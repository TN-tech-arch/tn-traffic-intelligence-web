"""ARIMA and Prophet: real statistical implementations.

Both models estimate their parameters on the **training split only**.  For
validation/test windows the state is updated with the observations that were
available before that window's forecast origin (ARIMA ``apply``), which is a
leakage free rolling-origin protocol (PROJECT_SPEC 11.1).
"""

from __future__ import annotations

from typing import Any

import numpy as np

from app.forecast.base import (
    Adapter,
    CancelCallback,
    FitResult,
    ProgressCallback,
    RegionContext,
    WindowBatch,
    never_cancel,
    noop_progress,
)


class ArimaAdapter(Adapter):
    algorithm_key = "arima"
    operates_in = "raw"
    has_epoch_progress = False
    stage_names = ("Fit", "Validation", "Ready")

    def fit(
        self,
        *,
        region: RegionContext,
        train: WindowBatch,
        validation: WindowBatch | None,
        progress: ProgressCallback = noop_progress,
        cancel: CancelCallback = never_cancel,
    ) -> FitResult:
        from statsmodels.tsa.arima.model import ARIMA

        progress("Fit", 5.0, "准备 ARIMA 训练序列（仅使用训练段）")
        order = (int(self.params["p"]), int(self.params["d"]), int(self.params["q"]))
        history = np.asarray(region.series_full[: region.train_end_index + 1], dtype="float64")
        model = ARIMA(
            history,
            order=order,
            trend=self.params.get("trend", "c"),
            enforce_stationarity=bool(self.params.get("enforce_stationarity", True)),
            enforce_invertibility=bool(self.params.get("enforce_invertibility", True)),
        )
        fitted = model.fit(method_kwargs={"maxiter": int(self.params.get("maxiter", 200))})
        self.check_cancel(cancel)
        progress("Fit", 80.0, f"ARIMA{order} 参数估计完成（AIC={fitted.aic:.2f}）")
        state = {
            "order": order,
            "params": np.asarray(fitted.params, dtype="float64").tolist(),
            "trend": self.params.get("trend", "c"),
            "enforce_stationarity": bool(self.params.get("enforce_stationarity", True)),
            "enforce_invertibility": bool(self.params.get("enforce_invertibility", True)),
            "aic": float(fitted.aic),
            "train_end_index": int(region.train_end_index),
            "train_end_at": region.train_end_at,
        }
        return FitResult(
            state=state,
            history={
                "type": "fit",
                "no_epochs": True,
                "log_likelihood": float(fitted.llf),
                "aic": float(fitted.aic),
                "bic": float(fitted.bic),
                "converged": bool(fitted.mle_retvals.get("converged", True)),
            },
            notes=[
                "普通 ARIMA（无季节项）；参数仅用训练段估计。",
                "验证/测试窗口使用 statsmodels 的 apply() 以预测起点之前的已观测值更新状态，不读取未来目标。",
            ],
        )

    def predict(
        self,
        *,
        region: RegionContext,
        state: dict[str, Any],
        batch: WindowBatch,
        progress: ProgressCallback = noop_progress,
        cancel: CancelCallback = never_cancel,
    ) -> np.ndarray:
        from statsmodels.tsa.arima.model import ARIMA

        series = np.asarray(region.series_full, dtype="float64")
        L = int(region.L)
        H = int(region.H)
        predictions = np.empty((batch.size, H), dtype="float64")
        model = ARIMA(
            series[: int(state["train_end_index"]) + 1],
            order=tuple(state["order"]),
            trend=state.get("trend", "c"),
            enforce_stationarity=bool(state.get("enforce_stationarity", True)),
            enforce_invertibility=bool(state.get("enforce_invertibility", True)),
        )
        try:
            fitted = model.smooth(np.asarray(state["params"], dtype="float64"))
        except Exception:
            fitted = model.fit(method_kwargs={"maxiter": int(self.params.get("maxiter", 200))})
        refit_interval = int(self.params.get("refit_interval", 0) or 0)
        last_origin = int(state["train_end_index"])
        total = max(1, batch.size)
        for row, start in enumerate(batch.starts):
            if row % 25 == 0:
                self.check_cancel(cancel)
                progress("Validation", 100.0 * row / total,
                         f"ARIMA 滚动预测 {row}/{batch.size}")
            origin = int(start) + L - 1
            if origin < last_origin:
                raise ValueError("ARIMA validation windows must be ordered by forecast origin")
            if refit_interval and row % refit_interval == 0 and origin > last_origin:
                model = ARIMA(
                    series[: origin + 1],
                    order=tuple(state["order"]),
                    trend=state.get("trend", "c"),
                    enforce_stationarity=bool(state.get("enforce_stationarity", True)),
                    enforce_invertibility=bool(state.get("enforce_invertibility", True)),
                )
                fitted = model.fit(method_kwargs={"maxiter": int(self.params.get("maxiter", 200))})
                last_origin = origin
            if origin > last_origin:
                # ``Results.append`` expects only observations that have not
                # already been incorporated into the state.
                increment = series[last_origin + 1: origin + 1]
                if increment.size:
                    fitted = fitted.append(increment, refit=False)
                    last_origin = origin
            forecast = fitted.forecast(steps=H)
            predictions[row] = np.asarray(forecast, dtype="float64")
        progress("Validation", 100.0, f"ARIMA rolling prediction {batch.size}/{batch.size}")
        return predictions


