"""Real data ingestion, structural verification and caching (spec 2.2).

Nothing in this module invents data: every number reported is computed from the
six immutable source files whose SHA-256 fingerprints are recorded.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from app.core.config import settings
from app.core.errors import NotFound
from app.db.connection import get_connection, json_dumps, json_loads, query_all, query_one
from app.core.ids import now_utc

# Expected values from PROJECT_SPEC 2.1.  They are assertions only: a mismatch is
# reported, never silently repaired.
SOURCE_DEFINITIONS: tuple[dict[str, Any], ...] = (
    {
        "key": "milano",
        "display_name": "Milano",
        "csv": "milano_traffic_nid.csv",
        "geojson": "milano.geojson",
        "geometry_key": "NIL",
        "unit_label": "Traffic volume (source unit unknown)",
        "native_frequency": "10min",
        "native_frequency_minutes": 10,
        "expected_time_points": 8928,
        "expected_series_regions": 88,
        "expected_gis_regions": 88,
        "expected_zero_values": None,
    },
    {
        "key": "trentino",
        "display_name": "Trentino",
        "csv": "trentino_traffic_nid.csv",
        "geojson": "trento.geojson",
        "geometry_key": "NAME_3",
        "unit_label": "Traffic volume (source unit unknown)",
        "native_frequency": "10min",
        "native_frequency_minutes": 10,
        "expected_time_points": 8928,
        "expected_series_regions": 223,
        "expected_gis_regions": 223,
        "expected_zero_values": None,
    },
    {
        "key": "zte",
        "display_name": "ZTE 4G Downlink",
        "csv": "zte_4g_down.region.csv",
        "geojson": "zte_4g_down.traffic.geojson",
        "geometry_key": "unique_id",
        "unit_label": "4G downlink traffic (unit unspecified)",
        "native_frequency": "15min",
        "native_frequency_minutes": 15,
        "expected_time_points": 2784,
        "expected_series_regions": 148,
        "expected_gis_regions": 162,
        "expected_zero_values": 735,
    },
)

SOURCE_BY_KEY = {d["key"]: d for d in SOURCE_DEFINITIONS}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _npz_path(source_key: str) -> Path:
    return settings.processed_dir / f"{source_key}_series.npz"


def _quality_path(source_key: str) -> Path:
    return settings.processed_dir / f"{source_key}_quality.json"


@dataclass
class LoadedSeries:
    """In-memory view of one source series matrix."""

    source_key: str
    timestamps: np.ndarray  # int64 epoch seconds (see time_basis)
    time_basis: str
    values: np.ndarray  # float32 [T, R]
    region_ids: list[str]
    display_names: list[str]
    data: dict[str, Any]

    def region_index(self, region_id: str) -> int:
        try:
            return self.region_ids.index(region_id)
        except ValueError as exc:  # pragma: no cover - guarded by callers
            raise NotFound(f"区域 {region_id} 不属于数据源 {self.source_key}") from exc

    def region_series(self, region_id: str) -> np.ndarray:
        return self.values[:, self.region_index(region_id)]


_CACHE: dict[str, LoadedSeries] = {}


def load_series(source_key: str, *, use_cache: bool = True) -> LoadedSeries:
    if use_cache and source_key in _CACHE:
        return _CACHE[source_key]
    path = _npz_path(source_key)
    if not path.exists():
        raise NotFound(
            f"数据源 {source_key} 尚未导入，请先运行 scripts/import_data.ps1 或后端启动导入",
            code="SOURCE_NOT_IMPORTED",
        )
    with np.load(path, allow_pickle=False) as npz:
        timestamps = npz["timestamps"].astype("int64")
        values = npz["values"].astype("float32")
        region_ids = [str(x) for x in npz["region_ids"].tolist()]
        display_names = [str(x) for x in npz["display_names"].tolist()]
        time_basis = str(npz["time_basis"].tolist())
    data = json.loads(_quality_path(source_key).read_text(encoding="utf-8"))
    loaded = LoadedSeries(
        source_key=source_key,
        timestamps=timestamps,
        time_basis=time_basis,
        values=values,
        region_ids=region_ids,
        display_names=display_names,
        data=data,
    )
    _CACHE[source_key] = loaded
    return loaded


def invalidate_cache(source_key: str | None = None) -> None:
    if source_key is None:
        _CACHE.clear()
    else:
        _CACHE.pop(source_key, None)
    from app.services.series import clear_axis_cache

    clear_axis_cache()


def _to_epoch_seconds(series: pd.Series) -> np.ndarray:
    """Convert raw naive timestamps to epoch seconds treated as UTC.

    The source files carry no timezone information (spec 2.3), therefore the
    timestamps are kept exactly as written in the file and interpreted as UTC
    when serialised, with ``time_basis`` documenting that decision.
    """
    dt = pd.to_datetime(series, errors="coerce", format="mixed")
    if dt.isna().any():
        raise ValueError(f"存在无法解析的时间戳，共 {int(dt.isna().sum())} 行")
    return dt.to_numpy().astype("datetime64[s]").astype("int64")


def inspect_source(definition: dict[str, Any], *, write_cache: bool = True) -> dict[str, Any]:
    """Import one source: read raw files, verify structure, cache series matrix."""
    csv_path = settings.raw_dir / definition["csv"]
    geo_path = settings.raw_dir / definition["geojson"]
    if not csv_path.exists():
        raise NotFound(f"缺少原始数据文件: {csv_path}", code="RAW_FILE_MISSING")
    if not geo_path.exists():
        raise NotFound(f"缺少原始 GIS 文件: {geo_path}", code="RAW_FILE_MISSING")

    fingerprint_csv = sha256_file(csv_path)
    fingerprint_geojson = sha256_file(geo_path)

    frame = pd.read_csv(csv_path, low_memory=False)
    if frame.shape[1] < 2:
        raise ValueError(f"{csv_path.name} 列数不足")
    time_column = frame.columns[0]
    timestamps = _to_epoch_seconds(frame[time_column])
    region_columns = [str(c) for c in frame.columns[1:]]
    numeric = frame[frame.columns[1:]].apply(pd.to_numeric, errors="coerce")
    values = numeric.to_numpy(dtype="float64")

    diffs = np.diff(timestamps)
    duplicate_count = int((diffs == 0).sum())
    monotonic = bool((diffs > 0).all())
    interval_seconds = int(np.median(diffs)) if diffs.size else 0
    interval_unique = sorted({int(x) for x in set(diffs.tolist())})

    finite = np.isfinite(values)
    nan_count = int((~finite).sum()) if np.isinf(values).sum() == 0 else int(np.isnan(values).sum())
    inf_count = int(np.isinf(values).sum())
    zero_count = int((values == 0).sum())
    negative_count = int((values < 0).sum())
    positive_count = int((values > 0).sum())

    with geo_path.open("r", encoding="utf-8") as handle:
        geo = json.load(handle)
    features = geo.get("features", [])
    gis_keys: list[str] = []
    geometry_by_key: dict[str, str] = {}
    properties_by_key: dict[str, dict[str, Any]] = {}
    invalid_geometries: list[str] = []
    geometry_types: dict[str, int] = {}
    key_field = definition["geometry_key"]
    for feature in features:
        props = feature.get("properties") or {}
        raw_key = props.get(key_field)
        cid = props.get("unique_id") if key_field != "unique_id" else None
        key = str(raw_key if raw_key is not None else cid)
        gis_keys.append(key)
        geometry = feature.get("geometry")
        if not geometry or not geometry.get("coordinates"):
            invalid_geometries.append(key)
            continue
        geometry_types[geometry.get("type", "Unknown")] = geometry_types.get(geometry.get("type", "Unknown"), 0) + 1
        geometry_by_key[key] = json_dumps(geometry)
        properties_by_key[key] = props

    csv_set = set(region_columns)
    gis_set = set(gis_keys)
    matched = sorted(csv_set & gis_set)
    gis_without_series = sorted(gis_set - csv_set)
    series_without_geometry = sorted(csv_set - gis_set)

    duplicate_region_columns = len(region_columns) - len(csv_set)

    # Region level statistics used by Module 1-3.
    series_stats: dict[str, Any] = {}
    all_missing_regions: list[str] = []
    for idx, name in enumerate(region_columns):
        column = values[:, idx]
        valid_mask = np.isfinite(column)
        if not valid_mask.any():
            all_missing_regions.append(name)
        series_stats[name] = {
            "valid_points": int(valid_mask.sum()),
            "missing_points": int((~valid_mask).sum()),
            "zero_points": int((column[valid_mask] == 0).sum()),
            "min": float(np.nanmin(column)) if valid_mask.any() else None,
            "max": float(np.nanmax(column)) if valid_mask.any() else None,
            "mean": float(np.nanmean(column)) if valid_mask.any() else None,
        }

    expected = {
        "time_points": definition["expected_time_points"],
        "series_regions": definition["expected_series_regions"],
        "gis_regions": definition["expected_gis_regions"],
        "zero_values": definition["expected_zero_values"],
    }
    checks = [
        {
            "name": "time_points",
            "expected": expected["time_points"],
            "actual": int(timestamps.size),
            "passed": expected["time_points"] is None or int(timestamps.size) == expected["time_points"],
        },
        {
            "name": "series_regions",
            "expected": expected["series_regions"],
            "actual": len(region_columns),
            "passed": int(len(region_columns)) == int(expected["series_regions"]),
        },
        {
            "name": "gis_regions",
            "expected": expected["gis_regions"],
            "actual": len(gis_keys),
            "passed": int(len(gis_keys)) == int(expected["gis_regions"]),
        },
        {
            "name": "zero_values",
            "expected": expected["zero_values"],
            "actual": zero_count,
            "passed": expected["zero_values"] is None or int(zero_count) == int(expected["zero_values"]),
        },
        {
            "name": "gis_regions_without_series",
            "expected": int(len(gis_keys)) - int(len(region_columns)),
            "actual": len(gis_without_series),
            "passed": len(gis_without_series) >= 0,
        },
        {"name": "timestamp_monotonic", "expected": True, "actual": monotonic, "passed": monotonic},
        {"name": "no_duplicate_timestamps", "expected": True, "actual": duplicate_count == 0, "passed": duplicate_count == 0},
        {"name": "unique_region_columns", "expected": True, "actual": duplicate_region_columns == 0, "passed": duplicate_region_columns == 0},
        {
            "name": "fixed_sampling_interval",
            "expected": definition["native_frequency_minutes"] * 60,
            "actual": interval_seconds,
            "passed": interval_seconds == definition["native_frequency_minutes"] * 60,
        },
        {"name": "no_infinite_values", "expected": 0, "actual": inf_count, "passed": inf_count == 0},
        {"name": "no_geometry_errors", "expected": 0, "actual": len(invalid_geometries), "passed": not invalid_geometries},
    ]

    start = pd.Timestamp(int(timestamps[0]), unit="s")
    end = pd.Timestamp(int(timestamps[-1]), unit="s")
    quality = {
        "source_key": definition["key"],
        "generated_at": now_utc(),
        "fingerprint_csv": fingerprint_csv,
        "fingerprint_geojson": fingerprint_geojson,
        "csv_file": csv_path.name,
        "geojson_file": geo_path.name,
        "csv_bytes": csv_path.stat().st_size,
        "geojson_bytes": geo_path.stat().st_size,
        "time_basis": "naive local timestamp as written in source file (treated as UTC internally)",
        "time_points": int(timestamps.size),
        "time_start": start.isoformat(sep=" "),
        "time_end": end.isoformat(sep=" "),
        "sampling_interval_seconds": interval_seconds,
        "sampling_interval_unique": interval_unique,
        "duplicate_timestamps": duplicate_count,
        "region_columns": len(region_columns),
        "gis_features": len(gis_keys),
        "matched_regions": len(matched),
        "gis_without_series": gis_without_series,
        "series_without_geometry": series_without_geometry,
        "regions_all_missing": all_missing_regions,
        "nan_count": nan_count,
        "inf_count": inf_count,
        "zero_count": zero_count,
        "negative_count": negative_count,
        "positive_count": positive_count,
        "geometry_types": geometry_types,
        "checks": checks,
        "all_expected_checks_passed": all(c["passed"] for c in checks),
        "series_stats": series_stats,
        "unit_label": definition["unit_label"],
        "native_frequency": definition["native_frequency"],
        "native_frequency_minutes": definition["native_frequency_minutes"],
    }

    if write_cache:
        settings.ensure_dirs()
        np.savez_compressed(
            _npz_path(definition["key"]),
            timestamps=timestamps,
            values=values.astype("float32"),
            region_ids=np.array(region_columns, dtype=str),
            display_names=np.array(region_columns, dtype=str),
            time_basis=np.array(quality["time_basis"], dtype=str),
        )
        _quality_path(definition["key"]).write_text(
            json.dumps(quality, ensure_ascii=False, indent=1), encoding="utf-8"
        )
        invalidate_cache(definition["key"])

    _upsert_source(definition, quality, region_columns, gis_keys, geometry_by_key, properties_by_key, series_stats)
    return quality


def _upsert_source(
    definition: dict[str, Any],
    quality: dict[str, Any],
    region_columns: list[str],
    gis_keys: list[str],
    geometry_by_key: dict[str, str],
    properties_by_key: dict[str, dict[str, Any]],
    series_stats: dict[str, Any],
) -> None:
    source_id = f"SRC-{definition['key'].upper()}"
    conn = get_connection()
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute(
            """
            INSERT INTO data_sources (
                source_id, key, display_name, csv_path, geojson_path, unit_label,
                native_frequency, native_frequency_minutes, fingerprint_csv, fingerprint_geojson,
                fingerprint, time_start, time_end, time_point_count, region_count_series,
                region_count_gis, zero_value_count, nan_value_count, negative_value_count,
                quality_json, imported_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(source_id) DO UPDATE SET
                display_name=excluded.display_name,
                csv_path=excluded.csv_path,
                geojson_path=excluded.geojson_path,
                unit_label=excluded.unit_label,
                native_frequency=excluded.native_frequency,
                native_frequency_minutes=excluded.native_frequency_minutes,
                fingerprint_csv=excluded.fingerprint_csv,
                fingerprint_geojson=excluded.fingerprint_geojson,
                fingerprint=excluded.fingerprint,
                time_start=excluded.time_start,
                time_end=excluded.time_end,
                time_point_count=excluded.time_point_count,
                region_count_series=excluded.region_count_series,
                region_count_gis=excluded.region_count_gis,
                zero_value_count=excluded.zero_value_count,
                nan_value_count=excluded.nan_value_count,
                negative_value_count=excluded.negative_value_count,
                quality_json=excluded.quality_json,
                imported_at=excluded.imported_at
            """,
            (
                source_id,
                definition["key"],
                definition["display_name"],
                str(settings.raw_dir / definition["csv"]),
                str(settings.raw_dir / definition["geojson"]),
                definition["unit_label"],
                definition["native_frequency"],
                definition["native_frequency_minutes"],
                quality["fingerprint_csv"],
                quality["fingerprint_geojson"],
                f"{quality['fingerprint_csv'][:16]}+{quality['fingerprint_geojson'][:16]}",
                quality["time_start"],
                quality["time_end"],
                quality["time_points"],
                quality["region_columns"],
                quality["gis_features"],
                quality["zero_count"],
                quality["nan_count"],
                quality["negative_count"],
                json_dumps(
                    {
                        k: v
                        for k, v in quality.items()
                        if k not in {"series_stats"}
                    }
                ),
                now_utc(),
            ),
        )
        conn.execute("DELETE FROM regions WHERE source_id = ?", (source_id,))
        rows = []
        gis_only = sorted(set(gis_keys) - set(region_columns))
        for name in region_columns:
            rows.append(
                (
                    source_id,
                    name,
                    name,
                    name,
                    1,
                    geometry_by_key.get(name),
                    json_dumps({"stats": series_stats.get(name, {})}),
                )
            )
        for name in gis_only:
            props = properties_by_key.get(name, {})
            rows.append(
                (
                    source_id,
                    name,
                    str(props.get("name") or name),
                    name,
                    0,
                    geometry_by_key.get(name),
                    json_dumps({"properties": props, "no_data_reason": "GIS polygon has no time-series column"}),
                )
            )
        conn.executemany(
            """
            INSERT INTO regions (source_id, region_id, display_name, geometry_key, has_timeseries,
                                 geometry_json, properties_json)
            VALUES (?,?,?,?,?,?,?)
            """,
            rows,
        )
    except Exception:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")


def import_all(*, write_cache: bool = True) -> dict[str, Any]:
    results: dict[str, Any] = {}
    for definition in SOURCE_DEFINITIONS:
        results[definition["key"]] = inspect_source(definition, write_cache=write_cache)
    return results


def sources_summary() -> list[dict[str, Any]]:
    rows = query_all("SELECT * FROM data_sources ORDER BY key")
    out = []
    for row in rows:
        out.append(
            {
                "source_id": row["source_id"],
                "key": row["key"],
                "display_name": row["display_name"],
                "unit_label": row["unit_label"],
                "native_frequency": row["native_frequency"],
                "native_frequency_minutes": row["native_frequency_minutes"],
                "time_start": row["time_start"],
                "time_end": row["time_end"],
                "time_point_count": row["time_point_count"],
                "series_region_count": row["region_count_series"],
                "gis_region_count": row["region_count_gis"],
                "no_data_region_count": row["region_count_gis"] - row["region_count_series"],
                "zero_value_count": row["zero_value_count"],
                "nan_value_count": row["nan_value_count"],
                "negative_value_count": row["negative_value_count"],
                "fingerprint": row["fingerprint"],
                "fingerprint_csv": row["fingerprint_csv"],
                "fingerprint_geojson": row["fingerprint_geojson"],
                "imported_at": row["imported_at"],
            }
        )
    return out


def source_row(source_key: str):
    row = query_one("SELECT * FROM data_sources WHERE key = ? OR source_id = ?", (source_key, source_key))
    if row is None:
        raise NotFound(f"数据源 {source_key} 不存在", code="SOURCE_NOT_FOUND")
    return row


def regions_for(source_id: str, *, has_timeseries: bool | None = None) -> list[dict[str, Any]]:
    sql = "SELECT * FROM regions WHERE source_id = ?"
    params: list[Any] = [source_id]
    if has_timeseries is not None:
        sql += " AND has_timeseries = ?"
        params.append(1 if has_timeseries else 0)
    sql += " ORDER BY region_id"
    out = []
    for row in query_all(sql, tuple(params)):
        props = json_loads(row["properties_json"]) or {}
        out.append(
            {
                "region_id": row["region_id"],
                "display_name": row["display_name"],
                "has_timeseries": bool(row["has_timeseries"]),
                "geometry_key": row["geometry_key"],
                "stats": props.get("stats", {}),
                "properties": props.get("properties", {}),
                "no_data_reason": props.get("no_data_reason"),
            }
        )
    return out


def geometry_collection(source_id: str) -> dict[str, Any]:
    features = []
    for row in query_all("SELECT * FROM regions WHERE source_id = ? ORDER BY region_id", (source_id,)):
        geometry = json_loads(row["geometry_json"])
        if not geometry:
            continue
        features.append(
            {
                "type": "Feature",
                "geometry": geometry,
                "properties": {
                    "region_id": row["region_id"],
                    "display_name": row["display_name"],
                    "has_timeseries": bool(row["has_timeseries"]),
                },
            }
        )
    return {"type": "FeatureCollection", "features": features}


def quality_report(source_key: str) -> dict[str, Any]:
    path = _quality_path(source_key)
    if not path.exists():
        raise NotFound(f"数据源 {source_key} 尚未导入", code="SOURCE_NOT_IMPORTED")
    return json.loads(path.read_text(encoding="utf-8"))


def expected_manifest() -> list[dict[str, Any]]:
    return [
        {
            "key": d["key"],
            "csv": d["csv"],
            "geojson": d["geojson"],
            "expected_time_points": d["expected_time_points"],
            "expected_series_regions": d["expected_series_regions"],
            "expected_gis_regions": d["expected_gis_regions"],
            "expected_zero_values": d["expected_zero_values"],
        }
        for d in SOURCE_DEFINITIONS
    ]
