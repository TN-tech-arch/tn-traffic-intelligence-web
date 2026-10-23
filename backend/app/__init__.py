"""TN Traffic Intelligence backend package."""

__version__ = "3.2.0"

# This must run before NumPy/PyTorch/LightGBM native extensions are imported.
from app.native_runtime import ensure_windows_cpp_runtime

ensure_windows_cpp_runtime()
