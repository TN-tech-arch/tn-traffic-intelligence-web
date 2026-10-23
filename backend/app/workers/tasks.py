"""Real task implementations executed by the durable worker process."""

from __future__ import annotations

import json
import platform
import sys
import time
import traceback
from pathlib import Path
from typing import Any

import numpy as np

from app.core.config import settings
from app.core.errors import NotFound
from app.core.ids import now_utc
from app.db.connection import get_connection, json_dumps, json_loads, query_all, query_one
from app.forecast.adapters import build_adapter
from app.forecast.base import CancelledError, RegionContext, WindowBatch
from app.forecast.registry import MODEL_BY_KEY, default_params
from app.services.artifacts import ensure_dir
from app.services.clustering import run_clustering  # re-exported for the worker loop
from app.services.datasets import load_dataset
from app.services.metrics import all_metrics, macro_average


class ProgressReporter:
    """Buffers progress into the DB so any browser can observe real state."""

    def __init__(
        self,
        job_id: str,
        experiment_id: str | None = None,
        evaluation_id: str | None = None,
    ) -> None:
        self.job_id = job_id
        self.experiment_id = experiment_id
        self.evaluation_id = evaluation_id
        self.last_write = 0.0
        self.payload: dict[str, Any] = {}

    def __call__(self, stage: str, percent: float, message: str, extra: dict[str, Any] | None = None) -> None:
        self.payload = {
            "stage": stage,
            "percent": round(float(percent), 3),
            "message": message,
            "updated_at": now_utc(),
        }
        if extra:
            self.payload.update(extra)
        now = time.time()
        if now - self.last_write < 1.0 and percent < 100:
            return
        self.last_write = now
        self.flush()

    def flush(self) -> None:
        try:
            execute = get_connection().execute
            execute(
                "UPDATE jobs SET progress_json = ?, heartbeat_at = ? WHERE job_id = ?",
                (json_dumps(self.payload), now_utc(), self.job_id),
            )
            if self.experiment_id:
                execute(
                    "UPDATE experiments SET progress_json = ? WHERE experiment_id = ?",
                    (json_dumps(self.payload), self.experiment_id),
                )
            if self.evaluation_id:
                execute(
                    "UPDATE evaluations SET progress_json = ? WHERE evaluation_id = ?",
                    (json_dumps(self.payload), self.evaluation_id),
                )
        except Exception:
            pass


def log_event(resource: str, resource_id: str, action: str, detail: dict[str, Any] | None = None) -> None:
    get_connection().execute(
        "INSERT INTO audit_events(resource, resource_id, action, detail_json, created_at) VALUES (?,?,?,?,?)",
        (resource, resource_id, action, json_dumps(detail or {}), now_utc()),
    )


def append_log(experiment_id: str, level: str, message: str, **extra: Any) -> None:
    """Append a structured log line to the experiment log file (spec 7.6)."""
    directory = ensure_dir("logs")
    path = directory / f"{experiment_id}.jsonl"
    record = {"at": now_utc(), "level": level, "message": message}
    record.update(extra)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def experiment_log_path(experiment_id: str) -> Path:
    return ensure_dir("logs") / f"{experiment_id}.jsonl"


def _region_batch(bundle, region_id: str, split: str) -> WindowBatch:
    starts, x_raw, y_raw, x_scaled, y_scaled = bundle.window_matrices(region_id, split, scaled=True)
    target_index = starts[:, None] + bundle.L + np.arange(bundle.H)[None, :] if starts.size else np.empty((0, bundle.H), dtype="int64")
    target_ts = bundle.target_timestamps(starts)
    return WindowBatch(
        starts=starts,
        X_scaled=x_scaled,
        Y_scaled=y_scaled,
        X_raw=x_raw,
        Y_raw=y_raw,
        target_index=target_index.astype("int64"),
        target_timestamps=target_ts,
    )


