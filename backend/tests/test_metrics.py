"""T28: metric definitions checked against independent hand computed samples."""

import math

import numpy as np
import pytest

from app.services.metrics import all_metrics, mae, macro_average, r2, rmse, smape


def test_mae_rmse_hand_computed():
    y_true = [3.0, -0.5, 2.0, 7.0]
    y_pred = [2.5, 0.0, 2.0, 8.0]
    assert mae(y_true, y_pred) == pytest.approx(0.5)
    assert rmse(y_true, y_pred) == pytest.approx(math.sqrt(0.375))


def test_smape_hand_computed():
    y_true = [100.0, 20.0]
    y_pred = [110.0, 15.0]
    expected = 100 * (2 * 10 / 210 + 2 * 5 / 35) / 2
    assert smape(y_true, y_pred) == pytest.approx(expected)


def test_smape_zero_over_zero_contributes_zero():
    """ZTE contains genuine zeros: 0/0 must contribute 0, not NaN."""
    value = smape([0.0, 0.0, 10.0], [0.0, 0.0, 12.0])
    expected = 100 * (0 + 0 + 2 * 2 / 22) / 3
    assert value == pytest.approx(expected)
    assert not math.isnan(value)


def test_r2_undefined_for_constant_truth():
    assert r2([5.0, 5.0, 5.0], [5.0, 6.0, 4.0]) is None


def test_r2_perfect_and_manual():
    assert r2([1.0, 2.0, 3.0], [1.0, 2.0, 3.0]) == pytest.approx(1.0)
    assert r2([1.0, 2.0, 3.0], [1.0, 2.0, 4.0]) == pytest.approx(0.5)


def test_non_finite_pairs_are_ignored_not_zeroed():
    result = all_metrics([1.0, np.nan, 3.0], [1.0, 5.0, 4.0])
    assert result["n_samples"] == 2
    assert result["mae"] == pytest.approx(0.5)


def test_macro_average_is_equal_weight_per_region():
    per_region = [
        {"mae": 1.0, "rmse": 1.0, "smape": 10.0, "r2": 0.9, "n_samples": 10},
        {"mae": 3.0, "rmse": 3.0, "smape": 30.0, "r2": None, "n_samples": 1000},
    ]
    macro = macro_average(per_region)
    assert macro["mae"] == pytest.approx(2.0)
    assert macro["smape"] == pytest.approx(20.0)
    assert macro["r2"] == pytest.approx(0.9)  # None values excluded, not treated as 0
    assert macro["n_regions"] == 2
    assert macro["n_samples"] == 1010
