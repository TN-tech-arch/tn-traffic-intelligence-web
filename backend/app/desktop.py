"""Windows desktop shell for the local TN Traffic Intelligence application."""

from __future__ import annotations

import argparse
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from app.core.config import settings
from app.db.connection import query_one
from app.db.migrate import run_migrations

APP_TITLE = "TianNuo Traffic Intelligence"
DEFAULT_PORT = 8077


def _log(message: str) -> None:
    log_dir = settings.data_dir / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    with (log_dir / "desktop.log").open("a", encoding="utf-8") as handle:
        handle.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {message}\n")


def _initialize_database() -> None:
    run_migrations()
    source_count = int(query_one("SELECT COUNT(*) AS n FROM data_sources")["n"])
    if source_count == 0:
        from app.services.ingest import import_all

        _log("initializing source data")
        report = import_all()
        _log(f"source data ready: {sorted(report)}")


def _healthy(port: int, timeout: float = 2.0) -> bool:
    try:
        with urllib.request.urlopen(
            f"http://127.0.0.1:{port}/api/health",
            timeout=timeout,
        ) as response:
            return response.status == 200
    except Exception:
        return False


def _port_available(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def _choose_port() -> tuple[int, bool]:
    if _healthy(DEFAULT_PORT):
        return DEFAULT_PORT, False
    if _port_available(DEFAULT_PORT):
        return DEFAULT_PORT, True
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1]), True


class LocalService:
    def __init__(self) -> None:
        self.port = DEFAULT_PORT
        self.owns_service = False
        self.processes: list[subprocess.Popen] = []
        self._output = None

    def start(self) -> str:
        _initialize_database()
        self.port, self.owns_service = _choose_port()
        if not self.owns_service:
            _log(f"reusing local API on port {self.port}")
            return f"http://127.0.0.1:{self.port}/"

        environment = os.environ.copy()
        environment.update(
            {
                "TN_PROJECT_ROOT": str(settings.project_root),
                "TN_DATA_DIR": str(settings.data_dir),
                "TN_MODEL_CACHE": str(settings.model_cache_dir),
                "TN_DB_PATH": str(settings.db_path),
                "TN_HOST": "127.0.0.1",
                "TN_PORT": str(self.port),
                "HF_HOME": str(settings.model_cache_dir / "hf"),
            }
        )
        backend_path = str(settings.project_root / "backend")
        existing_python_path = environment.get("PYTHONPATH")
        environment["PYTHONPATH"] = (
            f"{backend_path};{existing_python_path}"
            if existing_python_path
            else backend_path
        )
        creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        log_path = settings.data_dir / "logs" / "desktop-services.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        self._output = log_path.open("a", encoding="utf-8")
        python = Path(sys.executable)
        self.processes = [
            subprocess.Popen(
                [str(python), "-m", "app.workers.runner"],
                cwd=settings.project_root,
                env=environment,
                stdout=self._output,
                stderr=subprocess.STDOUT,
                creationflags=creation_flags,
            ),
            subprocess.Popen(
                [
                    str(python),
                    "-m",
                    "uvicorn",
                    "app.main:app",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(self.port),
                ],
                cwd=settings.project_root,
                env=environment,
                stdout=self._output,
                stderr=subprocess.STDOUT,
                creationflags=creation_flags,
            ),
        ]
        _log(f"started local services on port {self.port}")
        for _ in range(120):
            if any(process.poll() is not None for process in self.processes):
                self.stop()
                raise RuntimeError("本地服务进程异常退出，请查看 data/logs/desktop-services.log")
            if _healthy(self.port):
                return f"http://127.0.0.1:{self.port}/"
            time.sleep(0.5)
        self.stop()
        raise RuntimeError("本地服务启动超时，请查看 data/logs/desktop.log")

    def stop(self) -> None:
        for process in reversed(self.processes):
            if process.poll() is None:
                process.terminate()
        deadline = time.time() + 6
        for process in reversed(self.processes):
            remaining = max(0.1, deadline - time.time())
            try:
                process.wait(timeout=remaining)
            except subprocess.TimeoutExpired:
                process.kill()
        self.processes.clear()
        if self._output:
            self._output.close()
            self._output = None


def _show_error(message: str) -> None:
    try:
        import ctypes

        ctypes.windll.user32.MessageBoxW(None, message, APP_TITLE, 0x10)
    except Exception:
        pass


def _run_window(service: LocalService) -> int:
    import webview

    icon = settings.project_root / "tn.ico"
    window = webview.create_window(
        APP_TITLE,
        html=(
            "<html><body style='margin:0;display:grid;place-items:center;"
            "height:100vh;background:#f4f8ff;color:#16325c;font-family:Segoe UI'>"
            "<div style='text-align:center'><h2>TianNuo Traffic Intelligence</h2>"
            "<p>正在启动本地数据与预测服务...</p></div></body></html>"
        ),
        width=1600,
        height=1000,
        min_size=(1100, 720),
        background_color="#F4F8FF",
    )

    def boot() -> None:
        try:
            window.load_url(service.start())
        except Exception as exc:
            _log(f"desktop startup failed: {exc}")
            window.load_html(
                "<html><body style='font-family:Segoe UI;padding:32px'>"
                f"<h2>启动失败</h2><p>{exc}</p>"
                "<p>请使用“停止运行”清理进程后重试，或查看 data/logs/desktop.log。</p>"
                "</body></html>"
            )

    try:
        webview.start(
            boot,
            gui="edgechromium",
            debug=False,
            private_mode=False,
            storage_path=str(settings.data_dir / "webview"),
            icon=str(icon) if icon.exists() else None,
        )
    finally:
        service.stop()
    return 0


def _run_smoke_test(service: LocalService) -> int:
    try:
        url = service.start()
        with urllib.request.urlopen(url, timeout=30) as response:
            body = response.read(512)
            if response.status != 200 or b'<div id="root"' not in body:
                raise RuntimeError("desktop shell could not load the application page")
        print(f"desktop-smoke-ok {url}")
        return 0
    finally:
        service.stop()


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--smoke-test", action="store_true")
    args, _ = parser.parse_known_args()
    service = LocalService()
    try:
        if args.smoke_test:
            return _run_smoke_test(service)
        return _run_window(service)
    except Exception as exc:
        _log(f"desktop shell failed: {exc}")
        if not args.smoke_test:
            _show_error(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
