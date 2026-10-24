"""Readable history IDs, native frequency and full-range dataset defaults."""

from __future__ import annotations

import re
import sqlite3

from fastapi.testclient import TestClient

from app.core.ids import (
    _next_sequence,
    batch_id,
    cluster_run_id,
    dataset_id,
    experiment_id,
    region_experiment_ids,
)
from app.main import app
from app.services.validation import check_module

client = TestClient(app)


def test_sequence_allocation_reconciles_existing_business_ids():
    conn = sqlite3.connect(":memory:", isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("CREATE TABLE clusters (display_id TEXT)")
    conn.execute("INSERT INTO clusters(display_id) VALUES ('CLUS-MILANO-KMEANS-0042')")

    assert _next_sequence("CLUS|MILANO|KMEANS", conn=conn) == 43
    assert _next_sequence("CLUS|MILANO|KMEANS", conn=conn) == 44


def test_readable_ids_follow_the_required_patterns_and_never_repeat():
    ds = dataset_id("milano", "single", "ADRIANO")
    assert re.fullmatch(r"DS-MILANO-ADRIANO-\d{4,}", ds)
    assert dataset_id("milano", "single", "ADRIANO") != ds

    assert re.fullmatch(
        r"CLUS-MILANO-KMEANS-\d{4,}", cluster_run_id("milano", "kmeans")
    )
    assert re.fullmatch(
        r"EXP-MILANO-ADRIANO-LSTM-\d{4,}",
        experiment_id("milano", "single", "lstm", "ADRIANO"),
    )
    assert re.fullmatch(
        r"BATCH-MILANO-ADRIANO-MODELS-\d{4,}",
        batch_id("milano", "single", region_id="ADRIANO"),
    )
    region_ids = region_experiment_ids("milano", "lstm", ["ADRIANO", "BRERA"])
    assert set(region_ids) == {"ADRIANO", "BRERA"}
    assert len(set(region_ids.values())) == 2
    assert all(re.fullmatch(r"EXP-MILANO-(ADRIANO|BRERA)-LSTM-\d{4,}", value) for value in region_ids.values())


def test_backend_forces_native_frequency_even_for_an_old_client():
    _, m1 = check_module(
        "m1",
        {
            "source_key": "milano",
            "region_ids": ["ADRIANO"],
            "frequency": "60min",
            "aggregation": "sum",
        },
    )
    assert m1["frequency"] == "native"
    assert m1["aggregation"] == "mean"

    _, m3 = check_module(
        "m3",
        {
            "source_key": "milano",
            "scope": "single",
            "region_id": "ADRIANO",
            "frequency": "1day",
            "aggregation": "sum",
        },
    )
    assert m3["frequency"] == "native"
    assert m3["aggregation"] == "mean"


def test_dataset_build_needs_no_label_and_defaults_to_full_real_range():
    before = len(client.get("/api/datasets").json()["datasets"])
    response = client.post(
        "/api/datasets/build",
        json={
            "values": {
                "source_key": "milano",
                "scope": "single",
                "region_id": "ADRIANO",
                "input_length": 144,
                "output_length": 24,
                "step": 144,
                "train_ratio": 0.7,
                "val_ratio": 0.15,
                "test_ratio": 0.15,
            }
        },
    )
    assert response.status_code == 200, response.text
    built = response.json()
    dataset = built["dataset_id"]
    try:
        assert re.fullmatch(r"DS-MILANO-ADRIANO-\d{4,}", dataset)
        assert built["label"] == dataset
        assert built["frequency"] == "native"
        assert built["aggregation"] == "mean"
        assert built["frequency_minutes"] == 10
        assert built["time_start"] == "2013-11-01 00:00:00"
        assert built["time_end"] == "2014-01-01 23:50:00"
        assert len(client.get("/api/datasets").json()["datasets"]) == before + 1
    finally:
        cleanup = client.delete(f"/api/datasets/{dataset}")
        assert cleanup.status_code == 200, cleanup.text


def test_m3_explicit_range_is_used_and_invalid_bounds_are_reported():
    response = client.post(
        "/api/datasets/validate",
        json={
            "values": {
                "source_key": "milano",
                "scope": "single",
                "region_id": "ADRIANO",
                "time_start": "2013-11-02 00:00:00",
                "time_end": "2013-11-08 23:50:00",
                "input_length": 24,
                "output_length": 6,
                "step": 6,
                "train_ratio": 0.7,
                "val_ratio": 0.15,
                "test_ratio": 0.15,
            }
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["valid"] is True

    bad = client.post(
        "/api/datasets/validate",
        json={
            "values": {
                "source_key": "milano",
                "scope": "single",
                "region_id": "ADRIANO",
                "time_start": "2020-01-01 00:00:00",
                "time_end": "2020-01-02 00:00:00",
                "input_length": 24,
                "output_length": 6,
                "step": 6,
                "train_ratio": 0.7,
                "val_ratio": 0.15,
                "test_ratio": 0.15,
            }
        },
    )
    assert bad.status_code == 200
    assert bad.json()["valid"] is False
    assert any(
        item["path"] == "m3.time_start" and item["severity"] == "error"
        for item in bad.json()["issues"]
    )
