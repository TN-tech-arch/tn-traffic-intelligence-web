"""Spatial Analysis: ranking, histogram boundaries and insight consistency."""

import numpy as np

from app.services.insights import spatial_insights
from app.services.stats import _spatial_histogram


def entries(values):
    return [
        {"region_id": f"R{i:02d}", "display_name": f"Region {i:02d}", "value": v,
         "range_mean": v * 1.1 if v is not None else None}
        for i, v in enumerate(values)
    ]


def build(values):
    valid = [e for e in entries(values) if e["value"] is not None]
    top = sorted(valid, key=lambda e: (-e["value"], e["region_id"]))[:12]
    bottom = sorted(valid, key=lambda e: (e["value"], e["region_id"]))[:6]
    arr = np.array([e["value"] for e in valid], dtype="float64")
    hist = _spatial_histogram(arr)
    stats = {
        "count": int(arr.size),
        "mean": float(arr.mean()),
        "median": float(np.median(arr)),
        "std": float(arr.std()),
        "min": float(arr.min()),
        "max": float(arr.max()),
        "p05": float(np.percentile(arr, 5)),
        "p95": float(np.percentile(arr, 95)),
        "cv": float(arr.std() / arr.mean()) if arr.mean() else None,
        "single_value": hist["single_value"],
    }
    insights = spatial_insights(
        entries=entries(values), top=top, bottom=bottom, bins=hist["bins"], stats=stats,
        time_at="2024-01-01 00:00:00", no_data_count=0, unit_label="Traffic volume (source unit unknown)",
    )
    return top, bottom, hist, stats, insights


def test_top_and_bottom_order_and_length():
    values = [float(i) for i in range(20)]
    top, bottom, _, _, _ = build(values)
    assert len(top) == 12
    assert [e["value"] for e in top] == sorted(values, reverse=True)[:12]
    assert len(bottom) == 6
    assert [e["value"] for e in bottom] == sorted(values)[:6]


def test_ties_are_broken_stably_by_region_id():
    values = [5.0, 5.0, 5.0, 1.0]
    top, bottom, _, _, _ = build(values)
    assert [e["region_id"] for e in top[:3]] == ["R00", "R01", "R02"]
    assert bottom[0]["value"] == 1.0
    assert [e["region_id"] for e in bottom[1:]] == ["R00", "R01", "R02"]


def test_zero_values_are_valid_and_can_rank_lowest():
    values = [0.0, 0.0, 10.0, 20.0]
    top, bottom, _, stats, insights = build(values)
    assert bottom[0]["value"] == 0.0 and bottom[1]["value"] == 0.0
    assert stats["count"] == 4
    zeros = next(i for i in insights["low"]["items"] if i["key"] == "zeros")
    assert "2 个区域" in zeros["text"]
    assert "真实 0" in zeros["text"]


def test_distribution_counts_sum_to_valid_regions():
    values = [float(i * 3) for i in range(23)]
    _, _, hist, stats, _ = build(values)
    assert sum(b["count"] for b in hist["bins"]) == stats["count"] == 23
    assert hist["bins"][0]["left_closed"] is True
    assert hist["bins"][-1]["right_closed"] is True
    assert all(not b["right_closed"] for b in hist["bins"][:-1])
    assert all(b["end"] > b["start"] for b in hist["bins"])


def test_single_value_histogram_has_one_closed_bin():
    hist = _spatial_histogram(np.array([7.0, 7.0, 7.0]))
    assert hist["single_value"] is True
    assert len(hist["bins"]) == 1
    assert hist["bins"][0]["count"] == 3
    assert hist["bins"][0]["left_closed"] and hist["bins"][0]["right_closed"]


def test_insight_text_uses_real_numbers():
    values = [1.0, 2.0, 3.0, 100.0]
    top, bottom, _, stats, insights = build(values)
    highest = next(i for i in insights["high"]["items"] if i["key"] == "highest")
    assert top[0]["region_id"] in highest["text"]
    assert f"{top[0]['value']:,.2f}" in highest["text"]
    lowest = next(i for i in insights["low"]["items"] if i["key"] == "lowest")
    assert bottom[0]["region_id"] in lowest["text"]
    main = next(i for i in insights["distribution"]["items"] if i["key"] == "main_bin")
    assert f"{main['metrics']['count']}" in main["text"]
    assert "源单位" in highest["text"]


def test_no_valid_regions_returns_empty_blocks():
    insights = spatial_insights(
        entries=entries([None, None]), top=[], bottom=[], bins=[], stats={"count": 0},
        time_at="2024-01-01 00:00:00", no_data_count=2, unit_label="x",
    )
    assert insights["high"]["available"] is False
    assert insights["low"]["available"] is False
    assert insights["distribution"]["available"] is False


def test_sparse_data_reduces_reliability():
    values = [1.0, 2.0, 3.0]
    _, _, _, _, insights = build(values)
    assert insights["high"]["reliability"]["level"] == "medium"
    assert insights["low"]["warnings"]
