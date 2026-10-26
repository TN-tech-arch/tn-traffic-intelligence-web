"""Request-scoped filesystem paths for the multi-session web deployment."""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from app.core.config import settings


@dataclass(frozen=True)
class RuntimePaths:
    session_id: str
    root: Path
    data_dir: Path
    db_path: Path
    processed_dir: Path
    artifacts_dir: Path
    raw_dir: Path
    model_cache_dir: Path
    ephemeral: bool = True


_CURRENT_PATHS: ContextVar[RuntimePaths | None] = ContextVar(
    "tn_current_runtime_paths", default=None
)


def default_paths() -> RuntimePaths:
    return RuntimePaths(
        session_id="local",
        root=settings.project_root,
        data_dir=settings.data_dir,
        db_path=settings.db_path,
        processed_dir=settings.processed_dir,
        artifacts_dir=settings.artifacts_dir,
        raw_dir=settings.raw_dir,
        model_cache_dir=settings.model_cache_dir,
        ephemeral=False,
    )


def current_paths() -> RuntimePaths:
    return _CURRENT_PATHS.get() or default_paths()


def current_session_id() -> str:
    return current_paths().session_id


def current_data_dir() -> Path:
    return current_paths().data_dir


def current_db_path() -> Path:
    return current_paths().db_path


def current_processed_dir() -> Path:
    return current_paths().processed_dir


def current_artifacts_dir() -> Path:
    return current_paths().artifacts_dir


def current_raw_dir() -> Path:
    return current_paths().raw_dir


def current_model_cache_dir() -> Path:
    return current_paths().model_cache_dir


def ensure_current_dirs() -> None:
    paths = current_paths()
    for path in (
        paths.data_dir,
        paths.processed_dir,
        paths.artifacts_dir,
        paths.model_cache_dir,
        paths.data_dir / "logs",
        paths.data_dir / "backups",
    ):
        path.mkdir(parents=True, exist_ok=True)


def set_current_paths(paths: RuntimePaths) -> Token[RuntimePaths | None]:
    return _CURRENT_PATHS.set(paths)


def reset_current_paths(token: Token[RuntimePaths | None]) -> None:
    _CURRENT_PATHS.reset(token)


@contextmanager
def use_paths(paths: RuntimePaths) -> Iterator[RuntimePaths]:
    token = set_current_paths(paths)
    try:
        yield paths
    finally:
        reset_current_paths(token)
