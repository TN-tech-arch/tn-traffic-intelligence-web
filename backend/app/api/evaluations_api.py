"""Module 5: real held-out test evaluation with fair, identical protocols."""

from __future__ import annotations

import csv
import io
from typing import Any

from fastapi import APIRouter, Body, Query
from fastapi.responses import PlainTextResponse

from app.api.deps import create_job, raise_if_invalid
from app.core.errors import Conflict, NotFound
from app.core.ids import evaluation_id as make_id, now_utc
from app.db.connection import get_connection, json_dumps, json_loads, query_all, query_one
from app.services.datasets import get_dataset, load_dataset
from app.services.validation import validate_m5

router = APIRouter(prefix="/api/evaluations", tags=["evaluations"])


def _load_members(experiment_ids: list[str]) -> list[dict[str, Any]]:
    if not experiment_ids:
        return []
    placeholders = ",".join("?" for _ in experiment_ids)
    rows = query_all(
        f"SELECT * FROM experiments WHERE experiment_id IN ({placeholders}) "
        f"OR display_id IN ({placeholders})",
        tuple(experiment_ids) + tuple(experiment_ids),
    )
    out = []
    for row in rows:
        snapshot = json_loads(row["snapshot_json"]) or {}
        dataset = query_one(
            "SELECT display_id, dataset_id FROM dataset_versions WHERE dataset_id=?",
            (row["dataset_id"],),
        )
        batch = (
            query_one(
                "SELECT display_id, batch_id FROM batches WHERE batch_id=?",
                (row["batch_id"],),
            )
            if row["batch_id"]
            else None
        )
        out.append(
            {
                "experiment_id": row["experiment_id"],
                "display_id": row["display_id"] or row["experiment_id"],
                "internal_id": row["experiment_id"],
                "algorithm_key": row["algorithm_key"],
                "algorithm_label": row["algorithm_label"],
                "mode": row["mode"],
                "status": row["status"],
                "dataset_id": row["dataset_id"],
                "dataset_display_id": (dataset["display_id"] or dataset["dataset_id"])
                if dataset
                else row["dataset_id"],
                "scope": row["scope"],
                "batch_id": row["batch_id"],
                "batch_display_id": (batch["display_id"] or batch["batch_id"])
                if batch
                else None,
                "region_ids": snapshot.get("region_ids") or [],
                "created_at": row["created_at"],
                "error": row["error"],
            }
        )
    found = {m["experiment_id"] for m in out} | {m["display_id"] for m in out}
    for missing in set(experiment_ids) - found:
        out.append(
            {
                "experiment_id": missing,
                "display_id": missing,
                "status": "Missing",
                "error": "实验不存在",
            }
        )
    return out


def _prepare(payload: dict[str, Any]) -> dict[str, Any]:
    dataset_id = payload.get("dataset_id")
    if not dataset_id:
        raise Conflict("必须提供 dataset_id", code="DATASET_REQUIRED")
    dataset = get_dataset(dataset_id)
    experiment_ids = payload.get("experiment_ids") or []
    experiments = _load_members(experiment_ids)
    values = {
        "dataset_id": dataset_id,
        "scope": payload.get("scope", dataset["scope"]),
        "region_id": payload.get("region_id"),
        "experiment_ids": experiment_ids,
        "test_selection": payload.get("test_selection", "full"),
        "range_start_at": payload.get("range_start_at"),
        "range_end_at": payload.get("range_end_at"),
        "horizon_step": payload.get("horizon_step", 1),
    }
    issues = validate_m5(values, experiments=experiments, dataset=dataset)
    raise_if_invalid(issues, message="评价配置校验未通过")
    scope = values["scope"]
    if scope == "single":
        regions = [payload.get("region_id")]
    else:
        regions = list(dataset["region_ids"])
    if not regions or not regions[0]:
        raise Conflict("Single Region 评价必须指定区域", code="REGION_REQUIRED")
    bundle = load_dataset(dataset_id)
    missing_regions = [r for r in regions if r not in bundle.region_ids]
    if missing_regions:
        raise Conflict(f"区域不在数据集中: {', '.join(missing_regions[:5])}", code="REGION_NOT_IN_DATASET")
    return {"dataset": dataset, "experiments": experiments, "regions": regions, "values": values,
            "warnings": [i for i in issues if i["severity"] == "warning"]}


