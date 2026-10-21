"""All Models batch orchestration: 1 Batch ID -> 12 Experiment IDs (spec 7.3/7.4)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Query

from app.api.deps import create_job, raise_if_invalid
from app.core.errors import Conflict, NotFound
from app.core.ids import (
    batch_id as make_batch_id,
    now_utc,
    readable_id_on_connection,
)
from app.db.connection import get_connection, json_dumps, json_loads, query_all, query_one
from app.forecast.registry import MODELS, MODEL_BY_KEY, default_params
from app.services.datasets import load_dataset
from app.services.validation import all_models_summary, check_model_params

router = APIRouter(prefix="/api/batches", tags=["batches"])


def _gate_foundation(model_key: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    from app.api.experiments_api import _foundation_gate

    return _foundation_gate(model_key, params)


@router.post("/run")
def run_batch(payload: dict[str, Any] = Body(...)) -> dict:
    dataset_id = payload.get("dataset_id")
    if not dataset_id:
        raise Conflict("必须提供 dataset_id", code="DATASET_REQUIRED")
    bundle = load_dataset(dataset_id)
    if payload.get("scope") not in (None, "single"):
        raise Conflict("全区域批量训练已取消，仅支持单区域数据集。", code="MULTI_REGION_REMOVED")
    if bundle.dataset["scope"] != "single" or len(bundle.region_ids) != 1:
        raise Conflict("所选数据集不是单区域数据集，不能用于批量训练。", code="MULTI_REGION_REMOVED")
    scope = "single"
    requested_regions = payload.get("region_ids")
    if requested_regions and list(requested_regions) != list(bundle.region_ids):
        raise Conflict("批量训练区域必须与数据集冻结区域一致。", code="REGION_MISMATCH")
    region_ids = list(bundle.region_ids)
    policy = {
        "sequential": True,
        "continue_on_error": bool((payload.get("execution_policy") or {}).get("continue_on_error", True)),
        "skip_unavailable_after_confirmation": bool(
            (payload.get("execution_policy") or {}).get("skip_unavailable_after_confirmation", False)
        ),
        "max_concurrent_gpu_jobs": int((payload.get("execution_policy") or {}).get("max_concurrent_gpu_jobs", 1)),
    }
    model_configs = payload.get("model_configs") or {}
    train_samples = int(bundle.valid_starts(region_ids[0], "train").size) if region_ids else 0
    context = {
        "train_samples": train_samples,
        "region_count": len(region_ids),
        "planned_tasks": len(region_ids) * 12,
    }
    summary = all_models_summary(model_configs, context=context)
    per_model = {entry["algorithm_key"]: entry for entry in summary["models"]}
    for entry in summary["models"]:
        entry["errors"].extend(_gate_foundation(entry["algorithm_key"], entry["params"]))
        entry["runnable"] = not entry["errors"]
    blocking_errors = [e for e in summary["models"] if e["errors"]]
    blocking_batch = [i for i in summary["batch_issues"] if i["severity"] == "error"]
    if blocking_batch:
        raise_if_invalid(blocking_batch, message="批次级校验失败")
    if blocking_errors and not policy["skip_unavailable_after_confirmation"]:
        issues = []
        for entry in blocking_errors:
            issues.extend(entry["errors"])
        raise_if_invalid(issues, message="存在不可运行的模型，请修复或确认跳过")

    idempotency_key = payload.get("idempotency_key")
    if idempotency_key:
        existing = query_one("SELECT * FROM batches WHERE idempotency_key=?", (idempotency_key,))
        if existing:
            return _batch_public(existing, include_members=True) | {"idempotent_replay": True}

    source_key = bundle.dataset["source_key"]
    primary_region = region_ids[0] if scope == "single" else None
    new_batch = make_batch_id(source_key, scope, region_id=primary_region)
    planned = len(region_ids) * 12
    frozen: dict[str, Any] = {}
    for model in MODELS:
        config = model_configs.get(model["key"]) or {}
        params = dict(default_params(model["key"]))
        params.update(config.get("params") or {})
        frozen[model["key"]] = {
            "mode": config.get("mode") or model["default_mode"],
            "params": params,
            "customized": bool(config.get("params")),
        }
    conn = get_connection()
    sequence = conn.execute("SELECT COALESCE(MAX(sequence_no),0) AS n FROM jobs").fetchone()["n"]
    created: list[dict[str, Any]] = []
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute(
            """
            INSERT INTO batches (batch_id, display_id, dataset_id, scope, algorithm_count, region_count, planned_tasks,
                policy_json, params_snapshot_json, task_summary_json, status, created_at, idempotency_key,
                started_at)
            VALUES (?,?,?,?,12,?,?,?,?,?, 'Running', ?, ?, ?)
            """,
            (
                new_batch,
                new_batch,
                bundle.dataset["dataset_id"],
                scope,
                len(region_ids),
                planned,
                json_dumps(policy),
                json_dumps(frozen),
                json_dumps({"total": 12}),
                now_utc(),
                idempotency_key,
                now_utc(),
            ),
        )
        for model in MODELS:
            entry = per_model[model["key"]]
            config = frozen[model["key"]]
            # Allocate the business ID on the transaction connection. Opening a
            # second connection here would self-lock SQLite while this batch
            # transaction already owns the write lock.
            region_part = "REGIONS" if scope == "all" else (primary_region or "REGION")
            new_experiment = readable_id_on_connection(
                conn,
                "EXP",
                [source_key, region_part, model["key"]],
            )
            region_exp_ids = {region_ids[0]: new_experiment}
            errors = entry["errors"]
            status = "Queued"
            error_text = None
            if errors:
                status = "Skipped" if policy["skip_unavailable_after_confirmation"] else "Unavailable"
                error_text = json_dumps(errors)
            snapshot = {
                "dataset_snapshot": {
                    "dataset_id": bundle.dataset["dataset_id"],
                    "hash": bundle.dataset["hash"],
                    "L": bundle.L, "H": bundle.H, "S": bundle.S,
                    "frequency": bundle.dataset["frequency"],
                    "split_boundaries": bundle.dataset["split_boundaries"],
                    "preprocess": bundle.dataset["preprocess"],
                },
                "algorithm_params": config["params"],
                "mode": config["mode"],
                "region_ids": region_ids,
                "region_experiment_ids": region_exp_ids,
                "batch_id": new_batch,
                "frozen_at": now_utc(),
                "skipped_reason": errors or None,
            }
            conn.execute(
                """
                INSERT INTO experiments (experiment_id, dataset_id, batch_id, algorithm_key, algorithm_label,
                    display_id, category, mode, scope, params_json, snapshot_json, status, region_total, region_completed,
                    region_failed, error, created_at, ended_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,?,?,?)
                """,
                (
                    new_experiment,
                    bundle.dataset["dataset_id"],
                    new_batch,
                    model["key"],
                    model["label"],
                    new_experiment,
                    model["category"],
                    config["mode"],
                    scope,
                    json_dumps(config["params"]),
                    json_dumps(snapshot),
                    status,
                    len(region_ids),
                    error_text,
                    now_utc(),
                    now_utc() if status != "Queued" else None,
                ),
            )
            for region_id in region_ids:
                conn.execute(
                    """
                    INSERT INTO experiment_region_models
                        (experiment_id, region_id, region_experiment_id, status)
                    VALUES (?,?,?,?)
                    """,
                    (
                        new_experiment,
                        region_id,
                        region_exp_ids[region_id],
                        status if status in ("Skipped", "Unavailable") else "Queued",
                    ),
                )
            created.append(
                {
                    "experiment_id": new_experiment,
                    "display_id": new_experiment,
                    "region_experiment_ids": region_exp_ids,
                    "algorithm_key": model["key"],
                    "algorithm_label": model["label"],
                    "status": status,
                    "errors": errors,
                }
            )
    except Exception:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")

    jobs = []
    for index, entry in enumerate(created):
        if entry["status"] != "Queued":
            continue
        sequence += 1
        jobs.append(
            create_job(
                job_type="experiment",
                experiment_id=entry["experiment_id"],
                dataset_id=bundle.dataset["dataset_id"],
                parent_batch_id=new_batch,
                sequence_no=sequence,
                payload={"experiment_id": entry["experiment_id"], "batch_id": new_batch},
            )
        )
    return {
        "batch_id": new_batch,
        "display_id": new_batch,
        "dataset_id": bundle.dataset["dataset_id"],
        "scope": scope,
        "status": "Running",
        "algorithm_count": 12,
        "region_count": len(region_ids),
        "planned_region_model_tasks": planned,
        "queued_experiments": len(jobs),
        "experiments": created,
        "job_ids": jobs,
        "policy": policy,
        "warnings": summary["batch_issues"],
    }


def _batch_public(row, *, include_members: bool = False) -> dict[str, Any]:
    dataset = query_one("SELECT * FROM dataset_versions WHERE dataset_id=?", (row["dataset_id"],))
    experiments = query_all(
        "SELECT * FROM experiments WHERE batch_id=? ORDER BY created_at, algorithm_key", (row["batch_id"],)
    )
    summary = json_loads(row["task_summary_json"]) or {}
    by_status: dict[str, int] = {}
    for exp in experiments:
        by_status[exp["status"]] = by_status.get(exp["status"], 0) + 1
    payload = {
        "batch_id": row["batch_id"],
        "display_id": row["display_id"] or row["batch_id"],
        "internal_id": row["batch_id"],
        "dataset_id": row["dataset_id"],
        "dataset_display_id": (dataset["display_id"] or dataset["dataset_id"]) if dataset else row["dataset_id"],
        "scope": row["scope"],
        "status": row["status"],
        "algorithm_count": row["algorithm_count"],
        "region_count": row["region_count"],
        "planned_tasks": row["planned_tasks"],
        "policy": json_loads(row["policy_json"]),
        "params_snapshot": json_loads(row["params_snapshot_json"]),
        "task_summary": summary,
        "experiment_status_counts": by_status,
        "cancel_requested": bool(row["cancel_requested"]),
        "error": row["error"],
        "created_at": row["created_at"],
        "started_at": row["started_at"],
        "ended_at": row["ended_at"],
    }
    if include_members:
        payload["experiments"] = [
            {
                "experiment_id": exp["experiment_id"],
                "display_id": exp["display_id"] or exp["experiment_id"],
                "internal_id": exp["experiment_id"],
                "algorithm_key": exp["algorithm_key"],
                "algorithm_label": exp["algorithm_label"],
                "mode": exp["mode"],
                "status": exp["status"],
                "region_total": exp["region_total"],
                "region_completed": exp["region_completed"],
                "region_failed": exp["region_failed"],
                "progress": json_loads(exp["progress_json"]),
                "metrics": json_loads(exp["metrics_json"]),
                "error": exp["error"],
                "started_at": exp["started_at"],
                "ended_at": exp["ended_at"],
            }
            for exp in experiments
        ]
        payload["region_summary"] = _region_summary([exp["experiment_id"] for exp in experiments])
    return payload


def _region_summary(experiment_ids: list[str]) -> list[dict[str, Any]]:
    if not experiment_ids:
        return []
    placeholders = ",".join("?" for _ in experiment_ids)
    rows = query_all(
        f"""
        SELECT experiment_id, region_id, region_experiment_id, status, metrics_json, error,
               started_at, ended_at
        FROM experiment_region_models WHERE experiment_id IN ({placeholders})
        ORDER BY experiment_id, region_id
        """,
        tuple(experiment_ids),
    )
    parent_displays = {
        item["experiment_id"]: item["display_id"]
        for item in query_all(
            f"SELECT experiment_id, display_id FROM experiments "
            f"WHERE experiment_id IN ({placeholders})",
            tuple(experiment_ids),
        )
    }
    return [
        {
            "experiment_id": r["experiment_id"],
            "display_id": r["region_experiment_id"] or parent_displays.get(r["experiment_id"]),
            "parent_experiment_id": r["experiment_id"],
            "parent_display_id": parent_displays.get(r["experiment_id"]),
            "region_id": r["region_id"],
            "region_experiment_id": r["region_experiment_id"],
            "status": r["status"],
            "metrics": json_loads(r["metrics_json"]),
            "error": r["error"],
            "started_at": r["started_at"],
            "ended_at": r["ended_at"],
        }
        for r in rows
    ]


@router.get("")
def list_batches(limit: int = Query(50, ge=1, le=200)) -> dict:
    rows = query_all(
        "SELECT * FROM batches WHERE scope='single' ORDER BY created_at DESC LIMIT ?",
        (limit,),
    )
    return {"batches": [_batch_public(row) for row in rows], "count": len(rows)}


@router.get("/{batch_id}")
def get_batch(batch_id: str, include_members: bool = Query(True)) -> dict:
    row = query_one(
        "SELECT * FROM batches WHERE batch_id=? OR display_id=?",
        (batch_id, batch_id),
    )
    if row is None:
        raise NotFound(f"批次 {batch_id} 不存在")
    return _batch_public(row, include_members=include_members)


@router.post("/{batch_id}/stop")
def stop_batch(batch_id: str) -> dict:
    row = query_one(
        "SELECT * FROM batches WHERE batch_id=? OR display_id=?",
        (batch_id, batch_id),
    )
    if row is None:
        raise NotFound(f"批次 {batch_id} 不存在")
    if row["status"] not in ("Running", "Created", "Stopping"):
        raise Conflict(f"批次当前状态为 {row['status']}，无需停止", code="NOT_RUNNING")
    internal_id = row["batch_id"]
    conn = get_connection()
    conn.execute("UPDATE batches SET cancel_requested=1, status='Stopping' WHERE batch_id=?", (internal_id,))
    skipped = query_all("SELECT experiment_id FROM experiments WHERE batch_id=? AND status='Queued'", (internal_id,))
    for exp in skipped:
        conn.execute(
            "UPDATE experiments SET status='Stopped', cancel_requested=1, ended_at=?, "
            "error='batch stop requested before start' WHERE experiment_id=?",
            (now_utc(), exp["experiment_id"]),
        )
    conn.execute(
        "UPDATE experiments SET cancel_requested=1 WHERE batch_id=? AND status IN ('Running','Queued')",
        (internal_id,),
    )
    conn.execute(
        "UPDATE jobs SET cancel_requested=1, state=CASE WHEN state='Queued' THEN 'Skipped' ELSE state END, "
        "ended_at=CASE WHEN state='Queued' THEN ? ELSE ended_at END WHERE parent_batch_id=?",
        (now_utc(), internal_id),
    )
    return {
        "batch_id": internal_id,
        "display_id": row["display_id"] or internal_id,
        "cancel_requested": True,
        "acknowledged_by": "backend",
        "queued_experiments_stopped": len(skipped),
        "note": "未开始的任务已停止；运行中的任务将在安全检查点转为 Stopped，已完成实验与工件保留。",
    }


@router.delete("/{batch_id}")
def delete_batch(batch_id: str) -> dict:
    row = query_one(
        "SELECT * FROM batches WHERE batch_id=? OR display_id=?",
        (batch_id, batch_id),
    )
    if row is None:
        raise NotFound(f"批次 {batch_id} 不存在")
    if row["status"] in ("Running", "Stopping"):
        raise Conflict("运行中的批次必须先停止才能删除", code="BATCH_RUNNING")
    referenced = query_one(
        """
        SELECT COUNT(*) AS n FROM evaluation_experiments ee
        JOIN experiments e ON e.experiment_id = ee.experiment_id
        WHERE e.batch_id = ?
        """,
        (row["batch_id"],),
    )
    if referenced and referenced["n"]:
        raise Conflict(
            f"该批次的实验已被 {referenced['n']} 个评价引用，不能删除批次（可归档实验）",
            code="BATCH_REFERENCED",
        )
    return {"batch_id": row["batch_id"], "display_id": row["display_id"] or row["batch_id"], "deleted": False,
            "note": "批次历史为不可变快照，如需隐藏请在实验历史中归档其成员实验。"}
