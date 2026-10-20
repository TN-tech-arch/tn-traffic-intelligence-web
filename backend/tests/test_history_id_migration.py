"""Persisted readable history IDs and legacy-ID compatibility."""

from __future__ import annotations

import re

from fastapi.testclient import TestClient

from app.core.ids import slug
from app.db.connection import query_all, query_one
from app.db.history_ids import migrate_readable_history_ids
from app.main import app

client = TestClient(app)


def test_all_existing_history_rows_have_unique_readable_display_ids():
    expected = {
        "dataset_versions": 0,
        "clusters": 0,
        "experiments": 0,
        "batches": 0,
    }
    source_keys = {
        row["source_id"]: row["key"]
        for row in query_all("SELECT source_id, key FROM data_sources")
    }
    datasets = {
        row["dataset_id"]: row
        for row in query_all("SELECT * FROM dataset_versions")
    }
    seen: set[str] = set()

    for row in datasets.values():
        regions = row["region_ids_json"]
        region_match = re.search(r'"([^"]+)"', regions)
        region = "REGIONS" if row["scope"] == "all" else (
            region_match.group(1) if region_match else "REGION"
        )
        pattern = (
            rf"DS-{re.escape(slug(source_keys[row['source_id']]))}-"
            rf"{re.escape(slug(region))}-\d{{4,}}"
        )
        assert re.fullmatch(pattern, row["display_id"])
        assert row["display_id"] not in seen
        seen.add(row["display_id"])
        expected["dataset_versions"] += 1

    for row in query_all("SELECT * FROM clusters"):
        pattern = (
            rf"CLUS-{re.escape(slug(source_keys[row['source_id']]))}-"
            rf"{re.escape(slug(row['algorithm_key']))}-\d{{4,}}"
        )
        assert re.fullmatch(pattern, row["display_id"])
        assert row["display_id"] not in seen
        seen.add(row["display_id"])
        expected["clusters"] += 1

    for row in query_all("SELECT * FROM experiments"):
        dataset = datasets[row["dataset_id"]]
        snapshot_region = re.search(r'"region_ids"\s*:\s*\[\s*"([^"]+)"', row["snapshot_json"])
        region = "REGIONS" if row["scope"] == "all" else (
            snapshot_region.group(1) if snapshot_region else "REGION"
        )
        pattern = (
            rf"EXP-{re.escape(slug(source_keys[dataset['source_id']]))}-"
            rf"{re.escape(slug(region))}-{re.escape(slug(row['algorithm_key']))}-\d{{4,}}"
        )
        assert re.fullmatch(pattern, row["display_id"])
        assert row["display_id"] not in seen
        seen.add(row["display_id"])
        expected["experiments"] += 1

    for row in query_all("SELECT * FROM batches"):
        dataset = datasets[row["dataset_id"]]
        scope_region = "REGIONS" if row["scope"] == "all" else None
        if scope_region is None:
            match = re.search(r'"([^"]+)"', dataset["region_ids_json"])
            scope_region = match.group(1) if match else "REGION"
        model = "MODELS"
        if int(row["algorithm_count"] or 0) != 12:
            algorithms = {
                item["algorithm_key"]
                for item in query_all(
                    "SELECT DISTINCT algorithm_key FROM experiments WHERE batch_id=?",
                    (row["batch_id"],),
                )
            }
            assert len(algorithms) == 1
            model = algorithms.pop()
        pattern = (
            rf"BATCH-{re.escape(slug(source_keys[dataset['source_id']]))}-"
            rf"{re.escape(slug(scope_region))}-{re.escape(slug(model))}-\d{{4,}}"
        )
        assert re.fullmatch(pattern, row["display_id"])
        assert row["display_id"] not in seen
        seen.add(row["display_id"])
        expected["batches"] += 1

    assert expected == {
        "dataset_versions": query_one("SELECT COUNT(*) AS n FROM dataset_versions")["n"],
        "clusters": query_one("SELECT COUNT(*) AS n FROM clusters")["n"],
        "experiments": query_one("SELECT COUNT(*) AS n FROM experiments")["n"],
        "batches": query_one("SELECT COUNT(*) AS n FROM batches")["n"],
    }


