"""API contract for Spatial Analysis."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def payload(**overrides):
    data = {
        "source_key": "milano",
        "frequency": "native",
        "aggregation": "mean",
        "time_index": 0,
        "time_start": "2013-11-01 00:00:00",
        "time_end": "2013-11-07 23:50:00",
    }
    data.update(overrides)
    return data


def test_spatial_covers_all_regions_of_the_source_not_the_selection():
    data = client.post("/api/analysis/spatial", json=payload()).json()
    assert data["value_region_count"] == 88
    assert data["no_data_region_count"] == 0
    assert len(data["top"]) == 12
    assert len(data["bottom"]) == 6
    assert data["top"][0]["value"] >= data["top"][-1]["value"]
    assert data["bottom"][0]["value"] <= data["bottom"][-1]["value"]
    # ranking is independent from the (unused) region selection field
    with_selection = client.post(
        "/api/analysis/spatial", json=payload(region_ids=["ADRIANO"])
    ).json()
    assert with_selection["value_region_count"] == data["value_region_count"]
    assert with_selection["top"][0]["region_id"] == data["top"][0]["region_id"]


def test_distribution_counts_add_up():
    data = client.post("/api/analysis/spatial", json=payload()).json()
    bins = data["distribution"]["bins"]
    assert sum(b["count"] for b in bins) == data["value_region_count"]
    assert data["distribution"]["total"] == data["value_region_count"]
    assert all(b["end"] > b["start"] for b in bins)


def test_spatial_insights_cover_three_blocks():
    data = client.post("/api/analysis/spatial", json=payload()).json()
    for key in ("high", "low", "distribution"):
        block = data["insights"][key]
        assert block["items"], key
        assert block["items"][0]["text"]
        assert block["details"]


def test_zte_respects_no_data_regions():
    data = client.post(
        "/api/analysis/spatial",
        json=payload(source_key="zte", time_index=0, time_start="2024-07-28 00:00:00",
                     time_end="2024-08-03 23:45:00"),
    ).json()
    assert data["value_region_count"] == 148
    assert data["no_data_region_count"] == 0  # no missing values inside the 148 time-series regions
    assert data["gis_no_data_count"] == 14     # GIS-only polygons are reported separately
    assert len(data["top"]) == 12
