from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Query

from app.api.deps import create_job, raise_if_invalid
from app.core.errors import Conflict, NotFound
from app.core.ids import cluster_run_id as make_id, now_utc
from app.db.connection import get_connection, json_dumps, json_loads, query_all, query_one
from app.services.clustering import ALGORITHM_LABELS, feature_catalog
from app.services.ingest import source_row
from app.services.series import valid_region_ids
from app.services.validation import check_module, validate_m2

router = APIRouter(prefix="/api/clusters", tags=["clustering"])


@router.get("/features")
def features() -> dict:
    return {"features": feature_catalog(), "algorithms": [
        {"key": key, "label": label} for key, label in ALGORITHM_LABELS.items()
    ]}


@router.post("/validate")
def validate(payload: dict[str, Any] = Body(...)) -> dict:
    values = payload.get("values") or payload
    source_key = values.get("source_key") or "milano"
    region_count = len(valid_region_ids(source_key)) if source_key else None
    issues = validate_m2(values, region_count=region_count)
    _, coerced = check_module("m2", values)
    return {
        "valid": not any(i["severity"] == "error" for i in issues),
        "issues": issues,
        "region_count": region_count,
        "resolved": coerced,
    }


@router.post("/run")
def run(payload: dict[str, Any] = Body(...)) -> dict:
    values = payload.get("values") or payload
    source = source_row(values.get("source_key") or "")
    region_count = len(valid_region_ids(source["key"]))
    issues = validate_m2(values, region_count=region_count)
    raise_if_invalid(issues)
    _, coerced = check_module("m2", values)
    new_id = make_id()
    get_connection().execute(
        """
        INSERT INTO clusters (cluster_run_id, source_id, algorithm_key, params_json, features_json,
            frequency, aggregation, region_count, cluster_count, noise_count, status, created_at)
        VALUES (?,?,?,?,?,?,?,?,0,0,'Queued',?)
        """,
        (
            new_id,
            source["source_id"],
            coerced["algorithm"],
            json_dumps(coerced),
            json_dumps({"selected": values.get("features") or []}),
            coerced["frequency"],
            coerced["aggregation"],
            region_count,
            now_utc(),
        ),
    )
    job = create_job(job_type="clustering", payload={"cluster_run_id": new_id},
                     cluster_run_id=new_id, dataset_id=None)
    return {"cluster_run_id": new_id, "job_id": job, "status": "Queued", "region_count": region_count,
            "warnings": [i for i in issues if i["severity"] == "warning"]}


@router.get("")
def list_runs(limit: int = Query(50, ge=1, le=500)) -> dict:
    rows = query_all("SELECT * FROM clusters ORDER BY created_at DESC LIMIT ?", (limit,))
    return {
        "runs": [
            {
                "cluster_run_id": row["cluster_run_id"],
                "source_id": row["source_id"],
                "algorithm_key": row["algorithm_key"],
                "algorithm_label": ALGORITHM_LABELS.get(row["algorithm_key"], row["algorithm_key"]),
                "status": row["status"],
                "cluster_count": row["cluster_count"],
                "noise_count": row["noise_count"],
                "region_count": row["region_count"],
                "created_at": row["created_at"],
                "error": row["error"],
            }
            for row in rows
        ]
    }


@router.get("/{run_id}")
def get_run(run_id: str) -> dict:
    row = query_one("SELECT * FROM clusters WHERE cluster_run_id = ?", (run_id,))
    if row is None:
        raise NotFound(f"聚类运行 {run_id} 不存在")
    result = json_loads(row["result_json"]) or {}
    return {
        "cluster_run_id": row["cluster_run_id"],
        "source_id": row["source_id"],
        "algorithm_key": row["algorithm_key"],
        "algorithm_label": ALGORITHM_LABELS.get(row["algorithm_key"], row["algorithm_key"]),
        "params": json_loads(row["params_json"]),
        "features": json_loads(row["features_json"]),
        "status": row["status"],
        "error": row["error"],
        "metrics": json_loads(row["metrics_json"]),
        "created_at": row["created_at"],
        "result": result,
    }


@router.delete("/{run_id}")
def delete_run(run_id: str) -> dict:
    row = query_one("SELECT * FROM clusters WHERE cluster_run_id = ?", (run_id,))
    if row is None:
        raise NotFound(f"聚类运行 {run_id} 不存在")
    if row["status"] in ("Queued", "Running"):
        raise Conflict("运行中的聚类任务请先停止，再执行删除", code="CLUSTER_RUNNING")
    get_connection().execute("DELETE FROM clusters WHERE cluster_run_id = ?", (run_id,))
    return {"cluster_run_id": run_id, "deleted": True}
