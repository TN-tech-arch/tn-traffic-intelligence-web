"""Scoped, idempotent maintenance for retired application data."""

from __future__ import annotations

import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.core.config import settings
from app.db.connection import get_connection, query_all, transaction


def _remove_cluster_artifacts(cluster_ids: set[str], artifact_refs: list[str]) -> list[str]:
    """Remove only paths under data/artifacts or data/logs that name a target run."""
    if not cluster_ids:
        return []
    roots = [settings.artifacts_dir, settings.data_dir / "logs"]
    candidates: set[Path] = set()
    for raw in artifact_refs:
        if not raw:
            continue
        path = Path(raw)
        if path.exists():
            candidates.add(path)
    for root in roots:
        if not root.exists():
            continue
        for cluster_id in cluster_ids:
            candidates.update(root.rglob(f"*{cluster_id}*"))

    removed: list[str] = []
    for path in sorted(candidates, key=lambda item: len(item.parts), reverse=True):
        try:
            resolved = path.resolve()
        except OSError:
            continue
        if not any(resolved.is_relative_to(root.resolve()) for root in roots):
            continue
        if not any(cluster_id in resolved.name for cluster_id in cluster_ids):
            continue
        if not resolved.exists():
            continue
        if resolved.is_dir():
            for child in sorted(resolved.rglob("*"), reverse=True):
                if child.is_file():
                    child.unlink()
                elif child.is_dir():
                    child.rmdir()
            resolved.rmdir()
        else:
            resolved.unlink()
        removed.append(str(resolved))
    return removed


def purge_legacy_dbscan_history() -> dict[str, Any]:
    """Delete only rows/files explicitly identified as DBSCAN cluster runs.

    Original sources, shared experiments/evaluations, and histories for
    K-Means, Hierarchical, GMM and the new Spectral algorithm are never touched.
    """
    rows = query_all(
        "SELECT cluster_run_id, artifact_ref FROM clusters "
        "WHERE lower(trim(algorithm_key)) = 'dbscan'"
    )
    cluster_ids = {str(row["cluster_run_id"]) for row in rows}
    if not cluster_ids:
        return {
            "cluster_rows_deleted": 0,
            "job_rows_deleted": 0,
            "audit_rows_deleted": 0,
            "artifact_paths_deleted": [],
            "cluster_run_ids": [],
        }

    placeholders = ",".join("?" for _ in cluster_ids)
    params = tuple(sorted(cluster_ids))
    with transaction() as conn:
        job_count = conn.execute(
            f"DELETE FROM jobs WHERE cluster_run_id IN ({placeholders})", params
        ).rowcount
        audit_count = conn.execute(
            f"DELETE FROM audit_events WHERE resource_id IN ({placeholders}) "
            "AND lower(resource) IN ('cluster','clustering')",
            params,
        ).rowcount
        cluster_count = conn.execute(
            f"DELETE FROM clusters WHERE cluster_run_id IN ({placeholders})", params
        ).rowcount

    removed = _remove_cluster_artifacts(
        cluster_ids,
        [str(row["artifact_ref"]) for row in rows if row["artifact_ref"]],
    )
    return {
        "cluster_rows_deleted": int(cluster_count),
        "job_rows_deleted": int(job_count),
        "audit_rows_deleted": int(audit_count),
        "artifact_paths_deleted": removed,
        "cluster_run_ids": sorted(cluster_ids),
    }


def _backup_before_all_region_cleanup() -> Path:
    backup_dir = settings.data_dir / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    target = backup_dir / f"tn_traffic-before-all-region-cleanup-{stamp}.db"
    source = get_connection()
    destination = sqlite3.connect(str(target))
    try:
        source.backup(destination)
    finally:
        destination.close()
    return target


def _remove_all_region_files(ids: set[str], extra_refs: list[str]) -> tuple[list[str], list[str]]:
    roots = [
        settings.artifacts_dir.resolve(),
        settings.model_cache_dir.resolve(),
    ]
    candidates: set[Path] = set()
    for raw in extra_refs:
        if not raw:
            continue
        path = Path(raw)
        if path.exists():
            candidates.add(path)
    for root in roots:
        if not root.exists():
            continue
        for identifier in ids:
            candidates.update(root.rglob(f"*{identifier}*"))

    removed: list[str] = []
    errors: list[str] = []
    for path in sorted(candidates, key=lambda item: len(item.parts), reverse=True):
        try:
            resolved = path.resolve()
            if not any(resolved.is_relative_to(root) for root in roots):
                errors.append(f"unsafe path skipped: {resolved}")
                continue
            if not resolved.exists():
                continue
            if resolved.is_dir():
                shutil.rmtree(resolved)
            else:
                resolved.unlink()
            removed.append(str(resolved))
        except Exception as exc:
            errors.append(f"{path}: {exc}")
    return removed, errors


