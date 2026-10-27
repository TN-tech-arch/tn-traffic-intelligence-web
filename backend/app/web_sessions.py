"""Anonymous, ephemeral browser sessions for the public web deployment."""

from __future__ import annotations

import secrets
import shutil
import sqlite3
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.core.config import settings
from app.runtime_limits import (
    MAX_SESSIONS,
    REQUESTS_PER_MINUTE,
    SESSION_TTL_SECONDS,
)
from app.runtime_paths import RuntimePaths, reset_current_paths, set_current_paths


COOKIE_NAME = "tn_web_session"
_SESSION_TOKEN_LENGTH = 43
_PUBLIC_PATHS = ("/api/health", "/api/environment", "/assets/", "/favicon")
_manager: "SessionManager | None" = None


@dataclass
class SessionWorkspace:
    token: str
    paths: RuntimePaths
    created_at: float = field(default_factory=time.time)
    last_seen: float = field(default_factory=time.time)
    stop_event: threading.Event = field(default_factory=threading.Event)
    worker: threading.Thread | None = None
    request_times: deque[float] = field(default_factory=deque)
    lock: threading.Lock = field(default_factory=threading.Lock)

    def touch(self) -> None:
        self.last_seen = time.time()

    def rate_limited(self) -> bool:
        now = time.time()
        cutoff = now - 60.0
        with self.lock:
            while self.request_times and self.request_times[0] < cutoff:
                self.request_times.popleft()
            if len(self.request_times) >= REQUESTS_PER_MINUTE:
                return True
            self.request_times.append(now)
            return False


class SessionManager:
    def __init__(
        self,
        bootstrap: Callable[[], dict],
        *,
        root: Path | None = None,
    ) -> None:
        self.bootstrap = bootstrap
        self.root = root or settings.sessions_root
        self.base_root = self.root / "base"
        self.base = self._make_paths("base", self.base_root)
        self._sessions: dict[str, SessionWorkspace] = {}
        self._lock = threading.RLock()
        self._shutdown = threading.Event()
        self._cleanup_thread: threading.Thread | None = None

    def _make_paths(self, token: str, root: Path) -> RuntimePaths:
        data_dir = root / "data"
        return RuntimePaths(
            session_id=token,
            root=root,
            data_dir=data_dir,
            db_path=data_dir / "tn_traffic.db",
            processed_dir=data_dir / "processed",
            artifacts_dir=data_dir / "artifacts",
            raw_dir=settings.raw_dir,
            model_cache_dir=settings.model_cache_dir,
        )

    @staticmethod
    def _valid_token(token: str | None) -> bool:
        return bool(
            token
            and len(token) == _SESSION_TOKEN_LENGTH
            and all(ch.isalnum() or ch in "-_" for ch in token)
        )

    def initialize(self) -> None:
        from app.db.connection import close_current_connections

        if self.base_root.exists():
            shutil.rmtree(self.base_root, ignore_errors=True)
        for path in (
            self.base.data_dir,
            self.base.processed_dir,
            self.base.artifacts_dir,
            self.base.data_dir / "logs",
            self.base.data_dir / "backups",
            self.base.model_cache_dir,
        ):
            path.mkdir(parents=True, exist_ok=True)
        token = set_current_paths(self.base)
        try:
            self.bootstrap()
            close_current_connections()
        finally:
            reset_current_paths(token)
        self._cleanup_thread = threading.Thread(
            target=self._cleanup_loop,
            name="tn-session-cleanup",
            daemon=True,
        )
        self._cleanup_thread.start()

    def get(self, token: str | None) -> SessionWorkspace | None:
        if not self._valid_token(token):
            return None
        with self._lock:
            workspace = self._sessions.get(str(token))
        if workspace:
            workspace.touch()
        return workspace

    def create(self) -> SessionWorkspace:
        with self._lock:
            if len(self._sessions) >= MAX_SESSIONS:
                idle_candidates = sorted(
                    (
                        workspace
                        for workspace in self._sessions.values()
                        if not self._has_active_jobs(workspace)
                    ),
                    key=lambda workspace: workspace.last_seen,
                )
                if idle_candidates:
                    self._remove(idle_candidates[0])
            if len(self._sessions) >= MAX_SESSIONS:
                raise RuntimeError("当前公开演示的模型任务已满，请稍后重新打开。")
            token = secrets.token_urlsafe(32)
            root = self.root / token
            paths = self._make_paths(token, root)
            for path in (
                paths.data_dir,
                paths.processed_dir,
                paths.artifacts_dir,
                paths.data_dir / "logs",
                paths.data_dir / "backups",
                paths.model_cache_dir,
            ):
                path.mkdir(parents=True, exist_ok=True)
            shutil.copy2(self.base.db_path, paths.db_path)
            shutil.copytree(self.base.processed_dir, paths.processed_dir, dirs_exist_ok=True)
            workspace = SessionWorkspace(token=token, paths=paths)
            self._sessions[token] = workspace
            workspace.worker = threading.Thread(
                target=self._run_session_worker,
                args=(workspace,),
                name=f"tn-worker-{token[:8]}",
                daemon=True,
            )
            workspace.worker.start()
            return workspace

    def _run_session_worker(self, workspace: SessionWorkspace) -> None:
        from app.db.connection import close_current_connections
        from app.workers.runner import run_worker_loop

        token = set_current_paths(workspace.paths)
        try:
            run_worker_loop(workspace.stop_event, identity=workspace.token[:8])
        finally:
            close_current_connections()
            reset_current_paths(token)

    def _has_active_jobs(self, workspace: SessionWorkspace) -> bool:
        try:
            conn = sqlite3.connect(str(workspace.paths.db_path), timeout=2.0)
            try:
                row = conn.execute(
                    "SELECT COUNT(*) FROM jobs WHERE state IN ('Queued','Running')"
                ).fetchone()
                return bool(row and row[0])
            finally:
                conn.close()
        except sqlite3.Error:
            return False

    def _remove(self, workspace: SessionWorkspace) -> None:
        workspace.stop_event.set()
        if workspace.worker and workspace.worker.is_alive():
            workspace.worker.join(timeout=2.0)
        if workspace.worker and workspace.worker.is_alive():
            return
        root = workspace.paths.root.resolve()
        sessions_root = self.root.resolve()
        if root.parent != sessions_root:
            return
        shutil.rmtree(root, ignore_errors=True)
        with self._lock:
            self._sessions.pop(workspace.token, None)

    def _cleanup_loop(self) -> None:
        while not self._shutdown.wait(60.0):
            cutoff = time.time() - SESSION_TTL_SECONDS
            with self._lock:
                candidates = [
                    workspace
                    for workspace in self._sessions.values()
                    if workspace.last_seen < cutoff and not self._has_active_jobs(workspace)
                ]
            for workspace in candidates:
                self._remove(workspace)

    def shutdown(self) -> None:
        self._shutdown.set()
        if self._cleanup_thread:
            self._cleanup_thread.join(timeout=2.0)
        with self._lock:
            sessions = list(self._sessions.values())
        for workspace in sessions:
            workspace.stop_event.set()
        for workspace in sessions:
            if workspace.worker:
                workspace.worker.join(timeout=2.0)


class SessionIsolationMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        manager = get_session_manager()
        path = request.url.path
        if not settings.web_mode or manager is None:
            return await call_next(request)

        if path.startswith(_PUBLIC_PATHS):
            token = set_current_paths(manager.base)
            try:
                return await call_next(request)
            finally:
                reset_current_paths(token)

        workspace = manager.get(request.cookies.get(COOKIE_NAME))
        created = workspace is None
        if workspace is None:
            try:
                workspace = manager.create()
            except RuntimeError as exc:
                return JSONResponse(status_code=503, content={"message": str(exc)})
        if workspace.rate_limited():
            return JSONResponse(
                status_code=429,
                content={"message": "请求过于频繁，请稍后再试。", "code": "RATE_LIMITED"},
            )

        workspace.touch()
        request.state.web_session = workspace.token
        token = set_current_paths(workspace.paths)
        try:
            response = await call_next(request)
        finally:
            reset_current_paths(token)
        if created:
            response.set_cookie(
                COOKIE_NAME,
                workspace.token,
                httponly=True,
                secure=settings.cookie_secure,
                samesite="lax",
                path="/",
            )
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; "
            "worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
        )
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        response.headers.setdefault("X-Frame-Options", "DENY")
        return response


def initialize_session_manager(bootstrap: Callable[[], dict]) -> SessionManager:
    global _manager
    _manager = SessionManager(bootstrap)
    _manager.initialize()
    return _manager


def get_session_manager() -> SessionManager | None:
    return _manager


def shutdown_session_manager() -> None:
    global _manager
    if _manager is not None:
        _manager.shutdown()
        _manager = None
