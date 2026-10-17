"""Module 1 analytics computed from the real series (no fabricated statistics)."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from app.services.ingest import load_series, source_row
from app.services.series import available_frequencies, resample


def _clean_series(values: np.ndarray) -> np.ndarray:
    return np.asarray(values, dtype="float64")


def describe(values: np.ndarray) -> dict[str, Any]:
    array = _clean_series(values)
    mask = np.isfinite(array)
    if not mask.any():
        return {
            "valid_points": 0, "missing_points": int((~mask).sum()), "mean": None, "std": None,
            "min": None, "max": None, "p95": None, "cv": None, "peak_value": None,
            "trough_value": None, "peak_index": None, "trough_index": None, "zero_points": 0,
        }
    valid = array[mask]
    indices = np.arange(array.size)[mask]
    mean = float(valid.mean())
    std = float(valid.std())
    return {
        "valid_points": int(mask.sum()),
        "missing_points": int((~mask).sum()),
        "mean": mean,
        "std": std,
        "min": float(valid.min()),
        "max": float(valid.max()),
        "p95": float(np.percentile(valid, 95)),
        "cv": float(std / mean) if abs(mean) > 1e-12 else None,
        "peak_value": float(valid.max()),
        "trough_value": float(valid.min()),
        "peak_index": int(indices[int(np.argmax(valid))]),
        "trough_index": int(indices[int(np.argmin(valid))]),
        "zero_points": int((valid == 0).sum()),
    }


def autocorrelation(values: np.ndarray, max_lag: int = 48) -> dict[str, Any]:
    array = _clean_series(values)
    array = array[np.isfinite(array)]
    if array.size < 4:
        return {"lags": [], "values": [], "note": "有效点不足，无法计算自相关。"}
    centered = array - array.mean()
    denominator = float(np.dot(centered, centered))
    if denominator <= 0:
        return {"lags": [], "values": [], "note": "序列为常数，自相关未定义（N/A）。"}
    lags = list(range(1, min(max_lag, array.size - 1) + 1))
    acf = [float(np.dot(centered[:-lag], centered[lag:]) / denominator) for lag in lags]
    return {"lags": lags, "values": acf, "note": None}


def temporal_analysis(payload: dict[str, Any]) -> dict[str, Any]:
    source = source_row(payload["source_key"])
    region_ids = payload.get("region_ids") or []
    if not region_ids:
        all_series = resample(source["key"], frequency=payload.get("frequency", "native"),
                              aggregation=payload.get("aggregation", "mean"))
        region_ids = all_series.region_ids[:1]
    data = resample(
        source["key"],
        region_ids=region_ids,
        frequency=payload.get("frequency", "native"),
        aggregation=payload.get("aggregation", "mean"),
    )
    start = int(payload.get("start_index") or 0)
    points = int(payload.get("window_points") or data.timestamps.size)
    stop = min(start + points, data.timestamps.size)
    ts = data.timestamps[start:stop]
    values = data.values[start:stop]
    index = pd.to_datetime(ts, unit="s")
    hours = index.hour.to_numpy()
    weekdays = index.weekday.to_numpy()

    # Weekly patterns must not be limited to a short display window (2 days would
    # only contain 2 weekdays). They are therefore computed over the *full*
    # resampled series and labelled as such in the UI.
    full_index = pd.to_datetime(data.timestamps, unit="s")
    full_weekdays = full_index.weekday.to_numpy()

    series_out = []
    stats_out = []
    profiles = []
    weekly_profiles = []
    for position, region_id in enumerate(data.region_ids):
        column = values[:, position]
        stats = describe(column)
        series_out.append(
            {
                "region_id": region_id,
                "timestamps": [str(t) for t in index.strftime("%Y-%m-%d %H:%M:%S")],
                "values": [None if not np.isfinite(v) else float(v) for v in column],
            }
        )
        stats_out.append({"region_id": region_id, **stats})
        hourly = []
        for hour in range(24):
            selector = np.isfinite(column) & (hours == hour)
            hourly.append(float(column[selector].mean()) if selector.any() else None)
        profiles.append({"region_id": region_id, "hourly_mean": hourly})
        full_column = data.values[:, position]
        full_finite = np.isfinite(full_column)
        weekday_values = full_column[full_finite & (full_weekdays < 5)]
        weekend_values = full_column[full_finite & (full_weekdays >= 5)]
        weekly = []
        for day in range(7):
            selector = full_finite & (full_weekdays == day)
            weekly.append(float(full_column[selector].mean()) if selector.any() else None)
        weekly_profiles.append(
            {
                "region_id": region_id,
                "weekday_mean": float(weekday_values.mean()) if weekday_values.size else None,
                "weekend_mean": float(weekend_values.mean()) if weekend_values.size else None,
                "weekday_weekend_ratio": (
                    float(weekday_values.mean() / weekend_values.mean())
                    if weekday_values.size and weekend_values.size and abs(weekend_values.mean()) > 1e-12
                    else None
                ),
                "weekly_mean": weekly,
                "basis": "full_series",
                "points_used": int(full_finite.sum()),
            }
        )

    first = values[:, 0] if values.shape[1] else np.array([])
    return {
        "source": {
            "key": source["key"],
            "display_name": source["display_name"],
            "unit_label": source["unit_label"],
            "native_frequency_minutes": source["native_frequency_minutes"],
        },
        "frequency": data.frequency,
        "frequency_minutes": data.frequency_minutes,
        "aggregation": data.aggregation,
        "total_points": int(data.timestamps.size),
        "window": {
            "start_index": start,
            "stop_index": stop,
            "points": int(ts.size),
            "start_at": str(index[0]) if ts.size else None,
            "end_at": str(index[-1]) if ts.size else None,
        },
        "series": series_out,
        "statistics": stats_out,
        "intraday_profiles": profiles,
        "weekly_profiles": weekly_profiles,
        "weekly_note": "周内模式基于该来源的完整序列计算（不受上方显示窗口限制），因此七天都有真实均值。",
        "acf": autocorrelation(first),
        "trend": _trend(first),
        "notes": [
            "统计量基于真实观测计算；缺失点不参与统计，也不会被当作 0。",
            f"单位标注：{source['unit_label']}。",
        ],
    }


def _trend(values: np.ndarray) -> dict[str, Any]:
    array = _clean_series(values)
    mask = np.isfinite(array)
    if mask.sum() < 3:
        return {"slope": None, "intercept": None, "note": "有效点不足，无法估计趋势。"}
    x = np.arange(array.size)[mask]
    slope, intercept = np.polyfit(x, array[mask], 1)
    rolling = pd.Series(array).rolling(24, min_periods=6).mean().to_numpy()
    step = max(1, array.size // 200)
    return {
        "slope": float(slope),
        "intercept": float(intercept),
        "rolling_window": 24,
        "rolling_sample": [
            {"index": int(i), "value": None if not np.isfinite(rolling[i]) else float(rolling[i])}
            for i in range(0, array.size, step)
        ],
        "note": None,
    }


def spatial_analysis(payload: dict[str, Any]) -> dict[str, Any]:
    source = source_row(payload["source_key"])
    data = resample(
        source["key"],
        frequency=payload.get("frequency", "native"),
        aggregation=payload.get("aggregation", "mean"),
    )
    index_value = payload.get("time_index")
    if index_value is None:
        index_value = int(data.timestamps.size) - 1
    index_value = int(np.clip(index_value, 0, max(0, data.timestamps.size - 1)))
    slice_values = data.values[index_value]
    window_points = int(payload.get("window_points") or 0)
    if window_points > 1:
        low = max(0, index_value - window_points // 2)
        high = min(data.timestamps.size, index_value + window_points // 2)
        with np.errstate(invalid="ignore"):
            aggregated = np.nanmean(data.values[low:high], axis=0)
        window_used = {"start_index": low, "stop_index": high}
    else:
        aggregated = slice_values
        window_used = None
    entries = []
    for position, region_id in enumerate(data.region_ids):
        value = float(aggregated[position]) if np.isfinite(aggregated[position]) else None
        entries.append({"region_id": region_id, "value": value})
    finite = [e for e in entries if e["value"] is not None]
    ranked = sorted(finite, key=lambda e: e["value"], reverse=True)
    values_array = np.array([e["value"] for e in finite], dtype="float64")
    return {
        "source": {"key": source["key"], "display_name": source["display_name"],
                   "unit_label": source["unit_label"]},
        "frequency": data.frequency,
        "time_index": index_value,
        "time_at": str(pd.Timestamp(int(data.timestamps[index_value]), unit="s")) if data.timestamps.size else None,
        "window": window_used,
        "regions": entries,
        "ranking": ranked[:20],
        "bottom": list(reversed(ranked[-20:])),
        "summary": {
            "regions_with_value": len(finite),
            "regions_missing": len(entries) - len(finite),
            "mean": float(values_array.mean()) if values_array.size else None,
            "std": float(values_array.std()) if values_array.size else None,
            "min": float(values_array.min()) if values_array.size else None,
            "max": float(values_array.max()) if values_array.size else None,
            "distribution": _histogram(values_array),
        },
        "notes": [
            "空间强度为当前时间截面在真实观测上的统计值；No Data 区域显示为空值。",
        ],
    }


def _histogram(values: np.ndarray, bins: int = 12) -> list[dict[str, float]]:
    if values.size == 0:
        return []
    counts, edges = np.histogram(values, bins=min(bins, max(2, values.size)))
    return [
        {"bin_start": float(edges[i]), "bin_end": float(edges[i + 1]), "count": int(counts[i])}
        for i in range(len(counts))
    ]


def compare_sources(payload: dict[str, Any]) -> dict[str, Any]:
    """Cross-city comparison on **normalised shapes** (units are unknown)."""
    sources = payload.get("source_keys") or ["milano", "trentino", "zte"]
    frequency = payload.get("frequency", "60min")
    aggregation = payload.get("aggregation", "mean")
    entries = []
    for key in sources:
        source = source_row(key)
        data = resample(key, frequency=frequency, aggregation=aggregation)
        with np.errstate(invalid="ignore"):
            mean_profile = np.nanmean(data.values, axis=1)
        mask = np.isfinite(mean_profile)
        if not mask.any():
            continue
        profile = np.where(mask, mean_profile, np.nan)
        shape_mean = float(np.nanmean(profile))
        shape_std = float(np.nanstd(profile))
        shape_std = shape_std if shape_std > 1e-12 else 1.0
        normalised = (profile - shape_mean) / shape_std
        index = pd.to_datetime(data.timestamps, unit="s")
        hourly = []
        hours = index.hour.to_numpy()
        for hour in range(24):
            selector = mask & (hours == hour)
            hourly.append(float(np.nanmean(profile[selector])) if selector.any() else None)
        # z-score of the hourly shape so the three sources can be compared on
        # shape only (their units and absolute levels differ).
        hourly_values = np.array([v for v in hourly if v is not None], dtype="float64")
        if hourly_values.size:
            hour_mean = float(hourly_values.mean())
            hour_std = float(hourly_values.std()) or 1.0
            hourly_z = [
                None if v is None else (v - hour_mean) / hour_std for v in hourly
            ]
        else:
            hour_mean, hour_std, hourly_z = None, None, [None] * 24
        step = max(1, profile.size // 200)
        entries.append(
            {
                "source_key": key,
                "display_name": source["display_name"],
                "unit_label": source["unit_label"],
                "time_start": str(index[0]) if index.size else None,
                "time_end": str(index[-1]) if index.size else None,
                "points": int(profile.size),
                "native_frequency_minutes": source["native_frequency_minutes"],
                "hourly_shape": hourly,
                "hourly_shape_z": hourly_z,
                "hourly_mean_level": hour_mean,
                "hourly_std_level": hour_std,
                "normalised_sample": [
                    {"index": int(i), "value": None if not np.isfinite(normalised[i]) else float(normalised[i])}
                    for i in range(0, profile.size, step)
                ],
                "cv": float(np.nanstd(profile) / np.nanmean(profile)) if abs(np.nanmean(profile)) > 1e-12 else None,
            }
        )
    return {
        "frequency": frequency,
        "aggregation": aggregation,
        "sources": entries,
        "normalisation": "z-score（按每个来源自身的窗口均值/标准差归一化）",
        "disclaimers": [
            "三个来源的单位不一致且观测时段不重叠（Milano/Trentino 为 2013-11~2014-01，ZTE 为 2024-07~08），"
            "因此只能比较归一化后的周期形状，不能比较绝对值或声称同时发生。",
            "ZTE 为 4G 下行流量，不是道路车辆流量。",
        ],
    }
