"""Regression tests for native runtime loading and mixed evaluation outcomes."""

from __future__ import annotations

import os

import numpy as np
import pytest

from app.native_runtime import ensure_windows_cpp_runtime
from app.workers.tasks import _aggregate_evaluation_status


@pytest.mark.parametrize(
    ("statuses", "cancelled", "expected"),
    [
        ([], False, "Failed"),
        (["Completed", "Completed"], False, "Completed"),
        (["Completed", "Failed"], False, "Partial"),
        (["Partial", "Failed"], False, "Partial"),
        (["Failed", "Failed"], False, "Failed"),
        (["Completed", "Completed"], True, "Stopped"),
    ],
)
def test_aggregate_evaluation_status(statuses, cancelled, expected):
    reports = [{"status": status} for status in statuses]
    assert _aggregate_evaluation_status(reports, cancelled=cancelled) == expected


@pytest.mark.skipif(os.name != "nt", reason="Windows native runtime regression")
def test_windows_runtime_allows_torch_and_lightgbm_native_calls():
    status = ensure_windows_cpp_runtime()
    assert status["loaded"] is True, status

    import torch
    from lightgbm import LGBMRegressor

    assert torch.__version__

    rng = np.random.RandomState(7)
    features = rng.normal(size=(240, 8))
    target = features[:, 0] * 2.0
    model = LGBMRegressor(n_estimators=5, n_jobs=1, verbosity=-1)
    model.fit(features, target)
    prediction = model.predict(features[:8])
    assert prediction.shape == (8,)
    assert np.isfinite(prediction).all()
