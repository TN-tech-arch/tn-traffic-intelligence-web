"""Module 1 analytics computed from the real series (no fabricated statistics).

Every statistic in this module is derived from **one** resolved analysis range
(`services.time_range.resolve_range`).  Charts, numbers and the generated
insights therefore always describe the same observations.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from app.core.errors import RequestRejected
from app.services import insights as insight_engine
from app.services.ingest import regions_for, source_row
from app.services.series import resample
from app.services.time_range import has_blocking, resolve_range


def _clean_series(values: np.ndarray) -> np.ndarray:
    return np.asarray(values, dtype="float64")


def describe(values: np.ndarray, timestamps: np.ndarray | None = None) -> dict[str, Any]:
    array = _clean_series(values)
    mask = np.isfinite(array)
    base = {
        "valid_points": int(mask.sum()),
        "missing_points": int((~mask).sum()),
        "mean": None, "std": None, "min": None, "max": None, "p95": None, "cv": None,
        "peak_value": None, "trough_value": None, "peak_index": None, "trough_index": None,
        "peak_at": None, "trough_at": None, "zero_points": 0,
    }
    if not mask.any():
        return base
    valid = array[mask]
    indices = np.arange(array.size)[mask]
    mean = float(valid.mean())
    std = float(valid.std())
    peak_pos = int(np.argmax(valid))
    trough_pos = int(np.argmin(valid))
    peak_index = int(indices[peak_pos])
    trough_index = int(indices[trough_pos])
    base.update(
        {
            "mean": mean,
            "std": std,
            "min": float(valid.min()),
            "max": float(valid.max()),
            "p95": float(np.percentile(valid, 95)),
            "cv": float(std / mean) if abs(mean) > 1e-12 else None,
            "peak_value": float(valid.max()),
            "trough_value": float(valid.min()),
            "peak_index": peak_index,
            "trough_index": trough_index,
            "zero_points": int((valid == 0).sum()),
        }
    )
    if timestamps is not None and timestamps.size:
        base["peak_at"] = str(pd.Timestamp(int(timestamps[peak_index]), unit="s").strftime("%Y-%m-%d %H:%M:%S"))
        base["trough_at"] = str(pd.Timestamp(int(timestamps[trough_index]), unit="s").strftime("%Y-%m-%d %H:%M:%S"))
    return base


def _auto_max_lag(points: int, interval_minutes: int) -> int:
    day_lag = max(1, 1440 // max(1, interval_minutes))
    week_lag = max(1, 10080 // max(1, interval_minutes))

    def padded(lag: int) -> int:
        # leave room after the candidate lag so its local peak can be verified
        return lag + max(2, int(round(lag * 0.10)))

    if points >= 2 * week_lag:
        candidate = padded(week_lag)
    elif points >= 2 * day_lag:
        candidate = padded(day_lag)
    else:
        candidate = max(2, min(points - 2, points // 4))
    return int(min(max(2, candidate), 5000, max(2, points - 2)))


def _analysis_frame(payload: dict[str, Any]):
    source = source_row(payload["source_key"])
    frequency = payload.get("frequency", "native")
    aggregation = payload.get("aggregation", "mean")
    resolved = resolve_range(
        source["key"],
        frequency,
        time_start=payload.get("time_start"),
        time_end=payload.get("time_end"),
        start_index=payload.get("start_index"),
        window_points=payload.get("window_points"),
    )
    if has_blocking(resolved.issues):
        raise RequestRejected(
            [issue for issue in resolved.issues if issue["severity"] == "error"],
            message="分析时间范围校验未通过",
        )
    return source, frequency, aggregation, resolved


def temporal_analysis(payload: dict[str, Any]) -> dict[str, Any]:
    source, frequency, aggregation, resolved = _analysis_frame(payload)
    region_ids = payload.get("region_ids") or []
    if not region_ids:
        preview = resample(source["key"], frequency=frequency, aggregation=aggregation)
        region_ids = preview.region_ids[:1]
    data = resample(
        source["key"],
        region_ids=region_ids,
        frequency=frequency,
        aggregation=aggregation,
    )
    ts = data.timestamps[resolved.start_index: resolved.end_index]
    values = data.values[resolved.start_index: resolved.end_index]
    index = pd.to_datetime(ts, unit="s")
    hours = index.hour.to_numpy()
    weekdays = index.weekday.to_numpy()
    dates = index.strftime("%Y-%m-%d").to_numpy()
    interval = resolved.interval_minutes

    warnings: list[str] = [issue["message"] for issue in resolved.issues if issue["severity"] == "warning"]
    if resolved.span_seconds < 86400:
        warnings.append("所选时间范围不足 1 天，日内规律与工作日/周末比较的代表性有限。")
    elif resolved.span_seconds < 7 * 86400:
        warnings.append("所选时间范围不足 7 天，周内规律的稳定性有限。")

    series_out: list[dict[str, Any]] = []
    stats_out: list[dict[str, Any]] = []
    hourly_out: list[dict[str, Any]] = []
    weekday_out: list[dict[str, Any]] = []
    per_region_valid: dict[str, int] = {}
    per_region_dates: dict[str, int] = {}

    for position, region_id in enumerate(data.region_ids):
        column = values[:, position]
        valid_points = int(np.isfinite(column).sum())
        valid_dates = int(len(set(dates[np.isfinite(column)].tolist())))
        per_region_valid[region_id] = valid_points
        per_region_dates[region_id] = valid_dates
        series_out.append(
            {
                "region_id": region_id,
                "timestamps": [str(t) for t in index.strftime("%Y-%m-%d %H:%M:%S")],
                "values": [None if not np.isfinite(v) else float(v) for v in column],
                "valid_points": valid_points,
            }
        )
        stats_out.append({"region_id": region_id, **describe(column, ts)})

        profile = insight_engine.hourly_profile(column, hours)
        hourly_insight = insight_engine.hourly_insights(
            profile, valid_points=valid_points, valid_dates=valid_dates,
            day_start=int(payload.get("day_start_hour") or 6),
            day_end=int(payload.get("day_end_hour") or 18),
        )
        hourly_out.append(
            {
                "region_id": region_id,
                "hours": profile,
                "overall_mean": hourly_insight.get("overall_mean"),
                "insights": hourly_insight,
            }
        )

        groups = insight_engine.weekday_profiles(column, hours, weekdays, dates)
        weekday_insight = insight_engine.weekday_insights(groups)
        weekday_out.append({"region_id": region_id, **groups, "insights": weekday_insight})

    if not data.region_ids:
        raise RequestRejected(
            [{"path": "m1.region_ids", "code": "NO_REGION", "severity": "error",
              "message": "没有可分析的区域。", "suggestion": "请选择至少一个有效区域。", "received_value": []}],
            message="没有可分析的区域",
        )

    max_lag_requested = int(payload.get("acf_max_lag") or 0)
    auto_lag = _auto_max_lag(resolved.points, interval)
    max_lag = auto_lag if max_lag_requested <= 0 else max_lag_requested
    if max_lag_requested > 0 and max_lag_requested > max(2, resolved.points - 2):
        raise RequestRejected(
            [
                {
                    "path": "m1.acf_max_lag",
                    "code": "LAG_TOO_LARGE",
                    "severity": "error",
                    "message": f"Max Lag={max_lag_requested} 超过当前序列可支持的范围"
                               f"（{resolved.points} 个时间点，最多 {max(2, resolved.points - 2)}）。",
                    "suggestion": f"请把 Max Lag 设为 2–{max(2, resolved.points - 2)}，或改用 Auto 自动模式。",
                    "received_value": max_lag_requested,
                }
            ],
            message="ACF Max Lag 超出可用范围",
        )
    max_lag = int(min(max(2, max_lag), max(2, resolved.points - 2), 5000))

    requested_primary = payload.get("insight_region_id")
    primary_index = data.region_ids.index(requested_primary) if requested_primary in data.region_ids else 0
    primary_region = data.region_ids[primary_index]
    primary_values = values[:, primary_index]
    acf = insight_engine.acf_curve(primary_values, max_lag)
    periodicity = insight_engine.detect_periodicity(
        primary_values,
        interval_minutes=interval,
        max_lag=max_lag,
        span_seconds=resolved.span_seconds,
    )
    trend = insight_engine.trend_analysis(primary_values, interval)
    acf_trend_insight = insight_engine.acf_trend_insights(
        acf=acf,
        periodicity=periodicity,
        trend=trend,
        interval_minutes=interval,
        valid_points=per_region_valid.get(primary_region, 0),
        span_seconds=resolved.span_seconds,
        max_lag=max_lag,
    )
    insight_map = {
        "region_id": primary_region,
        "hourly": hourly_out[primary_index]["insights"],
        "weekday": weekday_out[primary_index]["insights"],
        "acf_trend": acf_trend_insight,
        "summary": insight_engine.summary_insights(
            stats_out,
            points=resolved.points,
            span_label=insight_engine.duration_label(resolved.span_seconds / 60),
            interval_minutes=interval,
            unit_label=source["unit_label"],
        ),
    }

    trend_line: list[dict[str, Any]] = []
    if trend.get("available") and trend.get("r2") is not None:
        step = max(1, resolved.points // 240)
        for i in range(0, resolved.points, step):
            trend_line.append(
                {"index": int(i), "value": float(trend["intercept"] + trend["slope_per_point"] * i)}
            )

    acf_public = {
        **acf,
        "region_id": primary_region,
        "max_lag": max_lag,
        "auto_max_lag": auto_lag,
        "requested_max_lag": max_lag_requested,
        "mode": "auto" if max_lag_requested <= 0 else "manual",
        "effective_max_lag": max_lag,
        "max_lag_label": insight_engine.duration_label(max_lag * interval),
        "interval_minutes": interval,
        "lag_seconds": interval * 60,
        "periodicity": periodicity,
        "start_at": resolved.start_at,
        "end_at": resolved.end_at,
        "valid_points": per_region_valid.get(primary_region, 0),
    }

    return {
        "source": {
            "key": source["key"],
            "display_name": source["display_name"],
            "unit_label": source["unit_label"],
            "native_frequency_minutes": source["native_frequency_minutes"],
        },
        "frequency": frequency,
        "frequency_minutes": interval,
        "aggregation": aggregation,
        "range": {
            **resolved.to_public(),
            "valid_points": per_region_valid,
            "valid_dates": per_region_dates,
            "native_interval_minutes": int(source["native_frequency_minutes"]),
        },
        "primary_region_id": primary_region,
        "series": series_out,
        "statistics": stats_out,
        "hourly": hourly_out,
        "weekday": weekday_out,
        "acf": acf_public,
        "trend": trend,
        "trend_line": trend_line,
        "insights": insight_map,
        "warnings": warnings,
        "notes": [
            "统计量基于真实观测计算；缺失点不参与统计，也不会被当作 0。",
            "ZTE 的真实 0 值会被保留为有效观测。",
            f"单位标注：{source['unit_label']}；时间边界为闭区间 [start_at, end_at]（按桶起始时间）。",
        ],
    }


def spatial_analysis(payload: dict[str, Any]) -> dict[str, Any]:
    source = source_row(payload["source_key"])
    frequency = payload.get("frequency", "native")
    aggregation = payload.get("aggregation", "mean")
    data = resample(source["key"], frequency=frequency, aggregation=aggregation)
    total = int(data.timestamps.size)
    index_value = payload.get("time_index")
    if index_value is None:
        index_value = total - 1
    index_value = int(np.clip(int(index_value), 0, max(0, total - 1)))
    slice_values = data.values[index_value]

    # The analysis range only feeds the range statistics; the map slice is an
    # independent "one instant" view and never changes the range statistics.
    range_info: dict[str, Any] = {}
    range_means: dict[str, float | None] = {}
    range_counts: dict[str, int] = {}
    range_warnings: list[str] = []
    try:
        resolved = resolve_range(
            source["key"], frequency,
            time_start=payload.get("time_start"), time_end=payload.get("time_end"),
            start_index=payload.get("start_index"), window_points=payload.get("window_points"),
        )
        range_info = resolved.to_public()
        range_warnings = [i["message"] for i in resolved.issues if i["severity"] == "warning"]
        if not has_blocking(resolved.issues):
            block = data.values[resolved.start_index: resolved.end_index]
            for position, region_id in enumerate(data.region_ids):
                column = block[:, position]
                finite = np.isfinite(column)
                range_means[region_id] = float(column[finite].mean()) if finite.any() else None
                range_counts[region_id] = int(finite.sum())
    except Exception as exc:  # range statistics are supplementary for the map view
        range_warnings.append(f"时间范围统计不可用：{exc}")

    region_rows = regions_for(source["source_id"])
    names = {r["region_id"]: r["display_name"] for r in region_rows}
    gis_only = sum(1 for r in region_rows if not r["has_timeseries"])
    entries = []
    for position, region_id in enumerate(data.region_ids):
        value = float(slice_values[position]) if np.isfinite(slice_values[position]) else None
        entries.append(
            {
                "region_id": region_id,
                "display_name": names.get(region_id) or region_id,
                "value": value,
                "range_mean": range_means.get(region_id),
                "range_valid_points": range_counts.get(region_id),
            }
        )
    finite = [e for e in entries if e["value"] is not None]
    # Stable tie-break on region_id so equal values always rank the same way.
    ranked = sorted(finite, key=lambda e: (-e["value"], e["region_id"]))
    bottom_sorted = sorted(finite, key=lambda e: (e["value"], e["region_id"]))
    values_array = np.array([e["value"] for e in finite], dtype="float64")
    histogram = _spatial_histogram(values_array)
    spatial_stats = {
        "count": int(values_array.size),
        "mean": float(values_array.mean()) if values_array.size else None,
        "median": float(np.median(values_array)) if values_array.size else None,
        "std": float(values_array.std()) if values_array.size else None,
        "min": float(values_array.min()) if values_array.size else None,
        "max": float(values_array.max()) if values_array.size else None,
        "p05": float(np.percentile(values_array, 5)) if values_array.size else None,
        "p95": float(np.percentile(values_array, 95)) if values_array.size else None,
        "cv": (
            float(values_array.std() / values_array.mean())
            if values_array.size and abs(float(values_array.mean())) > 1e-12 else None
        ),
        "single_value": bool(histogram["single_value"]),
    }
    top12 = ranked[:12]
    bottom6 = bottom_sorted[:6]
    no_data_count = len(entries) - len(finite)
    time_at = str(pd.Timestamp(int(data.timestamps[index_value]), unit="s")) if total else None
    spatial_insight = insight_engine.spatial_insights(
        entries=entries,
        top=top12,
        bottom=bottom6,
        bins=histogram["bins"],
        stats=spatial_stats,
        time_at=time_at,
        no_data_count=no_data_count,
        unit_label=source["unit_label"],
    )
    return {
        "source": {"key": source["key"], "display_name": source["display_name"],
                   "unit_label": source["unit_label"]},
        "frequency": data.frequency,
        "time_index": index_value,
        "time_at": time_at,
        "range": range_info,
        "range_warnings": range_warnings,
        "regions": entries,
        "top": top12,
        "bottom": bottom6,
        "ranking": top12,
        "distribution": histogram,
        "value_region_count": int(values_array.size),
        "no_data_region_count": int(no_data_count),
        "gis_no_data_count": int(gis_only),
        "stats": spatial_stats,
        "insights": spatial_insight,
        "summary": {
            "regions_with_value": len(finite),
            "regions_missing": len(entries) - len(finite),
            "mean": spatial_stats["mean"],
            "std": spatial_stats["std"],
            "min": spatial_stats["min"],
            "max": spatial_stats["max"],
            "distribution": histogram["bins"],
        },
        "notes": [
            "地图与三张空间分析图都使用当前时间截面的真实观测（当前数据源全部有效区域）。",
            "range_mean 是所选 Analysis Time Range 内的逐区域平均值，与当前截面值是两个不同口径。",
            "No Data 区域保持为空值，不参与排名、均值与分箱。",
        ],
    }


def _spatial_histogram(values: np.ndarray) -> dict[str, Any]:
    """Equal-width bins, left-closed right-open (last bin includes the right edge)."""
    if values.size == 0:
        return {"bins": [], "single_value": False, "bin_count": 0, "total": 0}
    vmin = float(values.min())
    vmax = float(values.max())
    if abs(vmax - vmin) <= 1e-12 * max(1.0, abs(vmax)):
        return {
            "bins": [
                {
                    "index": 0,
                    "start": vmin,
                    "end": vmax,
                    "count": int(values.size),
                    "pct": 100.0,
                    "left_closed": True,
                    "right_closed": True,
                }
            ],
            "single_value": True,
            "bin_count": 1,
            "total": int(values.size),
            "boundary_rule": "all values equal -> single closed interval",
        }
    bin_count = int(min(10, max(4, round(np.sqrt(values.size)))))
    counts, edges = np.histogram(values, bins=bin_count)
    bins = []
    for i, count in enumerate(counts):
        bins.append(
            {
                "index": i,
                "start": float(edges[i]),
                "end": float(edges[i + 1]),
                "count": int(count),
                "pct": float(count / values.size * 100.0),
                "left_closed": True,
                "right_closed": i == len(counts) - 1,
            }
        )
    return {
        "bins": bins,
        "single_value": False,
        "bin_count": len(bins),
        "total": int(values.size),
        "boundary_rule": "equal-width; [start, end) except the last bin which includes end",
    }


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
        hourly_values = np.array([v for v in hourly if v is not None], dtype="float64")
        if hourly_values.size:
            hour_mean = float(hourly_values.mean())
            hour_std = float(hourly_values.std()) or 1.0
            hourly_z = [None if v is None else (v - hour_mean) / hour_std for v in hourly]
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
        "normalisation": "z-score（按每个来源自身 24 小时均值的均值/标准差归一化）",
        "disclaimers": [
            "三个来源的单位不一致且观测时段不重叠（Milano/Trentino 为 2013-11~2014-01，ZTE 为 2024-07~08），"
            "因此只能比较归一化后的周期形状，不能比较绝对值或声称同时发生。",
            "ZTE 为 4G 下行流量，不是道路车辆流量。",
        ],
    }