@router.post("/validate")
def validate(payload: dict[str, Any] = Body(...)) -> dict:
    dataset_id = payload.get("dataset_id")
    dataset = get_dataset(dataset_id) if dataset_id else None
    experiments = _load_members(payload.get("experiment_ids") or [])
    issues = validate_m5(payload, experiments=experiments, dataset=dataset)
    common = _common_protocol(experiments, dataset)
    return {
        "valid": not any(i["severity"] == "error" for i in issues),
        "issues": issues,
        "experiments": experiments,
        "compatibility": common,
    }


def _common_protocol(experiments: list[dict[str, Any]], dataset: dict[str, Any] | None) -> dict[str, Any]:
    comparable = [e for e in experiments if e.get("status") in ("Completed", "Partial")]
    datasets = {e.get("dataset_id") for e in comparable}
    scopes = {e.get("scope") for e in comparable}
    return {
        "eligible_experiments": [e["experiment_id"] for e in comparable],
        "non_eligible": [
            {
                "experiment_id": e["experiment_id"],
                "display_id": e.get("display_id") or e["experiment_id"],
                "status": e.get("status"),
                "reason": e.get("error"),
            }
            for e in experiments
            if e.get("status") not in ("Completed", "Partial")
        ],
        "same_dataset": len(datasets) <= 1,
        "datasets": sorted(d for d in datasets if d),
        "same_scope": len(scopes) <= 1,
        "same_horizon": bool(dataset and all(dataset["H"] for _ in comparable)),
        "standard_ranking_allowed": len(datasets) <= 1 and len(scopes) <= 1 and bool(comparable),
        "note_zh": "只有相同 Dataset、H 与 Test 目标时间的实验才进入标准排名；不同协议会单独列出。",
    }


@router.post("/run")
def run(payload: dict[str, Any] = Body(...)) -> dict:
    prepared = _prepare(payload)
    bundle = load_dataset(prepared["dataset"]["dataset_id"])
    protocol = {
        "dataset_id": prepared["dataset"]["dataset_id"],
        "dataset_hash": prepared["dataset"]["hash"],
        "scope": prepared["values"]["scope"],
        "regions": prepared["regions"],
        "L": bundle.L,
        "H": bundle.H,
        "S": bundle.S,
        "test_selection": prepared["values"]["test_selection"],
        "range_start_at": prepared["values"].get("range_start_at"),
        "range_end_at": prepared["values"].get("range_end_at"),
        "horizon_step": prepared["values"]["horizon_step"],
        "metric_protocol": "(region_id, window_index, horizon_step) 每个样本计一次；正式成绩使用 Full Test",
        "experiments": [e["experiment_id"] for e in prepared["experiments"]],
        "created_at": now_utc(),
    }
    new_id = make_id()
    conn = get_connection()
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute(
            """
            INSERT INTO evaluations (evaluation_id, dataset_id, batch_id, source_id, scope, region_id,
                protocol_json, test_range_json, status, created_at)
            VALUES (?,?,?,?,?,?,?,?, 'Queued', ?)
            """,
            (
                new_id,
                prepared["dataset"]["dataset_id"],
                prepared["dataset"].get("batch_id"),
                prepared["dataset"]["source_key"],
                prepared["values"]["scope"],
                prepared["regions"][0] if prepared["values"]["scope"] == "single" else None,
                json_dumps(protocol),
                json_dumps({"selection": prepared["values"]["test_selection"]}),
                now_utc(),
            ),
        )
        for experiment in prepared["experiments"]:
            conn.execute(
                """
                INSERT INTO evaluation_experiments (evaluation_id, experiment_id, algorithm_key, status)
                VALUES (?,?,?, 'Queued')
                """,
                (new_id, experiment["experiment_id"], experiment.get("algorithm_key", "unknown")),
            )
    except Exception:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")
    job = create_job(job_type="evaluation", evaluation_id=new_id, dataset_id=prepared["dataset"]["dataset_id"],
                     payload={"evaluation_id": new_id})
    return {
        "evaluation_id": new_id,
        "status": "Queued",
        "job_id": job,
        "region_count": len(prepared["regions"]),
        "experiment_count": len(prepared["experiments"]),
        "protocol": protocol,
        "warnings": prepared["warnings"],
    }


