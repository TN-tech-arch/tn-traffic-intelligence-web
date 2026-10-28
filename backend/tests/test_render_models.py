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


def test_render_profile_uses_balanced_deep_defaults():
    project_root = Path(__file__).resolve().parents[2]
    env = {
        **os.environ,
        "TN_LOCAL_MODELS_ONLY": "1",
        "PYTHONPATH": str(project_root / "backend"),
    }
    command = [
        sys.executable,
        "-c",
        (
            "import json; "
            "from app.forecast.registry import default_params; "
            "keys=['mlp','rnn','lstm','gru','transformer']; "
            "print(json.dumps({k: default_params(k) for k in keys}))"
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
    defaults = __import__("json").loads(result.stdout)
    for key in ("mlp", "rnn", "lstm", "gru", "transformer"):
        assert defaults[key]["epochs"] == 40
        assert defaults[key]["patience"] == 8
        assert defaults[key]["early_stopping"] is True
    assert defaults["mlp"]["hidden_units"] == 64
    assert defaults["mlp"]["hidden_layers"] == 1
    for key in ("rnn", "lstm", "gru"):
        assert defaults[key]["hidden_size"] == 64
        assert defaults[key]["num_layers"] == 1
    assert defaults["transformer"]["d_model"] == 64
    assert defaults["transformer"]["n_heads"] == 4
    assert defaults["transformer"]["encoder_layers"] == 1
    assert defaults["transformer"]["dim_feedforward"] == 128
