"""Module 2: four real clustering algorithms with genuine quality metrics."""

from __future__ import annotations

import json
from typing import Any

import numpy as np

from app.core.ids import now_utc
from app.db.connection import get_connection, json_dumps, json_loads, query_one
from app.services.features import FEATURE_LABELS, extract_features, intraday_profile, weekly_profile
from app.services.ingest import load_series, regions_for, source_row
from app.services.series import resolve_frequency_minutes, resample, valid_region_ids

ALGORITHM_LABELS = {
    "kmeans": "K-Means",
    "dbscan": "DBSCAN",
    "hierarchical": "Hierarchical",
    "gmm": "GMM",
}


def feature_catalog() -> list[dict[str, str]]:
    return [
        {"key": key, "label_zh": meta["zh"], "help_zh": meta["help"]}
        for key, meta in FEATURE_LABELS.items()
    ]


def _cluster_labels(matrix: np.ndarray, params: dict[str, Any]) -> tuple[np.ndarray, dict[str, Any]]:
    algorithm = params["algorithm"]
    detail: dict[str, Any] = {}
    if algorithm == "kmeans":
        from sklearn.cluster import KMeans

        model = KMeans(
            n_clusters=int(params.get("n_clusters", 4)),
            n_init=int(params.get("n_init", 10)),
            random_state=int(params.get("random_state", 42)),
        )
        labels = model.fit_predict(matrix)
        detail["inertia"] = float(model.inertia_)
        detail["n_iter"] = int(model.n_iter_)
    elif algorithm == "dbscan":
        from sklearn.cluster import DBSCAN

        model = DBSCAN(
            eps=float(params.get("eps", 1.2)),
            min_samples=int(params.get("min_samples", 3)),
            metric=params.get("dbscan_metric", "euclidean"),
        )
        labels = model.fit_predict(matrix)
        detail["core_samples"] = int(getattr(model, "core_sample_indices_", np.array([])).size)
    elif algorithm == "hierarchical":
        from sklearn.cluster import AgglomerativeClustering

        linkage = params.get("linkage", "ward")
        metric = params.get("metric", "euclidean")
        kwargs: dict[str, Any] = {"n_clusters": int(params.get("hierarchical_n_clusters", 4)), "linkage": linkage}
        if linkage != "ward":
            kwargs["metric"] = metric
        model = AgglomerativeClustering(**kwargs)
        labels = model.fit_predict(matrix)
        detail["linkage"] = linkage
        detail["metric"] = metric
    else:
        from sklearn.mixture import GaussianMixture

        model = GaussianMixture(
            n_components=int(params.get("gmm_n_components", 4)),
            covariance_type=params.get("covariance_type", "full"),
            reg_covar=float(params.get("reg_covar", 1e-6)),
            random_state=int(params.get("random_state", 42)),
        )
        labels = model.fit_predict(matrix)
        detail["converged"] = bool(model.converged_)
        detail["n_iter"] = int(model.n_iter_)
        detail["bic"] = float(model.bic(matrix))
    return np.asarray(labels, dtype="int64"), detail


def _quality_metrics(matrix: np.ndarray, labels: np.ndarray) -> dict[str, Any]:
    unique = sorted({int(x) for x in labels.tolist() if int(x) >= 0})
    metrics: dict[str, Any] = {
        "n_clusters": len(unique),
        "noise_points": int((labels == -1).sum()),
        "silhouette": None,
        "davies_bouldin": None,
        "calinski_harabasz": None,
        "notes": [],
    }
    if len(unique) < 2:
        metrics["notes"].append("有效簇少于 2 个，轮廓系数/DB/CH 指标不适用（N/A）。")
        return metrics
    mask = labels >= 0
    if mask.sum() < len(unique):
        metrics["notes"].append("存在噪声点，质量指标只在非噪声样本上计算。")
    from sklearn import metrics as skm

    sub_matrix, sub_labels = matrix[mask], labels[mask]
    try:
        metrics["silhouette"] = float(skm.silhouette_score(sub_matrix, sub_labels))
    except Exception as exc:
        metrics["notes"].append(f"轮廓系数无法计算：{exc}")
    try:
        metrics["davies_bouldin"] = float(skm.davies_bouldin_score(sub_matrix, sub_labels))
    except Exception as exc:
        metrics["notes"].append(f"Davies-Bouldin 无法计算：{exc}")
    try:
        metrics["calinski_harabasz"] = float(skm.calinski_harabasz_score(sub_matrix, sub_labels))
    except Exception as exc:
        metrics["notes"].append(f"Calinski-Harabasz 无法计算：{exc}")
    return metrics


