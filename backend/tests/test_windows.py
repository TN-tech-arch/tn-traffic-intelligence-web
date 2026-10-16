"""T08/T09/T10: window boundaries, split isolation and causal preprocessing."""

import numpy as np

from app.services import windows as win


def test_window_definition_matches_spec():
    """X = v[t..t+L-1], Y = v[t+L..t+L+H-1], next start = t + S."""
    L, H, S = 4, 2, 2
    starts = win.window_starts_for_range(total_points=20, target_start=6, target_end=14, L=L, H=H, S=S)
    assert starts.tolist() == [2, 4, 6, 8]
    series = np.arange(20, dtype="float64")
    X, Y = win.stack_windows(series, starts, L, H)
    assert X[0].tolist() == [2, 3, 4, 5]
    assert Y[0].tolist() == [6, 7]
    assert X[1].tolist() == [4, 5, 6, 7]
    assert Y[1].tolist() == [8, 9]


def test_targets_never_cross_split_boundaries():
    boundaries = [(0, 10), (10, 15), (15, 20)]
    L, H, S = 3, 2, 1
    for split, (start, end) in zip(win.SPLIT_NAMES, boundaries):
        starts = win.window_starts_for_range(20, start, end, L, H, S)
        for t in starts.tolist():
            assert t + L >= start, f"{split} target starts before the split"
            assert t + L + H - 1 < end, f"{split} target ends after the split"


def test_split_boundaries_absorb_remainder():
    bounds = win.split_boundaries(8928, (0.7, 0.15, 0.15))
    assert bounds[0][1] + (bounds[1][1] - bounds[1][0]) + (bounds[2][1] - bounds[2][0]) == 8928
    assert bounds[0][1] == 6249


def test_causal_interpolation_rejects_windows_that_would_see_the_future():
    values = np.ones((10, 1), dtype="float64")
    values[4, 0] = np.nan
    values[5, 0] = np.nan
    pre = win.preprocess(values, "causal_interpolation")
    # the gap is filled using endpoints 3 and 6 -> imputed_end == 6
    assert pre.imputed_end[4, 0] == 6
    assert pre.imputed_end[5, 0] == 6
    L, H = 3, 1
    # origin = t + L - 1 must be >= 6 for the interpolated input to be usable
    observed = pre.observed[:, 0]
    imputed_end = pre.imputed_end[:, 0]
    starts = np.array([0, 3, 4], dtype="int64")
    valid = win.validate_windows(observed, imputed_end, starts, L, H)
    assert valid[0], "window without imputed inputs stays valid"
    assert not valid[1], "window whose origin precedes the interpolation endpoint must be dropped"
    assert valid[2], "window whose origin is at/after the endpoint may use the interpolation"


def test_targets_are_never_imputed():
    values = np.ones((8, 1), dtype="float64")
    values[5, 0] = np.nan
    pre = win.preprocess(values, "automatic")
    L, H = 2, 2
    observed = pre.observed[:, 0]
    starts = win.window_starts_for_range(8, 0, 8, L, H, 1)
    valid = win.validate_windows(observed, pre.imputed_end[:, 0], starts, L, H)
    for start, ok in zip(starts.tolist(), valid.tolist()):
        targets = range(start + L, start + L + H)
        if 5 in targets:
            assert not ok, "a window whose target contains a missing observation must be invalid"


def test_scaler_is_fitted_on_train_only_and_inverts_exactly():
    train = np.array([[1.0], [3.0], [5.0]])
    observed = np.ones_like(train, dtype=bool)
    scaler = win.fit_scaler(train, observed, "standard")
    assert scaler["mean"] == [3.0]
    scaled = win.apply_scaler(np.array([[3.0], [9.0]]), scaler)
    assert scaled[0, 0] == 0.0
    back = win.inverse_scaler(scaled, scaler)
    assert np.allclose(back, [[3.0], [9.0]])


def test_forward_fill_only_uses_the_past():
    values = np.array([[1.0], [np.nan], [np.nan], [4.0]])
    pre = win.preprocess(values, "automatic")
    assert pre.filled[1, 0] == 1.0
    assert pre.filled[2, 0] == 1.0
    assert pre.observed[1, 0] == False  # noqa: E712 - explicit intent
    assert pre.observed[3, 0] == True  # noqa: E712
    # a filled point is only valid while its own index is <= the window origin
    assert pre.imputed_end[1, 0] == 1
