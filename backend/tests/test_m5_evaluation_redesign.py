"""Module 5 redesign: traceability, compatibility and horizon metrics."""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.datasets import load_dataset
from app.workers.tasks import _evaluation_metrics, _filter_test_batch, _region_batch

client = TestClient(app)


def _datasets() -> list[dict]:
    return client.get("/api/datasets?include_archived=true").json()["datasets"]


def test_m5_rejects_experiment_from_another_dataset():
    datasets = [item for item in _datasets() if item["scope"] == "single"]
    experiments = client.get("/api/experiments?limit=500").json()["experiments"]
    pair = next(
        (
            (dataset, experiment)
            for dataset in datasets
            for experiment in experiments
            if experiment.get("dataset_id") != dataset["dataset_id"]
            and experiment.get("status") in ("Completed", "Partial")
        ),
        None,
    )
    assert pair is not None
    dataset, experiment = pair
    response = client.post(
        "/api/evaluations/validate",
        json={
            "dataset_id": dataset["dataset_id"],
            "scope": "single",
            "region_id": dataset["region_ids"][0],
            "experiment_ids": [experiment["experiment_id"]],
            "test_selection": "full",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["valid"] is False
    assert any(item["code"] == "DATASET_MISMATCH" for item in payload["issues"])
    assert payload["compatibility"]["standard_ranking_allowed"] is False


def test_m5_export_endpoint_is_removed():
    evaluations = client.get("/api/evaluations?limit=1").json()["evaluations"]
    assert evaluations
    response = client.get(f"/api/evaluations/{evaluations[0]['evaluation_id']}/export")
    assert response.status_code == 404


def test_m5_custom_range_must_stay_inside_test_split():
    dataset = next(item for item in _datasets() if item["scope"] == "single")
    experiment = next(
        item for item in client.get("/api/experiments?limit=500").json()["experiments"]
        if item["dataset_id"] == dataset["dataset_id"]
        and item.get("status") in ("Completed", "Partial")
    )
    response = client.post(
        "/api/evaluations/validate",
        json={
            "dataset_id": dataset["dataset_id"],
            "scope": "single",
            "region_id": dataset["region_ids"][0],
            "experiment_ids": [experiment["experiment_id"]],
            "test_selection": "range",
            "range_start_at": "1900-01-01 00:00:00",
            "range_end_at": "1900-01-02 00:00:00",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["valid"] is False
    assert any(item["code"] == "RANGE_OUTSIDE_TEST" for item in payload["issues"])


def test_m5_test_range_filters_real_test_windows():
    dataset = next(
        item for item in _datasets()
        if item["scope"] == "single" and item["window_counts"].get("test", 0) >= 4
    )
    bundle = load_dataset(dataset["dataset_id"])
    batch = _region_batch(bundle, dataset["region_ids"][0], "test")
    start = str(np.datetime_as_string(batch.target_timestamps[batch.size // 3, 0], unit="s")).replace("T", " ")
    end = str(np.datetime_as_string(batch.target_timestamps[(batch.size * 2) // 3, -1], unit="s")).replace("T", " ")
    filtered, detail = _filter_test_batch(
        batch,
        {
            "test_selection": "range",
            "range_start_at": start,
            "range_end_at": end,
        },
    )
    assert 0 < filtered.size < batch.size
    assert detail["actual_start_at"] >= start
    assert detail["actual_end_at"] <= end
    assert detail["valid_prediction_count"] == filtered.size * bundle.H


def test_m5_overall_and_per_horizon_metrics_use_all_horizons():
    truth = np.asarray(
        [
            [10.0, 20.0, 30.0],
            [12.0, 22.0, 32.0],
            [14.0, 24.0, 34.0],
        ]
    )
    prediction = truth + np.asarray([[1.0, -1.0, 2.0], [2.0, 0.0, -2.0], [1.0, 1.0, 1.0]])
    overall, per_horizon = _evaluation_metrics(truth, prediction)
    assert overall["n_samples"] == truth.size
    assert [item["horizon_step"] for item in per_horizon] == [1, 2, 3]
    assert all(item["n_samples"] == truth.shape[0] for item in per_horizon)
    assert overall["mae"] == pytest.approx(np.mean(np.abs(truth - prediction)))
