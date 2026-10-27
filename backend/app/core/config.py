"""Central runtime configuration.

All paths are derived from the project root so the application can be started
from any working directory.  Environment variables can override everything,
which keeps the packaged/installed deployment configurable without editing code.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _env_path(name: str, default: Path) -> Path:
    raw = os.environ.get(name)
    if raw:
        return Path(raw).expanduser().resolve()
    return default


PROJECT_ROOT = Path(__file__).resolve().parents[3]


@dataclass(frozen=True)
class Settings:
    project_root: Path = PROJECT_ROOT
    raw_dir_override: Path | None = field(
        default_factory=lambda: _env_path("TN_RAW_DIR", PROJECT_ROOT / "data" / "raw")
        if os.environ.get("TN_RAW_DIR")
        else None
    )
    data_dir: Path = field(default_factory=lambda: _env_path("TN_DATA_DIR", PROJECT_ROOT / "data"))
    model_cache_dir: Path = field(
        default_factory=lambda: _env_path("TN_MODEL_CACHE", PROJECT_ROOT / "models_cache")
    )
    db_path: Path = field(
        default_factory=lambda: _env_path("TN_DB_PATH", PROJECT_ROOT / "data" / "tn_traffic.db")
    )
    host: str = field(default_factory=lambda: os.environ.get("TN_HOST", "127.0.0.1"))
    port: int = field(default_factory=lambda: int(os.environ.get("TN_PORT", "8077")))
    # Worker
    worker_poll_seconds: float = field(
        default_factory=lambda: float(os.environ.get("TN_WORKER_POLL", "0.75"))
    )
    worker_stale_seconds: int = field(
        default_factory=lambda: int(os.environ.get("TN_WORKER_STALE", "120"))
    )
    # Foundation model downloads.  HuggingFace is unreachable from some networks;
    # the official mirror is used by default and can be overridden.
    hf_endpoint: str = field(
        default_factory=lambda: os.environ.get("HF_ENDPOINT", "https://hf-mirror.com")
    )
    web_mode: bool = field(
        default_factory=lambda: os.environ.get("TN_WEB_MODE", "0").lower() in {"1", "true", "yes"}
    )
    sessions_root: Path = field(
        default_factory=lambda: _env_path("TN_SESSIONS_DIR", PROJECT_ROOT / "data" / "sessions")
    )
    cookie_secure: bool = field(
        default_factory=lambda: os.environ.get("TN_COOKIE_SECURE", "1").lower()
        in {"1", "true", "yes"}
    )
    local_models_only: bool = field(
        default_factory=lambda: os.environ.get("TN_LOCAL_MODELS_ONLY", "0").lower()
        in {"1", "true", "yes"}
    )
    max_upload_mb: int = 25

    @property
    def raw_dir(self) -> Path:
        return self.raw_dir_override or (self.data_dir / "raw")

    @property
    def processed_dir(self) -> Path:
        return self.data_dir / "processed"

    @property
    def artifacts_dir(self) -> Path:
        return self.data_dir / "artifacts"

    def ensure_dirs(self) -> None:
        for path in (
            self.data_dir,
            self.raw_dir,
            self.processed_dir,
            self.artifacts_dir,
            self.model_cache_dir,
        ):
            path.mkdir(parents=True, exist_ok=True)


settings = Settings()

os.environ.setdefault("HF_ENDPOINT", settings.hf_endpoint)
# Keep HuggingFace caches inside the project so installs are self-contained.
os.environ.setdefault("HF_HOME", str(settings.model_cache_dir / "hf"))

