from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Query

from app.api.deps import create_job, raise_if_invalid
from app.core.errors import Conflict, NotFound
from app.db.connection import json_loads, query_one
from app.services import datasets as svc
from app.services.datasets import (
    archive_dataset,
    create_dataset,
    delete_dataset,
    get_dataset,
    list_datasets,
    preview_dataset,
    preview_window,
)
from app.services.ingest import source_row
from app.services.series import valid_region_ids
from app.services.validation import check_module, validate_m3

router = APIRouter(prefix="/api/datasets", tags=["datasets"])


def _validate(payload: dict[str, Any], *, deep: bool) -> tuple[list, dict]:
    values = payload.get("values") or payload
    source = source_row(values.get("source_key") or "")
    context: dict[str, Any] = {}
    issues = validate_m3(values, dataset_context=None)
    if not any(i["severity"] == "error" for i in issues) and deep:
        try:
            computed = svc._compute(
                {
                    "source_key": source["key"],
                    "scope": values.get("scope", "single"),
                    "region_id": values.get("region_id"),
                    "frequency": values.get("frequency", "native"),
                    "aggregation": values.get("aggregation", "mean"),
                    "input_length": values.get("input_length", 24),
                    "output_length": values.get("output_length", 6),
                    "step": values.get("step", 1),
                    "train_ratio": values.get("train_ratio", 0.7),
                    "val_ratio": values.get("val_ratio", 0.15),
                    "test_ratio": values.get("test_ratio", 0.15),
                    "missing_mode": values.get("missing_mode", "automatic"),
                    "scaling": values.get("scaling", "standard"),
                }
            )
            context = {
                "empty_splits": computed["empty_splits"],
                "train_windows": computed["counts"]["train"],
                "windows_below_minimum": computed["counts"]["train"] < 50,
            }
            issues.extend(validate_m3(values, dataset_context=context))
        except Exception as exc:
            issues.append(
                {
                    "path": "m3",
                    "code": "PRECOMPUTE_FAILED",
                    "severity": "error",
                    "message": f"无法计算窗口：{exc}",
                    "suggestion": "请检查 L/H/S、时间范围与比例设置。",
                    "received_value": None,
                }
            )
    _, coerced = check_module("m3", values)
    return issues, {"values": coerced, "context": context, "source": source}


@router.post("/validate")
def validate(payload: dict[str, Any] = Body(...)) -> dict:
    issues, info = _validate(payload, deep=True)
    return {
        "valid": not any(i["severity"] == "error" for i in issues),
        "issues": issues,
        "resolved": info["values"],
        "context": info["context"],
    }


@router.post("/preview")
def preview(payload: dict[str, Any] = Body(...)) -> dict:
    issues, info = _validate(payload, deep=True)
    raise_if_invalid(issues)
    values = info["values"]
    values["source_key"] = info["source"]["key"]
    return preview_dataset(values)


@router.post("/preview-window")
def preview_single_window(payload: dict[str, Any] = Body(...)) -> dict:
    values_payload = payload.get("values") or payload
    split = str(payload.get("split") or "test")
    window_index = int(payload.get("window_index") or 0)
    issues, info = _validate({"values": values_payload}, deep=True)
    raise_if_invalid(issues)
    values = dict(info["values"])
    values["source_key"] = info["source"]["key"]
    values["preview_region_id"] = payload.get("preview_region_id")
    return preview_window(values, split=split, window_index=window_index)


@router.post("/build")
def build(payload: dict[str, Any] = Body(...)) -> dict:
    issues, info = _validate(payload, deep=True)
    raise_if_invalid(issues)
    values = dict(info["values"])
    values["source_key"] = info["source"]["key"]
    values["label"] = (payload.get("values") or payload).get("label") or ""
    dataset = create_dataset(values)
    return dataset


@router.get("")
def list_all(include_archived: bool = Query(True)) -> dict:
    rows = list_datasets(include_archived=include_archived)
    return {"datasets": rows, "count": len(rows)}


@router.get("/{dataset_id}")
def detail(dataset_id: str) -> dict:
    return get_dataset(dataset_id)


@router.get("/{dataset_id}/windows")
def windows(
    dataset_id: str,
    split: str = Query("train"),
    region_id: str | None = None,
    limit: int = Query(20, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict:
    bundle = svc.load_dataset(dataset_id)
    region_id = region_id or bundle.region_ids[0]
    starts = bundle.valid_starts(region_id, split)
    selected = starts[offset: offset + limit]
    rows = []
    for start in selected:
        x_start, x_end = int(start), int(start + bundle.L - 1)
        y_start, y_end = int(start + bundle.L), int(start + bundle.L + bundle.H - 1)
        rows.append(
            {
                "origin_index": int(start),
                "input_start_at": _ts(bundle.timestamps, x_start),
                "input_end_at": _ts(bundle.timestamps, x_end),
                "target_start_at": _ts(bundle.timestamps, y_start),
                "target_end_at": _ts(bundle.timestamps, y_end),
                "X": [float(v) for v in bundle.values[x_start: x_end + 1, bundle.region_index(region_id)]],
                "Y": [float(v) for v in bundle.values[y_start: y_end + 1, bundle.region_index(region_id)]],
            }
        )
    return {
        "dataset_id": dataset_id,
        "split": split,
        "region_id": region_id,
        "total_windows": int(starts.size),
        "offset": offset,
        "limit": limit,
        "windows": rows,
    }


def _ts(timestamps, index: int) -> str:
    import pandas as pd

    return pd.Timestamp(int(timestamps[index]), unit="s").isoformat(sep=" ")


@router.post("/{dataset_id}/archive")
def archive(dataset_id: str, archived: bool = Query(True)) -> dict:
    return archive_dataset(dataset_id, archived=archived)


@router.delete("/{dataset_id}")
def remove(dataset_id: str) -> dict:
    return delete_dataset(dataset_id)


@router.get("/{dataset_id}/options")
def options(dataset_id: str) -> dict:
    dataset = get_dataset(dataset_id)
    return {
        "dataset_id": dataset_id,
        "region_ids": dataset["region_ids"],
        "L": dataset["L"],
        "H": dataset["H"],
        "S": dataset["S"],
        "scope": dataset["scope"],
        "window_counts": dataset["window_counts"],
    }
