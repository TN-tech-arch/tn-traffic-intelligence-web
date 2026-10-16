from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Query

from app.api.deps import create_job, raise_if_invalid
from app.core.config import settings
from app.core.errors import Conflict, NotFound
from app.db.connection import json_loads, query_one
from app.forecast.foundation import chronos_status, timesfm_status
from app.forecast.registry import ALGORITHM_KEYS, MODEL_BY_KEY, default_params, public_registry
from app.services.datasets import load_dataset
from app.services.validation import all_models_summary, check_model_params, environment_report

router = APIRouter(prefix="/api/models", tags=["models"])


@router.get("/registry")
def registry() -> dict:
    models = public_registry()
    return {
        "algorithm_count": len(models),
        "all_models": {
            "key": "all_models",
            "label": "All Models (12)",
            "is_algorithm": False,
            "description_zh": "顶部批量编排入口：依次运行下方 12 个算法，不是第 13 种算法。",
        },
        "categories": [
            {"key": "statistical", "label": "Statistical", "label_zh": "统计模型"},
            {"key": "machine_learning", "label": "Machine Learning", "label_zh": "机器学习"},
            {"key": "deep_learning", "label": "Deep Learning", "label_zh": "深度学习"},
            {"key": "foundation", "label": "Foundation Model", "label_zh": "基础大模型"},
        ],
        "models": models,
        "environment": environment_report(),
    }


@router.get("/foundation")
def foundation() -> dict:
    return {"timesfm": timesfm_status(), "chronos": chronos_status()}


@router.post("/preflight")
def preflight(payload: dict[str, Any] = Body(...)) -> dict:
    """Real compatibility preflight for one model or the whole All Models batch."""
    dataset_id = payload.get("dataset_id")
    dataset = load_dataset(dataset_id) if dataset_id else None
    region_ids = payload.get("region_ids") or (dataset.region_ids if dataset else [])
    train_samples = None
    if dataset and region_ids:
        try:
            starts = dataset.valid_starts(region_ids[0], "train")
            train_samples = int(starts.size)
        except Exception:
            train_samples = None
    context = {
        "train_samples": train_samples,
        "region_count": len(region_ids),
        "planned_tasks": len(region_ids) * (12 if payload.get("algorithm_choice") == "all_models" else 1),
        "dataset": {
            "dataset_id": dataset.dataset["dataset_id"],
            "L": dataset.L,
            "H": dataset.H,
            "S": dataset.S,
            "scope": dataset.dataset["scope"],
        } if dataset else None,
    }
    if payload.get("algorithm_choice") == "all_models" or payload.get("all_models"):
        summary = all_models_summary(payload.get("model_configs") or {}, context=context)
        summary["context"] = context
        summary["valid"] = summary["blocking_error_count"] == 0
        return summary
    algorithm_key = payload.get("algorithm_key")
    if algorithm_key not in MODEL_BY_KEY:
        raise NotFound(f"未知算法 {algorithm_key}")
    issues, coerced = check_model_params(
        algorithm_key,
        payload.get("params") or {},
        mode=payload.get("mode") or MODEL_BY_KEY[algorithm_key]["default_mode"],
        context=context,
        path_prefix=f"model_configs.{algorithm_key}.params",
    )
    model = MODEL_BY_KEY[algorithm_key]
    runnable = not any(i["severity"] == "error" for i in issues)
    capabilities = dict(model["capabilities"])
    if model.get("foundation"):
        status = timesfm_status() if model["foundation"] == "timesfm" else chronos_status()
        capabilities.update({"installed": status["package_installed"], "ready": status["ready"],
                             "device": status["device_available"]})
        if not status["package_installed"]:
            issues.append(
                {
                    "path": f"model_configs.{algorithm_key}.params.checkpoint_id",
                    "code": "DEPENDENCY_MISSING",
                    "severity": "error",
                    "message": f"{model['label']} 的官方推理依赖未安装。",
                    "suggestion": f"请在虚拟环境安装对应包：{', '.join(status['packages'])}。",
                    "received_value": None,
                }
            )
            runnable = False
        elif not status["ready"]:
            issues.append(
                {
                    "path": f"model_configs.{algorithm_key}.params.checkpoint_id",
                    "code": "CHECKPOINT_UNAVAILABLE",
                    "severity": "error",
                    "message": f"{model['label']} 没有任何已下载的预训练权重（Unavailable: weights missing）。",
                    "suggestion": "调用 POST /api/models/foundation/{key}/download 下载合规 checkpoint 后再运行。",
                    "received_value": payload.get("params", {}).get("checkpoint_id") if payload.get("params") else None,
                }
            )
            runnable = False
    return {
        "valid": runnable,
        "algorithm_key": algorithm_key,
        "label": model["label"],
        "mode": payload.get("mode") or model["default_mode"],
        "issues": issues,
        "params": coerced,
        "capabilities": capabilities,
        "context": context,
    }


@router.post("/foundation/{key}/download")
def download_checkpoint(key: str, payload: dict[str, Any] = Body(default={})) -> dict:
    if key not in ("timesfm", "chronos"):
        raise NotFound(f"未知大模型 {key}")
    checkpoint_id = (payload or {}).get("checkpoint_id")
    status = timesfm_status() if key == "timesfm" else chronos_status()
    if not status["package_installed"]:
        raise Conflict(
            f"{key} 推理依赖未安装：{', '.join(status['packages'])}",
            code="DEPENDENCY_MISSING",
        )
    available = {c["id"] for c in status["checkpoints"] if c["available"]}
    if checkpoint_id and checkpoint_id in available:
        return {"checkpoint_id": checkpoint_id, "already_available": True, "status": status}
    job = create_job(job_type="checkpoint_download", payload={"key": key, "checkpoint_id": checkpoint_id})
    return {
        "job_id": job,
        "key": key,
        "checkpoint_id": checkpoint_id,
        "status": "Queued",
        "note": "下载在后台执行；完成后 GET /api/models/foundation 会显示 available=true。",
    }
