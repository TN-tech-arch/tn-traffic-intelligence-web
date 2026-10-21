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


def test_training_is_single_region_only():
    assert all(item["scope"] == "single" for item in _experiments())
    assert all(
        item["scope"] == "single"
        for item in client.get("/api/batches?limit=200").json()["batches"]
    )
    datasets = client.get("/api/datasets?include_archived=true").json()["datasets"]
    dataset = next(item for item in datasets if item["scope"] == "single")
    rejected = client.post(
        "/api/experiments/run",
        json={
            "dataset_id": dataset["dataset_id"],
            "algorithm_key": "arima",
            "scope": "all",
            "params": {},
        },
    )
    assert rejected.status_code == 409
    assert rejected.json()["code"] == "MULTI_REGION_REMOVED"
    rejected_batch = client.post(
        "/api/batches/run",
        json={
            "dataset_id": dataset["dataset_id"],
            "scope": "all",
            "model_configs": {},
        },
    )
    assert rejected_batch.status_code == 409
    assert rejected_batch.json()["code"] == "MULTI_REGION_REMOVED"


def test_module_three_and_five_reject_removed_all_region_scope():
    dataset = client.get("/api/datasets?include_archived=true").json()["datasets"][0]
    rejected_dataset = client.post(
        "/api/datasets/preview",
        json={
            "values": {
                "source_key": dataset["source_key"],
                "scope": "all",
                "region_id": dataset["region_ids"][0],
                "input_length": 24,
                "output_length": 6,
                "step": 1,
                "train_ratio": 0.7,
                "val_ratio": 0.15,
                "test_ratio": 0.15,
            }
        },
    )
    assert rejected_dataset.status_code in (409, 422)
    assert any(
        item["code"] == "MULTI_REGION_REMOVED"
        for item in rejected_dataset.json()["issues"]
    )

    rejected_evaluation = client.post(
        "/api/evaluations/validate",
        json={
            "dataset_id": dataset["dataset_id"],
            "scope": "all",
            "region_id": dataset["region_ids"][0],
            "experiment_ids": [],
        },
    )
    assert rejected_evaluation.status_code == 200
    assert rejected_evaluation.json()["valid"] is False
    assert any(
        item["code"] == "MULTI_REGION_REMOVED"
        for item in rejected_evaluation.json()["issues"]
    )


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
