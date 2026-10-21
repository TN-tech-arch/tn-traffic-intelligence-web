from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Body, Query

from app.api.deps import create_job, job_public, raise_if_invalid
from app.core.errors import Conflict, NotFound
from app.core.ids import (
    experiment_id as make_id,
    now_utc,
)
from app.db.connection import get_connection, json_dumps, json_loads, query_all, query_one
from app.forecast.registry import MODEL_BY_KEY, default_params
from app.services.datasets import load_dataset
from app.services.validation import check_model_params, environment_report
from app.workers.tasks import environment_snapshot, experiment_log_path

router = APIRouter(prefix="/api/experiments", tags=["experiments"])

PROTECTED_STATUSES = ("Running", "Queued", "Stopping")


def _experiment_row(reference: str):
    return query_one(
        "SELECT * FROM experiments WHERE experiment_id=? OR display_id=?",
        (reference, reference),
    )


def _experiment_public(row, *, include_logs: bool = False) -> dict[str, Any]:
    dataset = query_one("SELECT * FROM dataset_versions WHERE dataset_id=?", (row["dataset_id"],))
    batch = query_one("SELECT * FROM batches WHERE batch_id=?", (row["batch_id"],)) if row["batch_id"] else None
    payload = {
        "experiment_id": row["experiment_id"],
        "display_id": row["display_id"] or row["experiment_id"],
        "internal_id": row["experiment_id"],
        "dataset_id": row["dataset_id"],
        "dataset_display_id": (
            (dataset["display_id"] or dataset["dataset_id"]) if dataset else row["dataset_id"]
        ),
        "batch_id": row["batch_id"],
        "batch_display_id": (batch["display_id"] or batch["batch_id"]) if batch else None,
        "algorithm_key": row["algorithm_key"],
        "algorithm_label": row["algorithm_label"],
        "category": row["category"],
        "mode": row["mode"],
        "scope": row["scope"],
        "params": json_loads(row["params_json"]),
        "snapshot": json_loads(row["snapshot_json"]),
        "status": row["status"],
        "progress": json_loads(row["progress_json"]),
        "region_total": row["region_total"],
        "region_completed": row["region_completed"],
        "region_failed": row["region_failed"],
        "error": row["error"],
        "cancel_requested": bool(row["cancel_requested"]),
        "metrics": json_loads(row["metrics_json"]),
        "created_at": row["created_at"],
        "started_at": row["started_at"],
        "ended_at": row["ended_at"],
        "dataset": {
            "dataset_id": dataset["dataset_id"],
            "display_id": (dataset["display_id"] or dataset["dataset_id"]) if "display_id" in dataset.keys() else dataset["dataset_id"],
            "source_id": dataset["source_id"],
            "scope": dataset["scope"],
            "L": dataset["input_length"],
            "H": dataset["output_length"],
            "S": dataset["step"],
            "frequency": dataset["frequency"],
            "status": dataset["status"],
        } if dataset else None,
    }
    if include_logs:
        payload["logs"] = read_logs(row["experiment_id"])
        payload["region_models"] = [
            {
                "experiment_id": r["experiment_id"],
                "region_id": r["region_id"],
                "display_id": r["region_experiment_id"] if "region_experiment_id" in r.keys() else None,
                "region_experiment_id": r["region_experiment_id"] if "region_experiment_id" in r.keys() else None,
                "status": r["status"],
                "metrics": json_loads(r["metrics_json"]),
                "history": json_loads(r["history_json"]),
                "checkpoint_ref": r["checkpoint_ref"],
                "error": r["error"],
                "artifact_ref": r["model_artifact_ref"],
                "started_at": r["started_at"],
                "ended_at": r["ended_at"],
            }
            for r in query_all(
                "SELECT * FROM experiment_region_models WHERE experiment_id=? ORDER BY region_id",
                (row["experiment_id"],),
            )
        ]
    return payload


