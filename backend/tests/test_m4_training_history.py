"""Module 4 training history and monitoring API regression."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _experiments() -> list[dict]:
    response = client.get("/api/experiments?limit=500")
    assert response.status_code == 200
    return response.json()["experiments"]


def test_experiment_detail_contains_real_monitoring_fields():
    completed = next(item for item in _experiments() if item["status"] == "Completed")
    response = client.get(f"/api/experiments/{completed['display_id']}")
    assert response.status_code == 200
    detail = response.json()
    assert detail["internal_id"] == completed["experiment_id"]
    assert detail["display_id"] == completed["display_id"]
    assert detail["started_at"]
    assert detail["ended_at"]
    assert detail["region_models"]
    for region in detail["region_models"]:
        assert region["status"] in ("Completed", "Partial", "Failed", "Stopped", "Queued", "Running")
        assert "started_at" in region
        assert "ended_at" in region


def test_all_regions_experiment_keeps_independent_region_models():
    all_region = next(
        item
        for item in _experiments()
        if item["scope"] == "all"
        and item["region_total"] > 1
        and item["status"] == "Completed"
    )
    detail = client.get(
        f"/api/experiments/{all_region['experiment_id']}?include_logs=true"
    ).json()
    regions = detail["region_models"]
    assert len(regions) == all_region["region_total"]
    assert len({row["region_id"] for row in regions}) == len(regions)
    assert all(row["region_experiment_id"].startswith("EXP-") for row in regions)


def test_failed_and_batch_records_are_not_reported_as_success():
    experiments = _experiments()
    failed = next((item for item in experiments if item["status"] == "Failed"), None)
    if failed:
        failed_detail = client.get(f"/api/experiments/{failed['experiment_id']}").json()
        assert failed_detail["status"] == "Failed"
        assert failed_detail["error"]

    batches = client.get("/api/batches?limit=200").json()["batches"]
    batch = next(item for item in batches if item["status"] == "Completed")
    batch_detail = client.get(f"/api/batches/{batch['batch_id']}").json()
    assert batch_detail["display_id"].startswith("BATCH-")
    assert batch_detail["experiments"]
    assert all("display_id" in row for row in batch_detail["experiments"])
    assert all("region_id" in row for row in batch_detail["region_summary"])
    assert all("started_at" in row and "ended_at" in row for row in batch_detail["region_summary"])


def test_module_five_can_resolve_a_module_four_display_id():
    experiment = next(item for item in _experiments() if item["status"] in ("Completed", "Partial"))
    detail = client.get(f"/api/experiments/{experiment['experiment_id']}").json()
    snapshot = detail["snapshot"]
    region_id = snapshot.get("region_ids", [None])[0]
    assert region_id
    response = client.post(
        "/api/evaluations/validate",
        json={
            "dataset_id": detail["dataset_id"],
            "scope": "single",
            "region_id": region_id,
            "experiment_ids": [detail["display_id"]],
            "test_selection": "full",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    member = next(
        item for item in payload["experiments"] if item["internal_id"] == detail["internal_id"]
    )
    assert member["display_id"] == detail["display_id"]