def test_region_experiment_ids_and_persistent_mapping_are_complete():
    region_rows = query_all(
        "SELECT * FROM experiment_region_models ORDER BY experiment_id, region_id"
    )
    region_ids = [row["region_experiment_id"] for row in region_rows]
    assert region_ids
    assert all(value and value.startswith("EXP-") for value in region_ids)
    assert len(region_ids) == len(set(region_ids))

    mappings = query_one("SELECT COUNT(*) AS n FROM history_id_migrations")["n"]
    assert mappings == (
        query_one("SELECT COUNT(*) AS n FROM dataset_versions")["n"]
        + query_one("SELECT COUNT(*) AS n FROM clusters")["n"]
        + query_one("SELECT COUNT(*) AS n FROM experiments")["n"]
        + len(region_rows)
        + query_one("SELECT COUNT(*) AS n FROM batches")["n"]
    )
    assert query_one("SELECT COUNT(*) AS n FROM history_id_migration_issues")["n"] == 0


def test_legacy_and_display_ids_both_resolve_and_retry_is_idempotent():
    for table, internal_column, endpoint in (
        ("dataset_versions", "dataset_id", "/api/datasets/"),
        ("clusters", "cluster_run_id", "/api/clusters/"),
        ("experiments", "experiment_id", "/api/experiments/"),
        ("batches", "batch_id", "/api/batches/"),
    ):
        row = query_one(
            f"SELECT {internal_column} AS internal_id, display_id "
            f"FROM {table} WHERE display_id IS NOT NULL "
            f"AND display_id != {internal_column} LIMIT 1"
        )
        if row is None:
            row = query_one(
                f"SELECT {internal_column} AS internal_id, display_id "
                f"FROM {table} WHERE display_id IS NOT NULL LIMIT 1"
            )
        assert row is not None
        legacy = client.get(f"{endpoint}{row['internal_id']}")
        current = client.get(f"{endpoint}{row['display_id']}")
        assert legacy.status_code == 200, legacy.text
        assert current.status_code == 200, current.text
        assert legacy.json()["internal_id"] == current.json()["internal_id"]

    before = {
        "datasets": query_one("SELECT COUNT(*) AS n FROM dataset_versions")["n"],
        "clusters": query_one("SELECT COUNT(*) AS n FROM clusters")["n"],
        "experiments": query_one("SELECT COUNT(*) AS n FROM experiments")["n"],
        "batches": query_one("SELECT COUNT(*) AS n FROM batches")["n"],
    }
    result = migrate_readable_history_ids()
    assert result["performed"] is False
    after = {
        "datasets": query_one("SELECT COUNT(*) AS n FROM dataset_versions")["n"],
        "clusters": query_one("SELECT COUNT(*) AS n FROM clusters")["n"],
        "experiments": query_one("SELECT COUNT(*) AS n FROM experiments")["n"],
        "batches": query_one("SELECT COUNT(*) AS n FROM batches")["n"],
    }
    assert before == after


def test_module_five_accepts_internal_and_display_experiment_ids():
    row = query_one(
        "SELECT experiment_id, display_id FROM experiments "
        "WHERE display_id IS NOT NULL LIMIT 1"
    )
    assert row is not None
    dataset = query_one(
        "SELECT d.* FROM dataset_versions d JOIN experiments e "
        "ON e.dataset_id=d.dataset_id WHERE e.experiment_id=?",
        (row["experiment_id"],),
    )
    assert dataset is not None
    experiment = query_one("SELECT scope, snapshot_json FROM experiments WHERE experiment_id=?", (row["experiment_id"],))
    region_match = re.search(r'"region_ids"\s*:\s*\[\s*"([^"]+)"', experiment["snapshot_json"])
    assert region_match is not None
    payload = {
        "dataset_id": dataset["dataset_id"],
        "scope": "single",
        "region_id": region_match.group(1),
        "experiment_ids": [row["display_id"]],
    }
    current = client.post("/api/evaluations/validate", json=payload)
    assert current.status_code == 200, current.text
    assert current.json()["experiments"][0]["internal_id"] == row["experiment_id"]
    payload["experiment_ids"] = [row["experiment_id"]]
    legacy = client.post("/api/evaluations/validate", json=payload)
    assert legacy.status_code == 200, legacy.text
    assert legacy.json()["experiments"][0]["display_id"] == row["display_id"]
