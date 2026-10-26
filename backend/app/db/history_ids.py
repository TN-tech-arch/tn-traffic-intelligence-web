"""Backfill readable display IDs without changing internal primary keys."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.core.ids import (
    now_utc,
    readable_id_on_connection,
    reserve_sequence_on_connection,
    slug,
)
from app.db.connection import get_connection, json_loads
from app.runtime_paths import current_data_dir

_HISTORY_TABLES = {
    "dataset": ("dataset_versions", "dataset_id"),
    "cluster": ("clusters", "cluster_run_id"),
    "experiment": ("experiments", "experiment_id"),
    "batch": ("batches", "batch_id"),
}


def _record_issue(
    conn: sqlite3.Connection,
    resource_type: str,
    internal_id: str,
    reason: str,
) -> None:
    conn.execute(
        """
        INSERT INTO history_id_migration_issues(resource_type, internal_id, reason, created_at)
        VALUES (?,?,?,?)
        ON CONFLICT(resource_type, internal_id) DO UPDATE SET
            reason=excluded.reason, created_at=excluded.created_at
        """,
        (resource_type, internal_id, reason, now_utc()),
    )


def _clear_issue(
    conn: sqlite3.Connection,
    resource_type: str,
    internal_id: str,
) -> None:
    conn.execute(
        "DELETE FROM history_id_migration_issues WHERE resource_type=? AND internal_id=?",
        (resource_type, internal_id),
    )


def _record_mapping(
    conn: sqlite3.Connection,
    resource_type: str,
    internal_id: str,
    display_id: str,
    old_external_id: str | None,
) -> None:
    conn.execute(
        """
        INSERT INTO history_id_migrations
            (resource_type, internal_id, display_id, old_external_id, created_at)
        VALUES (?,?,?,?,?)
        ON CONFLICT(resource_type, internal_id) DO UPDATE SET
            display_id=excluded.display_id, old_external_id=excluded.old_external_id
        """,
        (resource_type, internal_id, display_id, old_external_id, now_utc()),
    )


def _backup_database() -> Path:
    backup_dir = current_data_dir() / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    target = backup_dir / f"tn_traffic-before-history-id-migration-{stamp}.db"
    source = get_connection()
    destination = sqlite3.connect(str(target))
    try:
        source.backup(destination)
    finally:
        destination.close()
    return target


def _has_unresolved_pending() -> bool:
    conn = get_connection()
    for resource_type, (table, internal_column) in _HISTORY_TABLES.items():
        row = conn.execute(
            f"""
            SELECT 1 FROM {table} h
            WHERE h.display_id IS NULL
              AND NOT EXISTS (
                  SELECT 1 FROM history_id_migration_issues i
                  WHERE i.resource_type=? AND i.internal_id=h.{internal_column}
              )
            LIMIT 1
            """,
            (resource_type,),
        ).fetchone()
        if row:
            return True
    return bool(
        conn.execute(
            """
            SELECT 1 FROM experiment_region_models r
            WHERE r.region_experiment_id IS NULL
              AND NOT EXISTS (
                  SELECT 1 FROM history_id_migration_issues i
                  WHERE i.resource_type='region_experiment'
                    AND i.internal_id=r.experiment_id || '|' || r.region_id
              )
              AND NOT EXISTS (
                  SELECT 1 FROM history_id_migration_issues i
                  WHERE i.resource_type='experiment'
                    AND i.internal_id=r.experiment_id
              )
            LIMIT 1
            """
        ).fetchone()
    )


def _display_parts(
    source_key: str,
    scope: str,
    *,
    region_id: str | None = None,
    model_key: str | None = None,
) -> list[str]:
    region = "REGIONS" if scope == "all" else (region_id or "REGION")
    return [source_key, region] + ([model_key] if model_key else [])


def _display_stem(prefix: str, parts: list[str]) -> str:
    return "-".join([prefix, *(slug(part, "NA") for part in parts)])


def _is_expected_display(
    value: str | None,
    prefix: str,
    parts: list[str],
) -> bool:
    if not value:
        return False
    stem = _display_stem(prefix, parts)
    if not value.startswith(f"{stem}-"):
        return False
    suffix = value[len(stem) + 1 :]
    return suffix.isdigit() and len(suffix) >= 4


def _allocate_display(
    conn: sqlite3.Connection,
    prefix: str,
    parts: list[str],
    *,
    current_display_id: str | None,
    internal_id: str,
) -> tuple[str, bool]:
    """Return the display ID and whether it differs from the prior display."""
    if _is_expected_display(current_display_id, prefix, parts):
        reserve_sequence_on_connection(conn, prefix, parts, current_display_id)
        return str(current_display_id), False
    if _is_expected_display(internal_id, prefix, parts):
        reserve_sequence_on_connection(conn, prefix, parts, internal_id)
        return internal_id, False
    display = readable_id_on_connection(conn, prefix, parts)
    return display, True


def _dataset_parts(row) -> list[str] | None:
    source_key = row["source_key"]
    scope = row["scope"]
    regions = json_loads(row["region_ids_json"]) or []
    if not source_key or scope not in ("single", "all"):
        return None
    if scope == "single" and not regions:
        return None
    return _display_parts(source_key, scope, region_id=regions[0] if regions else None)


def _counts(conn: sqlite3.Connection) -> dict[str, int]:
    return {
        "datasets": conn.execute("SELECT COUNT(*) FROM dataset_versions").fetchone()[0],
        "clusters": conn.execute("SELECT COUNT(*) FROM clusters").fetchone()[0],
        "experiments": conn.execute("SELECT COUNT(*) FROM experiments").fetchone()[0],
        "region_experiments": conn.execute(
            "SELECT COUNT(*) FROM experiment_region_models"
        ).fetchone()[0],
        "batches": conn.execute("SELECT COUNT(*) FROM batches").fetchone()[0],
        "mappings": conn.execute("SELECT COUNT(*) FROM history_id_migrations").fetchone()[0],
        "issues": conn.execute("SELECT COUNT(*) FROM history_id_migration_issues").fetchone()[0],
    }


def migrate_readable_history_ids() -> dict[str, Any]:
    """Idempotently assign readable display IDs to every existing history row."""
    if not _has_unresolved_pending():
        conn = get_connection()
        return {
            "performed": False,
            "backup": None,
            "migrated": {},
            "counts": _counts(conn),
        }

    backup = _backup_database()
    conn = get_connection()
    migrated = {
        "datasets": 0,
        "clusters": 0,
        "experiments": 0,
        "region_experiments": 0,
        "batches": 0,
        "issues": 0,
    }
    conn.execute("BEGIN IMMEDIATE")
    try:
        before = _counts(conn)
        dataset_rows = conn.execute(
            """
            SELECT d.*, s.key AS source_key
            FROM dataset_versions d
            LEFT JOIN data_sources s ON s.source_id=d.source_id
            ORDER BY d.created_at, d.dataset_id
            """
        ).fetchall()
        dataset_meta: dict[str, dict[str, Any]] = {}

        # Reserve existing readable IDs first so generated IDs cannot collide
        # with a higher sequence already present in the table.
        for row in dataset_rows:
            parts = _dataset_parts(row)
            if parts is None:
                continue
            reserve_sequence_on_connection(
                conn,
                "DS",
                parts,
                row["display_id"] or row["dataset_id"],
            )

        for row in dataset_rows:
            internal_id = row["dataset_id"]
            regions = json_loads(row["region_ids_json"]) or []
            parts = _dataset_parts(row)
            if parts is None:
                _record_issue(
                    conn,
                    "dataset",
                    internal_id,
                    "数据集缺少可靠的数据源或单区域信息，无法生成 DS 显示 ID",
                )
                migrated["issues"] += 1
                continue
            display, changed = _allocate_display(
                conn,
                "DS",
                parts,
                current_display_id=row["display_id"],
                internal_id=internal_id,
            )
            if changed or row["display_id"] != display:
                conn.execute(
                    "UPDATE dataset_versions SET display_id=? WHERE dataset_id=?",
                    (display, internal_id),
                )
                migrated["datasets"] += 1
            _clear_issue(conn, "dataset", internal_id)
            _record_mapping(
                conn,
                "dataset",
                internal_id,
                display,
                internal_id if internal_id != display else None,
            )
            dataset_meta[internal_id] = {
                "source_key": row["source_key"],
                "scope": row["scope"],
                "region_id": regions[0] if row["scope"] == "single" and regions else None,
                "regions": regions,
            }

        cluster_rows = conn.execute(
            """
            SELECT c.*, s.key AS source_key
            FROM clusters c
            LEFT JOIN data_sources s ON s.source_id=c.source_id
            ORDER BY c.created_at, c.cluster_run_id
            """
        ).fetchall()
        for row in cluster_rows:
            if row["source_key"]:
                reserve_sequence_on_connection(
                    conn,
                    "CLUS",
                    [row["source_key"], row["algorithm_key"]],
                    row["display_id"] or row["cluster_run_id"],
                )
        for row in cluster_rows:
            internal_id = row["cluster_run_id"]
            if not row["source_key"] or not row["algorithm_key"]:
                _record_issue(
                    conn,
                    "cluster",
                    internal_id,
                    "聚类记录缺少真实数据源或聚类算法，无法生成 CLUS 显示 ID",
                )
                migrated["issues"] += 1
                continue
            parts = [row["source_key"], row["algorithm_key"]]
            display, changed = _allocate_display(
                conn,
                "CLUS",
                parts,
                current_display_id=row["display_id"],
                internal_id=internal_id,
            )
            if changed or row["display_id"] != display:
                conn.execute(
                    "UPDATE clusters SET display_id=? WHERE cluster_run_id=?",
                    (display, internal_id),
                )
                migrated["clusters"] += 1
            _clear_issue(conn, "cluster", internal_id)
            _record_mapping(
                conn,
                "cluster",
                internal_id,
                display,
                internal_id if internal_id != display else None,
            )

        experiment_rows = conn.execute(
            """
            SELECT e.*, s.key AS source_key
            FROM experiments e
            LEFT JOIN dataset_versions d ON d.dataset_id=e.dataset_id
            LEFT JOIN data_sources s ON s.source_id=d.source_id
            ORDER BY e.created_at, e.experiment_id
            """
        ).fetchall()
        experiment_region_rows: dict[str, list[Any]] = {}
        for row in experiment_rows:
            experiment_region_rows[row["experiment_id"]] = conn.execute(
                "SELECT * FROM experiment_region_models WHERE experiment_id=? ORDER BY region_id",
                (row["experiment_id"],),
            ).fetchall()

        def experiment_parts(row, region_models) -> list[str] | None:
            snapshot = json_loads(row["snapshot_json"]) or {}
            fallback = dataset_meta.get(row["dataset_id"], {})
            regions = snapshot.get("region_ids") or fallback.get("regions") or []
            if not regions:
                regions = [item["region_id"] for item in region_models]
            source_key = row["source_key"] or fallback.get("source_key")
            scope = row["scope"]
            if not source_key or not row["algorithm_key"] or scope not in ("single", "all"):
                return None
            if scope == "single" and not regions:
                return None
            return _display_parts(
                source_key,
                scope,
                region_id=regions[0] if regions else None,
                model_key=row["algorithm_key"],
            )

        for row in experiment_rows:
            parts = experiment_parts(row, experiment_region_rows[row["experiment_id"]])
            if parts:
                reserve_sequence_on_connection(
                    conn,
                    "EXP",
                    parts,
                    row["display_id"] or row["experiment_id"],
                )
            if row["source_key"]:
                for region_model in experiment_region_rows[row["experiment_id"]]:
                    reserve_sequence_on_connection(
                        conn,
                        "EXP",
                        [row["source_key"], region_model["region_id"], row["algorithm_key"]],
                        region_model["region_experiment_id"],
                    )

        for row in experiment_rows:
            internal_id = row["experiment_id"]
            region_models = experiment_region_rows[internal_id]
            parts = experiment_parts(row, region_models)
            if parts is None:
                _record_issue(
                    conn,
                    "experiment",
                    internal_id,
                    "实验缺少真实数据源、区域或模型信息，无法生成 EXP 显示 ID",
                )
                migrated["issues"] += 1
                continue
            display, changed = _allocate_display(
                conn,
                "EXP",
                parts,
                current_display_id=row["display_id"],
                internal_id=internal_id,
            )
            if changed or row["display_id"] != display:
                conn.execute(
                    "UPDATE experiments SET display_id=? WHERE experiment_id=?",
                    (display, internal_id),
                )
                migrated["experiments"] += 1
            _clear_issue(conn, "experiment", internal_id)
            _record_mapping(
                conn,
                "experiment",
                internal_id,
                display,
                internal_id if internal_id != display else None,
            )

            source_key = row["source_key"]
            snapshot = json_loads(row["snapshot_json"]) or {}
            region_display_ids: dict[str, str] = {}
            for region_model in region_models:
                region_id = region_model["region_id"]
                current = region_model["region_experiment_id"]
                if row["scope"] == "single" and region_id == parts[1]:
                    region_display = display
                    reserve_sequence_on_connection(
                        conn, "EXP", [source_key, region_id, row["algorithm_key"]], display
                    )
                else:
                    region_display, _ = _allocate_display(
                        conn,
                        "EXP",
                        [source_key, region_id, row["algorithm_key"]],
                        current_display_id=current,
                        internal_id=f"{internal_id}|{region_id}",
                    )
                region_display_ids[region_id] = region_display
                if current != region_display:
                    conn.execute(
                        """
                        UPDATE experiment_region_models
                        SET region_experiment_id=?
                        WHERE experiment_id=? AND region_id=?
                        """,
                        (region_display, internal_id, region_id),
                    )
                    migrated["region_experiments"] += 1
                _record_mapping(
                    conn,
                    "region_experiment",
                    f"{internal_id}|{region_id}",
                    region_display,
                    current if current and current != region_display else None,
                )
                _clear_issue(conn, "region_experiment", f"{internal_id}|{region_id}")

            if region_display_ids:
                snapshot["region_experiment_ids"] = region_display_ids
                conn.execute(
                    "UPDATE experiments SET snapshot_json=? WHERE experiment_id=?",
                    (
                        json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")),
                        internal_id,
                    ),
                )

        batch_rows = conn.execute(
            """
            SELECT b.*, s.key AS source_key
            FROM batches b
            LEFT JOIN dataset_versions d ON d.dataset_id=b.dataset_id
            LEFT JOIN data_sources s ON s.source_id=d.source_id
            ORDER BY b.created_at, b.batch_id
            """
        ).fetchall()
        batch_parts: dict[str, list[str] | None] = {}
        for row in batch_rows:
            meta = dataset_meta.get(row["dataset_id"], {})
            source_key = row["source_key"] or meta.get("source_key")
            scope = row["scope"]
            members = conn.execute(
                "SELECT DISTINCT algorithm_key FROM experiments WHERE batch_id=?",
                (row["batch_id"],),
            ).fetchall()
            algorithms = sorted(item["algorithm_key"] for item in members if item["algorithm_key"])
            if int(row["algorithm_count"] or 0) == 12:
                model = "MODELS"
            elif len(algorithms) == 1:
                model = algorithms[0]
            else:
                model = None
            region_ok = scope == "all" or bool(meta.get("region_id"))
            batch_parts[row["batch_id"]] = (
                _display_parts(
                    source_key,
                    scope,
                    region_id=meta.get("region_id"),
                    model_key=model,
                )
                if source_key and model and region_ok and scope in ("single", "all")
                else None
            )
            parts = batch_parts[row["batch_id"]]
            if parts:
                reserve_sequence_on_connection(
                    conn,
                    "BATCH",
                    parts,
                    row["display_id"] or row["batch_id"],
                )

        for row in batch_rows:
            internal_id = row["batch_id"]
            parts = batch_parts[internal_id]
            if parts is None:
                _record_issue(
                    conn,
                    "batch",
                    internal_id,
                    "批量任务缺少可唯一确定的数据源、区域或模型范围，无法生成 BATCH 显示 ID",
                )
                migrated["issues"] += 1
                continue
            display, changed = _allocate_display(
                conn,
                "BATCH",
                parts,
                current_display_id=row["display_id"],
                internal_id=internal_id,
            )
            if changed or row["display_id"] != display:
                conn.execute(
                    "UPDATE batches SET display_id=? WHERE batch_id=?",
                    (display, internal_id),
                )
                migrated["batches"] += 1
            _clear_issue(conn, "batch", internal_id)
            _record_mapping(
                conn,
                "batch",
                internal_id,
                display,
                internal_id if internal_id != display else None,
            )

        after = _counts(conn)
    except Exception:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")

    return {
        "performed": True,
        "backup": str(backup),
        "before": before,
        "after": after,
        "migrated": migrated,
    }
