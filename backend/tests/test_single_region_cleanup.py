"""Retired all-region records stay absent while single-region history remains."""

from __future__ import annotations

from app.core.config import settings
from app.db.connection import query_all, query_one
from app.db.maintenance import purge_all_region_history


def test_all_region_history_is_absent_and_cleanup_is_idempotent():
    for table in ("dataset_versions", "experiments", "batches", "evaluations"):
        assert query_one(
            f"SELECT COUNT(*) AS n FROM {table} WHERE COALESCE(scope, '') != 'single'"
        )["n"] == 0
        assert query_one(f"SELECT COUNT(*) AS n FROM {table}")["n"] > 0

    result = purge_all_region_history()
    assert result["performed"] is False

    assert not (
        settings.artifacts_dir
        / "datasets"
        / "DS-MILANO-ALL-01M5293ETPAY"
    ).exists()
    assert not (
        settings.artifacts_dir
        / "experiments"
        / "EXP-LIGHTGBM-01M5293EXECJ"
    ).exists()
    assert not (
        settings.artifacts_dir
        / "logs"
        / "EXP-LIGHTGBM-01M5293EXECJ.jsonl"
    ).exists()


def test_foreign_keys_and_single_region_relationships_remain_valid():
    assert query_all("PRAGMA foreign_key_check") == []
    assert query_one(
        """
        SELECT COUNT(*) AS n
        FROM experiment_region_models r
        LEFT JOIN experiments e ON e.experiment_id=r.experiment_id
        WHERE e.experiment_id IS NULL
        """
    )["n"] == 0
    assert query_one(
        """
        SELECT COUNT(*) AS n
        FROM evaluation_experiments ee
        LEFT JOIN experiments e ON e.experiment_id=ee.experiment_id
        WHERE e.experiment_id IS NULL
        """
    )["n"] == 0
