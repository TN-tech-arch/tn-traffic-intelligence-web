"""API level tests, including the negative tests required by T48."""

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_reports_database_and_environment():
    payload = client.get("/api/health").json()
    assert payload["status"] in ("ok", "degraded")
    assert payload["database"]["ok"] is True
    assert "cuda_available" in payload["notes"]


def test_sources_match_the_real_data_baseline():
    payload = client.get("/api/data/sources").json()
    assert payload["totals"]["sources"] == 3
    assert payload["totals"]["series_regions"] == 459
    assert payload["totals"]["gis_regions"] == 473
    assert payload["totals"]["no_data_regions"] == 14
    by_key = {s["key"]: s for s in payload["sources"]}
    assert by_key["milano"]["time_point_count"] == 8928
    assert by_key["trentino"]["time_point_count"] == 8928
    assert by_key["zte"]["time_point_count"] == 2784
    assert by_key["zte"]["zero_value_count"] == 735
    assert by_key["milano"]["native_frequency_minutes"] == 10
    assert by_key["zte"]["native_frequency_minutes"] == 15


def test_registry_exposes_exactly_twelve_models_and_all_models_entry():
    payload = client.get("/api/models/registry").json()
    assert payload["algorithm_count"] == 12
    assert payload["all_models"]["is_algorithm"] is False
    keys = [m["key"] for m in payload["models"]]
    assert keys == [
        "arima", "prophet", "random_forest", "xgboost", "lightgbm", "mlp", "rnn", "lstm", "gru",
        "transformer", "timesfm", "chronos",
    ]
    for model in payload["models"]:
        assert model["params"], f"{model['key']} has no parameters"
        for spec in model["params"]:
            assert spec["help_zh"], f"{model['key']}.{spec['key']} missing Chinese help text"


def test_geometry_returns_real_polygons_and_no_data_regions():
    payload = client.get("/api/data/geometry?source_key=zte").json()
    assert len(payload["features"]) == 162
    assert len(payload["metadata"]["no_data_regions"]) == 14


def test_dataset_validation_rejects_l_zero_with_field_path():
    response = client.post(
        "/api/datasets/validate",
        json={"values": {"source_key": "milano", "scope": "single", "region_id": "DUOMO",
                         "frequency": "native", "aggregation": "mean", "input_length": 0,
                         "output_length": 6, "step": 1, "train_ratio": 0.7, "val_ratio": 0.15,
                         "test_ratio": 0.15}},
    )
    payload = response.json()
    assert response.status_code == 200  # validate endpoint reports, never mutates
    assert payload["valid"] is False
    assert any(i["path"] == "m3.input_length" and i["severity"] == "error" for i in payload["issues"])


def test_dataset_build_rejects_invalid_ratio_sum_without_creating_a_dataset():
    before = len(client.get("/api/datasets").json()["datasets"])
    response = client.post(
        "/api/datasets/build",
        json={"values": {"source_key": "milano", "scope": "single", "region_id": "DUOMO",
                         "frequency": "native", "aggregation": "mean", "input_length": 24,
                         "output_length": 6, "step": 1, "train_ratio": 0.7, "val_ratio": 0.2,
                         "test_ratio": 0.2}},
    )
    assert response.status_code == 422
    issues = response.json()["issues"]
    assert any(i["code"] == "RATIO_SUM" for i in issues)
    after = len(client.get("/api/datasets").json()["datasets"])
    assert before == after, "a rejected build must not create a dataset"


def test_experiment_run_rejects_dropout_1_5_bypassing_the_frontend():
    dataset_id = _any_dataset_id()
    if dataset_id is None:
        pytest.skip("no dataset available in this database")
    before = len(client.get("/api/experiments").json()["experiments"])
    response = client.post(
        "/api/experiments/run",
        json={"dataset_id": dataset_id, "algorithm_key": "mlp", "params": {"dropout": 1.5}},
    )
    assert response.status_code == 422
    body = response.json()
    assert any(i["path"].endswith("dropout") and i["severity"] == "error" for i in body["issues"])
    assert body["request_id"]
    after = len(client.get("/api/experiments").json()["experiments"])
    assert before == after, "a rejected run must not create an experiment"


def test_experiment_run_rejects_transformer_head_mismatch():
    dataset_id = _any_dataset_id()
    if dataset_id is None:
        pytest.skip("no dataset available in this database")
    response = client.post(
        "/api/experiments/run",
        json={"dataset_id": dataset_id, "algorithm_key": "transformer",
              "params": {"d_model": 130, "n_heads": 8}},
    )
    assert response.status_code == 422
    assert any(i["code"] == "DIVISIBLE" for i in response.json()["issues"])


def test_batch_run_rejects_unknown_dataset():
    response = client.post("/api/batches/run", json={"dataset_id": "DS-DOES-NOT-EXIST"})
    assert response.status_code == 404


def test_batch_validation_reports_each_algorithm():
    dataset_id = _any_dataset_id()
    if dataset_id is None:
        pytest.skip("no dataset available in this database")
    payload = client.post(
        "/api/models/preflight",
        json={"dataset_id": dataset_id, "algorithm_choice": "all_models",
              "model_configs": {"mlp": {"mode": "train", "params": {"dropout": 2.0}}}},
    ).json()
    assert len(payload["models"]) == 12
    broken = [m for m in payload["models"] if m["errors"]]
    assert [m["algorithm_key"] for m in broken] == ["mlp"]
    assert payload["blocking_error_count"] == 1


def test_evaluation_requires_experiments():
    dataset_id = _any_dataset_id()
    if dataset_id is None:
        pytest.skip("no dataset available in this database")
    response = client.post(
        "/api/evaluations/validate",
        json={"dataset_id": dataset_id, "scope": "single", "region_id": "R1", "experiment_ids": []},
    )
    payload = response.json()
    assert payload["valid"] is False
    assert any(i["path"] == "m5.experiment_ids" for i in payload["issues"])


def test_delete_protection_for_referenced_dataset():
    """T30: a dataset referenced by an experiment may not be hard deleted."""
    row = client.get("/api/datasets").json()["datasets"]
    referenced = [d for d in row if d["is_referenced"]]
    if not referenced:
        pytest.skip("no referenced dataset in this database")
    response = client.delete(f"/api/datasets/{referenced[0]['dataset_id']}")
    assert response.status_code == 409
    assert response.json()["code"] == "DATASET_REFERENCED"


def test_validation_schema_is_machine_readable():
    payload = client.get("/api/validation/schema").json()
    assert set(payload["modules"].keys()) == {"m1", "m2", "m3", "m5"}
    assert len(payload["models"]) == 12
    assert payload["contract"]["severity"]


def _any_dataset_id():
    datasets = client.get("/api/datasets").json()["datasets"]
    return datasets[0]["dataset_id"] if datasets else None
