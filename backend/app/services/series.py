"""Resampling / aggregation and real-time-range access to source series."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from app.services.ingest import LoadedSeries, load_series

FREQUENCY_MINUTES: dict[str, int | None] = {
    "native": None,
    "30min": 30,
    "60min": 60,
    "1day": 1440,
}

FREQUENCY_LABELS: dict[str, str] = {
    "native": "原生频率",
    "30min": "30 分钟",
    "60min": "1 小时",
    "1day": "1 天",
}


@dataclass
class ResampledSeries:
    timestamps: np.ndarray  # int64 epoch seconds of bucket start
    values: np.ndarray  # float32 [T, R]
    region_ids: list[str]
    frequency: str
    frequency_minutes: int
    aggregation: str
    complete: np.ndarray  # bool [T, R] bucket contained the full number of samples
    native_points_per_bucket: int


def resolve_frequency_minutes(source_native_minutes: int, frequency: str) -> int:
    if frequency not in FREQUENCY_MINUTES:
        raise ValueError(f"不支持的频率: {frequency}")
    target = FREQUENCY_MINUTES[frequency]
    if target is None:
        return source_native_minutes
    if target % source_native_minutes != 0:
        raise ValueError(
            f"频率 {frequency} 不是原生频率 {source_native_minutes} 分钟的整数倍"
        )
    return target


def available_frequencies(source_native_minutes: int) -> list[dict[str, Any]]:
    out = []
    for key, minutes in FREQUENCY_MINUTES.items():
        resolved = source_native_minutes if minutes is None else minutes
        out.append(
            {
                "key": key,
                "label": FREQUENCY_LABELS[key],
                "minutes": resolved,
                "available": minutes is None or minutes % source_native_minutes == 0,
                "is_native": minutes is None,
            }
        )
    return out


def resample(
    source_key: str,
    *,
    region_ids: list[str] | None = None,
    frequency: str = "native",
    aggregation: str = "mean",
    time_start: int | None = None,
    time_end: int | None = None,
    loaded: LoadedSeries | None = None,
) -> ResampledSeries:
    """Aggregate the real source series; incomplete buckets become NaN."""
    src = loaded or load_series(source_key)
    native_minutes = int(src.data["native_frequency_minutes"])
    target_minutes = resolve_frequency_minutes(native_minutes, frequency)
    ratio = max(1, target_minutes // native_minutes)
    if aggregation not in ("sum", "mean"):
        raise ValueError("aggregation 只能是 sum 或 mean")

    if region_ids is None:
        indices = list(range(len(src.region_ids)))
        ids = list(src.region_ids)
    else:
        indices = [src.region_index(r) for r in region_ids]
        ids = list(region_ids)

    values = src.values[:, indices]
    timestamps = src.timestamps
    mask = np.isfinite(values)

    if ratio == 1:
        complete = mask.copy()
        out_values = values.astype("float32")
        out_ts = timestamps
    else:
        usable = (timestamps.size // ratio) * ratio
        trimmed = values[:usable]
        trimmed_mask = mask[:usable]
        out_ts = timestamps[::ratio][: usable // ratio]
        blocks = trimmed.reshape(-1, ratio, trimmed.shape[1])
        block_mask = trimmed_mask.reshape(-1, ratio, trimmed_mask.shape[1])
        complete = block_mask.all(axis=1)
        counts = block_mask.sum(axis=1)
        sums = np.where(block_mask, blocks, 0.0).sum(axis=1)
        if aggregation == "sum":
            aggregated = sums
        else:
            with np.errstate(invalid="ignore", divide="ignore"):
                aggregated = np.where(counts > 0, sums / np.maximum(counts, 1), np.nan)
        # Only complete buckets keep a value; partial buckets are recorded missing.
        out_values = np.where(complete, aggregated, np.nan).astype("float32")

    if time_start is not None or time_end is not None:
        lower = time_start if time_start is not None else out_ts[0]
        upper = time_end if time_end is not None else out_ts[-1]
        selector = (out_ts >= lower) & (out_ts <= upper)
        out_ts = out_ts[selector]
        out_values = out_values[selector]
        complete = complete[selector]

    return ResampledSeries(
        timestamps=out_ts,
        values=out_values,
        region_ids=ids,
        frequency=frequency,
        frequency_minutes=target_minutes,
        aggregation=aggregation,
        complete=complete,
        native_points_per_bucket=ratio,
    )


def time_bounds(source_key: str) -> dict[str, Any]:
    src = load_series(source_key)
    return {
        "time_start": int(src.timestamps[0]),
        "time_end": int(src.timestamps[-1]),
        "time_points": int(src.timestamps.size),
        "native_frequency_minutes": int(src.data["native_frequency_minutes"]),
        "time_basis": src.time_basis,
    }


def valid_region_ids(source_key: str) -> list[str]:
    """Regions with genuine time-series coverage (used for All Regions scope)."""
    src = load_series(source_key)
    mask = np.isfinite(src.values).any(axis=0)
    return [rid for rid, ok in zip(src.region_ids, mask.tolist()) if ok]


def region_series_raw(source_key: str, region_id: str) -> tuple[np.ndarray, np.ndarray]:
    src = load_series(source_key)
    return src.timestamps, src.values[:, src.region_index(region_id)]


_AXIS_CACHE: dict[tuple[str, str], np.ndarray] = {}


def resample_axis(source_key: str, frequency: str) -> np.ndarray:
    """Bucket start timestamps for a source/frequency (cached, values independent).

    This is the single time axis used both by date<->index conversion and by the
    resampler, so the UI and the analyser can never disagree about which
    observations belong to a range.
    """
    cache_key = (source_key, frequency)
    cached = _AXIS_CACHE.get(cache_key)
    if cached is not None:
        return cached
    src = load_series(source_key)
    native_minutes = int(src.data["native_frequency_minutes"])
    target_minutes = resolve_frequency_minutes(native_minutes, frequency)
    ratio = max(1, target_minutes // native_minutes)
    usable = (src.timestamps.size // ratio) * ratio
    axis = src.timestamps[:usable:ratio].astype("int64")
    _AXIS_CACHE[cache_key] = axis
    return axis


def clear_axis_cache() -> None:
    _AXIS_CACHE.clear()