def read_logs(experiment_id: str, limit: int = 500) -> list[dict[str, Any]]:
    path = experiment_log_path(experiment_id)
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8").strip().splitlines()
    out = []
    for line in lines[-limit:]:
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def _prepare_run(payload: dict[str, Any]) -> dict[str, Any]:
    dataset_id = payload.get("dataset_id")
    if not dataset_id:
        raise Conflict("必须提供 dataset_id", code="DATASET_REQUIRED")
    bundle = load_dataset(dataset_id)
    algorithm_key = payload.get("algorithm_key")
    if algorithm_key not in MODEL_BY_KEY:
        raise NotFound(f"未知算法 {algorithm_key}", code="UNKNOWN_ALGORITHM")
    model = MODEL_BY_KEY[algorithm_key]
    if payload.get("scope") not in (None, "single"):
        raise Conflict("全区域训练已取消，仅支持单区域数据集。", code="MULTI_REGION_REMOVED")
    if bundle.dataset["scope"] != "single" or len(bundle.region_ids) != 1:
        raise Conflict("所选数据集不是单区域数据集，不能用于训练。", code="MULTI_REGION_REMOVED")
    scope = "single"
    requested_regions = payload.get("region_ids")
    if requested_regions and list(requested_regions) != list(bundle.region_ids):
        raise Conflict(
            "训练区域必须与数据集冻结区域一致。",
            code="REGION_MISMATCH",
            issues=[
                {
                    "path": "region_ids",
                    "code": "REGION_MISMATCH",
                    "severity": "error",
                    "message": "训练区域必须与数据集冻结区域一致。",
                    "suggestion": "请使用该单区域数据集对应的区域。",
                    "received_value": requested_regions,
                }
            ],
        )
    region_ids = list(bundle.region_ids)
    missing = [r for r in region_ids if r not in bundle.region_ids]
    if missing:
        raise Conflict(
            f"以下区域不在数据集 {dataset_id} 中: {', '.join(missing[:5])}",
            code="REGION_NOT_IN_DATASET",
            issues=[
                {
                    "path": "region_ids",
                    "code": "REGION_NOT_IN_DATASET",
                    "severity": "error",
                    "message": f"区域 {r} 不属于该数据集。",
                    "suggestion": "请重新从数据集区域中选择。",
                    "received_value": r,
                }
                for r in missing[:5]
            ],
        )
    train_samples = 0
    if region_ids:
        train_samples = int(bundle.valid_starts(region_ids[0], "train").size)
    mode = payload.get("mode") or model["default_mode"]
    if mode not in model["supported_modes"]:
        raise Conflict(
            f"{model['label']} 不支持执行模式 {mode}，可用模式: {', '.join(model['supported_modes'])}",
            code="MODE_NOT_SUPPORTED",
            issues=[
                {
                    "path": f"model_configs.{algorithm_key}.mode",
                    "code": "MODE_NOT_SUPPORTED",
                    "severity": "error",
                    "message": f"{model['label']} 不支持执行模式 {mode}。",
                    "suggestion": f"请使用 {', '.join(model['supported_modes'])}。",
                    "received_value": mode,
                }
            ],
        )
    context = {"train_samples": train_samples, "region_count": len(region_ids)}
    issues, coerced = check_model_params(
        algorithm_key, payload.get("params") or {}, mode=mode, context=context,
        path_prefix=f"model_configs.{algorithm_key}.params",
    )
    foundation_errors = _foundation_gate(algorithm_key, coerced)
    issues.extend(foundation_errors)
    raise_if_invalid(issues, message=f"{model['label']} 参数校验未通过")
    return {
        "bundle": bundle,
        "model": model,
        "mode": mode,
        "params": coerced,
        "region_ids": region_ids,
        "scope": scope,
        "train_samples": train_samples,
        "warnings": [i for i in issues if i["severity"] == "warning"],
    }


