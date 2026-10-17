"""Multi-City comparison contracts: sample counts, normalisation and insights."""

import numpy as np
from fastapi.testclient import TestClient

from app.main import app
from app.services.insights import comparison_insights
from app.services.stats import zscore_typical

client = TestClient(app)


def compare_payload():
    return {
        "source_keys": ["milano", "trentino", "zte"],
        "frequency": "60min",
        "aggregation": "mean",
    }


def test_compare_reports_raw_hourly_and_profile_counts_separately():
    response = client.post("/api/analysis/compare", json=compare_payload())
    assert response.status_code == 200, response.text
    data = response.json()
    by_key = {source["source_key"]: source for source in data["sources"]}
    assert set(by_key) == {"milano", "trentino", "zte"}

    expected = {
        "milano": (8928, 785664, 10, 1488),
        "trentino": (8928, 1990944, 10, 1488),
        "zte": (2784, 412032, 15, 696),
    }
    for key, (raw_points, raw_observations, interval, hourly_buckets) in expected.items():
        source = by_key[key]
        assert source["raw_time_point_count"] == raw_points
        assert source["raw_observation_count"] == raw_observations
        assert source["raw_valid_observation_count"] == raw_observations
        assert source["native_frequency_minutes"] == interval
        assert source["hourly_bucket_count"] == hourly_buckets
        assert source["hourly_valid_bucket_count"] == hourly_buckets
        assert source["hourly_profile_points"] == 24
        assert source["coverage_hours"] == 24
        assert len(source["hourly_profile"]) == 24
        assert all(point["samples"] > 0 for point in source["hourly_profile"])
        assert source["cv_basis"].startswith("24 个典型小时均值")
        assert abs(float(np.mean(source["hourly_shape_z"]))) < 1e-10
        assert abs(float(np.std(source["hourly_shape_z"])) - 1.0) < 1e-10

    assert by_key["milano"]["time_end"].startswith("2014-01-01 23:50")
    assert by_key["zte"]["time_end"].startswith("2024-08-25 23:45")
    assert "ZTE 为 4G 下行流量" in data["warning"]
    assert len(data["disclaimers"]) == 1


def test_compare_insights_use_the_same_24_hour_curves():
    data = client.post("/api/analysis/compare", json=compare_payload()).json()
    insights = data["insights"]
    assert [item["key"] for item in insights["items"]] == [
        "peaks",
        "valleys",
        "similarity",
        "variation",
    ]
    assert len(insights["similarity"]["pairs"]) == 3
    assert all(pair["common_hours"] == 24 for pair in insights["similarity"]["pairs"])
    closest = insights["similarity"]["closest"]
    assert closest is not None
    assert closest["left"] == "Milano"
    assert closest["right"] == "Trentino"

    for source in data["sources"]:
        name = source["display_name"]
        z = np.asarray(source["hourly_shape_z"], dtype="float64")
        peak_metrics = insights["peaks"][name]
        valley_metrics = insights["valleys"][name]
        assert int(np.argmax(z)) in peak_metrics["hours"]
        assert int(np.argmin(z)) in valley_metrics["hours"]

    largest = insights["time_difference"]["largest_hourly_spread"]
    assert largest is not None
    assert largest["highest"] != largest["lowest"]
    assert insights["warnings"] == []


def test_zscore_keeps_missing_hours_and_refuses_zero_variance():
    with_missing = zscore_typical([1.0, 2.0, 3.0] + [None] * 21)
    assert with_missing["available"] is True
    assert with_missing["values"][3:] == [None] * 21
    assert all(value is not None for value in with_missing["values"][:3])

    constant = zscore_typical([5.0] * 24)
    assert constant["available"] is False
    assert constant["zero_variance"] is True
    assert constant["values"] == [None] * 24

    insufficient = zscore_typical([5.0] + [None] * 23)
    assert insufficient["available"] is False
    assert insufficient["values"] == [None] * 24
    assert "只有 1 个有效小时" in insufficient["reason"]


def test_comparison_insights_are_safe_for_a_constant_source():
    profile = [{"hour": hour, "mean": 5.0, "z": None, "samples": 3} for hour in range(24)]
    entry = {
        "source_key": "constant",
        "display_name": "Constant",
        "hourly_profile": profile,
        "coverage_hours": 24,
        "zero_variance": True,
        "cv_typical": 0.0,
        "raw_time_point_count": 24,
        "raw_valid_observation_count": 24,
        "hourly_bucket_count": 24,
        "hourly_valid_bucket_count": 24,
        "time_start": "2024-01-01 00:00:00",
        "time_end": "2024-01-01 23:00:00",
    }
    result = comparison_insights([entry])
    assert result["available"] is True
    assert result["peaks"]["Constant"]["all_tied"] is True
    assert result["similarity"]["pairs"] == []
    assert result["reliability"]["level"] == "low"
    assert any("未生成 Z-score" in warning for warning in result["warnings"])
