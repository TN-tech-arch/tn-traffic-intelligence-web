"""Sliding-window construction, leakage-safe splitting and causal preprocessing.

Implements PROJECT_SPEC 6.2:

* X_i = [v[t] .. v[t+L-1]], Y_i = [v[t+L] .. v[t+L+H-1]], next start = t + S
* every target of a window must lie inside one single split,
* validation/test windows may use already observed history as input,
* imputation may never use a value that has not been observed at the forecast
  origin of the window being built.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

MISSING_MODES = ("automatic", "causal_interpolation", "drop_invalid")
SCALING_METHODS = ("standard", "minmax", "none")

SPLIT_NAMES = ("train", "validation", "test")


@dataclass
class Preprocessed:
    filled: np.ndarray  # float32 [T, R]
    observed: np.ndarray  # bool [T, R]
    imputed_end: np.ndarray  # int32 [T, R]; index of right interpolation endpoint
    strategy: str
    imputed_points: int


def preprocess(values: np.ndarray, mode: str = "automatic") -> Preprocessed:
    """Fill missing samples without ever peeking past a forecast origin."""
    if mode not in MISSING_MODES:
        raise ValueError(f"未知的缺失值处理方式: {mode}")
    values = np.asarray(values, dtype="float64")
    observed = np.isfinite(values)
    filled = values.copy()
    imputed_end = np.full(values.shape, -1, dtype="int32")

    for col in range(values.shape[1]):
        obs = observed[:, col]
        if mode == "drop_invalid" or obs.all():
            continue
        col_values = values[:, col]
        last_valid_index = -1
        if mode == "automatic":
            for idx in range(values.shape[0]):
                if obs[idx]:
                    last_valid_index = idx
                elif last_valid_index >= 0:
                    filled[idx, col] = col_values[last_valid_index]
                    imputed_end[idx, col] = idx
            continue

        # causal_interpolation: fill each interior gap between two observed
        # endpoints; the whole gap is marked with the *right* endpoint index, so a
        # window whose origin precedes that endpoint will reject the window.
        index = 0
        n = values.shape[0]
        while index < n:
            if obs[index]:
                last_valid_index = index
                index += 1
                continue
            gap_start = index
            while index < n and not obs[index]:
                index += 1
            gap_end = index - 1
            right_endpoint = index if index < n else -1
            if last_valid_index >= 0 and right_endpoint >= 0:
                left_value = col_values[last_valid_index]
                right_value = col_values[right_endpoint]
                span = right_endpoint - last_valid_index
                for offset in range(1, span):
                    position = last_valid_index + offset
                    weight = offset / span
                    filled[position, col] = left_value + (right_value - left_value) * weight
                    imputed_end[position, col] = right_endpoint
            elif last_valid_index >= 0:
                # trailing gap: only past information is available -> forward fill
                for position in range(gap_start, gap_end + 1):
                    filled[position, col] = col_values[last_valid_index]
                    imputed_end[position, col] = position
    imputed_points = int((imputed_end >= 0).sum())
    return Preprocessed(filled=filled.astype("float32"), observed=observed, imputed_end=imputed_end,
                        strategy=mode, imputed_points=imputed_points)


def split_boundaries(total_points: int, ratios: Iterable[float]) -> list[tuple[int, int]]:
    """Time-ordered 3-way split; the test split absorbs rounding remainder."""
    train_ratio, val_ratio, test_ratio = list(ratios)
    n_train = int(np.floor(total_points * train_ratio))
    n_val = int(np.floor(total_points * val_ratio))
    n_test = total_points - n_train - n_val
    if n_test < 0:
        n_test = 0
    bounds = [
        (0, n_train),
        (n_train, n_train + n_val),
        (n_train + n_val, n_train + n_val + n_test),
    ]
    return bounds


def window_starts_for_range(
    total_points: int, target_start: int, target_end: int, L: int, H: int, S: int
) -> np.ndarray:
    """Origins whose *targets* fall inside [target_start, target_end)."""
    low = max(0, target_start - L)
    high = target_end - H - L
    if high < low or H <= 0:
        return np.empty(0, dtype="int64")
    return np.arange(low, high + 1, S, dtype="int64")


def validate_windows(
    observed: np.ndarray, imputed_end: np.ndarray, starts: np.ndarray, L: int, H: int
) -> np.ndarray:
    """Boolean validity per origin (causal-imputation rule included)."""
    if starts.size == 0:
        return np.zeros(0, dtype=bool)
    total = observed.shape[0]
    max_start = total - L - H
    usable = starts[(starts >= 0) & (starts <= max_start)]
    if usable.size == 0:
        return np.zeros(0, dtype=bool)
    obs_x = sliding_window_view(observed, L)[usable]  # [n, L]
    ie_x = sliding_window_view(imputed_end, L)[usable]  # [n, L]
    origins = usable + L - 1
    x_ok = (obs_x | (ie_x <= origins[:, None])).all(axis=1)
    obs_y = sliding_window_view(observed, H)[usable + L]  # [n, H]
    y_ok = obs_y.all(axis=1)
    return x_ok & y_ok


def build_region_windows(
    filled: np.ndarray,
    observed: np.ndarray,
    imputed_end: np.ndarray,
    L: int,
    H: int,
    S: int,
    boundaries: list[tuple[int, int]],
) -> dict[str, Any]:
    """Return per-split valid origins plus window arrays for one region (1-D)."""
    total = filled.shape[0]
    per_split: dict[str, Any] = {}
    for name, (start, end) in zip(SPLIT_NAMES, boundaries):
        starts = window_starts_for_range(total, start, end, L, H, S)
        valid = validate_windows(observed, imputed_end, starts, L, H)
        per_split[name] = {
            "starts": starts,
            "valid": valid,
            "valid_count": int(valid.sum()),
            "candidate_count": int(starts.size),
            "target_range": (start, end),
        }
    return per_split


def stack_windows(values: np.ndarray, starts: np.ndarray, L: int, H: int) -> tuple[np.ndarray, np.ndarray]:
    if starts.size == 0:
        return np.empty((0, L), dtype="float32"), np.empty((0, H), dtype="float32")
    x = sliding_window_view(values, L)[starts]
    y = sliding_window_view(values, H)[starts + L]
    return x.astype("float32"), y.astype("float32")


def fit_scaler(values: np.ndarray, observed: np.ndarray, method: str) -> dict[str, Any]:
    """Fit per-region scaling statistics on the training segment only."""
    if method == "none":
        return {"method": "none"}
    values = np.asarray(values, dtype="float64")
    observed = np.asarray(observed, dtype=bool)
    if values.ndim == 1:
        values = values[:, None]
        observed = observed[:, None]
    masked = np.where(observed, values, np.nan)
    if np.all(np.isnan(masked)):
        masked = np.zeros_like(values)
    with np.errstate(invalid="ignore"):
        mean = np.nanmean(masked, axis=0)
        std = np.nanstd(masked, axis=0)
        minimum = np.nanmin(masked, axis=0)
        maximum = np.nanmax(masked, axis=0)
    mean = np.atleast_1d(np.nan_to_num(mean, nan=0.0))
    std = np.atleast_1d(np.nan_to_num(std, nan=0.0))
    minimum = np.atleast_1d(np.nan_to_num(minimum, nan=0.0))
    maximum = np.atleast_1d(np.nan_to_num(maximum, nan=0.0))
    std = np.where(std < 1e-12, 1.0, std)
    span = maximum - minimum
    span = np.where(span < 1e-12, 1.0, span)
    return {
        "method": method,
        "mean": mean.astype("float64").tolist(),
        "std": std.astype("float64").tolist(),
        "min": minimum.astype("float64").tolist(),
        "max": maximum.astype("float64").tolist(),
        "unit": "per region, fitted on train split observed samples only",
    }


def apply_scaler(values: np.ndarray, scaler: dict[str, Any]) -> np.ndarray:
    method = scaler.get("method", "none")
    if method == "none":
        return values
    mean = np.asarray(scaler["mean"], dtype="float64")
    std = np.asarray(scaler["std"], dtype="float64")
    minimum = np.asarray(scaler["min"], dtype="float64")
    span = np.asarray(scaler["max"], dtype="float64") - minimum
    span = np.where(span < 1e-12, 1.0, span)
    if method == "standard":
        return ((values - mean) / std).astype("float32")
    if method == "minmax":
        return ((values - minimum) / span).astype("float32")
    raise ValueError(f"未知的缩放方法: {method}")


def inverse_scaler(values: np.ndarray, scaler: dict[str, Any]) -> np.ndarray:
    method = scaler.get("method", "none")
    if method == "none":
        return values
    mean = np.asarray(scaler["mean"], dtype="float64")
    std = np.asarray(scaler["std"], dtype="float64")
    minimum = np.asarray(scaler["min"], dtype="float64")
    span = np.asarray(scaler["max"], dtype="float64") - minimum
    span = np.where(span < 1e-12, 1.0, span)
    if method == "standard":
        return (values * std + mean).astype("float64")
    if method == "minmax":
        return (values * span + minimum).astype("float64")
    raise ValueError(f"未知的缩放方法: {method}")


def window_metadata(
    timestamps: np.ndarray, starts: np.ndarray, L: int, H: int
) -> dict[str, Any]:
    if starts.size == 0:
        return {"count": 0}
    input_start = int(timestamps[int(starts[0])])
    input_end = int(timestamps[int(starts[0]) + L - 1])
    target_start = int(timestamps[int(starts[0]) + L])
    last = int(starts[-1])
    target_end = int(timestamps[last + L + H - 1])
    forecast_origin = int(timestamps[last + L - 1])
    return {
        "count": int(starts.size),
        "input_start_at": input_start,
        "input_end_at": input_end,
        "target_start_at": target_start,
        "target_end_at": target_end,
        "last_forecast_origin_at": forecast_origin,
        "first_origin_index": int(starts[0]),
        "last_origin_index": last,
    }
