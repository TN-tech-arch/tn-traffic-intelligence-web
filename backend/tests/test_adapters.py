"""T13/T16/T17: every one of the 12 adapters must produce a finite [N, H] output.

The foundation adapters are only executed when the official checkpoint is really
present in the local cache; otherwise the test records them as Unavailable
instead of pretending they ran (spec 8.4 / T17).
"""

from dataclasses import replace

import numpy as np
import pandas as pd
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


def test_arima_rolling_predictions_append_only_new_observations():
    from statsmodels.tsa.arima.model import ARIMA

    region = make_region()
    params = dict(default_params("arima"))
    params.update({"p": 1, "d": 0, "q": 1, "refit_interval": 0})
    adapter = build_adapter("arima", params, "fit")
    train = make_batch(region, "train")
    validation = make_batch(region, "validation")
    result = adapter.fit(region=region, train=train, validation=validation)

    progress_values = []
    actual = adapter.predict(
        region=region,
        state=result.state,
        batch=validation,
        progress=lambda stage, percent, message, extra=None: progress_values.append(percent),
    )

    train_end = int(result.state["train_end_index"])
    model = ARIMA(
        region.series_full[: train_end + 1],
        order=tuple(result.state["order"]),
        trend=result.state["trend"],
        enforce_stationarity=result.state["enforce_stationarity"],
        enforce_invertibility=result.state["enforce_invertibility"],
    )
    fitted = model.smooth(np.asarray(result.state["params"], dtype="float64"))
    expected = np.empty_like(actual)
    last_origin = train_end
    for row, start in enumerate(validation.starts):
        origin = int(start) + region.L - 1
        if origin > last_origin:
            fitted = fitted.append(region.series_full[last_origin + 1: origin + 1], refit=False)
            last_origin = origin
        expected[row] = np.asarray(fitted.forecast(steps=region.H), dtype="float64")

    assert np.allclose(actual, expected, rtol=1e-9, atol=1e-9)
    assert progress_values
    assert progress_values[-1] == 100.0


def test_prophet_predict_accepts_explicit_false_seasonality():
    region = make_region()
    params = dict(default_params("prophet"))
    params.update({"daily_seasonality": False, "weekly_seasonality": False, "yearly_seasonality": False})
    adapter = build_adapter("prophet", params, "fit")
    train = make_batch(region, "train")
    validation = make_batch(region, "validation")
    result = adapter.fit(region=region, train=train, validation=validation)
    prediction = adapter.predict(region=region, state=result.state, batch=validation)
    assert prediction.shape == (validation.size, H)
    assert np.isfinite(prediction).all()


def test_prophet_predict_reuses_serialized_training_model(monkeypatch):
    region = make_region()
    params = dict(default_params("prophet"))
    params.update({"daily_seasonality": False, "weekly_seasonality": False})
    adapter = build_adapter("prophet", params, "fit")
    train = make_batch(region, "train")
    validation = make_batch(region, "validation")
    result = adapter.fit(region=region, train=train, validation=validation)
    assert isinstance(result.state.get("model_json"), str)

    from prophet import Prophet
    from prophet.serialize import model_from_json

    def fail_if_refit(*args, **kwargs):
        raise AssertionError("Prophet must not fit during prediction")

    monkeypatch.setattr(Prophet, "fit", fail_if_refit)
    progress_values = []
    prediction = adapter.predict(
        region=region,
        state=result.state,
        batch=validation,
        progress=lambda stage, percent, message, extra=None: progress_values.append(percent),
    )
    assert prediction.shape == (validation.size, H)
    assert np.isfinite(prediction).all()
    assert progress_values and progress_values[-1] == 100.0

    trained_model = model_from_json(result.state["model_json"])
    expected = []
    for timestamps in validation.target_timestamps:
        frame = pd.DataFrame(
            {"ds": pd.to_datetime(timestamps, unit="s")}
        )
        expected.append(
            np.asarray(trained_model.predict(frame)["yhat"], dtype="float64")
        )
    expected = np.vstack(expected)
    assert np.allclose(prediction, expected, rtol=1e-9, atol=1e-9)

    missing_model_state = dict(result.state)
    missing_model_state.pop("model_json")
    with pytest.raises(ValueError):
        adapter.predict(region=region, state=missing_model_state, batch=validation)


def test_xgboost_passes_early_stopping_to_estimator():
    params = dict(default_params("xgboost"))
    params["early_stopping_rounds"] = 2
    adapter = build_adapter("xgboost", params, "train")
    estimator = adapter._make_estimator()
    assert estimator.early_stopping_rounds == 2


def test_validated_default_profiles_match_model_complexity():
    prophet = default_params("prophet")
    assert prophet["daily_fourier_order"] == 4
    assert prophet["holiday_country"] == "auto"
    assert prophet["random_seed"] == 42
    assert "refit_interval" not in prophet
    assert "calibration_days" not in prophet
    assert not any("calibration" in key for key in prophet)
    assert "interval_width" not in prophet

    transformer = default_params("transformer")
    assert transformer["d_model"] == 64
    assert transformer["n_heads"] == 4
    assert transformer["encoder_layers"] == 2
    assert transformer["dim_feedforward"] == 128
    assert transformer["learning_rate"] == 0.0005
    assert transformer["patience"] == 8


def test_prophet_default_holiday_calendar_follows_data_source():
    params = default_params("prophet")
    adapter = build_adapter("prophet", params, "fit")
    region = make_region()
    assert adapter._holiday_country(replace(region, source_key="milano")) == "IT"
    assert adapter._holiday_country(replace(region, source_key="trentino")) == "IT"
    assert adapter._holiday_country(replace(region, source_key="zte")) == "CN"

    disabled = build_adapter("prophet", {**params, "holiday_country": "none"}, "fit")
    assert disabled._holiday_country(replace(region, source_key="milano")) is None


def test_removed_prophet_parameters_are_ignored_by_new_validation():
    from app.services.validation import check_model_params

    params = {
        **default_params("prophet"),
        "refit_interval": 144,
        "calibration_days": 6,
        "interval_width": 0.8,
    }
    issues, coerced = check_model_params("prophet", params, mode="fit")
    assert not [issue for issue in issues if issue["severity"] == "error"]
    assert "refit_interval" not in coerced
    assert "calibration_days" not in coerced
    assert "interval_width" not in coerced
