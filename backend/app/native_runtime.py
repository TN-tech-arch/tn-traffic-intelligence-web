"""Load a compatible Windows C++ runtime before native ML libraries."""

from __future__ import annotations

import ctypes
import os
import sys
import sysconfig
import threading
from pathlib import Path
from typing import Any

_LOCK = threading.Lock()
_STATUS: dict[str, Any] | None = None
_DLL_HANDLES: list[Any] = []
_DLL_DIRECTORY_HANDLES: list[Any] = []


def _candidate_paths() -> list[Path]:
    candidates: list[Path] = []
    prefixes = [Path(sys.prefix), Path(sys.base_prefix)]
    for prefix in prefixes:
        candidates.extend(
            [
                prefix / "tn_runtime" / "msvcp140.dll",
                prefix / "msvcp140.dll",
                prefix / "Lib" / "site-packages" / "sklearn" / ".libs" / "msvcp140.dll",
            ]
        )
    purelib = sysconfig.get_paths().get("purelib")
    if purelib:
        candidates.append(Path(purelib) / "sklearn" / ".libs" / "msvcp140.dll")
    candidates.append(
        Path(__file__).resolve().parents[2]
        / ".venv"
        / "Lib"
        / "site-packages"
        / "sklearn"
        / ".libs"
        / "msvcp140.dll"
    )
    unique: list[Path] = []
    seen: set[str] = set()
    for path in candidates:
        key = os.path.normcase(str(path))
        if key not in seen:
            seen.add(key)
            unique.append(path)
    return unique


def ensure_windows_cpp_runtime() -> dict[str, Any]:
    """Preload the project's compatible MSVC runtime once per process.

    Some Windows installations retain an older ``msvcp140.dll`` even though the
    VC++ redistributable is registered as current. PyTorch and LightGBM native
    DLLs then fail depending on which library happens to be imported first.
    Loading the compatible DLL by absolute path removes that import-order
    dependency.
    """

    global _STATUS
    if os.name != "nt":
        return {"loaded": False, "platform": os.name, "reason": "not_windows"}
    if _STATUS is not None:
        return dict(_STATUS)
    with _LOCK:
        if _STATUS is not None:
            return dict(_STATUS)
        attempted: list[str] = []
        for path in _candidate_paths():
            attempted.append(str(path))
            if not path.is_file():
                continue
            try:
                handle = ctypes.WinDLL(str(path))
                directory_handle = os.add_dll_directory(str(path.parent))
            except (AttributeError, OSError) as exc:
                continue
            _DLL_HANDLES.append(handle)
            _DLL_DIRECTORY_HANDLES.append(directory_handle)
            _STATUS = {
                "loaded": True,
                "path": str(path),
                "file_size": path.stat().st_size,
            }
            return dict(_STATUS)
        _STATUS = {
            "loaded": False,
            "reason": "compatible_msvcp140_not_found_or_load_failed",
            "attempted": attempted,
        }
        return dict(_STATUS)


def native_runtime_status() -> dict[str, Any]:
    """Return the immutable result of the process-wide runtime probe."""

    return ensure_windows_cpp_runtime()