def _filter_test_batch(
    batch: WindowBatch,
    protocol: dict[str, Any],
) -> tuple[WindowBatch, dict[str, Any]]:
    selection = str(protocol.get("test_selection") or "full")
    if selection == "range":
        raw_start = protocol.get("range_start_at")
        raw_end = protocol.get("range_end_at")
        if not raw_start or not raw_end:
            raise ValueError("custom test range requires both start and end")
        start = np.datetime64(str(raw_start).replace(" ", "T"))
        end = np.datetime64(str(raw_end).replace(" ", "T"))
        first_target = batch.target_timestamps[:, 0]
        last_target = batch.target_timestamps[:, -1]
        mask = (first_target >= start) & (last_target <= end)
        batch = WindowBatch(
            starts=batch.starts[mask],
            X_scaled=batch.X_scaled[mask],
            Y_scaled=batch.Y_scaled[mask],
            X_raw=batch.X_raw[mask],
            Y_raw=batch.Y_raw[mask],
            target_index=batch.target_index[mask],
            target_timestamps=batch.target_timestamps[mask],
        )
    if batch.size:
        timestamps = batch.target_timestamps.reshape(-1)
        actual_start = str(np.datetime_as_string(timestamps.min(), unit="s")).replace("T", " ")
        actual_end = str(np.datetime_as_string(timestamps.max(), unit="s")).replace("T", " ")
    else:
        actual_start = None
        actual_end = None
    return batch, {
        "selection": selection,
        "requested_start_at": protocol.get("range_start_at"),
        "requested_end_at": protocol.get("range_end_at"),
        "actual_start_at": actual_start,
        "actual_end_at": actual_end,
        "window_count": batch.size,
        "valid_prediction_count": int(batch.size * int(batch.Y_raw.shape[1])) if batch.size else 0,
    }


def _evaluation_metrics(truth: np.ndarray, prediction: np.ndarray) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    overall = all_metrics(truth, prediction)
    per_horizon = [
        {
            "horizon_step": horizon + 1,
            **all_metrics(truth[:, horizon], prediction[:, horizon]),
        }
        for horizon in range(truth.shape[1])
    ]
    return overall, per_horizon


def _region_context(bundle, region_id: str) -> RegionContext:
    index = bundle.region_index(region_id)
    return RegionContext(
        source_key=bundle.dataset["source_key"],
        region_id=region_id,
        timestamps=bundle.timestamps,
        series_full=np.asarray(bundle.values[:, index], dtype="float64"),
        observed=bundle.observed[:, index],
        imputed_end=bundle.imputed_end[:, index],
        L=bundle.L,
        H=bundle.H,
        S=bundle.S,
        scaler=bundle.scalers.get(region_id, {"method": "none"}),
        split_boundaries=bundle.boundaries,
        unit_label=bundle.dataset.get("unit_label") or "",
    )


def _strip_unpicklable(state: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in state.items() if not k.endswith("_ref")}


def _save_region_artifact(experiment_id: str, region_id: str, payload: dict[str, Any]) -> str:
    import joblib

    directory = ensure_dir("experiments", experiment_id)
    path = directory / f"{region_id}.joblib"
    joblib.dump(payload, path)
    return str(path)