def _evaluation_public(row, *, include_predictions: bool = False, limit: int = 400) -> dict[str, Any]:
    members = query_all(
        "SELECT * FROM evaluation_experiments WHERE evaluation_id=? ORDER BY algorithm_key",
        (row["evaluation_id"],),
    )
    dataset = query_one(
        "SELECT display_id, dataset_id FROM dataset_versions WHERE dataset_id=?",
        (row["dataset_id"],),
    )
    experiment_rows = query_all(
        f"""
        SELECT experiment_id, display_id, batch_id
        FROM experiments
        WHERE experiment_id IN ({",".join("?" for _ in members)})
        """,
        tuple(m["experiment_id"] for m in members),
    ) if members else []
    experiment_lookup = {item["experiment_id"]: item for item in experiment_rows}
    batch_ids = sorted({item["batch_id"] for item in experiment_rows if item["batch_id"]})
    batch_lookup = {
        item["batch_id"]: item
        for item in (
            query_all(
                f"SELECT batch_id, display_id FROM batches "
                f"WHERE batch_id IN ({','.join('?' for _ in batch_ids)})",
                tuple(batch_ids),
            )
            if batch_ids
            else []
        )
    }
    metrics_summary = json_loads(row["metrics_summary_json"])
    if isinstance(metrics_summary, dict):
        for key in ("ranking", "experiments"):
            for item in metrics_summary.get(key) or []:
                experiment = experiment_lookup.get(item.get("experiment_id"))
                if experiment:
                    item["display_id"] = experiment["display_id"] or experiment["experiment_id"]
    payload = {
        "evaluation_id": row["evaluation_id"],
        "dataset_id": row["dataset_id"],
        "dataset_display_id": (dataset["display_id"] or dataset["dataset_id"])
        if dataset
        else row["dataset_id"],
        "scope": row["scope"],
        "region_id": row["region_id"],
        "status": row["status"],
        "protocol": json_loads(row["protocol_json"]),
        "metrics_summary": metrics_summary,
        "progress": json_loads(row["progress_json"]),
        "error": row["error"],
        "created_at": row["created_at"],
        "started_at": row["started_at"],
        "ended_at": row["ended_at"],
        "exported_at": row["exported_at"],
        "experiments": [
            {
                "experiment_id": m["experiment_id"],
                "display_id": (
                    experiment_lookup[m["experiment_id"]]["display_id"]
                    or experiment_lookup[m["experiment_id"]]["experiment_id"]
                )
                if m["experiment_id"] in experiment_lookup
                else m["experiment_id"],
                "batch_id": experiment_lookup[m["experiment_id"]]["batch_id"]
                if m["experiment_id"] in experiment_lookup
                else None,
                "batch_display_id": (
                    batch_lookup[
                        experiment_lookup[m["experiment_id"]]["batch_id"]
                    ]["display_id"]
                    or experiment_lookup[m["experiment_id"]]["batch_id"]
                )
                if m["experiment_id"] in experiment_lookup
                and experiment_lookup[m["experiment_id"]]["batch_id"] in batch_lookup
                else None,
                "algorithm_key": m["algorithm_key"],
                "status": m["status"],
                "coverage_regions": m["coverage_regions"],
                "sample_count": m["sample_count"],
                "metrics": json_loads(m["metrics_json"]),
                "error": m["error"],
            }
            for m in members
        ],
    }
    if include_predictions:
        rows = query_all(
            """
            SELECT experiment_id, region_id, window_index, horizon_step, target_at, y_true, y_pred
            FROM evaluation_predictions WHERE evaluation_id=? ORDER BY region_id, window_index, horizon_step
            LIMIT ?
            """,
            (row["evaluation_id"], limit),
        )
        payload["predictions"] = [dict(r) for r in rows]
        total = query_one(
            "SELECT COUNT(*) AS n FROM evaluation_predictions WHERE evaluation_id=?",
            (row["evaluation_id"],),
        )
        payload["prediction_count"] = total["n"] if total else 0
    return payload


@router.get("")
def list_evaluations(limit: int = Query(50, ge=1, le=200)) -> dict:
    rows = query_all("SELECT * FROM evaluations ORDER BY created_at DESC LIMIT ?", (limit,))
    return {"evaluations": [_evaluation_public(row) for row in rows], "count": len(rows)}


@router.get("/{evaluation_id}")
def get_evaluation(evaluation_id: str, include_predictions: bool = Query(True),
                   limit: int = Query(600, ge=1, le=5000)) -> dict:
    row = query_one("SELECT * FROM evaluations WHERE evaluation_id=?", (evaluation_id,))
    if row is None:
        raise NotFound(f"评价 {evaluation_id} 不存在")
    return _evaluation_public(row, include_predictions=include_predictions, limit=limit)


