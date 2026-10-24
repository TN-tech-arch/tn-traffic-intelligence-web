"""Forecast metrics exactly as specified in PROJECT_SPEC 9.5."""

from __future__ import annotations

import numpy as np

SMAPE_EPSILON = 1e-9


def _as_float_arrays(y_true, y_pred) -> tuple[np.ndarray, np.ndarray]:
    a = np.asarray(y_true, dtype="float64").ravel()
    b = np.asarray(y_pred, dtype="float64").ravel()
    if a.shape != b.shape:
        raise ValueError("y_true 与 y_pred 形状不一致")
    mask = np.isfinite(a) & np.isfinite(b)
    return a[mask], b[mask]


def mae(y_true, y_pred) -> float | None:
    a, b = _as_float_arrays(y_true, y_pred)
    if a.size == 0:
        return None
    return float(np.mean(np.abs(a - b)))


def rmse(y_true, y_pred) -> float | None:
    a, b = _as_float_arrays(y_true, y_pred)
    if a.size == 0:
        return None
    return float(np.sqrt(np.mean((a - b) ** 2)))


def smape(y_true, y_pred) -> float | None:
    """100 * mean(2|y-yhat| / (|y|+|yhat|)); terms with 0 denominator contribute 0."""
    a, b = _as_float_arrays(y_true, y_pred)
    if a.size == 0:
        return None
    denominator = np.abs(a) + np.abs(b)
    numerator = 2.0 * np.abs(a - b)
    ratio = np.zeros_like(numerator)
    nonzero = denominator > SMAPE_EPSILON
    ratio[nonzero] = numerator[nonzero] / denominator[nonzero]
    return float(100.0 * np.mean(ratio))


def wape(y_true, y_pred) -> float | None:
    """100 * sum(|y-yhat|) / sum(|y|); undefined when all truth values are zero."""
    a, b = _as_float_arrays(y_true, y_pred)
    if a.size == 0:
        return None
    denominator = float(np.sum(np.abs(a)))
    if denominator <= SMAPE_EPSILON:
        return None
    return float(100.0 * np.sum(np.abs(a - b)) / denominator)


def r2(y_true, y_pred) -> float | None:
    """R^2; returns None (rendered as N/A) when the truth is constant."""
    a, b = _as_float_arrays(y_true, y_pred)
    if a.size == 0:
        return None
    denominator = float(np.sum((a - np.mean(a)) ** 2))
    if denominator <= 0:
        return None
    return float(1.0 - np.sum((a - b) ** 2) / denominator)


def all_metrics(y_true, y_pred, *, sample_count: int | None = None) -> dict[str, object]:
    a, b = _as_float_arrays(y_true, y_pred)
    return {
        "mae": mae(a, b),
        "rmse": rmse(a, b),
        "wape": wape(a, b),
        "smape": smape(a, b),
        "r2": r2(a, b),
        "n_samples": int(a.size) if sample_count is None else int(sample_count),
        "smape_epsilon": SMAPE_EPSILON,
    }


def macro_average(per_group: list[dict[str, object]]) -> dict[str, object]:
    """Equal-weight macro average across regions (spec 9.5)."""
    out: dict[str, object] = {}
    for key in ("mae", "rmse", "wape", "smape"):
        values = [g[key] for g in per_group if g.get(key) is not None]
        out[key] = float(np.mean(values)) if values else None
    r2_values = [g["r2"] for g in per_group if g.get("r2") is not None]
    out["r2"] = float(np.mean(r2_values)) if r2_values else None
    out["n_regions"] = len(per_group)
    out["n_samples"] = int(sum(int(g.get("n_samples") or 0) for g in per_group))
    return out
