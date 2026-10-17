"""Module 1 API contract: date ranges drive every statistic and insights."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def base_payload(**overrides):
    payload = {
        "source_key": "milano",
        "region_ids": ["ADRIANO"],
        "frequency": "native",
        "aggregation": "mean",
        "time_start": "2013-11-04 00:00:00",
        "time_end": "2013-11-10 23:50:00",
        "acf_max_lag": 0,
        "day_start_hour": 6,
        "day_end_hour": 18,
        "max_regions": 6,
    }
    payload.update(overrides)
    return payload


def test_temporal_uses_the_selected_dates_everywhere():
    response = client.post("/api/analysis/temporal", json=base_payload())
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["range"]["points"] == 1008
    assert data["range"]["start_at"] == "2013-11-04 00:00:00"
    assert data["range"]["end_at"] == "2013-11-10 23:50:00"
    assert len(data["series"][0]["timestamps"]) == 1008
    assert len(data["series"][0]["values"]) == 1008
    # header aggregates must be computed from the same slice
    stats = data["statistics"][0]
    assert stats["valid_points"] == 1008
    assert data["range"]["valid_points"]["ADRIANO"] == 1008
    hourly = data["hourly"][0]["hours"]
    assert sum(point["samples"] for point in hourly) == 1008
    weekday = data["weekday"][0]
    assert weekday["weekday"]["valid_dates"] == 5
    assert weekday["weekend"]["valid_dates"] == 2


def test_temporal_insights_are_consistent_with_the_statistics():
    data = client.post("/api/analysis/temporal", json=base_payload()).json()
    stats = data["statistics"][0]
    peak_item = data["insights"]["hourly"]["items"][0]
    peak_hour = peak_item["metrics"].get("hour")
    hourly = data["hourly"][0]["hours"]
    if peak_hour is not None:
        assert abs(hourly[peak_hour]["mean"] - peak_item["metrics"]["value"]) < 1e-6
    # trend insight must quote the same slope as the trend object
    trend_item = next(i for i in data["insights"]["acf_trend"]["items"] if i["key"] == "trend")
    assert f"{data['trend']['slope_per_hour']:,.2f}" in trend_item["text"]
    assert stats["mean"] is not None


def test_weekday_only_range_reports_missing_weekend_without_fake_curve():
    payload = base_payload(time_start="2013-11-04 00:00:00", time_end="2013-11-08 23:50:00")
    data = client.post("/api/analysis/temporal", json=payload).json()
    weekend = data["weekday"][0]["weekend"]
    assert weekend["samples"] == 0
    assert all(point["mean"] is None for point in weekend["profile"])
    overall = next(i for i in data["insights"]["weekday"]["items"] if i["key"] == "overall")
    assert "没有有效周末数据" in overall["text"]


def test_invalid_date_order_is_rejected_with_field_error():
    payload = base_payload(time_start="2013-11-10 00:00:00", time_end="2013-11-04 00:00:00")
    response = client.post("/api/analysis/temporal", json=payload)
    assert response.status_code == 422
    issues = response.json()["issues"]
    assert any(i["path"] == "m1.time_start" and i["code"] == "DATE_ORDER" for i in issues)


def test_out_of_bounds_dates_are_rejected():
    payload = base_payload(time_start="2024-01-01 00:00:00", time_end="2024-01-02 00:00:00")
    response = client.post("/api/analysis/temporal", json=payload)
    assert response.status_code == 422
    assert any(i["code"] == "OUT_OF_BOUNDS" for i in response.json()["issues"])


def test_huge_analysis_is_never_silently_faked():
    """A Max Lag larger than the series is clamped and reported, not rejected."""
    data = client.post("/api/analysis/temporal", json=base_payload(acf_max_lag=5000)).json()
    assert data["acf"]["max_lag"] <= data["range"]["points"] - 2
    assert any("Max Lag" in line for line in data["warnings"])


def test_max_lag_changes_the_acf_result():
    short = client.post("/api/analysis/temporal", json=base_payload(acf_max_lag=24)).json()
    long = client.post("/api/analysis/temporal", json=base_payload(acf_max_lag=144)).json()
    assert len(short["acf"]["lags"]) == 24
    assert len(long["acf"]["lags"]) == 144
    daily = next(c for c in long["acf"]["periodicity"]["candidates"] if "24 小时" in c["name"])
    assert daily["available"] is True
    covered = next(c for c in short["acf"]["periodicity"]["candidates"] if "24 小时" in c["name"])
    assert covered["available"] is False


def test_spatial_reports_range_means_and_keeps_slice_independent():
    payload = base_payload()
    data = client.post("/api/analysis/spatial", json={**payload, "time_index": 100}).json()
    assert data["range"]["points"] == 1008
    assert data["time_at"] is not None
    assert all("range_mean" in region for region in data["regions"])
    # the slice value is a single observation, not the range mean
    sample = next(r for r in data["regions"] if r["value"] is not None)
    assert sample["range_mean"] is not None
    assert sample["range_valid_points"] == 1008
