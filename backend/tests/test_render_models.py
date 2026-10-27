"""Render web profile exposes only the ten local forecasting models."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def test_render_profile_registry_has_ten_local_models():
    project_root = Path(__file__).resolve().parents[2]
    backend_root = project_root / "backend"
    env = {
        **os.environ,
        "TN_LOCAL_MODELS_ONLY": "1",
        "PYTHONPATH": str(backend_root),
    }
    command = [
        sys.executable,
        "-c",
        (
            "from app.forecast.registry import ALGORITHM_KEYS; "
            "print(','.join(ALGORITHM_KEYS))"
        ),
    ]
    result = subprocess.run(
        command,
        cwd=project_root,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    keys = result.stdout.strip().split(",")
    assert keys == [
        "arima",
        "prophet",
        "random_forest",
        "xgboost",
        "lightgbm",
        "mlp",
        "rnn",
        "lstm",
        "gru",
        "transformer",
    ]
