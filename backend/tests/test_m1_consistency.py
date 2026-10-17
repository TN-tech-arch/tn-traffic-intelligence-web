"""Charts, numbers and insight text must describe exactly the same observations."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

PAYLOAD = {
    "source_key": "milano",
    "region_ids": ["ADRIANO"],
    "frequency": "native",
    "aggregation": "mean",
    "time_start": "2013-11-02 00:00:00",
    "time_end": "2013-11-15 23:50:00",
    "acf_max_lag": 0,
    "day_start_hour": 6,
    "day_end_hour": 18,
    "max_regions": 6,
}


def fetch():
    response = client.post("/api/analysis/temporal", json=PAYLOAD)
    assert response.status_code == 200, response.text
    return response.json()


def test_sample_counts_add_up_across_the_three_views():
    data = fetch()
    valid = data["statistics"][0]["valid_points"]
    assert valid == data["range"]["valid_points"]["ADRIANO"]
    hourly = data["hourly"][0]["hours"]
    assert sum(point["samples"] for point in hourly) == valid
    weekday = data["weekday"][0]
    assert weekday["weekday"]["samples"] + weekday["weekend"]["samples"] == valid
    # ACF uses the same number of observations (before pairwise lag exclusion)
    assert data["acf"]["valid_points"] == valid


def test_hourly_chart_and_insight_share_the_same_peak():
    data = fetch()
    hours = data["hourly"][0]["hours"]
    peak_item = data["insights"]["hourly"]["items"][0]
    if peak_item["key"] == "peak" and peak_item["metrics"].get("hour") is not None:
        hour = peak_item["metrics"]["hour"]
        assert abs(hours[hour]["mean"] - peak_item["metrics"]["value"]) < 1e-6
        assert f"{peak_item['metrics']['value']:,.2f}" in peak_item["text"]


def test_weekday_metrics_come_from_the_same_series():
    data = fetch()
    groups = data["weekday"][0]
    overall = next(i for i in groups["insights"]["items"] if i["key"] == "overall")
    assert overall["metrics"]["weekday_mean"] is not None
    assert abs(overall["metrics"]["weekday_mean"] - groups["weekday"]["mean"]) < 1e-6
    assert f"{groups['weekday']['mean']:,.2f}" in overall["text"]
    # peak hours in metrics must match the argmax of the curve
    peaks = groups["insights"]["peaks"]
    weekday_means = [p["mean"] for p in groups["weekday"]["profile"]]
    if peaks.get("weekday") is not None:
        best = max((v, i) for i, v in enumerate(weekday_means) if v is not None)[1]
        assert peaks["weekday"] == best


def test_acf_and_trend_text_quote_the_returned_numbers():
    data = fetch()
    trend = data["trend"]
    trend_item = next(i for i in data["insights"]["acf_trend"]["items"] if i["key"] == "trend")
    assert f"{trend['slope_per_hour']:,.2f}" in trend_item["text"]
    acf = data["acf"]
    # every plotted ACF value is finite or explicitly null, and the 95% band exists
    assert len(acf["values"]) == len(acf["lags"]) == len(acf["ci"])
    assert all(v is None or -1.0000001 <= v <= 1.0000001 for v in acf["values"])
    daily = next(c for c in acf["periodicity"]["candidates"] if "24 小时" in c["name"])
    if daily["status"] == "confirmed":
        assert daily["repetitions"] >= 3
        assert daily["pairs"] >= 2 * daily["peak_lag"]


def test_periodicity_states_are_exclusive_and_explained():
    data = fetch()
    for candidate in data["acf"]["periodicity"]["candidates"]:
        assert candidate["status"] in ("confirmed", "candidate", "insufficient")
        if candidate["status"] != "confirmed":
            assert candidate["reason"], f"{candidate['name']} must explain why it is not confirmed"
        if candidate["status"] == "confirmed":
            assert candidate["repetitions"] >= 3
