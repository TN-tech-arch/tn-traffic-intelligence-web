"""Safe artifact path handling (spec 10.3 / 14.4): whitelist + no path traversal."""

from __future__ import annotations

import shutil
from pathlib import Path

from app.core.errors import Conflict
from app.runtime_paths import current_artifacts_dir


def artifact_root() -> Path:
    root = current_artifacts_dir().resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def safe_dir(*parts: str) -> Path:
    """Return a path inside the artifact root, rejecting traversal attempts."""
    root = artifact_root()
    candidate = root.joinpath(*parts)
    resolved = candidate.resolve() if candidate.exists() else candidate.absolute()
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise Conflict(f"非法的工件路径: {candidate}", code="UNSAFE_PATH") from exc
    return resolved


def ensure_dir(*parts: str) -> Path:
    path = safe_dir(*parts)
    path.mkdir(parents=True, exist_ok=True)
    return path


def remove_registered(path: Path) -> bool:
    """Delete an artifact directory only if it is inside the registered root."""
    root = artifact_root()
    try:
        resolved = path.resolve()
    except OSError:
        return False
    if root not in resolved.parents:
        return False
    if resolved.exists():
        shutil.rmtree(resolved, ignore_errors=True)
        return True
    return False
