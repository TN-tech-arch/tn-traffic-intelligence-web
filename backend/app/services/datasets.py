"""Module 3 dataset construction: preview, atomic build, persistence, loading."""

from __future__ import annotations

import json
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from app.core.config import settings
from app.core.errors import Conflict, NotFound
from app.core.ids import dataset_id as make_dataset_id, now_utc, ulid
from app.db.connection import execute, get_connection, json_dumps, json_loads, query_all, query_one
from app.services import windows as win
from app.services.ingest import load_series, source_row
from app.services.series import resolve_frequency_minutes, resample, valid_region_ids


def dataset_dir(dataset_id: str) -> Path:
    return settings.artifacts_dir / "datasets" / dataset_id


def _pack_bits(flags: np.ndarray) -> bytes:
    if flags.size == 0:
        return b""
    return np.packbits(flags.astype(bool)).tobytes()


def _unpack_bits(blob: bytes, count: int) -> np.ndarray:
    if count == 0:
        return np.zeros(0, dtype=bool)
    data = np.frombuffer(blob, dtype=np.uint8)
    return np.unpackbits(data)[:count].astype(bool)


@dataclass
class DatasetBundle:
    """Everything a training/evaluation job needs, loaded from the artifact."""

    dataset: dict[str, Any]
    timestamps: np.ndarray
    region_ids: list[str]
    values: np.ndarray  # filled float32 [T, R]
    observed: np.ndarray  # bool [T, R]
    imputed_end: np.ndarray  # int32 [T, R]
    scalers: dict[str, dict[str, Any]]
    boundaries: list[list[int]]
    window_ranges: dict[str, dict[int, dict[str, Any]]]

    @property
    def L(self) -> int:
        return int(self.dataset["L"])

    @property
    def H(self) -> int:
        return int(self.dataset["H"])

    @property
    def S(self) -> int:
        return int(self.dataset["S"])

    def region_index(self, region_id: str) -> int:
        try:
            return self.region_ids.index(region_id)
        except ValueError as exc:
            raise NotFound(f"区域 {region_id} 不在数据集 {self.dataset['dataset_id']} 中") from exc

    def valid_starts(self, region_id: str, split: str) -> np.ndarray:
        entry = self.window_ranges[split][self.region_index(region_id)]
        low, high, step = entry["low"], entry["high"], entry["step"]
        if high < low:
            return np.empty(0, dtype="int64")
        candidates = np.arange(low, high + 1, step, dtype="int64")
        flags = _unpack_bits(bytes.fromhex(entry["bitmap"]), candidates.size)
        return candidates[flags]

    def split_slice(self, split: str) -> tuple[int, int]:
        index = win.SPLIT_NAMES.index(split)
        start, end = self.boundaries[index]
        return int(start), int(end)

    def window_matrices(self, region_id: str, split: str, *, scaled: bool = True):
        starts = self.valid_starts(region_id, split)
        column = self.values[:, self.region_index(region_id)]
        x, y = win.stack_windows(column, starts, self.L, self.H)
        scaler = self.scalers.get(region_id, {"method": "none"})
        if scaled:
            x_scaled = win.apply_scaler(x.astype("float64"), scaler).astype("float32")
            y_scaled = win.apply_scaler(y.astype("float64"), scaler).astype("float32")
        else:
            x_scaled, y_scaled = x, y
        return starts, x, y, x_scaled, y_scaled

    def target_timestamps(self, starts: np.ndarray) -> np.ndarray:
        if starts.size == 0:
            return np.empty((0, self.H), dtype="datetime64[s]")
        index = starts[:, None] + self.L + np.arange(self.H)[None, :]
        # Return a real datetime64 array: pd.to_datetime() would otherwise treat a
        # bare int64 array as nanoseconds since epoch.
        return self.timestamps[index].astype("datetime64[s]")


