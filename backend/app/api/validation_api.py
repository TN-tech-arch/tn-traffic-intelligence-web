"""Unified validation API (spec 3.5.3 / 12.4)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body

from app.core.ids import ulid
from app.forecast.registry import public_registry
from app.services.validation import (
    MODULE_SCHEMAS,
    all_models_summary,
    check_model_params,
    check_module,
    environment_report,
    validate_m1,
    validate_m2,
    validate_m3,
    validate_m5,
)

router = APIRouter(prefix="/api/validation", tags=["validation"])


@router.get("/schema")
def schema() -> dict:
    """Machine readable constraints used by the frontend to render and pre-check."""
    return {
        "modules": MODULE_SCHEMAS,
        "models": public_registry(),
        "severity_levels": ["error", "warning", "info"],
        "contract": {
            "path": "dotted path of the offending field, e.g. model.params.dropout",
            "code": "stable machine readable code",
            "severity": "error | warning",
            "message": "Chinese explanation including the received value",
            "suggestion": "how to fix",
            "received_value": "echo of the rejected value",
        },
        "server_side_enforcement": "every build/run endpoint re-validates with the same engine; "
                                   "rejections return HTTP 422/409 with structured issues and no side effects",
    }


@router.post("/check")
def check(payload: dict[str, Any] = Body(...)) -> dict:
    request_id = payload.get("request_id") or ulid()
    kind = payload.get("kind")
    issues: list = []
    if kind in MODULE_SCHEMAS:
        context = payload.get("context") or {}
        if kind == "m3":
            issues = validate_m3(payload.get("values") or {}, dataset_context=context)
        elif kind == "m2":
            issues = validate_m2(payload.get("values") or {}, region_count=context.get("region_count"))
        elif kind == "m1":
            issues = validate_m1(payload.get("values") or {}, available_regions=context.get("available_regions"))
        else:
            issues = validate_m5(payload.get("values") or {}, experiments=context.get("experiments"),
                                 dataset=context.get("dataset"))
    elif kind == "model":
        issues, _ = check_model_params(
            payload.get("algorithm_key", ""),
            payload.get("values") or {},
            mode=payload.get("mode"),
            context=payload.get("context") or {},
            path_prefix=payload.get("path") or None,
        )
    elif kind == "all_models":
        summary = all_models_summary(payload.get("values") or {}, context=payload.get("context") or {})
        return {
            "valid": summary["blocking_error_count"] == 0,
            "models": summary["models"],
            "batch_issues": summary["batch_issues"],
            "runnable_count": summary["runnable_count"],
            "blocking_error_count": summary["blocking_error_count"],
            "request_id": request_id,
        }
    else:
        return {
            "valid": False,
            "issues": [
                {
                    "path": "kind",
                    "code": "UNKNOWN_KIND",
                    "severity": "error",
                    "message": f"未知的校验类型 {kind}",
                    "suggestion": "请使用 m1 / m2 / m3 / m5 / model / all_models",
                    "received_value": kind,
                }
            ],
            "request_id": request_id,
        }
    return {
        "valid": not any(i["severity"] == "error" for i in issues),
        "issues": issues,
        "request_id": request_id,
    }


@router.get("/environment")
def environment() -> dict:
    return environment_report()