@router.get("/{evaluation_id}/series")
def series(evaluation_id: str, experiment_id: str = Query(...), region_id: str | None = None,
           horizon_step: int | None = None) -> dict:
    row = query_one("SELECT * FROM evaluations WHERE evaluation_id=?", (evaluation_id,))
    if row is None:
        raise NotFound(f"评价 {evaluation_id} 不存在")
    experiment = query_one(
        "SELECT experiment_id, display_id FROM experiments WHERE experiment_id=? OR display_id=?",
        (experiment_id, experiment_id),
    )
    internal_experiment_id = experiment["experiment_id"] if experiment else experiment_id
    sql = (
        "SELECT region_id, window_index, horizon_step, target_at, y_true, y_pred "
        "FROM evaluation_predictions WHERE evaluation_id=? AND experiment_id=?"
    )
    params: list[Any] = [evaluation_id, internal_experiment_id]
    if region_id:
        sql += " AND region_id=?"
        params.append(region_id)
    if horizon_step:
        sql += " AND horizon_step=?"
        params.append(horizon_step)
    sql += " ORDER BY region_id, window_index, horizon_step"
    rows = query_all(sql, tuple(params))
    return {
        "evaluation_id": evaluation_id,
        "experiment_id": experiment_id,
        "internal_experiment_id": internal_experiment_id,
        "display_id": (experiment["display_id"] or experiment["experiment_id"])
        if experiment
        else experiment_id,
        "region_id": region_id,
        "rows": [dict(r) for r in rows],
        "count": len(rows),
    }


@router.get("/{evaluation_id}/export")
def export(evaluation_id: str, format: str = Query("csv")) -> PlainTextResponse:
    row = query_one("SELECT * FROM evaluations WHERE evaluation_id=?", (evaluation_id,))
    if row is None:
        raise NotFound(f"评价 {evaluation_id} 不存在")
    rows = query_all(
        """
        SELECT experiment_id, region_id, window_index, horizon_step, target_at, y_true, y_pred
        FROM evaluation_predictions WHERE evaluation_id=? ORDER BY experiment_id, region_id, window_index, horizon_step
        """,
        (evaluation_id,),
    )
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["evaluation_id", "experiment_id", "region_id", "window_index", "horizon_step",
                     "target_at", "y_true", "y_pred"])
    for r in rows:
        writer.writerow([evaluation_id, r["experiment_id"], r["region_id"], r["window_index"],
                         r["horizon_step"], r["target_at"], r["y_true"], r["y_pred"]])
    get_connection().execute(
        "UPDATE evaluations SET exported_at=? WHERE evaluation_id=?", (now_utc(), evaluation_id)
    )
    return PlainTextResponse(
        buffer.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{evaluation_id}.csv"'},
    )


@router.delete("/{evaluation_id}")
def delete(evaluation_id: str) -> dict:
    row = query_one("SELECT * FROM evaluations WHERE evaluation_id=?", (evaluation_id,))
    if row is None:
        raise NotFound(f"评价 {evaluation_id} 不存在")
    if row["status"] in ("Running", "Queued", "Stopping"):
        raise Conflict("运行中的评价请先停止再删除", code="EVALUATION_RUNNING")
    conn = get_connection()
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute("DELETE FROM evaluation_predictions WHERE evaluation_id=?", (evaluation_id,))
        conn.execute("DELETE FROM evaluation_experiments WHERE evaluation_id=?", (evaluation_id,))
        conn.execute("DELETE FROM jobs WHERE evaluation_id=?", (evaluation_id,))
        conn.execute("DELETE FROM evaluations WHERE evaluation_id=?", (evaluation_id,))
    except Exception:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")
    return {"evaluation_id": evaluation_id, "deleted": True,
            "note": "只删除本评价的预测/指标与元数据，不影响上游 Dataset 与 Experiment。"}


@router.post("/{evaluation_id}/stop")
def stop(evaluation_id: str) -> dict:
    row = query_one("SELECT * FROM evaluations WHERE evaluation_id=?", (evaluation_id,))
    if row is None:
        raise NotFound(f"评价 {evaluation_id} 不存在")
    if row["status"] not in ("Running", "Queued"):
        raise Conflict(f"评价当前状态为 {row['status']}，无需停止", code="NOT_RUNNING")
    get_connection().execute(
        "UPDATE evaluations SET cancel_requested=1, status='Stopping' WHERE evaluation_id=?", (evaluation_id,)
    )
    get_connection().execute(
        "UPDATE jobs SET cancel_requested=1 WHERE evaluation_id=?", (evaluation_id,)
    )
    return {"evaluation_id": evaluation_id, "cancel_requested": True, "acknowledged_by": "backend"}
