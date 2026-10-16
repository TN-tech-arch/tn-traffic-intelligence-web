from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from app.api.deps import raise_if_invalid
from app.core.errors import NotFound
from app.services import ingest
from app.services.ingest import geometry_collection, quality_report, regions_for, source_row, sources_summary
from app.services.series import available_frequencies, resample, time_bounds, valid_region_ids
from app.services.validation import validate_m1

router = APIRouter(prefix="/api/data", tags=["data"])


@router.get("/sources")
def list_sources() -> dict:
    rows = sources_summary()
    if not rows:
        raise NotFound(
            "尚未导入任何数据源，请运行 scripts/import_data.ps1 或调用 POST /api/data/import",
            code="NO_SOURCE",
        )
    total_series = sum(r["series_region_count"] for r in rows)
    total_gis = sum(r["gis_region_count"] for r in rows)
    return {
        "sources": rows,
        "totals": {
            "sources": len(rows),
            "series_regions": total_series,
            "gis_regions": total_gis,
            "no_data_regions": total_gis - total_series,
        },
        "manifest": ingest.expected_manifest(),
    }


@router.post("/import")
def import_sources() -> dict:
    results = ingest.import_all(write_cache=True)
    return {
        "imported": list(results.keys()),
        "checks": {
            key: {
                "time_points": value["time_points"],
                "series_regions": value["region_columns"],
                "gis_regions": value["gis_features"],
                "zero_count": value["zero_count"],
                "nan_count": value["nan_count"],
                "all_expected_checks_passed": value["all_expected_checks_passed"],
                "failed_checks": [c for c in value["checks"] if not c["passed"]],
                "fingerprint_csv": value["fingerprint_csv"],
                "fingerprint_geojson": value["fingerprint_geojson"],
            }
            for key, value in results.items()
        },
    }


@router.get("/quality")
def quality(source_key: str = Query(...)) -> dict:
    source_row(source_key)
    report = quality_report(source_key)
    report.pop("series_stats", None)
    return report


@router.get("/regions")
def regions(source_key: str = Query(...), has_timeseries: bool | None = None) -> dict:
    source = source_row(source_key)
    rows = regions_for(source["source_id"], has_timeseries=has_timeseries)
    return {
        "source": {
            "source_id": source["source_id"],
            "key": source["key"],
            "display_name": source["display_name"],
            "unit_label": source["unit_label"],
            "native_frequency": source["native_frequency"],
        },
        "regions": rows,
        "counts": {
            "total": len(rows),
            "with_timeseries": sum(1 for r in rows if r["has_timeseries"]),
            "no_data": sum(1 for r in rows if not r["has_timeseries"]),
        },
        "valid_region_ids": valid_region_ids(source["key"]),
    }


@router.get("/geometry")
def geometry(source_key: str = Query(...)) -> dict:
    source = source_row(source_key)
    collection = geometry_collection(source["source_id"])
    collection["metadata"] = {
        "source_key": source["key"],
        "display_name": source["display_name"],
        "feature_count": len(collection["features"]),
        "no_data_regions": [
            r["region_id"] for r in regions_for(source["source_id"], has_timeseries=False)
        ],
    }
    return collection


@router.get("/series")
def series(
    source_key: str = Query(...),
    region_id: str = Query(...),
    frequency: str = Query("native"),
    aggregation: str = Query("mean"),
    start_index: int | None = None,
    window_points: int | None = None,
) -> dict:
    source = source_row(source_key)
    issues = validate_m1(
        {
            "source_key": source_key,
            "region_ids": [region_id],
            "frequency": frequency,
            "aggregation": aggregation,
            "start_index": start_index or 0,
            "window_points": window_points or 288,
        },
        available_regions=[r["region_id"] for r in regions_for(source["source_id"])],
    )
    raise_if_invalid(issues)
    data = resample(source_key, region_ids=[region_id], frequency=frequency, aggregation=aggregation)
    start = int(start_index or 0)
    points = int(window_points or data.timestamps.size)
    stop = min(start + points, data.timestamps.size)
    values = data.values[start:stop, 0]
    import pandas as pd

    index = pd.to_datetime(data.timestamps[start:stop], unit="s")
    return {
        "source_key": source_key,
        "region_id": region_id,
        "unit_label": source["unit_label"],
        "frequency": frequency,
        "aggregation": aggregation,
        "frequency_options": available_frequencies(int(source["native_frequency_minutes"])),
        "time_bounds": time_bounds(source_key),
        "timestamps": [str(t) for t in index.strftime("%Y-%m-%d %H:%M:%S")],
        "values": [None if not (v == v) else float(v) for v in values],
    }
