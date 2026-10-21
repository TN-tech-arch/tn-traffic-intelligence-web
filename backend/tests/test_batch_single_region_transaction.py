"""Regression coverage for single-region All Models batch allocation."""

from __future__ import annotations

import sqlite3
from types import SimpleNamespace

import numpy as np

from app.api import batches_api


def test_batch_allocates_all_experiment_ids_in_one_transaction(tmp_path, monkeypatch):
    db_path = tmp_path / "batch.db"
    conn = sqlite3.connect(str(db_path), isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        CREATE TABLE batches (
            batch_id TEXT PRIMARY KEY,
            display_id TEXT,
            dataset_id TEXT NOT NULL,
            scope TEXT NOT NULL,
            algorithm_count INTEGER NOT NULL,
            region_count INTEGER NOT NULL,
            planned_tasks INTEGER NOT NULL,
            policy_json TEXT NOT NULL,
            params_snapshot_json TEXT NOT NULL,
            task_summary_json TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            idempotency_key TEXT,
            started_at TEXT
        );
        CREATE TABLE experiments (
            experiment_id TEXT PRIMARY KEY,
            dataset_id TEXT NOT NULL,
            batch_id TEXT,
            algorithm_key TEXT NOT NULL,
            algorithm_label TEXT NOT NULL,
            display_id TEXT,
            category TEXT NOT NULL,
            mode TEXT NOT NULL,
            scope TEXT NOT NULL,
            params_json TEXT NOT NULL,
            snapshot_json TEXT NOT NULL,
            status TEXT NOT NULL,
            region_total INTEGER NOT NULL,
            region_completed INTEGER NOT NULL,
            region_failed INTEGER NOT NULL,
            error TEXT,
            created_at TEXT NOT NULL,
            ended_at TEXT
        );
        CREATE TABLE experiment_region_models (
            experiment_id TEXT NOT NULL,
            region_id TEXT NOT NULL,
            region_experiment_id TEXT,
            status TEXT NOT NULL,
            PRIMARY KEY (experiment_id, region_id)
        );
        CREATE TABLE jobs (
            sequence_no INTEGER NOT NULL
        );
        CREATE TABLE readable_id_sequences (
            sequence_key TEXT PRIMARY KEY,
            next_value INTEGER NOT NULL,
            updated_at TEXT NOT NULL
        );
        """
    )

    models = [
        {
            "key": f"model_{index}",
            "label": f"Model {index}",
            "category": "statistical",
            "default_mode": "train",
        }
        for index in range(12)
    ]
    bundle = SimpleNamespace(
        dataset={
            "dataset_id": "DS-MILANO-ADRIANO-0099",
            "source_key": "milano",
            "scope": "single",
            "hash": "test-hash",
            "L": 24,
            "H": 6,
            "S": 1,
            "frequency": "native",
            "split_boundaries": {},
            "preprocess": {},
        },
        L=24,
        H=6,
        S=1,
        region_ids=["ADRIANO"],
        valid_starts=lambda region_id, split: np.arange(100),
    )
    created_jobs: list[dict] = []

    monkeypatch.setattr(batches_api, "get_connection", lambda: conn)
    monkeypatch.setattr(batches_api, "load_dataset", lambda dataset_id: bundle)
    monkeypatch.setattr(batches_api, "MODELS", models)
    monkeypatch.setattr(batches_api, "default_params", lambda key: {})
    monkeypatch.setattr(
        batches_api,
        "all_models_summary",
        lambda model_configs, context: {
            "models": [
                {"algorithm_key": model["key"], "params": {}, "errors": []}
                for model in models
            ],
            "batch_issues": [],
        },
    )
    monkeypatch.setattr(batches_api, "_gate_foundation", lambda key, params: [])
    monkeypatch.setattr(
        batches_api,
        "make_batch_id",
        lambda source_key, scope, region_id=None: "BATCH-MILANO-ADRIANO-MODELS-0099",
    )

    def fake_create_job(**kwargs):
        created_jobs.append(kwargs)
        return f"JOB-{len(created_jobs):04d}"

    monkeypatch.setattr(batches_api, "create_job", fake_create_job)
    try:
        response = batches_api.run_batch(
            {
                "dataset_id": bundle.dataset["dataset_id"],
                "scope": "single",
                "model_configs": {},
                "execution_policy": {
                    "continue_on_error": True,
                    "skip_unavailable_after_confirmation": True,
                },
            }
        )
    finally:
        conn.close()

    assert response["scope"] == "single"
    assert response["region_count"] == 1
    assert response["algorithm_count"] == 12
    assert response["planned_region_model_tasks"] == 12
    assert len(response["experiments"]) == 12
    assert len(created_jobs) == 12
    experiment_ids = [item["experiment_id"] for item in response["experiments"]]
    assert len(set(experiment_ids)) == 12
    assert all(item.startswith("EXP-MILANO-ADRIANO-") for item in experiment_ids)
    assert all(item["region_experiment_ids"]["ADRIANO"] == item["experiment_id"] for item in response["experiments"])