def run_experiment(
    experiment_id: str,
    *,
    job_id: str,
    cancel_requested,
    progress: ProgressReporter | None = None,
) -> dict[str, Any]:
    """Fit one algorithm on one dataset (Single or All Regions, region independent)."""
    row = query_one("SELECT * FROM experiments WHERE experiment_id = ?", (experiment_id,))
    if row is None:
        raise NotFound(f"实验 {experiment_id} 不存在")
    reporter = progress or ProgressReporter(job_id, experiment_id)
    bundle = load_dataset(row["dataset_id"])
    params = json_loads(row["params_json"]) or {}
    algorithm_key = row["algorithm_key"]
    model = MODEL_BY_KEY[algorithm_key]
    mode = row["mode"]
    source_key = bundle.dataset["source_key"]

    snapshot = json_loads(row["snapshot_json"]) or {}
    regions = snapshot.get("region_ids")
    region_experiment_ids = snapshot.get("region_experiment_ids") or {}
    regions = regions or bundle.region_ids

    started = time.time()
    get_connection().execute(
        "UPDATE experiments SET status='Running', started_at=?, error=NULL WHERE experiment_id=?",
        (now_utc(), experiment_id),
    )
    reporter("Preparing", 0.0, f"{model['label']} 开始：{len(regions)} 个区域")
    append_log(experiment_id, "info", f"experiment start algorithm={algorithm_key} mode={mode} regions={len(regions)}")

    completed = 0
    failed = 0
    skipped = 0
    per_region_metrics: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    cancelled = False

    for index, region_id in enumerate(regions):
        if cancel_requested():
            cancelled = True
            break
        total = len(regions)
        base_percent = 100.0 * index / total
        region_started_at = now_utc()
        get_connection().execute(
            """
            UPDATE experiment_region_models
            SET status='Running', started_at=COALESCE(started_at, ?)
            WHERE experiment_id=? AND region_id=?
            """,
            (region_started_at, experiment_id, region_id),
        )
        try:
            region = _region_context(bundle, region_id)
            train_batch = _region_batch(bundle, region_id, "train")
            validation_batch = _region_batch(bundle, region_id, "validation")
            if train_batch.size == 0:
                raise ValueError("训练集没有可用窗口")
            adapter = build_adapter(algorithm_key, params, mode, {"algorithm_key": algorithm_key,
                                                                 "region_id": region_id})

            def scoped_progress(stage, percent, message, extra=None, _index=index, _total=total, _region=region_id):
                local = max(0.0, min(100.0, float(percent))) / 100.0
                overall = base_percent + (local * 0.8) * (100.0 / _total)
                payload = dict(extra or {})
                payload["region_id"] = _region
                payload["region_index"] = _index
                payload["region_total"] = _total
                reporter(stage, overall, f"[{_region}] {message}", payload)

            def validation_progress(stage, percent, message, extra=None, _index=index, _total=total, _region=region_id):
                local = max(0.0, min(100.0, float(percent))) / 100.0
                overall = base_percent + (0.8 + local * 0.18) * (100.0 / _total)
                payload = dict(extra or {})
                payload["region_id"] = _region
                payload["region_index"] = _index
                payload["region_total"] = _total
                reporter(stage, overall, f"[{_region}] {message}", payload)

            scoped_progress("Fit", 0.0, f"开始训练（train windows={train_batch.size}）")
            result = adapter.fit(
                region=region,
                train=train_batch,
                validation=validation_batch if validation_batch.size else None,
                progress=scoped_progress,
                cancel=cancel_requested,
            )
            scoped_progress("Fit", 100.0, "model fit complete")
            metrics: dict[str, Any] = {}
            if validation_batch.size:
                scoped_progress("Validation", 0.0, "在验证集窗口上推理（真实预测）")
                pred_scaled = adapter.predict(region=region, state=result.state, batch=validation_batch,
                                              progress=validation_progress, cancel=cancel_requested)
                if adapter.operates_in == "scaled":
                    from app.services.windows import inverse_scaler

                    pred = inverse_scaler(pred_scaled, region.scaler)
                else:
                    pred = pred_scaled
                metrics = all_metrics(validation_batch.Y_raw, pred)
                validation_progress("Validation", 100.0, "validation metrics complete")
            state_to_save = _strip_unpicklable(result.state)
            reload_hint = None
            if "pipeline_ref" in result.state:
                reload_hint = {
                    "reload": True,
                    "checkpoint_id": result.state.get("checkpoint_id"),
                    "effective_context_length": result.state.get("effective_context_length"),
                }
            artifact_ref = _save_region_artifact(
                experiment_id,
                region_id,
                {
                    "algorithm_key": algorithm_key,
                    "mode": mode,
                    "params": params,
                    "state": state_to_save,
                    "reload_hint": reload_hint,
                    "history": result.history,
                    "notes": result.notes,
                    "validation_metrics": metrics,
                    "L": bundle.L,
                    "H": bundle.H,
                    "region_id": region_id,
                    "saved_at": now_utc(),
                },
            )
            get_connection().execute(
                """
                INSERT INTO experiment_region_models
                    (experiment_id, region_id, region_experiment_id, status, model_artifact_ref, checkpoint_ref, metrics_json,
                     history_json, logs_ref, error, started_at, ended_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(experiment_id, region_id) DO UPDATE SET
                    status=excluded.status, model_artifact_ref=excluded.model_artifact_ref,
                    checkpoint_ref=excluded.checkpoint_ref, metrics_json=excluded.metrics_json,
                    history_json=excluded.history_json, logs_ref=excluded.logs_ref, error=excluded.error,
                    started_at=COALESCE(experiment_region_models.started_at, excluded.started_at),
                    ended_at=excluded.ended_at
                """,
                (
                    experiment_id,
                    region_id,
                    region_experiment_ids.get(region_id),
                    "Completed",
                    artifact_ref,
                    result.state.get("checkpoint_id"),
                    json_dumps(metrics),
                    json_dumps(result.history),
                    str(experiment_log_path(experiment_id)),
                    None,
                    region_started_at,
                    now_utc(),
                ),
            )
            completed += 1
            per_region_metrics.append(metrics)
            append_log(experiment_id, "info",
                       f"region {region_id} completed",
                       region_id=region_id, metrics=metrics,
                       epochs=result.history.get("epochs_completed"))
        except CancelledError:
            cancelled = True
            get_connection().execute(
                "UPDATE experiment_region_models SET status='Stopped', ended_at=? "
                "WHERE experiment_id=? AND region_id=?",
                (now_utc(), experiment_id, region_id),
            )
            break
        except Exception as exc:  # a single region failure must not kill the rest
            failed += 1
            detail = {
                "region_id": region_id,
                "error": str(exc),
                "error_type": type(exc).__name__,
            }
            errors.append(detail)
            get_connection().execute(
                """
                INSERT INTO experiment_region_models
                    (experiment_id, region_id, region_experiment_id, status, error, started_at, ended_at)
                VALUES (?,?,?,?,?,?,?)
                ON CONFLICT(experiment_id, region_id) DO UPDATE SET status='Failed', error=excluded.error,
                    started_at=COALESCE(experiment_region_models.started_at, excluded.started_at),
                    ended_at=excluded.ended_at
                """,
                (experiment_id, region_id, region_experiment_ids.get(region_id), "Failed",
                 f"{type(exc).__name__}: {exc}", region_started_at, now_utc()),
            )
            append_log(experiment_id, "error", f"region {region_id} failed: {exc}",
                       region_id=region_id, traceback=traceback.format_exc(limit=3))
        finally:
            get_connection().execute(
                "UPDATE experiments SET region_completed=?, region_failed=? WHERE experiment_id=?",
                (completed, failed, experiment_id),
            )

    if cancelled:
        status = "Stopped" if completed < len(regions) else "Completed"
    elif failed and completed:
        status = "Partial"
    elif failed and not completed:
        status = "Failed"
    else:
        status = "Completed"
    duration = round(time.time() - started, 3)
    summary = {
        "regions_total": len(regions),
        "regions_completed": completed,
        "regions_failed": failed,
        "regions_skipped": skipped,
        "duration_seconds": duration,
        "macro_validation": macro_average(per_region_metrics) if per_region_metrics else {},
        "errors": errors[:50],
        "environment": environment_snapshot(),
    }
    get_connection().execute(
        """
        UPDATE experiments SET status=?, metrics_json=?, ended_at=?,
            error=? WHERE experiment_id=?
        """,
        (
            status,
            json_dumps(summary),
            now_utc(),
            (json_dumps(errors[:10]) if errors and status in ("Failed", "Partial") else None),
            experiment_id,
        ),
    )
    reporter("Ready", 100.0, f"实验结束：{status}（成功 {completed} / 失败 {failed}）")
    append_log(experiment_id, "info", f"experiment end status={status} duration={duration}s")
    log_event("experiment", experiment_id, "finished", {"status": status})
    return {"status": status, "completed": completed, "failed": failed}