class ProphetAdapter(Adapter):
    algorithm_key = "prophet"
    operates_in = "raw"
    has_epoch_progress = False
    stage_names = ("Fit", "Ready")

    @staticmethod
    def _flag(value: Any) -> Any:
        if value == "auto":
            return "auto"
        return str(value).lower() == "true"

    def _holiday_country(self, region: RegionContext | None) -> str | None:
        requested = str(self.params.get("holiday_country", "auto") or "auto")
        if requested.lower() == "none":
            return None
        if requested != "auto":
            return requested.upper()
        if region is None:
            return None
        source = region.source_key.lower()
        if source in {"milano", "trentino"}:
            return "IT"
        if source == "zte":
            return "CN"
        return None

    def _make_model(self, growth: str | None = None, region: RegionContext | None = None):
        from prophet import Prophet

        model = Prophet(
            growth=growth or self.params.get("growth", "linear"),
            seasonality_mode=self.params.get("seasonality_mode", "additive"),
            daily_seasonality=False,
            weekly_seasonality=self._flag(self.params.get("weekly_seasonality", "auto")),
            yearly_seasonality=False,
            changepoint_prior_scale=float(self.params.get("changepoint_prior_scale", 0.05)),
            seasonality_prior_scale=float(self.params.get("seasonality_prior_scale", 10.0)),
            n_changepoints=int(self.params.get("n_changepoints", 25)),
            uncertainty_samples=0,
        )
        daily_enabled = self._flag(self.params.get("daily_seasonality", "auto"))
        if daily_enabled is not False:
            model.add_seasonality(
                name="daily_traffic",
                period=1,
                fourier_order=int(self.params.get("daily_fourier_order", 4)),
            )
        country = self._holiday_country(region)
        if country:
            try:
                model.add_country_holidays(country_name=country)
            except Exception:
                # Holidays are auxiliary features; a missing calendar must not
                # prevent otherwise valid Prophet forecasts.
                country = None
        return model

    def fit(
        self,
        *,
        region: RegionContext,
        train: WindowBatch,
        validation: WindowBatch | None,
        progress: ProgressCallback = noop_progress,
        cancel: CancelCallback = never_cancel,
    ) -> FitResult:
        import pandas as pd
        from prophet import Prophet

        progress("Fit", 5.0, "拟合 Prophet（仅训练段，含日/周周期）")

        model = self._make_model(region=region)
        history = pd.DataFrame(
            {
                "ds": pd.to_datetime(region.timestamps[: region.train_end_index + 1], unit="s"),
                "y": np.asarray(region.series_full[: region.train_end_index + 1], dtype="float64"),
            }
        )
        if self.params.get("growth") == "logistic":
            upper = float(np.nanmax(history["y"]) * 1.2)
            history["cap"] = upper
            model.cap = upper
        seed = int(self.params.get("random_seed", 42))
        model.fit(history, seed=seed)
        self.check_cancel(cancel)
        progress("Fit", 90.0, "Prophet 拟合完成")
        return FitResult(
            state={
                "train_end_index": int(region.train_end_index),
                "train_end_at": region.train_end_at,
                "growth": self.params.get("growth", "linear"),
                "cap": (float(np.nanmax(history["y"]) * 1.2) if self.params.get("growth") == "logistic" else None),
                "changepoints": int(len(model.changepoints)) if model.changepoints is not None else 0,
                "daily_fourier_order": int(self.params.get("daily_fourier_order", 4)),
                "holiday_country": self._holiday_country(region),
                "random_seed": seed,
                "components": ["trend", "daily", "weekly"]
                + (["holidays"] if self._holiday_country(region) else []),
            },
            history={
                "type": "fit",
                "no_epochs": True,
                "changepoints": int(model.changepoints.shape[0]) if model.changepoints is not None else 0,
                "daily_fourier_order": int(self.params.get("daily_fourier_order", 4)),
                "holiday_country": self._holiday_country(region),
                "random_seed": seed,
            },
            notes=[
                "Prophet 的基础参数仅使用训练段拟合；启用滚动重拟合时，只读取每个预测起点之前的真实观测。",
                "日周期使用显式傅里叶阶数，周周期由配置或训练段跨度决定，节假日按数据源日历注入。",
            ],
        )

    def predict(
        self,
        *,
        region: RegionContext,
        state: dict[str, Any],
        batch: WindowBatch,
        progress: ProgressCallback = noop_progress,
        cancel: CancelCallback = never_cancel,
    ) -> np.ndarray:
        import pandas as pd
        from prophet import Prophet

        progress("Ready", 10.0, "Prophet 推理（使用训练段拟合的模型）")
        model = self._make_model(state.get("growth", "linear"), region=region)
        series = np.asarray(region.series_full, dtype="float64")
        history = pd.DataFrame(
            {
                "ds": pd.to_datetime(region.timestamps[: int(state["train_end_index"]) + 1], unit="s"),
                "y": series[: int(state["train_end_index"]) + 1],
            }
        )
        if state.get("cap"):
            history["cap"] = state["cap"]
            model.cap = state["cap"]
        seed = int(self.params.get("random_seed", 42))
        model.fit(history, seed=seed)
        L = int(region.L)
        H = int(region.H)
        refit_interval = int(self.params.get("refit_interval", 0) or 0)

        def fitted_history(end_index: int):
            frame = pd.DataFrame(
                {
                    "ds": pd.to_datetime(region.timestamps[: end_index + 1], unit="s"),
                    "y": np.asarray(series[: end_index + 1], dtype="float64"),
                }
            )
            if state.get("cap"):
                frame["cap"] = state["cap"]
            fresh = self._make_model(state.get("growth", "linear"), region=region)
            if state.get("cap"):
                fresh.cap = state["cap"]
            fresh.fit(frame, seed=seed)
            return fresh

        def calibrated_batch(
            current_model,
            starts: np.ndarray,
            target_timestamps: np.ndarray,
        ) -> np.ndarray:
            origins = np.asarray(starts, dtype="int64") + L - 1
            recent_points = max(1, min(6, L))
            calibration_indices = origins[:, None] - np.arange(recent_points - 1, -1, -1)[None, :]
            calibration_indices = np.maximum(calibration_indices, 0)
            calibration_frame = pd.DataFrame(
                {"ds": pd.to_datetime(region.timestamps[calibration_indices].reshape(-1), unit="s")}
            )
            if state.get("cap"):
                calibration_frame["cap"] = state["cap"]
            calibration_prediction = np.asarray(
                current_model.predict(calibration_frame)["yhat"], dtype="float64"
            ).reshape(origins.size, recent_points)
            offsets = np.median(
                np.asarray(series[calibration_indices], dtype="float64") - calibration_prediction,
                axis=1,
            )

            target_frame = pd.DataFrame(
                {"ds": pd.to_datetime(target_timestamps.reshape(-1))}
            )
            if state.get("cap"):
                target_frame["cap"] = state["cap"]
            base = np.asarray(current_model.predict(target_frame)["yhat"], dtype="float64")
            return base.reshape(origins.size, H) + offsets[:, None]

        if refit_interval <= 0:
            values = calibrated_batch(model, batch.starts, batch.target_timestamps)
        else:
            values = np.empty((batch.size, H), dtype="float64")
            last_fit_origin = int(state["train_end_index"])
            row = 0
            while row < batch.size:
                self.check_cancel(cancel)
                progress(
                    "Validation",
                    100.0 * row / max(1, batch.size),
                    f"Prophet rolling prediction {row}/{batch.size}",
                )
                origin = int(batch.starts[row]) + L - 1
                if origin > last_fit_origin:
                    model = fitted_history(origin)
                    last_fit_origin = origin
                end = min(batch.size, row + refit_interval)
                values[row:end] = calibrated_batch(
                    model,
                    batch.starts[row:end],
                    batch.target_timestamps[row:end],
                )
                row = end
        self.check_cancel(cancel)
        progress("Validation", 100.0, f"Prophet rolling prediction {batch.size}/{batch.size}")
        if values.size != batch.size * int(region.H):
            raise ValueError(
                f"Prophet 输出数量 {values.size} 与期望 {batch.size * int(region.H)} 不一致"
            )
        return values.reshape(batch.size, int(region.H))