def _foundation_gate(algorithm_key: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    from app.forecast.foundation import chronos_status, timesfm_status

    if algorithm_key not in ("timesfm", "chronos"):
        return []
    status = timesfm_status() if algorithm_key == "timesfm" else chronos_status()
    issues: list[dict[str, Any]] = []
    if not status["package_installed"]:
        issues.append(
            {
                "path": f"model_configs.{algorithm_key}.params.checkpoint_id",
                "code": "DEPENDENCY_MISSING",
                "severity": "error",
                "message": f"{algorithm_key} 官方推理依赖未安装（{', '.join(status['packages'])}）。",
                "suggestion": "安装依赖后重试；未安装时该模型不能运行。",
                "received_value": None,
            }
        )
        return issues
    checkpoint = params.get("checkpoint_id")
    available = {c["id"] for c in status["checkpoints"] if c["available"]}
    if not checkpoint or checkpoint not in available:
        issues.append(
            {
                "path": f"model_configs.{algorithm_key}.params.checkpoint_id",
                "code": "CHECKPOINT_UNAVAILABLE",
                "severity": "error",
                "message": f"checkpoint {checkpoint or '(未选择)'} 不可用（Unavailable: weights missing）。",
                "suggestion": "请先在模型预检页下载合规 checkpoint，或选择已下载的 checkpoint。",
                "received_value": checkpoint,
            }
        )
    return issues


def _snapshot(dataset_summary: dict[str, Any], params: dict[str, Any], mode: str, region_ids: list[str],
              algorithm_key: str, region_experiment_ids: dict[str, str] | None = None) -> dict[str, Any]:
    return {
        "dataset_snapshot": {
            "dataset_id": dataset_summary["dataset_id"],
            "hash": dataset_summary["hash"],
            "source_key": dataset_summary["source_key"],
            "source_fingerprint": dataset_summary["quality"].get("source_fingerprint"),
            "L": dataset_summary["L"],
            "H": dataset_summary["H"],
            "S": dataset_summary["S"],
            "frequency": dataset_summary["frequency"],
            "aggregation": dataset_summary["aggregation"],
            "ratios": dataset_summary["ratios"],
            "split_boundaries": dataset_summary["split_boundaries"],
            "preprocess": dataset_summary["preprocess"],
            "unit_label": dataset_summary["unit_label"],
        },
        "algorithm_key": algorithm_key,
        "algorithm_params": params,
        "mode": mode,
        "region_ids": region_ids,
        "region_experiment_ids": region_experiment_ids or {},
        "environment": environment_snapshot(),
        "frozen_at": now_utc(),
    }


@router.post("/run")
def run_experiment(payload: dict[str, Any] = Body(...)) -> dict:
    prepared = _prepare_run(payload)
    idempotency_key = payload.get("idempotency_key")
    if idempotency_key:
        existing = query_one("SELECT * FROM experiments WHERE idempotency_key=?", (idempotency_key,))
        if existing:
            jobs = query_all(
                "SELECT * FROM jobs WHERE experiment_id=? ORDER BY sequence_no", (existing["experiment_id"],)
            )
            existing_batch = (
                query_one("SELECT * FROM batches WHERE batch_id=?", (existing["batch_id"],))
                if existing["batch_id"]
                else None
            )
            return {
                "experiment_id": existing["experiment_id"],
                "display_id": existing["display_id"] or existing["experiment_id"],
                "batch_id": existing["batch_id"],
                "batch_display_id": (existing_batch["display_id"] or existing_batch["batch_id"])
                if existing_batch
                else None,
                "status": existing["status"],
                "idempotent_replay": True,
                "jobs": [job_public(j) for j in jobs],
                "region_count": existing["region_total"],
            }
    bundle = prepared["bundle"]
    model = prepared["model"]
    source_key = bundle.dataset["source_key"]
    scope = prepared["scope"]
    primary_region = prepared["region_ids"][0]
    new_id = make_id(source_key, scope, model["key"], primary_region)
    region_ids = prepared["region_ids"]
    region_exp_ids = {region_ids[0]: new_id}
    batch_ref = None
    snapshot = _snapshot(
        bundle.dataset,
        prepared["params"],
        prepared["mode"],
        region_ids,
        model["key"],
        region_exp_ids,
    )
    conn = get_connection()
    conn.execute("BEGIN IMMEDIATE")
    try:
        if batch_ref:
            conn.execute(
                """
                INSERT INTO batches (batch_id, display_id, dataset_id, scope, algorithm_count, region_count,
                    planned_tasks, policy_json, params_snapshot_json, task_summary_json, status,
                    created_at, started_at)
                VALUES (?,?,?,'all',1,?,?,?,?,?,'Running',?,?)
                """,
                (
                    batch_ref,
                    batch_ref,
                    bundle.dataset["dataset_id"],
                    len(region_ids),
                    len(region_ids),
                    json_dumps({"sequential": True, "continue_on_error": True}),
                    json_dumps({model["key"]: {"mode": prepared["mode"], "params": prepared["params"]}}),
                    json_dumps({"total": 1}),
                    now_utc(),
                    now_utc(),
                ),
            )
        conn.execute(
            """
            INSERT INTO experiments (experiment_id, dataset_id, batch_id, algorithm_key, algorithm_label,
                display_id, category, mode, scope, params_json, snapshot_json, status, region_total, region_completed,
                region_failed, created_at, idempotency_key)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,'Queued',?,0,0,?,?)
            """,
            (
                new_id,
                bundle.dataset["dataset_id"],
                batch_ref,
                model["key"],
                model["label"],
                new_id,
                model["category"],
                prepared["mode"],
                prepared["scope"],
                json_dumps(prepared["params"]),
                json_dumps(snapshot),
                len(prepared["region_ids"]),
                now_utc(),
                idempotency_key,
            ),
        )
        for region_id in region_ids:
            conn.execute(
                """
                INSERT INTO experiment_region_models
                    (experiment_id, region_id, region_experiment_id, status)
                VALUES (?,?,?,'Queued')
                """,
                (new_id, region_id, region_exp_ids[region_id]),
            )
    except Exception:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")
    job = create_job(
        job_type="experiment",
        experiment_id=new_id,
        dataset_id=bundle.dataset["dataset_id"],
        parent_batch_id=batch_ref,
        payload={"experiment_id": new_id, "batch_id": batch_ref},
    )
    return {
        "experiment_id": new_id,
        "display_id": new_id,
        "batch_id": batch_ref,
        "batch_display_id": batch_ref,
        "status": "Queued",
        "job_id": job,
        "region_count": len(prepared["region_ids"]),
        "mode": prepared["mode"],
        "algorithm_key": model["key"],
        "warnings": prepared["warnings"],
        "snapshot": snapshot,
    }


@router.get("")
def list_experiments(
    dataset_id: str | None = None,
    batch_id: str | None = None,
    status: str | None = None,
    limit: int = Query(100, ge=1, le=500),
) -> dict:
    sql = "SELECT * FROM experiments WHERE scope='single'"
    params: list[Any] = []
    if dataset_id:
        resolved = query_one(
            "SELECT dataset_id FROM dataset_versions WHERE dataset_id=? OR display_id=?",
            (dataset_id, dataset_id),
        )
        if resolved is None:
            return {"experiments": [], "count": 0}
        sql += " AND dataset_id=?"
        params.append(resolved["dataset_id"])
    if batch_id:
        resolved = query_one(
            "SELECT batch_id FROM batches WHERE batch_id=? OR display_id=?",
            (batch_id, batch_id),
        )
        if resolved is None:
            return {"experiments": [], "count": 0}
        sql += " AND batch_id=?"
        params.append(resolved["batch_id"])
    if status:
        sql += " AND status=?"
        params.append(status)
    sql += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    rows = query_all(sql, tuple(params))
    return {"experiments": [_experiment_public(row) for row in rows], "count": len(rows)}


@router.get("/{experiment_id}")
def get_experiment(experiment_id: str, include_logs: bool = Query(True)) -> dict:
    row = _experiment_row(experiment_id)
    if row is None:
        raise NotFound(f"实验 {experiment_id} 不存在")
    return _experiment_public(row, include_logs=include_logs)


@router.get("/{experiment_id}/logs")
def logs(experiment_id: str, limit: int = Query(500, ge=1, le=5000), level: str | None = None,
         region_id: str | None = None) -> dict:
    row = _experiment_row(experiment_id)
    if row is None:
        raise NotFound(f"实验 {experiment_id} 不存在")
    entries = read_logs(row["experiment_id"], limit=limit)
    if level:
        entries = [e for e in entries if e.get("level") == level]
    if region_id:
        entries = [e for e in entries if e.get("region_id") == region_id]
    return {"experiment_id": row["experiment_id"], "display_id": row["display_id"] or row["experiment_id"], "logs": entries, "count": len(entries)}


@router.post("/{experiment_id}/stop")
def stop(experiment_id: str) -> dict:
    row = _experiment_row(experiment_id)
    if row is None:
        raise NotFound(f"实验 {experiment_id} 不存在")
    if row["status"] not in PROTECTED_STATUSES:
        raise Conflict(f"实验当前状态为 {row['status']}，无需停止", code="NOT_RUNNING")
    internal_id = row["experiment_id"]
    get_connection().execute(
        "UPDATE experiments SET cancel_requested=1, status=CASE WHEN status='Queued' THEN 'Stopped' ELSE status END,"
        " ended_at=CASE WHEN status='Queued' THEN ? ELSE ended_at END WHERE experiment_id=?",
        (now_utc(), internal_id),
    )
    get_connection().execute(
        "UPDATE jobs SET cancel_requested=1, state=CASE WHEN state='Queued' THEN 'Skipped' ELSE state END,"
        " ended_at=CASE WHEN state='Queued' THEN ? ELSE ended_at END WHERE experiment_id=?",
        (now_utc(), internal_id),
    )
    return {
        "experiment_id": internal_id,
        "display_id": row["display_id"] or internal_id,
        "cancel_requested": True,
        "acknowledged_by": "backend",
        "note": "Worker 在安全检查点确认后状态将变为 Stopped；已完成区域工件保留。",
    }


@router.post("/{experiment_id}/duplicate")
def duplicate(experiment_id: str) -> dict:
    row = _experiment_row(experiment_id)
    if row is None:
        raise NotFound(f"实验 {experiment_id} 不存在")
    snapshot = json_loads(row["snapshot_json"]) or {}
    return {
        "draft": True,
        "creates_experiment_id": False,
        "note": "Duplicate 只生成草稿，不会创建新的历史 Experiment ID；真正 Run 时才生成。",
        "dataset_id": row["dataset_id"],
        "algorithm_key": row["algorithm_key"],
        "mode": row["mode"],
        "scope": row["scope"],
        "params": json_loads(row["params_json"]),
        "region_ids": snapshot.get("region_ids"),
        "source_experiment_id": row["experiment_id"],
        "source_display_id": row["display_id"] or row["experiment_id"],
    }


@router.post("/{experiment_id}/archive")
def archive(experiment_id: str, archived: bool = Query(True)) -> dict:
    row = _experiment_row(experiment_id)
    if row is None:
        raise NotFound(f"实验 {experiment_id} 不存在")
    if archived and row["status"] in PROTECTED_STATUSES:
        raise Conflict("运行中的实验请先停止再归档", code="RUNNING")
    get_connection().execute(
        "UPDATE experiments SET status=? WHERE experiment_id=?",
        ("Archived" if archived else "Completed", row["experiment_id"]),
    )
    return _experiment_public(
        query_one("SELECT * FROM experiments WHERE experiment_id=?", (row["experiment_id"],))
    )


@router.delete("/{experiment_id}")
def remove(experiment_id: str) -> dict:
    row = _experiment_row(experiment_id)
    if row is None:
        raise NotFound(f"实验 {experiment_id} 不存在")
    if row["status"] in PROTECTED_STATUSES:
        raise Conflict("运行中的实验必须先停止才能删除", code="RUNNING")
    internal_id = row["experiment_id"]
    referenced = query_one(
        "SELECT COUNT(*) AS n FROM evaluation_experiments WHERE experiment_id=?", (internal_id,)
    )
    if referenced and referenced["n"]:
        raise Conflict(
            f"实验 {row['display_id'] or internal_id} 已被 {referenced['n']} 个 Evaluation 引用，只能 Archive，不能删除",
            code="EXPERIMENT_REFERENCED",
        )
    conn = get_connection()
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute("DELETE FROM experiment_region_models WHERE experiment_id=?", (internal_id,))
        conn.execute("DELETE FROM jobs WHERE experiment_id=?", (internal_id,))
        conn.execute("DELETE FROM experiments WHERE experiment_id=?", (internal_id,))
    except Exception:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")
    from app.services.artifacts import remove_registered, safe_dir

    remove_registered(safe_dir("experiments", internal_id))
    log_file = experiment_log_path(internal_id)
    try:
        if log_file.exists():
            log_file.unlink()
    except OSError:
        pass
    return {"experiment_id": internal_id, "display_id": row["display_id"] or internal_id, "deleted": True}
