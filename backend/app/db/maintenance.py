"""Scoped, idempotent maintenance for retired application data."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.core.config import settings
from app.db.connection import query_all, transaction


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