def _resolve_regions(payload: dict[str, Any], source: Any) -> list[str]:
    if payload["scope"] == "single":
        region_id = payload.get("region_id")
        if not region_id:
            raise Conflict("Single Region 必须指定 region_id", code="REGION_REQUIRED")
        row = query_one(
            "SELECT * FROM regions WHERE source_id = ? AND region_id = ?", (source["source_id"], region_id)
        )
        if row is None:
            raise NotFound(f"区域 {region_id} 不属于 {source['key']}")
        if not row["has_timeseries"]:
            raise Conflict(
                f"区域 {region_id} 没有时序数据（No Data），不能用于预测数据集构建",
                code="REGION_NO_TIMESERIES",
            )
        return [region_id]
    return valid_region_ids(source["key"])


def _compute(payload: dict[str, Any]) -> dict[str, Any]:
    source = source_row(payload["source_key"])
    region_ids = _resolve_regions(payload, source)
    if not region_ids:
        raise Conflict("该数据源没有可用时序区域", code="NO_VALID_REGION")
    native_minutes = int(source["native_frequency_minutes"])
    frequency_minutes = resolve_frequency_minutes(native_minutes, payload["frequency"])
    data = resample(
        source["key"],
        region_ids=region_ids,
        frequency=payload["frequency"],
        aggregation=payload["aggregation"],
        time_start=payload.get("time_start"),
        time_end=payload.get("time_end"),
    )
    pre = win.preprocess(data.values, payload["missing_mode"])
    total_points = data.timestamps.size
    ratios = (payload["train_ratio"], payload["val_ratio"], payload["test_ratio"])
    boundaries = win.split_boundaries(total_points, ratios)

    ranges: dict[str, dict[int, dict[str, Any]]] = {name: {} for name in win.SPLIT_NAMES}
    counts = {name: 0 for name in win.SPLIT_NAMES}
    candidate_counts = {name: 0 for name in win.SPLIT_NAMES}
    per_region: dict[str, Any] = {}
    L, H, S = payload["input_length"], payload["output_length"], payload["step"]
    for ridx, region_id in enumerate(data.region_ids):
        observed = pre.observed[:, ridx]
        imputed_end = pre.imputed_end[:, ridx]
        region_summary = {"train": 0, "validation": 0, "test": 0}
        for name, (start, end) in zip(win.SPLIT_NAMES, boundaries):
            low = max(0, start - L)
            high = end - H - L
            if high < low:
                ranges[name][ridx] = {"low": 0, "high": -1, "step": S, "bitmap": ""}
                region_summary[name] = 0
                continue
            candidates = np.arange(low, high + 1, S, dtype="int64")
            valid = win.validate_windows(observed, imputed_end, candidates, L, H)
            ranges[name][ridx] = {
                "low": int(low),
                "high": int(high),
                "step": int(S),
                "bitmap": _pack_bits(valid).hex(),
            }
            counts[name] += int(valid.sum())
            candidate_counts[name] += int(candidates.size)
            region_summary[name] = int(valid.sum())
        per_region[region_id] = region_summary

    scaler_specs: dict[str, dict[str, Any]] = {}
    if payload["scaling"] != "none":
        train_end = boundaries[0][1]
        for ridx, region_id in enumerate(data.region_ids):
            scaler_specs[region_id] = win.fit_scaler(
                pre.filled[:train_end, ridx], pre.observed[:train_end, ridx], payload["scaling"]
            )
    else:
        for region_id in data.region_ids:
            scaler_specs[region_id] = {"method": "none"}

    empty_splits = [name for name in win.SPLIT_NAMES if counts[name] == 0]
    return {
        "source": source,
        "region_ids": list(data.region_ids),
        "data": data,
        "pre": pre,
        "boundaries": boundaries,
        "ranges": ranges,
        "counts": counts,
        "candidate_counts": candidate_counts,
        "per_region": per_region,
        "scalers": scaler_specs,
        "empty_splits": empty_splits,
        "frequency_minutes": frequency_minutes,
    }