def purge_all_region_history() -> dict[str, Any]:
    """Remove retired multi-region records using persisted scope relationships."""
    datasets = query_all("SELECT * FROM dataset_versions WHERE scope='all'")
    experiments = query_all("SELECT * FROM experiments WHERE scope='all'")
    batches = query_all("SELECT * FROM batches WHERE scope='all'")
    evaluations = query_all("SELECT * FROM evaluations WHERE scope='all'")
    if not any((datasets, experiments, batches, evaluations)):
        return {
            "performed": False,
            "deleted": {},
            "ids": {},
            "artifact_paths_deleted": [],
            "file_errors": [],
        }

    dataset_ids = {str(row["dataset_id"]) for row in datasets}
    experiment_ids = {str(row["experiment_id"]) for row in experiments}
    batch_ids = {str(row["batch_id"]) for row in batches}
    evaluation_ids = {str(row["evaluation_id"]) for row in evaluations}

    def placeholders(values: set[str]) -> str:
        return ",".join("?" for _ in values)

    # Scope cleanup must never orphan retained single-region records.
    if dataset_ids:
        ds_marks = placeholders(dataset_ids)
        ds_params = tuple(dataset_ids)
        unsafe_experiments = query_all(
            f"SELECT experiment_id FROM experiments WHERE dataset_id IN ({ds_marks}) AND scope!='all'",
            ds_params,
        )
        unsafe_evaluations = query_all(
            f"SELECT evaluation_id FROM evaluations WHERE dataset_id IN ({ds_marks}) AND scope!='all'",
            ds_params,
        )
        if unsafe_experiments or unsafe_evaluations:
            raise RuntimeError("all-region datasets are referenced by retained single-region records")
    if experiment_ids:
        exp_marks = placeholders(experiment_ids)
        unsafe_members = query_all(
            f"SELECT evaluation_id FROM evaluation_experiments "
            f"WHERE experiment_id IN ({exp_marks})",
            tuple(experiment_ids),
        )
        allowed = set(evaluation_ids)
        if any(str(row["evaluation_id"]) not in allowed for row in unsafe_members):
            raise RuntimeError("all-region experiments are referenced by retained evaluations")
    if batch_ids:
        batch_marks = placeholders(batch_ids)
        unsafe_batch_experiments = query_all(
            f"SELECT experiment_id FROM experiments WHERE batch_id IN ({batch_marks}) AND scope!='all'",
            tuple(batch_ids),
        )
        if unsafe_batch_experiments:
            raise RuntimeError("all-region batches still contain retained single-region experiments")

    backup = _backup_before_all_region_cleanup()
    # Collect explicit paths while source rows still exist.
    experiment_regions = query_all(
        f"SELECT model_artifact_ref, logs_ref FROM experiment_region_models "
        f"WHERE experiment_id IN ({placeholders(experiment_ids)})",
        tuple(experiment_ids),
    ) if experiment_ids else []
    extra_refs = [
        str(row["artifact_ref"])
        for row in [*datasets, *experiments, *evaluations]
        if row["artifact_ref"]
    ]
    extra_refs.extend(
        str(row[key])
        for row in experiment_regions
        for key in ("model_artifact_ref", "logs_ref")
        if row[key]
    )

    deleted: dict[str, int] = {}
    with transaction() as conn:
        if evaluation_ids:
            marks = placeholders(evaluation_ids)
            params = tuple(evaluation_ids)
            deleted["evaluation_predictions"] = conn.execute(
                f"DELETE FROM evaluation_predictions WHERE evaluation_id IN ({marks})",
                params,
            ).rowcount
            deleted["evaluation_experiments"] = conn.execute(
                f"DELETE FROM evaluation_experiments WHERE evaluation_id IN ({marks})",
                params,
            ).rowcount
            deleted["evaluation_jobs"] = conn.execute(
                f"DELETE FROM jobs WHERE evaluation_id IN ({marks})", params
            ).rowcount
            deleted["evaluations"] = conn.execute(
                f"DELETE FROM evaluations WHERE evaluation_id IN ({marks})", params
            ).rowcount
        if experiment_ids:
            marks = placeholders(experiment_ids)
            params = tuple(experiment_ids)
            deleted["region_models"] = conn.execute(
                f"DELETE FROM experiment_region_models WHERE experiment_id IN ({marks})",
                params,
            ).rowcount
            deleted["experiment_jobs"] = conn.execute(
                f"DELETE FROM jobs WHERE experiment_id IN ({marks})", params
            ).rowcount
            deleted["experiments"] = conn.execute(
                f"DELETE FROM experiments WHERE experiment_id IN ({marks})", params
            ).rowcount
        if batch_ids:
            marks = placeholders(batch_ids)
            params = tuple(batch_ids)
            deleted["batch_jobs"] = conn.execute(
                f"DELETE FROM jobs WHERE parent_batch_id IN ({marks})", params
            ).rowcount
            deleted["batches"] = conn.execute(
                f"DELETE FROM batches WHERE batch_id IN ({marks})", params
            ).rowcount
        if dataset_ids:
            marks = placeholders(dataset_ids)
            params = tuple(dataset_ids)
            deleted["dataset_jobs"] = conn.execute(
                f"DELETE FROM jobs WHERE dataset_id IN ({marks})", params
            ).rowcount
            deleted["datasets"] = conn.execute(
                f"DELETE FROM dataset_versions WHERE dataset_id IN ({marks})", params
            ).rowcount

        all_ids = dataset_ids | experiment_ids | batch_ids | evaluation_ids
        if all_ids:
            marks = placeholders(all_ids)
            params = tuple(all_ids)
            deleted["audit_events"] = conn.execute(
                f"DELETE FROM audit_events WHERE resource_id IN ({marks})", params
            ).rowcount
            mapping_conditions: list[str] = []
            mapping_params: list[str] = []
            if dataset_ids:
                mapping_conditions.append(
                    f"(resource_type='dataset' AND internal_id IN ({placeholders(dataset_ids)}))"
                )
                mapping_params.extend(sorted(dataset_ids))
            if experiment_ids:
                mapping_conditions.append(
                    f"(resource_type='experiment' AND internal_id IN ({placeholders(experiment_ids)}))"
                )
                mapping_conditions.append(
                    f"(resource_type='region_experiment' AND "
                    + " OR ".join("internal_id LIKE ?" for _ in experiment_ids)
                    + ")"
                )
                mapping_params.extend(sorted(experiment_ids))
                mapping_params.extend(f"{value}|%" for value in sorted(experiment_ids))
            if batch_ids:
                mapping_conditions.append(
                    f"(resource_type='batch' AND internal_id IN ({placeholders(batch_ids)}))"
                )
                mapping_params.extend(sorted(batch_ids))
            if mapping_conditions:
                deleted["history_mappings"] = conn.execute(
                    "DELETE FROM history_id_migrations WHERE " + " OR ".join(mapping_conditions),
                    tuple(mapping_params),
                ).rowcount
            issue_conditions = [f"internal_id IN ({marks})"]
            issue_params: list[str] = list(params)
            if experiment_ids:
                issue_conditions.append(
                    "(resource_type='region_experiment' AND "
                    + " OR ".join("internal_id LIKE ?" for _ in experiment_ids)
                    + ")"
                )
                issue_params.extend(f"{value}|%" for value in sorted(experiment_ids))
            deleted["migration_issues"] = conn.execute(
                "DELETE FROM history_id_migration_issues WHERE "
                + " OR ".join(issue_conditions),
                tuple(issue_params),
            ).rowcount

    removed, errors = _remove_all_region_files(
        {
            *dataset_ids,
            *experiment_ids,
            *batch_ids,
            *evaluation_ids,
        },
        extra_refs,
    )
    return {
        "performed": True,
        "backup": str(backup),
        "deleted": deleted,
        "ids": {
            "datasets": sorted(dataset_ids),
            "experiments": sorted(experiment_ids),
            "batches": sorted(batch_ids),
            "evaluations": sorted(evaluation_ids),
        },
        "artifact_paths_deleted": removed,
        "file_errors": errors,
    }
