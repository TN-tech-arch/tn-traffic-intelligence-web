"""T13/T16/T17: every one of the 12 adapters must produce a finite [N, H] output.

The foundation adapters are only executed when the official checkpoint is really
present in the local cache; otherwise the test records them as Unavailable
instead of pretending they ran (spec 8.4 / T17).
"""

import numpy as np
import pytest

from app.forecast.adapters import build_adapter
from app.forecast.base import RegionContext, WindowBatch
from app.forecast.foundation import chronos_status, timesfm_status
from app.forecast.registry import ALGORITHM_KEYS, default_params
from app.services import windows as win

L, H, S = 12, 4, 1
TOTAL = 120


def make_region(seed: int = 3) -> RegionContext:
    rng = np.random.RandomState(seed)
    series = 100 + 20 * np.sin(np.arange(TOTAL) / 6.0) + rng.normal(0, 1.0, TOTAL)
    scaler = win.fit_scaler(series[: int(TOTAL * 0.7)][:, None],
                            np.ones((int(TOTAL * 0.7), 1), dtype=bool), "standard")
    return RegionContext(
        source_key="test",
        region_id="R1",
        timestamps=(np.arange(TOTAL) * 3600 + 1700000000).astype("int64"),
        series_full=series,
        observed=np.ones(TOTAL, dtype=bool),
        imputed_end=np.full(TOTAL, -1, dtype="int32"),
        L=L,
        H=H,
        S=S,
        scaler=scaler,
        split_boundaries=[[0, 84], [84, 102], [102, 120]],
    )


def make_batch(region: RegionContext, split: str) -> WindowBatch:
    bounds = {"train": (0, 84), "validation": (84, 102), "test": (102, 120)}[split]
    starts = win.window_starts_for_range(TOTAL, bounds[0], bounds[1], L, H, S)
    x_raw, y_raw = win.stack_windows(region.series_full, starts, L, H)
    x_scaled = win.apply_scaler(x_raw.astype("float64"), region.scaler).astype("float32")
    y_scaled = win.apply_scaler(y_raw.astype("float64"), region.scaler).astype("float32")
    target_index = starts[:, None] + L + np.arange(H)[None, :]
    return WindowBatch(
        starts=starts,
        X_scaled=x_scaled,
        Y_scaled=y_scaled,
        X_raw=x_raw.astype("float32"),
        Y_raw=y_raw.astype("float32"),
        target_index=target_index.astype("int64"),
        target_timestamps=region.timestamps[target_index].astype("datetime64[s]"),
    )


FAST_DL = {"epochs": 2, "batch_size": 16, "hidden_size": 8, "hidden_layers": 1, "hidden_units": 16,
           "num_layers": 1, "d_model": 16, "n_heads": 4, "encoder_layers": 1, "early_stopping": False}


@pytest.mark.parametrize("algorithm", [k for k in ALGORITHM_KEYS if k not in ("timesfm", "chronos")])
def test_standard_adapters_produce_finite_output(algorithm):
    region = make_region()
    params = dict(default_params(algorithm))
    if algorithm in ("mlp", "rnn", "lstm", "gru", "transformer"):
        params.update(FAST_DL)
    if algorithm in ("random_forest",):
        params.update({"n_estimators": 8})
    if algorithm in ("xgboost", "lightgbm"):
        params.update({"n_estimators": 10})
    if algorithm == "arima":
        params.update({"p": 1, "d": 0, "q": 1})
    adapter = build_adapter(algorithm, params, "fit" if algorithm in ("arima", "prophet") else "train")
    train = make_batch(region, "train")
    validation = make_batch(region, "validation")
    result = adapter.fit(region=region, train=train, validation=validation)
    prediction = adapter.predict(region=region, state=result.state, batch=validation)
    assert prediction.shape == (validation.size, H), f"{algorithm} wrong shape {prediction.shape}"
    assert np.isfinite(prediction).all(), f"{algorithm} produced non finite values"


@pytest.mark.parametrize("algorithm,status_fn", [("timesfm", timesfm_status), ("chronos", chronos_status)])
def test_foundation_adapters_use_real_weights_or_report_unavailable(algorithm, status_fn):
    status = status_fn()
    if not status["ready"]:
        pytest.skip(
            f"{algorithm}: Unavailable — package_installed={status['package_installed']}, "
            f"checkpoints={[c['available'] for c in status['checkpoints']]}"
        )
    checkpoint = status["default_checkpoint"]
    region = make_region()
    params = {"checkpoint_id": checkpoint, "effective_context_length": L, "inference_batch_size": 2}
    adapter = build_adapter(algorithm, params, "zero_shot")
    train = make_batch(region, "train")
    validation = make_batch(region, "validation")
    result = adapter.fit(region=region, train=train, validation=validation)
    assert result.history.get("no_epochs") is True, "zero-shot must not report training epochs"
    prediction = adapter.predict(region=region, state=result.state, batch=validation)
    assert prediction.shape == (validation.size, H)
    assert np.isfinite(prediction).all()
    assert result.state.get("checkpoint_id") == checkpoint
    assert result.state.get("license")


def test_foundation_adapter_reports_missing_weights_instead_of_faking():
    region = make_region()
    params = {"checkpoint_id": "amazon/chronos-bolt-base-not-a-real-repo", "inference_batch_size": 2}
    adapter = build_adapter("chronos", params, "zero_shot")
    with pytest.raises(RuntimeError):
        adapter.fit(region=region, train=make_batch(region, "train"), validation=None)
