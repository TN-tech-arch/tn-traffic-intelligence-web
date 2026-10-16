from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body

from app.api.deps import raise_if_invalid
from app.services.ingest import regions_for, source_row
from app.services.stats import compare_sources, spatial_analysis, temporal_analysis
from app.services.validation import validate_m1

router = APIRouter(prefix="/api/analysis", tags=["analysis"])


def _guard(payload: dict[str, Any]) -> None:
    source = source_row(payload.get("source_key") or "")
    issues = validate_m1(
        payload,
        available_regions=[r["region_id"] for r in regions_for(source["source_id"])],
    )
    raise_if_invalid(issues)


@router.post("/temporal")
def temporal(payload: dict[str, Any] = Body(...)) -> dict:
    _guard(payload)
    return temporal_analysis(payload)


@router.post("/spatial")
def spatial(payload: dict[str, Any] = Body(...)) -> dict:
    _guard(payload)
    return spatial_analysis(payload)


@router.post("/compare")
def compare(payload: dict[str, Any] = Body(default={})) -> dict:
    return compare_sources(payload or {})