def run_clustering(cluster_run_id: str, *, job_id: str, cancel_requested, progress=None) -> dict[str, Any]:
    """Execute one genuine clustering run and persist every real result."""
    row = query_one("SELECT * FROM clusters WHERE cluster_run_id = ?", (cluster_run_id,))
    if row is None:
        raise KeyError(cluster_run_id)
    params = json_loads(row["params_json"]) or {}
    features = json_loads(row["features_json"]) or {}
    source = source_row(row["source_id"])
    region_ids = valid_region_ids(source["key"])
    frequency = row["frequency"]
    aggregation = row["aggregation"]

    def report(stage: str, percent: float, message: str) -> None:
        if progress:
            progress(stage, percent, message)

    report("Features", 5.0, f"提取 {len(region_ids)} 个区域的特征")
    data = resample(source["key"], region_ids=region_ids, frequency=frequency, aggregation=aggregation)
    start = int(params.get("start_index") or 0)
    points = int(params.get("window_points") or data.timestamps.size)
    stop = min(start + points, data.timestamps.size)
    ts = data.timestamps[start:stop]
    values = data.values[start:stop]
    selected = list(features.get("selected") or [])
    frequency_minutes = resolve_frequency_minutes(int(source["native_frequency_minutes"]), frequency)
    matrix, names, detail = extract_features(
        ts, values, selected=selected, frequency_minutes=frequency_minutes
    )
    finite_rows = np.isfinite(matrix).all(axis=1)
    dropped = [region_ids[i] for i in range(len(region_ids)) if not finite_rows[i]]
    matrix = matrix[finite_rows]
    kept_regions = [region_ids[i] for i in range(len(region_ids)) if finite_rows[i]]
    if matrix.shape[0] < 2:
        raise ValueError("可用区域不足 2 个，无法聚类")
    if cancel_requested():
        raise RuntimeError("已按用户请求停止")

    scaler_mean = matrix.mean(axis=0)
    scaler_std = matrix.std(axis=0)
    scaler_std = np.where(scaler_std < 1e-12, 1.0, scaler_std)
    scaled = (matrix - scaler_mean) / scaler_std if params.get("standardize", True) else matrix
    report("Clustering", 45.0, f"运行 {ALGORITHM_LABELS[params['algorithm']]}")
    labels, algo_detail = _cluster_labels(scaled, params)
    quality = _quality_metrics(scaled, labels)
    report("Summarising", 75.0, "计算簇摘要与典型模式")

    profile = intraday_profile(ts, values)
    weekly = weekly_profile(ts, values)
    cluster_index = {int(c): [] for c in sorted({int(x) for x in labels.tolist()})}
    for position, label in enumerate(labels.tolist()):
        cluster_index.setdefault(int(label), []).append(position)

    cluster_summaries = []
    for label, positions in sorted(cluster_index.items()):
        region_position = list(positions)
        member_regions = [kept_regions[p] for p in positions]
        summary = {
            "cluster_id": label,
            "label_zh": "噪声点" if label == -1 else f"簇 {label}",
            "region_count": len(positions),
            "regions": member_regions,
            "feature_means": {
                names[f]: float(np.nanmean(matrix[positions, f])) for f in range(len(names))
            },
            "intraday_profile": [float(v) if np.isfinite(v) else None
                                 for v in np.nanmean(profile[:, region_position], axis=1)],
            "weekly_profile": [float(v) if np.isfinite(v) else None
                               for v in np.nanmean(weekly[:, region_position], axis=1)],
            "mean_level": float(np.nanmean(matrix[positions, 0])) if positions else None,
            "inferred_zone_type": None,
        }
        summary["inferred_zone_type"] = _infer_zone_type(summary["feature_means"])
        cluster_summaries.append(summary)

    region_records = []
    for position, label in enumerate(labels.tolist()):
        region_id = kept_regions[position]
        region_records.append(
            {
                "region_id": region_id,
                "cluster_id": int(label),
                "features": {names[f]: float(matrix[position, f]) for f in range(len(names))},
            }
        )
    result = {
        "algorithm": params["algorithm"],
        "algorithm_label": ALGORITHM_LABELS[params["algorithm"]],
        "clusters": cluster_summaries,
        "regions": region_records,
        "feature_names": names,
        "feature_matrix": matrix.tolist(),
        "labels": labels.tolist(),
        "scaled_matrix": scaled.tolist(),
        "algorithm_detail": algo_detail,
        "quality": quality,
        "dropped_regions": dropped,
        "no_data_regions": [r["region_id"] for r in regions_for(source["source_id"], has_timeseries=False)],
        "time_start": str(ts[0]) if ts.size else None,
        "time_end": str(ts[-1]) if ts.size else None,
        "frequency": frequency,
        "aggregation": aggregation,
        "feature_help": {key: FEATURE_LABELS[key] for key in names if key in FEATURE_LABELS},
        "disclaimer_zh": "簇类型标签仅依据流量模式的推测，不代表真实土地使用数据。",
    }
    get_connection().execute(
        """
        UPDATE clusters SET status='Completed', cluster_count=?, noise_count=?, metrics_json=?,
            result_json=?, error=NULL WHERE cluster_run_id=?
        """,
        (
            quality["n_clusters"],
            quality["noise_points"],
            json_dumps(quality),
            json_dumps(result),
            cluster_run_id,
        ),
    )
    return result


def _infer_zone_type(feature_means: dict[str, float]) -> dict[str, Any]:
    """Pattern based *speculation* label with the evidence that produced it."""
    day_night = feature_means.get("day_night_ratio") or 0.0
    peak = feature_means.get("intraday_peak_ratio") or 0.0
    weekend = feature_means.get("weekday_weekend_ratio") or 0.0
    cv = feature_means.get("cv") or 0.0
    if peak >= 1.35 and day_night >= 1.2:
        name = "推测：日间通勤/办公型"
    elif peak >= 1.2 and day_night < 1.0:
        name = "推测：夜间活跃型"
    elif abs(day_night - 1.0) < 0.15 and cv < 0.5:
        name = "推测：稳定混合型"
    elif weekend < 0.85:
        name = "推测：休闲/周末活跃型"
    else:
        name = "推测：均衡型"
    return {
        "label": name,
        "is_inferred": True,
        "evidence": {
            "day_night_ratio": day_night,
            "intraday_peak_ratio": peak,
            "weekday_weekend_ratio": weekend,
            "cv": cv,
        },
        "disclaimer_zh": "该标签由流量模式推测得到，不是 GIS 土地使用真值。",
    }