def environment_snapshot() -> dict[str, Any]:
    snapshot: dict[str, Any] = {
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "machine": platform.machine(),
    }
    for module in ("numpy", "pandas", "sklearn", "statsmodels", "xgboost", "lightgbm", "torch", "prophet"):
        try:
            mod = __import__(module)
            snapshot[module] = getattr(mod, "__version__", "unknown")
        except Exception:
            snapshot[module] = None
    return snapshot


def _load_region_artifact(experiment_id: str, region_id: str) -> dict[str, Any]:
    import joblib

    directory = ensure_dir("experiments", experiment_id)
    path = directory / f"{region_id}.joblib"
    if not path.exists():
        raise NotFound(f"实验 {experiment_id} 的区域 {region_id} 没有模型工件")
    return joblib.load(path)


def rebuild_adapter_for_prediction(algorithm_key: str, payload: dict[str, Any], mode: str, context: dict):
    adapter = build_adapter(algorithm_key, payload.get("params") or {}, mode, context)
    state = dict(payload.get("state") or {})
    hint = payload.get("reload_hint")
    if hint and hint.get("reload"):
        # Foundation pipelines are not pickled: reload the verified checkpoint.
        params = dict(payload.get("params") or {})
        if hint.get("checkpoint_id"):
            params["checkpoint_id"] = hint["checkpoint_id"]
        adapter = build_adapter(algorithm_key, params, mode, context)
        region_stub = None
        fresh = adapter.fit(
            region=context.get("region"),
            train=context.get("train_batch"),
            validation=None,
        )
        state = fresh.state
    return adapter, state


