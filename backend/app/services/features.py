"""Clustering feature extraction from the real traffic series (spec 5.2)."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

FEATURE_LABELS: dict[str, dict[str, str]] = {
    "mean": {"zh": "平均流量水平", "help": "窗口内有效观测的平均值（源单位）。"},
    "std": {"zh": "波动强度", "help": "窗口内有效观测的标准差。"},
    "cv": {"zh": "变异系数", "help": "标准差 / 平均值，衡量相对波动。"},
    "intraday_peak_ratio": {"zh": "日内峰值比", "help": "日内小时均值最大值 / 全天均值。"},
    "day_night_ratio": {"zh": "昼夜比", "help": "白天(06:00-18:00)均值 / 夜间均值。"},
    "weekday_weekend_ratio": {"zh": "工作日/周末比", "help": "工作日均值 / 周末均值。"},
    "daily_seasonality": {"zh": "日周期强度", "help": "1 - 日内残差方差/总方差, 越大表示日周期越显著。"},
    "trend_slope": {"zh": "长期趋势", "help": "窗口内线性趋势斜率（每点变化量）。"},
    "peak_hour": {"zh": "峰值时段", "help": "日内流量最高的整点小时。"},
    "sparsity": {"zh": "零值比例", "help": "零观测占有效观测的比例（ZTE 真实零值会被保留）。"},
}


def extract_features(
    timestamps: np.ndarray,
    values: np.ndarray,
    *,
    selected: list[str],
    frequency_minutes: int,
) -> tuple[np.ndarray, list[str], dict[str, Any]]:
    """Return [R, F] feature matrix computed from genuine observations."""
    frame_index = pd.to_datetime(timestamps, unit="s")
    hours = frame_index.hour.to_numpy()
    weekdays = frame_index.weekday.to_numpy()
    is_weekend = weekdays >= 5
    is_day = (hours >= 6) & (hours < 18)

    rows: list[list[float]] = []
    names: list[str] = []
    detail: dict[str, Any] = {}
    for column_index in range(values.shape[1]):
        column = np.asarray(values[:, column_index], dtype="float64")
        mask = np.isfinite(column)
        valid = column[mask]
        feature: dict[str, float] = {}
        if valid.size == 0:
            feature = {key: float("nan") for key in selected}
        else:
            mean = float(valid.mean())
            std = float(valid.std())
            feature["mean"] = mean
            feature["std"] = std
            feature["cv"] = float(std / mean) if abs(mean) > 1e-12 else 0.0
            hourly = np.full(24, np.nan)
            for hour in range(24):
                selector = mask & (hours == hour)
                if selector.any():
                    hourly[hour] = float(column[selector].mean())
            hour_mean = np.nanmean(hourly) if np.isfinite(hourly).any() else 0.0
            feature["intraday_peak_ratio"] = (
                float(np.nanmax(hourly) / hour_mean) if abs(hour_mean) > 1e-12 else 0.0
            )
            feature["peak_hour"] = float(np.nanargmax(hourly)) if np.isfinite(hourly).any() else 0.0
            day_values = column[mask & is_day]
            night_values = column[mask & ~is_day]
            feature["day_night_ratio"] = (
                float(day_values.mean() / night_values.mean())
                if day_values.size and night_values.size and abs(night_values.mean()) > 1e-12
                else 0.0
            )
            weekday_values = column[mask & ~is_weekend]
            weekend_values = column[mask & is_weekend]
            feature["weekday_weekend_ratio"] = (
                float(weekday_values.mean() / weekend_values.mean())
                if weekday_values.size and weekend_values.size and abs(weekend_values.mean()) > 1e-12
                else 0.0
            )
            # daily seasonality strength: variance explained by the hour-of-day profile
            total_variance = float(np.var(valid))
            profile = np.array([hourly[h] if np.isfinite(hourly[h]) else np.nan for h in range(24)])
            if np.isfinite(profile).all() and total_variance > 1e-12:
                predicted = profile[hours[mask]]
                residual = float(np.var(valid - predicted))
                feature["daily_seasonality"] = float(max(0.0, 1.0 - residual / total_variance))
            else:
                feature["daily_seasonality"] = 0.0
            if valid.size > 1:
                x = np.arange(valid.size, dtype="float64")
                slope = float(np.polyfit(x, valid, 1)[0])
            else:
                slope = 0.0
            feature["trend_slope"] = slope
            feature["sparsity"] = float((valid == 0).sum() / valid.size)
        rows.append([float(feature.get(key, float("nan"))) for key in selected])
        detail[str(column_index)] = {"valid_points": int(valid.size), "mean": feature.get("mean")}
    names = list(selected)
    return np.asarray(rows, dtype="float64"), names, detail


def intraday_profile(timestamps: np.ndarray, values: np.ndarray) -> np.ndarray:
    """[24, R] mean profile by hour of day from real observations."""
    index = pd.to_datetime(timestamps, unit="s")
    hours = index.hour.to_numpy()
    profile = np.full((24, values.shape[1]), np.nan)
    for hour in range(24):
        selector = hours == hour
        if not selector.any():
            continue
        block = values[selector]
        counts = np.isfinite(block).sum(axis=0)
        sums = np.nansum(block, axis=0)
        profile[hour] = np.divide(
            sums,
            counts,
            out=np.full(block.shape[1], np.nan),
            where=counts > 0,
        )
    return profile


def weekly_profile(timestamps: np.ndarray, values: np.ndarray) -> np.ndarray:
    index = pd.to_datetime(timestamps, unit="s")
    weekdays = index.weekday.to_numpy()
    profile = np.full((7, values.shape[1]), np.nan)
    for day in range(7):
        selector = weekdays == day
        if not selector.any():
            continue
        block = values[selector]
        counts = np.isfinite(block).sum(axis=0)
        sums = np.nansum(block, axis=0)
        profile[day] = np.divide(
            sums,
            counts,
            out=np.full(block.shape[1], np.nan),
            where=counts > 0,
        )
    return profile
