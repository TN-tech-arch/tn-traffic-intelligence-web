"""Release large training objects between queued jobs."""

from __future__ import annotations

import ctypes
import gc
import os


def release_training_memory() -> None:
    """Run Python/PyTorch cleanup and return freed allocator pages on Linux."""
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        if hasattr(torch, "mps") and hasattr(torch.mps, "empty_cache"):
            torch.mps.empty_cache()
    except Exception:
        pass
    gc.collect()
    if os.name == "posix":
        try:
            libc = ctypes.CDLL("libc.so.6")
            trim = getattr(libc, "malloc_trim", None)
            if trim is not None:
                trim(0)
        except OSError:
            pass