def _aggregate_evaluation_status(
    experiment_reports: list[dict[str, Any]],
    *,
    cancelled: bool,
) -> str:
    """Return an honest aggregate status for the evaluation history record."""

    if cancelled:
        return "Stopped"
    if not experiment_reports:
        return "Failed"
    if all(report.get("status") == "Completed" for report in experiment_reports):
        return "Completed"
    if any(report.get("status") in ("Completed", "Partial") for report in experiment_reports):
        return "Partial"
    return "Failed"


def run_evaluation(evaluation_id: str, *, job_id: str, cancel_requested, progress: ProgressReporter | None = None):
    """Module 5: real held-out test inference for every selected experiment."""
    row = query_one("SELECT * FROM evaluations WHERE evaluation_id = ?", (evaluation_id,))
    if row is None:
        raise NotFound(f"评价 {evaluation_id} 不存在")
    reporter = progress or ProgressReporter(job_id, evaluation_id=evaluation_id)
    protocol = json_loads(row["protocol_json"]) or {}
    bundle = load_dataset(row["dataset_id"])
    members = query_all(
        "SELECT * FROM evaluation_experiments WHERE evaluation_id = ? ORDER BY algorithm_key",
        (evaluation_id,),
    )
    regions = protocol.get("regions") or bundle.region_ids
    horizon_step = int(protocol.get("horizon_step") or 1)
    started = time.time()
    get_connection().execute(
        "UPDATE evaluations SET status='Running', started_at=? WHERE evaluation_id=?",
        (now_utc(), evaluation_id),
    )

    def insert_predictions(exp_id: str, region_id: str, starts: np.ndarray, truth: np.ndarray, pred: np.ndarray):
        conn = get_connection()
        target_ts = bundle.target_timestamps(starts)
        conn.execute("BEGIN IMMEDIATE")
        try:
            conn.execute(
                "DELETE FROM evaluation_predictions WHERE evaluation_id=? AND experiment_id=? AND region_id=?",
                (evaluation_id, exp_id, region_id),
            )
            payload = []
            for w in range(starts.shape[0]):
                for h in range(bundle.H):
                    payload.append(
                        (
                            evaluation_id,
                            exp_id,
                            region_id,
                            int(starts[w]),
                            h + 1,
                            str(np.datetime_as_string(target_ts[w, h], unit="s")).replace("T", " "),
                            float(truth[w, h]),
                            float(pred[w, h]),
                            1,
                        )
                    )
            conn.executemany(
                """
                INSERT OR REPLACE INTO evaluation_predictions
                    (evaluation_id, experiment_id, region_id, window_index, horizon_step, target_at,
                     y_true, y_pred, is_valid)
                VALUES (?,?,?,?,?,?,?,?,?)
                """,
                payload,
            )
        except Exception:
            conn.execute("ROLLBACK")
            raise
        else:
            conn.execute("COMMIT")

    experiment_reports: list[dict[str, Any]] = []
    actual_test_range: dict[str, Any] = {}
    cancelled = False
    total_members = len(members)
    for member_index, member in enumerate(members):
        experiment_id = member["experiment_id"]
        if cancel_requested():
            cancelled = True
            break
        exp = query_one("SELECT * FROM experiments WHERE experiment_id=?", (experiment_id,))
        algorithm_key = exp["algorithm_key"]
        mode = exp["mode"]
        per_region: list[dict[str, Any]] = []
        pooled_true: list[np.ndarray] = []
        pooled_pred: list[np.ndarray] = []
        errors: list[dict[str, Any]] = []
        for r_index, region_id in enumerate(regions):
            region_total = max(1, len(regions))

            def inference_progress(stage, percent, message, extra=None):
                local = max(0.0, min(100.0, float(percent))) / 100.0
                member_fraction = (r_index + local) / region_total
                overall = 100.0 * (member_index + member_fraction) / max(1, total_members)
                reporter(stage, overall, f"[{algorithm_key}] {message}", extra)

            if cancel_requested():
                cancelled = True
                break
            percent = 100.0 * (member_index + (r_index / max(1, len(regions)))) / max(1, total_members)
            reporter("Inference", percent,
                     f"[{algorithm_key}] 区域 {region_id} 测试集推理 ({r_index + 1}/{len(regions)})")
            try:
                payload = _load_region_artifact(experiment_id, region_id)
            except Exception as exc:
                errors.append({"region_id": region_id, "error": f"缺少模型工件: {exc}"})
                continue
            try:
                region = _region_context(bundle, region_id)
                batch, test_range_detail = _filter_test_batch(
                    _region_batch(bundle, region_id, "test"),
                    protocol,
                )
                actual_test_range = actual_test_range or test_range_detail
                if batch.size == 0:
                    errors.append({"region_id": region_id, "error": "测试集没有可用窗口"})
                    continue
                adapter = build_adapter(algorithm_key, payload.get("params") or {}, mode,
                                        {"algorithm_key": algorithm_key, "region_id": region_id})
                state = dict(payload.get("state") or {})
                hint = payload.get("reload_hint")
                if hint and hint.get("reload"):
                    params = dict(payload.get("params") or {})
                    if hint.get("checkpoint_id"):
                        params["checkpoint_id"] = hint["checkpoint_id"]
                    adapter = build_adapter(algorithm_key, params, mode,
                                            {"algorithm_key": algorithm_key, "region_id": region_id})
                    train_batch = _region_batch(bundle, region_id, "train")
                    state = adapter.fit(region=region, train=train_batch, validation=None).state
                prediction = adapter.predict(region=region, state=state, batch=batch,
                                             progress=inference_progress, cancel=cancel_requested)
                inference_progress("Inference", 100.0, "inference complete")
                if adapter.operates_in == "scaled":
                    from app.services.windows import inverse_scaler

                    prediction = inverse_scaler(prediction, region.scaler)
                truth = batch.Y_raw.astype("float64")
                if not np.isfinite(prediction).all():
                    raise ValueError("预测包含非有限值")
                insert_predictions(experiment_id, region_id, batch.starts, truth, prediction)
                metrics, per_horizon = _evaluation_metrics(truth, prediction)
                per_region.append({
                    "region_id": region_id,
                    **metrics,
                    "per_horizon": per_horizon,
                    "test_window_count": batch.size,
                    "file": None,
                })
                pooled_true.append(truth.ravel())
                pooled_pred.append(prediction.ravel())
            except Exception as exc:
                errors.append({"region_id": region_id, "error": f"{type(exc).__name__}: {exc}"})
        macro = macro_average(per_region) if per_region else {}
        pooled = (
            all_metrics(np.concatenate(pooled_true), np.concatenate(pooled_pred))
            if pooled_true
            else {}
        )
        per_horizon = []
        if per_region and bundle.H:
            for horizon_index in range(bundle.H):
                groups = [
                    region_report["per_horizon"][horizon_index]
                    for region_report in per_region
                    if len(region_report.get("per_horizon") or []) > horizon_index
                ]
                aggregate = macro_average(groups) if groups else {}
                per_horizon.append({
                    "horizon_step": horizon_index + 1,
                    **aggregate,
                })
        status = "Completed" if not errors else ("Partial" if per_region else "Failed")
        get_connection().execute(
            """
            UPDATE evaluation_experiments SET status=?, coverage_regions=?, sample_count=?, metrics_json=?, error=?
            WHERE evaluation_id=? AND experiment_id=?
            """,
            (
                status,
                len(per_region),
                int(macro.get("n_samples") or 0),
                json_dumps({
                    "macro": macro,
                    "pooled": pooled,
                    "per_horizon": per_horizon,
                    "per_region": per_region,
                    "errors": errors[:50],
                }),
                (json_dumps(errors[:5]) if errors else None),
                evaluation_id,
                experiment_id,
            ),
        )
        experiment_reports.append(
            {
                "experiment_id": experiment_id,
                "algorithm_key": algorithm_key,
                "algorithm_label": MODEL_BY_KEY[algorithm_key]["label"],
                "mode": mode,
                "status": status,
                "coverage_regions": len(per_region),
                "macro": macro,
                "pooled": pooled,
                "per_horizon": per_horizon,
                "errors": errors[:20],
            }
        )

    ranked = [r for r in experiment_reports if r["macro"].get("rmse") is not None]
    ranking = sorted(ranked, key=lambda r: r["macro"]["rmse"])
    summary = {
        "experiments": experiment_reports,
        "ranking": [
            {"rank": i + 1, "experiment_id": r["experiment_id"], "algorithm_key": r["algorithm_key"],
             "algorithm_label": r["algorithm_label"], "macro": r["macro"]}
            for i, r in enumerate(ranking)
        ],
        "protocol": protocol,
        "test_range": actual_test_range,
        "duration_seconds": round(time.time() - started, 3),
        "horizon_step": horizon_step,
    }
    status = _aggregate_evaluation_status(experiment_reports, cancelled=cancelled)
    get_connection().execute(
        "UPDATE evaluations SET status=?, metrics_summary_json=?, test_range_json=?, artifact_ref=?, "
        "ended_at=? WHERE evaluation_id=?",
        (status, json_dumps(summary), json_dumps(actual_test_range), None, now_utc(), evaluation_id),
    )
    reporter("Ready", 100.0, f"评价完成：{status}，共 {len(experiment_reports)} 个实验")
    log_event("evaluation", evaluation_id, "finished", {"status": status, "experiments": len(experiment_reports)})
    return {"status": status, "experiments": experiment_reports}