def preview_dataset(payload: dict[str, Any]) -> dict[str, Any]:
    """Full real computation without persisting anything (spec 13.1)."""
    computed = _compute(payload)
    data = computed["data"]
    pre = computed["pre"]
    boundaries = computed["boundaries"]
    L, H = payload["input_length"], payload["output_length"]
    first_region = computed["region_ids"][0]
    ridx = data.region_ids.index(first_region)

    sample_region = payload.get("preview_region_id") or first_region
    if sample_region not in computed["region_ids"]:
        sample_region = first_region
    sridx = data.region_ids.index(sample_region)
    starts_all = {
        name: _valid_starts_from(computed["ranges"][name][sridx], L, H)
        for name in win.SPLIT_NAMES
    }
    column = pre.filled[:, sridx]
    observed = pre.observed[:, sridx]

    def window_sample(starts: np.ndarray, limit: int = 1) -> list[dict[str, Any]]:
        out = []
        for start in starts[:limit]:
            x_start, x_end = int(start), int(start + L - 1)
            y_start, y_end = int(start + L), int(start + L + H - 1)
            out.append(
                {
                    "origin_index": int(start),
                    "input_start_at": _ts(data.timestamps, x_start),
                    "input_end_at": _ts(data.timestamps, x_end),
                    "target_start_at": _ts(data.timestamps, y_start),
                    "target_end_at": _ts(data.timestamps, y_end),
                    "X": [None if not observed[i] else float(column[i]) for i in range(x_start, x_end + 1)],
                    "Y": [None if not observed[i] else float(column[i]) for i in range(y_start, y_end + 1)],
                    "imputed_input_positions": [
                        i for i in range(x_start, x_end + 1) if pre.imputed_end[i, sridx] >= 0
                    ],
                }
            )
        return out

    sample = window_sample(starts_all["test"], 2) or window_sample(starts_all["validation"], 2) or \
        window_sample(starts_all["train"], 2)

    return {
        "source": {
            "source_id": computed["source"]["source_id"],
            "key": computed["source"]["key"],
            "display_name": computed["source"]["display_name"],
            "unit_label": computed["source"]["unit_label"],
        },
        "scope": payload["scope"],
        "region_ids": computed["region_ids"],
        "region_count": len(computed["region_ids"]),
        "frequency": payload["frequency"],
        "frequency_minutes": computed["frequency_minutes"],
        "aggregation": payload["aggregation"],
        "time_points": int(data.timestamps.size),
        "time_start": _ts(data.timestamps, 0),
        "time_end": _ts(data.timestamps, int(data.timestamps.size) - 1),
        "L": L,
        "H": H,
        "S": payload["step"],
        "split_boundaries": [
            {
                "split": name,
                "start_index": int(b[0]),
                "end_index": int(b[1]),
                "start_at": _ts(data.timestamps, int(b[0])) if b[1] > b[0] else None,
                "end_at": _ts(data.timestamps, int(b[1]) - 1) if b[1] > b[0] else None,
                "window_count": int(computed["counts"][name]),
                "candidate_windows": int(computed["candidate_counts"][name]),
            }
            for name, b in zip(win.SPLIT_NAMES, boundaries)
        ],
        "window_counts": {k: int(v) for k, v in computed["counts"].items()},
        "window_counts_per_region": computed["per_region"],
        "empty_splits": computed["empty_splits"],
        "missing": {
            "mode": pre.strategy,
            "imputed_points": pre.imputed_points,
            "missing_points_before": int((~pre.observed).sum()),
            "zero_points_preserved": int((np.nan_to_num(pre.filled, nan=0.0) == 0).sum()),
        },
        "scaling": payload["scaling"],
        "scaler_sample": computed["scalers"].get(sample_region),
        "preview_region_id": sample_region,
        "preview_windows": sample,
        "series_preview": {
            "region_id": sample_region,
            "timestamps": [_ts(data.timestamps, i) for i in range(0, int(data.timestamps.size), max(1, data.timestamps.size // 240))],
            "values": [float(v) if np.isfinite(v) else None
                       for v in pre.filled[:: max(1, data.timestamps.size // 240), sridx]],
        },
        "window_counts_by_split": {k: int(v) for k, v in computed["counts"].items()},
    }


def _valid_starts_from(entry: dict[str, Any], L: int, H: int) -> np.ndarray:
    if entry["high"] < entry["low"]:
        return np.empty(0, dtype="int64")
    candidates = np.arange(entry["low"], entry["high"] + 1, entry["step"], dtype="int64")
    flags = _unpack_bits(bytes.fromhex(entry["bitmap"]), candidates.size)
    return candidates[flags]


def _ts(timestamps: np.ndarray, index: int) -> str:
    import pandas as pd

    if index < 0 or index >= timestamps.size:
        return ""
    return pd.Timestamp(int(timestamps[index]), unit="s").isoformat(sep=" ")


def create_dataset(payload: dict[str, Any]) -> dict[str, Any]:
    """Atomic build: compute into a temp dir, then commit files + metadata."""
    computed = _compute(payload)
    if computed["empty_splits"]:
        raise Conflict(
            "构建后以下集合没有任何合法窗口: " + ", ".join(computed["empty_splits"]),
            code="EMPTY_SPLIT",
        )
    new_id = make_dataset_id(computed["source"]["key"], payload["scope"])
    target_dir = dataset_dir(new_id)
    tmp_dir = Path(tempfile.mkdtemp(prefix=f".build-{ulid()[:8]}-", dir=str(settings.artifacts_dir)))
    data = computed["data"]
    pre = computed["pre"]
    try:
        bitmap_bytes = {
            f"bitmap_{name}": np.frombuffer(
                b"".join(bytes.fromhex(computed["ranges"][name][i]["bitmap"]) for i in range(len(data.region_ids))),
                dtype=np.uint8,
            )
            for name in win.SPLIT_NAMES
        }
        np.savez_compressed(
            tmp_dir / "series.npz",
            timestamps=data.timestamps.astype("int64"),
            region_ids=np.array(data.region_ids, dtype=str),
            values=pre.filled.astype("float32"),
            observed=pre.observed.astype("uint8"),
            imputed_end=pre.imputed_end.astype("int32"),
            **bitmap_bytes,
        )
        meta = {
            "dataset_id": new_id,
            "source_key": computed["source"]["key"],
            "source_fingerprint": computed["source"]["fingerprint"],
            "scope": payload["scope"],
            "region_ids": computed["region_ids"],
            "frequency": payload["frequency"],
            "frequency_minutes": computed["frequency_minutes"],
            "aggregation": payload["aggregation"],
            "L": payload["input_length"],
            "H": payload["output_length"],
            "S": payload["step"],
            "ratios": {
                "train": payload["train_ratio"],
                "validation": payload["val_ratio"],
                "test": payload["test_ratio"],
            },
            "boundaries": computed["boundaries"],
            "missing_mode": payload["missing_mode"],
            "scaling": payload["scaling"],
            "scalers": computed["scalers"],
            "window_ranges": {
                name: {
                    str(i): {
                        "low": computed["ranges"][name][i]["low"],
                        "high": computed["ranges"][name][i]["high"],
                        "step": computed["ranges"][name][i]["step"],
                        "bitmap_hex": computed["ranges"][name][i]["bitmap"],
                    }
                    for i in range(len(data.region_ids))
                }
                for name in win.SPLIT_NAMES
            },
            "window_counts": computed["counts"],
            "time_basis": data.frequency,
        }
        (tmp_dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
        target_dir.parent.mkdir(parents=True, exist_ok=True)
        if target_dir.exists():
            shutil.rmtree(target_dir)
        tmp_dir.rename(target_dir)
    except Exception:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise

    quality = {
        "missing_mode": payload["missing_mode"],
        "imputed_points": pre.imputed_points,
        "missing_points_before": int((~pre.observed).sum()),
        "zero_values_kept": int((np.nan_to_num(pre.filled, nan=1e30) == 0).sum()),
        "time_points": int(data.timestamps.size),
        "regions": len(data.region_ids),
        "candidate_windows": {k: int(v) for k, v in computed["candidate_counts"].items()},
        "valid_windows": {k: int(v) for k, v in computed["counts"].items()},
        "leakage_check": "targets confined to a single split; imputed inputs never reference a value observed after the forecast origin",
    }
    split_json = [
        {
            "split": name,
            "start_index": int(b[0]),
            "end_index": int(b[1]),
            "start_at": _ts(data.timestamps, int(b[0])) if b[1] > b[0] else None,
            "end_at": _ts(data.timestamps, int(b[1]) - 1) if b[1] > b[0] else None,
            "window_count": int(computed["counts"][name]),
        }
        for name, b in zip(win.SPLIT_NAMES, computed["boundaries"])
    ]
    digest_source = json.dumps(
        {
            "fingerprint": computed["source"]["fingerprint"],
            "region_ids": computed["region_ids"],
            "L": payload["input_length"],
            "H": payload["output_length"],
            "S": payload["step"],
            "frequency": payload["frequency"],
            "aggregation": payload["aggregation"],
            "ratios": [payload["train_ratio"], payload["val_ratio"], payload["test_ratio"]],
            "missing_mode": payload["missing_mode"],
            "scaling": payload["scaling"],
        },
        sort_keys=True,
        ensure_ascii=False,
    )
    import hashlib

    dataset_hash = hashlib.sha256(digest_source.encode("utf-8")).hexdigest()
    conn = get_connection()
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute(
            """
            INSERT INTO dataset_versions (
                dataset_id, source_id, label, scope, region_ids_json, frequency, frequency_minutes,
                aggregation, input_length, output_length, step, train_ratio, val_ratio, test_ratio,
                split_boundaries_json, preprocess_json, scaler_ref, artifact_ref, window_counts_json,
                region_window_summary_json, quality_json, status, hash, created_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                new_id,
                computed["source"]["source_id"],
                payload.get("label") or f"{computed['source']['display_name']} {payload['scope']}",
                payload["scope"],
                json_dumps(computed["region_ids"]),
                payload["frequency"],
                computed["frequency_minutes"],
                payload["aggregation"],
                payload["input_length"],
                payload["output_length"],
                payload["step"],
                payload["train_ratio"],
                payload["val_ratio"],
                payload["test_ratio"],
                json_dumps(split_json),
                json_dumps(
                    {
                        "missing_mode": payload["missing_mode"],
                        "scaling": payload["scaling"],
                        "time_basis": data.frequency,
                        "aggregation": payload["aggregation"],
                    }
                ),
                str(target_dir / "meta.json"),
                str(target_dir),
                json_dumps({k: int(v) for k, v in computed["counts"].items()}),
                json_dumps(computed["per_region"]),
                json_dumps(quality),
                "Built",
                dataset_hash,
                now_utc(),
            ),
        )
    except Exception:
        conn.execute("ROLLBACK")
        shutil.rmtree(target_dir, ignore_errors=True)
        raise
    else:
        conn.execute("COMMIT")
    return get_dataset(new_id)


def dataset_row(dataset_id: str):
    row = query_one("SELECT * FROM dataset_versions WHERE dataset_id = ?", (dataset_id,))
    if row is None:
        raise NotFound(f"Dataset {dataset_id} 不存在", code="DATASET_NOT_FOUND")
    return row


def dataset_summary(row) -> dict[str, Any]:
    source = query_one("SELECT * FROM data_sources WHERE source_id = ?", (row["source_id"],))
    boundaries = json_loads(row["split_boundaries_json"])
    return {
        "dataset_id": row["dataset_id"],
        "label": row["label"],
        "source_id": row["source_id"],
        "source_key": source["key"] if source else None,
        "source_display_name": source["display_name"] if source else None,
        "unit_label": source["unit_label"] if source else None,
        "scope": row["scope"],
        "region_ids": json_loads(row["region_ids_json"]),
        "region_count": len(json_loads(row["region_ids_json"])),
        "frequency": row["frequency"],
        "frequency_minutes": row["frequency_minutes"],
        "aggregation": row["aggregation"],
        "L": row["input_length"],
        "H": row["output_length"],
        "S": row["step"],
        "ratios": {"train": row["train_ratio"], "validation": row["val_ratio"], "test": row["test_ratio"]},
        "split_boundaries": boundaries,
        "preprocess": json_loads(row["preprocess_json"]),
        "window_counts": json_loads(row["window_counts_json"]),
        "quality": json_loads(row["quality_json"]),
        "status": row["status"],
        "hash": row["hash"],
        "created_at": row["created_at"],
        "is_referenced": bool(row["is_referenced"]) or _is_referenced(row["dataset_id"]),
        "artifact_ref": row["artifact_ref"],
    }


def _is_referenced(dataset_id: str) -> bool:
    row = query_one(
        "SELECT COUNT(*) AS n FROM experiments WHERE dataset_id = ?", (dataset_id,)
    )
    if row and row["n"]:
        return True
    row = query_one("SELECT COUNT(*) AS n FROM evaluations WHERE dataset_id = ?", (dataset_id,))
    return bool(row and row["n"])


def get_dataset(dataset_id: str) -> dict[str, Any]:
    return dataset_summary(dataset_row(dataset_id))


def list_datasets(*, include_archived: bool = False) -> list[dict[str, Any]]:
    sql = "SELECT * FROM dataset_versions"
    if not include_archived:
        sql += " WHERE status != 'Archived'"
    sql += " ORDER BY created_at DESC"
    return [dataset_summary(row) for row in query_all(sql)]


def archive_dataset(dataset_id: str, *, archived: bool = True) -> dict[str, Any]:
    dataset_row(dataset_id)
    execute(
        "UPDATE dataset_versions SET status = ? WHERE dataset_id = ?",
        ("Archived" if archived else "Built", dataset_id),
    )
    return get_dataset(dataset_id)


def delete_dataset(dataset_id: str) -> dict[str, Any]:
    row = dataset_row(dataset_id)
    if _is_referenced(dataset_id):
        raise Conflict(
            f"Dataset {dataset_id} 已被 Experiment / Evaluation 引用，只能 Archive，不能删除",
            code="DATASET_REFERENCED",
        )
    conn = get_connection()
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute("DELETE FROM dataset_versions WHERE dataset_id = ?", (dataset_id,))
    except Exception:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")
    target = Path(row["artifact_ref"])
    root = settings.artifacts_dir.resolve()
    try:
        resolved = target.resolve()
        if root in resolved.parents and resolved.exists():
            shutil.rmtree(resolved)
    except OSError:
        pass
    return {"dataset_id": dataset_id, "deleted": True}


def load_dataset(dataset_id: str) -> DatasetBundle:
    row = dataset_row(dataset_id)
    meta = json.loads((Path(row["artifact_ref"]) / "meta.json").read_text(encoding="utf-8"))
    with np.load(Path(row["artifact_ref"]) / "series.npz", allow_pickle=False) as npz:
        timestamps = npz["timestamps"].astype("int64")
        values = npz["values"].astype("float32")
        observed = npz["observed"].astype(bool)
        imputed_end = npz["imputed_end"].astype("int32")
        region_ids = [str(x) for x in npz["region_ids"].tolist()]
        bitmaps = {}
        for name in win.SPLIT_NAMES:
            blob = npz[f"bitmap_{name}"].tobytes()
            bitmaps[name] = blob
    ranges: dict[str, dict[int, dict[str, Any]]] = {name: {} for name in win.SPLIT_NAMES}
    per_split_size = {name: [] for name in win.SPLIT_NAMES}
    for name in win.SPLIT_NAMES:
        for i in range(len(region_ids)):
            entry = meta["window_ranges"][name][str(i)]
            ranges[name][i] = {
                "low": entry["low"],
                "high": entry["high"],
                "step": entry["step"],
                "bitmap": entry["bitmap_hex"],
            }
            count = 0 if entry["high"] < entry["low"] else (entry["high"] - entry["low"]) // entry["step"] + 1
            per_split_size[name].append(count)
    return DatasetBundle(
        dataset=dataset_summary(row),
        timestamps=timestamps,
        region_ids=region_ids,
        values=values,
        observed=observed,
        imputed_end=imputed_end,
        scalers=meta["scalers"],
        boundaries=meta["boundaries"],
        window_ranges=ranges,
    )
