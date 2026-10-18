"""Module 2: four real clustering algorithms with genuine quality metrics."""

from __future__ import annotations

from typing import Any

import numpy as np

from app.core.ids import now_utc
from app.core.errors import RequestRejected
from app.db.connection import get_connection, json_dumps, json_loads, query_one
from app.services.features import FEATURE_LABELS, extract_features, intraday_profile, weekly_profile
from app.services.ingest import load_series, regions_for, source_row
from app.services.series import resolve_frequency_minutes, resample, valid_region_ids
from app.services.time_range import has_blocking, resolve_range

ALGORITHM_LABELS = {
    "kmeans": "K-Means",
    "spectral": "Spectral Clustering",
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
    elif algorithm == "spectral":
        from sklearn.cluster import SpectralClustering

        n_clusters = int(params.get("spectral_n_clusters", 4))
        if n_clusters >= matrix.shape[0]:
            raise ValueError(
                f"谱聚类簇数量 {n_clusters} 必须小于有效区域数 {matrix.shape[0]}。"
            )
        affinity = str(params.get("spectral_affinity", "nearest_neighbors"))
        model_options: dict[str, Any] = {
            "n_clusters": n_clusters,
            "random_state": int(params.get("random_state", 42)),
            "affinity": affinity,
        }
        if affinity == "nearest_neighbors":
            n_neighbors = int(params.get("spectral_n_neighbors", 10))
            if n_neighbors < 1 or n_neighbors >= matrix.shape[0]:
                raise ValueError(
                    f"谱聚类邻居数量 {n_neighbors} 必须在 1 到 {matrix.shape[0] - 1} 之间。"
                )
            model_options["n_neighbors"] = n_neighbors
            detail["n_neighbors"] = n_neighbors
        elif affinity == "rbf":
            gamma = float(params.get("spectral_gamma", 1.0))
            if gamma <= 0:
                raise ValueError("谱聚类 RBF gamma 必须大于 0。")
            model_options["gamma"] = gamma
            detail["gamma"] = gamma
        else:
            raise ValueError(f"不支持的谱聚类相似度构建方式：{affinity}")
        model = SpectralClustering(**model_options)
        labels = model.fit_predict(matrix)
        detail.update(
            {
                "n_clusters": n_clusters,
                "affinity": affinity,
                "random_state": int(params.get("random_state", 42)),
                "implementation": "sklearn.cluster.SpectralClustering",
            }
        )
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
    unique = sorted({int(x) for x in labels.tolist()})
    metrics: dict[str, Any] = {
        "n_clusters": len(unique),
        "noise_points": 0,
        "silhouette": None,
        "davies_bouldin": None,
        "calinski_harabasz": None,
        "notes": [],
    }
    if len(unique) < 2:
        metrics["notes"].append("有效簇少于 2 个，轮廓系数、Davies-Bouldin 和 Calinski-Harabasz 指标不适用。")
        return metrics
    from sklearn import metrics as skm

    try:
        metrics["silhouette"] = float(skm.silhouette_score(matrix, labels))
    except Exception as exc:
        metrics["notes"].append(f"轮廓系数无法计算：{exc}")
    try:
        metrics["davies_bouldin"] = float(skm.davies_bouldin_score(matrix, labels))
    except Exception as exc:
        metrics["notes"].append(f"Davies-Bouldin 无法计算：{exc}")
    try:
        metrics["calinski_harabasz"] = float(skm.calinski_harabasz_score(matrix, labels))
    except Exception as exc:
        metrics["notes"].append(f"Calinski-Harabasz 无法计算：{exc}")
    return metrics


def _fmt(value: float | None, *, digits: int = 2) -> str:
    if value is None or not np.isfinite(value):
        return "—"
    return f"{value:,.{digits}f}"


def _pct_diff(left: float | None, right: float | None) -> float | None:
    if left is None or right is None or not np.isfinite(left) or not np.isfinite(right):
        return None
    if abs(right) <= 1e-12:
        return None
    return (left - right) / abs(right) * 100.0


def _rank_word(index: int, count: int, words: list[str]) -> str:
    if count <= 1:
        return words[0]
    if count == 2:
        return words[0] if index == 0 else words[-1]
    if count == 3:
        return [words[0], words[1], words[-1]][index]
    scaled = round(index * (len(words) - 1) / max(1, count - 1))
    return words[scaled]


def _percentile_rank(values: np.ndarray, value: float) -> float | None:
    finite = np.asarray(values, dtype="float64")
    finite = finite[np.isfinite(finite)]
    if finite.size == 0 or not np.isfinite(value):
        return None
    below = int((finite < value).sum())
    equal = int(np.isclose(finite, value, rtol=1e-10, atol=1e-12).sum())
    return float((below + 0.5 * equal) / finite.size)


def _pattern_type(
    feature_means: dict[str, float],
    matrix: np.ndarray,
    names: list[str],
) -> dict[str, Any]:
    """Name a cluster from its real statistics relative to all valid regions.

    The label never uses a cluster number and never asserts a land-use class.
    High/low flow and volatility are percentile based rather than fixed absolute
    cut-offs, so the same rule adapts to Milano, Trentino and ZTE.
    """
    index = {name: position for position, name in enumerate(names)}
    raw = {
        "mean": feature_means.get("mean"),
        "std": feature_means.get("std"),
        "cv": feature_means.get("cv"),
        "intraday_peak_ratio": feature_means.get("intraday_peak_ratio"),
        "day_night_ratio": feature_means.get("day_night_ratio"),
        "weekday_weekend_ratio": feature_means.get("weekday_weekend_ratio"),
        "daily_seasonality": feature_means.get("daily_seasonality"),
    }

    def feature_percentile(key: str) -> float | None:
        position = index.get(key)
        value = raw.get(key)
        if position is None or value is None:
            return None
        return _percentile_rank(matrix[:, position], float(value))

    mean_pct = feature_percentile("mean")
    cv_pct = feature_percentile("cv")
    peak_pct = feature_percentile("intraday_peak_ratio")
    season_pct = feature_percentile("daily_seasonality")
    day_night_pct = feature_percentile("day_night_ratio")
    weekday_pct = None
    weekday_position = index.get("weekday_weekend_ratio")
    weekday_value = raw.get("weekday_weekend_ratio")
    if weekday_position is not None and weekday_value is not None:
        deviations = np.abs(matrix[:, weekday_position] - 1.0)
        weekday_pct = _percentile_rank(deviations, abs(float(weekday_value) - 1.0))

    def level(pct: float | None, *, high: float, low: float) -> str:
        if pct is None:
            return "unknown"
        if pct >= 0.85:
            return "very_high"
        if pct >= high:
            return "high"
        if pct <= 0.15:
            return "very_low"
        if pct <= low:
            return "low"
        return "mid"

    flow_level = level(mean_pct, high=0.65, low=0.35)
    vol_level = level(cv_pct, high=0.70, low=0.30)
    flow_words = {
        "very_high": "高流量",
        "high": "中高流量",
        "mid": "中流量",
        "low": "中低流量",
        "very_low": "低流量",
    }
    vol_words = {
        "very_high": "高波动",
        "high": "高波动",
        "mid": "波动适中",
        "low": "平稳",
        "very_low": "平稳",
    }
    key_by_label = {
        "高流量·高波动型": "high_flow_high_volatility",
        "高流量·波动适中型": "high_flow_mid_volatility",
        "高流量·平稳型": "high_flow_low_volatility",
        "中高流量·高波动型": "upper_mid_flow_high_volatility",
        "中高流量·波动适中型": "upper_mid_flow_mid_volatility",
        "中高流量·平稳型": "upper_mid_flow_low_volatility",
        "中流量·高波动型": "mid_flow_high_volatility",
        "中流量·波动适中型": "mid_flow_mid_volatility",
        "中流量·平稳型": "mid_flow_low_volatility",
        "中低流量·高波动型": "lower_mid_flow_high_volatility",
        "中低流量·波动适中型": "lower_mid_flow_mid_volatility",
        "中低流量·平稳型": "lower_mid_flow_low_volatility",
        "低流量·高波动型": "low_flow_high_volatility",
        "低流量·波动适中型": "low_flow_mid_volatility",
        "低流量·平稳型": "low_flow_low_volatility",
        "流量峰值突出型": "prominent_peak",
        "日周期特征明显型": "strong_daily_cycle",
        "工作日与周末差异明显型": "weekday_weekend_difference",
        "综合流量特征型": "mixed_profile",
    }

    if flow_level != "unknown" and vol_level != "unknown":
        label = f"{flow_words[flow_level]}·{vol_words[vol_level]}型"
        selection_basis = f"Mean 百分位 {mean_pct:.3f}；CV 百分位 {cv_pct:.3f}"
        if flow_level == "mid" and vol_level == "mid":
            temporal_candidates = [
                (peak_pct, "流量峰值突出型", "日内峰值比"),
                (weekday_pct, "工作日与周末差异明显型", "工作日/周末偏离度"),
                (season_pct, "日周期特征明显型", "日周期强度"),
            ]
            best = max(
                (item for item in temporal_candidates if item[0] is not None and item[0] >= 0.80),
                default=None,
                key=lambda item: float(item[0]),
            )
            if best is not None:
                label = best[1]
                selection_basis = f"{best[2]}百分位 {float(best[0]):.3f}，作为主要区分特征"
    else:
        temporal_candidates = [
            (peak_pct, "流量峰值突出型", "日内峰值比"),
            (weekday_pct, "工作日与周末差异明显型", "工作日/周末偏离度"),
            (season_pct, "日周期特征明显型", "日周期强度"),
        ]
        best = max(
            (item for item in temporal_candidates if item[0] is not None and item[0] >= 0.80),
            default=None,
            key=lambda item: float(item[0]),
        )
        if best is None:
            label = "综合流量特征型"
            selection_basis = "Mean 或 CV 不可用，且没有单一时间特征达到 80% 百分位"
        else:
            label = best[1]
            selection_basis = f"{best[2]}百分位 {float(best[0]):.3f}，作为主要区分特征"

    return {
        "key": key_by_label[label],
        "label": label,
        "is_hypothesis": False,
        "hypothesis_zh": None,
        "evidence": {
            **raw,
            "mean_percentile": mean_pct,
            "cv_percentile": cv_pct,
            "intraday_peak_percentile": peak_pct,
            "day_night_percentile": day_night_pct,
            "weekday_weekend_deviation_percentile": weekday_pct,
            "daily_seasonality_percentile": season_pct,
            "valid_region_count": int(matrix.shape[0]),
        },
        "selection_basis_zh": selection_basis,
        "rule_zh": (
            "先比较该簇 Mean 与 CV 在全部有效区域中的百分位：Mean≥65% 为高流量、"
            "35%-65% 为中流量、≤35% 为中低/低流量；CV≥70% 为高波动、≤30% 为平稳。"
            "仅当流量和波动都处于中间水平时，才用日内峰值、工作日/周末偏离度或"
            "日周期强度的 80% 百分位选择单一主导特征；否则使用综合流量特征型。"
            "阈值基于当前数据分布，不使用固定绝对流量值，也不推断土地用途。"
        ),
    }


def _profile_extremes(profile: list[float | None]) -> dict[str, Any]:
    pairs = [(hour, float(value)) for hour, value in enumerate(profile) if value is not None]
    if not pairs:
        return {"peak_hour": None, "peak_value": None, "trough_hour": None, "trough_value": None}
    peak_hour, peak_value = max(pairs, key=lambda item: item[1])
    trough_hour, trough_value = min(pairs, key=lambda item: item[1])
    return {
        "peak_hour": peak_hour,
        "peak_value": peak_value,
        "trough_hour": trough_hour,
        "trough_value": trough_value,
    }


def _profile_correlation(left: list[float | None], right: list[float | None]) -> float | None:
    pairs = [
        (float(a), float(b))
        for a, b in zip(left, right)
        if a is not None and b is not None
    ]
    if len(pairs) < 3:
        return None
    array_a = np.asarray([item[0] for item in pairs], dtype="float64")
    array_b = np.asarray([item[1] for item in pairs], dtype="float64")
    if array_a.std() <= 1e-12 or array_b.std() <= 1e-12:
        return None
    return float(np.corrcoef(array_a, array_b)[0, 1])


def _row_nanmean(block: np.ndarray) -> np.ndarray:
    """Row-wise mean without the RuntimeWarning from all-missing rows."""
    counts = np.isfinite(block).sum(axis=1)
    sums = np.nansum(block, axis=1)
    return np.divide(
        sums,
        counts,
        out=np.full(block.shape[0], np.nan),
        where=counts > 0,
    )


def _characterization(
    cluster_id: int,
    feature_means: dict[str, dict[str, float]],
) -> dict[str, Any]:
    ids = sorted(feature_means)
    if not ids:
        return {"summary_zh": "", "tags": []}

    def ordered(key: str, *, reverse: bool = True) -> list[int]:
        return sorted(ids, key=lambda cid: feature_means[cid].get(key, 0.0), reverse=reverse)

    mean_order = ordered("mean")
    cv_order = ordered("cv")
    weekday_order = ordered("weekday_weekend_ratio")
    seasonality_order = ordered("daily_seasonality")
    peak_order = ordered("intraday_peak_ratio")
    count = len(ids)
    flow = _rank_word(mean_order.index(cluster_id), count, ["最高", "较高", "较低", "最低"])
    volatility = _rank_word(cv_order.index(cluster_id), count, ["最强", "较强", "较弱", "最弱"])
    weekday_effect = _rank_word(
        weekday_order.index(cluster_id), count, ["最强", "较强", "较弱", "最弱"]
    )
    seasonality = _rank_word(
        seasonality_order.index(cluster_id), count, ["最清晰", "较清晰", "较弱", "最弱"]
    )
    peak = _rank_word(peak_order.index(cluster_id), count, ["最突出", "较突出", "较弱", "最弱"])
    own = feature_means[cluster_id]
    tags = [
        f"流量{flow}",
        f"波动{volatility}",
        f"工作日效应{weekday_effect}",
        f"日周期{seasonality}",
    ]
    summary = (
        f"{'·'.join(tags)}；"
        f"平均流量 {_fmt(own.get('mean'))}，CV {_fmt(own.get('cv'), digits=3)}，"
        f"日内峰值比 {_fmt(own.get('intraday_peak_ratio'), digits=3)}，"
        f"昼夜比 {_fmt(own.get('day_night_ratio'), digits=3)}，"
        f"工作日/周末比 {_fmt(own.get('weekday_weekend_ratio'), digits=3)}，"
        f"日周期强度 {_fmt(own.get('daily_seasonality'), digits=3)}"
    )
    return {
        "summary_zh": summary,
        "tags": tags,
        "rank_notes": {
            "mean": f"流量{flow}",
            "cv": f"波动{volatility}",
            "weekday_weekend_ratio": f"工作日效应{weekday_effect}",
            "daily_seasonality": f"日周期{seasonality}",
            "intraday_peak_ratio": f"日内峰谷{peak}",
        },
    }


def _quality_interpretation(quality: dict[str, Any], span_days: float) -> list[str]:
    notes: list[str] = []
    silhouette = quality.get("silhouette")
    if silhouette is not None:
        if silhouette < 0.25:
            notes.append(f"轮廓系数 {silhouette:.3f}，簇间分离度偏弱，簇边界需要结合业务解释谨慎使用。")
        elif silhouette < 0.5:
            notes.append(f"轮廓系数 {silhouette:.3f}，簇间存在一定分离，但仍有重叠。")
        else:
            notes.append(f"轮廓系数 {silhouette:.3f}，簇间分离较清晰。")
    else:
        notes.append("轮廓系数不可计算：有效簇不足、样本不足或存在退化簇。")
    db = quality.get("davies_bouldin")
    if db is not None:
        notes.append(f"Davies-Bouldin={db:.3f}，该指标越低越好。")
    else:
        notes.append("Davies-Bouldin 不可计算：有效簇不足或聚类退化。")
    ch = quality.get("calinski_harabasz")
    if ch is not None:
        notes.append(f"Calinski-Harabasz={ch:.2f}，该指标越高通常表示簇间分散程度更好。")
    else:
        notes.append("Calinski-Harabasz 不可计算：有效簇不足或聚类退化。")
    if span_days < 14:
        notes.append(f"当前特征窗口约 {span_days:.1f} 天，周周期与功能区类型只能作为初步假设。")
    return notes


def _build_pairwise_analysis(
    summaries: list[dict[str, Any]],
    scaled: np.ndarray,
    cluster_index: dict[int, list[int]],
    names: list[str],
) -> tuple[list[dict[str, Any]], dict[int, list[dict[str, Any]]]]:
    normal = [summary for summary in summaries if int(summary["cluster_id"]) >= 0]
    centroids = {
        int(summary["cluster_id"]): np.mean(
            scaled[cluster_index[int(summary["cluster_id"])]], axis=0
        )
        for summary in normal
    }
    pairs: list[dict[str, Any]] = []
    by_cluster: dict[int, list[dict[str, Any]]] = {int(summary["cluster_id"]): [] for summary in normal}
    for index, left in enumerate(normal):
        left_id = int(left["cluster_id"])
        for right in normal[index + 1:]:
            right_id = int(right["cluster_id"])
            a = left["feature_means"]
            b = right["feature_means"]
            centroid_gap = np.abs(centroids[left_id] - centroids[right_id])
            gap_index = int(np.argmax(centroid_gap))
            gap_feature = names[gap_index]
            gap_label = FEATURE_LABELS.get(gap_feature, {}).get("zh", gap_feature)
            correlation = _profile_correlation(left["intraday_profile"], right["intraday_profile"])
            mean_pct = _pct_diff(a.get("mean"), b.get("mean"))
            cv_delta = (a.get("cv") or 0.0) - (b.get("cv") or 0.0)
            weekday_delta = (
                (a.get("weekday_weekend_ratio") or 0.0)
                - (b.get("weekday_weekend_ratio") or 0.0)
            )
            seasonality_delta = (
                (a.get("daily_seasonality") or 0.0)
                - (b.get("daily_seasonality") or 0.0)
            )
            same_type = left["pattern_type"]["key"] == right["pattern_type"]["key"]
            def difference_summary(
                own_id: int,
                other_id: int,
                own: dict[str, float],
                other: dict[str, float],
            ) -> tuple[str, float | None]:
                signed_mean = _pct_diff(own.get("mean"), other.get("mean"))
                signed_cv = (own.get("cv") or 0.0) - (other.get("cv") or 0.0)
                signed_weekday = (
                    (own.get("weekday_weekend_ratio") or 0.0)
                    - (other.get("weekday_weekend_ratio") or 0.0)
                )
                signed_seasonality = (
                    (own.get("daily_seasonality") or 0.0)
                    - (other.get("daily_seasonality") or 0.0)
                )
                text = (
                    f"与簇 {other_id} 相比：平均流量"
                    + (f"{signed_mean:+.1f}%" if signed_mean is not None else "无法计算百分比")
                    + f"，CV 差 {signed_cv:+.3f}，工作日/周末比差 {signed_weekday:+.3f}，"
                    f"日周期强度差 {signed_seasonality:+.3f}；"
                    f"标准化质心差异最大的是{gap_label}（z 差 {float(centroid_gap[gap_index]):.3f}）。"
                )
                return text, signed_mean

            summary_text, _ = difference_summary(left_id, right_id, a, b)
            reverse_summary, _ = difference_summary(right_id, left_id, b, a)
            pattern_prefix = (
                f"两簇的粗粒度模式均为“{left['pattern_type']['label']}”，"
                if same_type
                else f"两簇的粗粒度模式分别为“{left['pattern_type']['label']}”与“{right['pattern_type']['label']}”，"
            )
            why = (
                pattern_prefix
                + f"聚类使用的是 {len(names)} 维标准化特征，不是簇名称。"
                f"标准化质心最大差异为{gap_label}（z 差 {float(centroid_gap[gap_index]):.3f}），"
                + (
                    f"平均流量相差 {abs(mean_pct):.1f}%，"
                    if mean_pct is not None
                    else "平均流量百分比无法计算，"
                )
                + f"CV 差 {cv_delta:+.3f}，工作日/周末比差 {weekday_delta:+.3f}，"
                f"日周期强度差 {seasonality_delta:+.3f}。"
                + (
                    f" 两条 24 小时曲线相关 r={correlation:.3f}，"
                    if correlation is not None
                    else " 曲线相关无法计算，"
                )
                + "因此算法仍将它们保留为独立簇，不能仅凭粗粒度模式名合并。"
            )
            pair = {
                "left_cluster_id": left_id,
                "right_cluster_id": right_id,
                "same_pattern_type": same_type,
                "pattern_type": left["pattern_type"]["label"] if same_type else None,
                "centroid_distance": float(np.linalg.norm(centroids[left_id] - centroids[right_id])),
                "largest_centroid_gap": {
                    "feature": gap_feature,
                    "feature_label_zh": gap_label,
                    "absolute_z_difference": float(centroid_gap[gap_index]),
                },
                "mean_difference_pct": None if mean_pct is None else float(mean_pct),
                "cv_difference": float(cv_delta),
                "weekday_weekend_ratio_difference": float(weekday_delta),
                "daily_seasonality_difference": float(seasonality_delta),
                "profile_correlation": correlation,
                "summary_zh": summary_text,
                "why_separated_zh": why,
            }
            pairs.append(pair)
            by_cluster[left_id].append({
                **pair,
                "other_cluster_id": right_id,
                "summary_zh": summary_text,
            })
            by_cluster[right_id].append({
                **pair,
                "other_cluster_id": left_id,
                "summary_zh": reverse_summary,
            })
    for cluster_id, rows in by_cluster.items():
        rows.sort(key=lambda row: row["centroid_distance"])
    return pairs, by_cluster


def _build_pattern_insights(
    summaries: list[dict[str, Any]],
    pairwise: list[dict[str, Any]],
    quality: dict[str, Any],
    *,
    span_days: float,
    assignment: dict[str, Any],
) -> dict[str, Any]:
    normal = [summary for summary in summaries if int(summary["cluster_id"]) >= 0]
    if not normal:
        return {
            "available": False,
            "items": [],
            "warnings": ["没有有效簇，无法生成典型模式分析。"],
            "details": [],
            "reliability": {"level": "none", "notes": ["有效簇数量为 0。"]},
        }
    items: list[dict[str, Any]] = []
    warnings: list[str] = []
    details: list[dict[str, Any]] = []

    peak_parts = [
        f"簇 {summary['cluster_id']} 峰值 {summary['peak_hour']:02d}:00、"
        f"谷值 {summary['trough_hour']:02d}:00"
        for summary in normal
        if summary.get("peak_hour") is not None and summary.get("trough_hour") is not None
    ]
    items.append(
        {
            "key": "peak_trough",
            "label": "峰谷时刻",
            "text": "各簇真实 24 小时典型曲线：" + "；".join(peak_parts)
            + "。峰值和谷值来自该簇全部成员区域逐小时真实均值的平均曲线。",
            "level": "info",
            "metrics": {
                str(summary["cluster_id"]): {
                    "peak_hour": summary.get("peak_hour"),
                    "trough_hour": summary.get("trough_hour"),
                }
                for summary in normal
            },
        }
    )

    repeated = [pair for pair in pairwise if pair.get("same_pattern_type")]
    for pair in repeated[:2]:
        items.append(
            {
                "key": f"pair_{pair['left_cluster_id']}_{pair['right_cluster_id']}",
                "label": f"簇 {pair['left_cluster_id']} 与簇 {pair['right_cluster_id']}",
                "text": pair["why_separated_zh"],
                "level": "info",
                "metrics": pair,
            }
        )

    if len(items) < 3:
        nearest = min(pairwise, key=lambda pair: pair["centroid_distance"], default=None)
        items.append(
            {
                "key": "pairwise_center",
                "label": "标准化质心差异",
                "text": nearest["summary_zh"] if nearest else "没有可比较的簇。",
                "level": "info",
                "metrics": nearest or {},
            }
        )

    min_size = min(int(summary["region_count"]) for summary in normal)
    reliability_level = "high"
    if span_days < 14:
        warnings.append(
            f"当前特征窗口约 {span_days:.1f} 天，周周期和功能区类型只能作为初步假设。"
        )
        reliability_level = "medium"
    if min_size < 5:
        warnings.append(f"最小簇只有 {min_size} 个区域，簇均值可能受个别区域影响。")
        reliability_level = "low"
    silhouette = quality.get("silhouette")
    if silhouette is not None and silhouette < 0.25:
        warnings.append(
            f"轮廓系数 {silhouette:.3f}，簇间分离度偏弱，不宜把簇差异解释为明确的城市功能分区。"
        )
        reliability_level = "low"
    items.append(
        {
            "key": "reliability",
            "label": "可靠性",
            "text": (
                f"实际得到 {quality.get('n_clusters', len(normal))} 个有效簇，"
                f"{assignment['assigned_regions']}/{assignment['total_regions']} 个区域均有唯一归属。"
                f"观测窗口约 {span_days:.1f} 天；"
                + (
                    f"轮廓系数 {silhouette:.3f}。" if silhouette is not None
                    else "轮廓系数不可计算。"
                )
                + " 粗粒度模式名与土地用途假设均需更长时间数据验证。"
            ),
            "level": "warning" if warnings else "info",
            "metrics": {"span_days": span_days, "silhouette": silhouette},
        }
    )

    for summary in normal:
        details.append(
            {
                "label": f"簇 {summary['cluster_id']}",
                "value": (
                    f"{summary['region_count']} 区域；{summary['pattern_type']['label']}；"
                    f"{summary['characterization']['summary_zh']}"
                ),
            }
        )
    for pair in pairwise:
        details.append(
            {
                "label": f"簇 {pair['left_cluster_id']} vs 簇 {pair['right_cluster_id']}",
                "value": pair["why_separated_zh"],
            }
        )
    return {
        "available": True,
        "items": items[:4],
        "warnings": warnings,
        "details": details,
        "reliability": {
            "level": reliability_level,
            "notes": [
                f"特征窗口约 {span_days:.1f} 天，覆盖一个小样本周期。",
                f"最小簇包含 {min_size} 个区域。",
                "聚类名称是对时间模式的描述，不等同于真实土地使用或功能区验证。",
            ],
        },
    }


def _pca_projection(
    matrix: np.ndarray,
    labels: np.ndarray,
    region_ids: list[str],
    names: list[str],
) -> dict[str, Any]:
    """PCA is visualisation only; clustering uses the original scaled matrix."""
    if matrix.shape[0] < 2 or matrix.shape[1] < 2:
        return {
            "available": False,
            "reason": "有效区域或特征少于 2 个，无法生成二维 PCA。",
        }
    from sklearn.decomposition import PCA

    model = PCA(n_components=2)
    coords = model.fit_transform(matrix)
    return {
        "available": True,
        "method_zh": "对实际参与聚类的标准化特征矩阵执行 PCA；PCA 只用于二维可视化，不参与簇分配。",
        "explained_variance_ratio": [float(value) for value in model.explained_variance_ratio_],
        "projection": [
            {
                "region_id": region_ids[index],
                "cluster_id": int(labels[index]),
                "pc1": float(coords[index, 0]),
                "pc2": float(coords[index, 1]),
            }
            for index in range(len(region_ids))
        ],
        "component_weights": {
            "PC1": {names[index]: float(model.components_[0, index]) for index in range(len(names))},
            "PC2": {names[index]: float(model.components_[1, index]) for index in range(len(names))},
        },
    }


def refresh_cluster_result_names(result: dict[str, Any]) -> dict[str, Any]:
    """Recompute descriptive names from a stored run without changing labels.

    Older results were saved with the previous naming rules.  Rebuilding only
    the explanatory fields keeps their original cluster IDs, region membership,
    colors and quality metrics intact while presenting the current terminology.
    """
    matrix = np.asarray(result.get("feature_matrix") or [], dtype="float64")
    scaled = np.asarray(result.get("scaled_matrix") or [], dtype="float64")
    labels = np.asarray(result.get("labels") or [], dtype="int64")
    names = list(result.get("feature_names") or [])
    clusters = list(result.get("clusters") or [])
    if (
        matrix.size == 0
        or scaled.size == 0
        or labels.size == 0
        or not names
        or not clusters
    ):
        return result

    feature_means_by_cluster = {
        int(summary["cluster_id"]): summary.get("feature_means", {})
        for summary in clusters
        if int(summary["cluster_id"]) >= 0
    }
    for summary in clusters:
        cluster_id = int(summary["cluster_id"])
        if cluster_id < 0:
            continue
        pattern_type = _pattern_type(
            summary.get("feature_means", {}),
            matrix,
            names,
        )
        summary["pattern_type"] = pattern_type
        summary["display_name"] = f"簇 {cluster_id}（{pattern_type['label']}）"
        summary["label_zh"] = summary["display_name"]
        summary["characterization"] = _characterization(
            cluster_id, feature_means_by_cluster
        )
        summary["inferred_zone_type"] = {
            "label": pattern_type["label"],
            "is_inferred": False,
            "hypothesis_zh": None,
            "evidence": pattern_type["evidence"],
            "disclaimer_zh": "该名称仅描述当前数据中的统计特征，不代表真实土地用途。",
        }

    cluster_index = {
        int(cluster_id): [
            position for position, label in enumerate(labels.tolist())
            if int(label) == int(cluster_id)
        ]
        for cluster_id in feature_means_by_cluster
    }
    pairwise, pair_by_cluster = _build_pairwise_analysis(
        clusters, scaled, cluster_index, names
    )
    for summary in clusters:
        summary["differences"] = pair_by_cluster.get(int(summary["cluster_id"]), [])
    quality = result.get("quality") or {}
    assignment = result.get("assignment") or {}
    span_days = float(result.get("sample_window_days") or 0.0)
    result["pairwise_differences"] = pairwise
    result["pattern_insights"] = _build_pattern_insights(
        clusters,
        pairwise,
        quality,
        span_days=span_days,
        assignment=assignment,
    )
    result["disclaimer_zh"] = (
        "簇模式名来自真实流量特征及其在当前有效区域中的统计位置；"
        "不推断商业、办公、住宅或通勤等真实土地用途。"
    )
    result["name_rule_version"] = "distribution_percentile_v2"
    return result


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
    resolved = resolve_range(
        source["key"],
        frequency,
        time_start=params.get("time_start") or None,
        time_end=params.get("time_end") or None,
        start_index=params.get("start_index"),
        window_points=params.get("window_points"),
        path_prefix="m2",
    )
    if has_blocking(resolved.issues):
        raise RequestRejected(
            [issue for issue in resolved.issues if issue["severity"] == "error"],
            message="聚类时间范围校验未通过",
        )
    start = resolved.start_index
    stop = resolved.end_index
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
    raw_scaler_std = matrix.std(axis=0)
    scaler_std = np.where(raw_scaler_std < 1e-12, 1.0, raw_scaler_std)
    standardize_applied = bool(params.get("standardize", True))
    scaled = (matrix - scaler_mean) / scaler_std if standardize_applied else matrix
    report("Clustering", 45.0, f"运行 {ALGORITHM_LABELS[params['algorithm']]}")
    labels, algo_detail = _cluster_labels(scaled, params)
    if np.any(labels < 0):
        raise ValueError("聚类算法返回了无效簇标签，无法生成可靠的功能区结果。")
    quality = _quality_metrics(scaled, labels)
    report("Summarising", 75.0, "计算簇摘要与典型模式")

    profile = intraday_profile(ts, values)
    weekly = weekly_profile(ts, values)
    span_days = (
        float(ts[-1] - ts[0]) / 86400.0 + frequency_minutes / 1440.0
        if ts.size > 1
        else 0.0
    )
    cluster_index = {int(c): [] for c in sorted({int(x) for x in labels.tolist()})}
    for position, label in enumerate(labels.tolist()):
        cluster_index.setdefault(int(label), []).append(position)

    cluster_summaries = []
    for label, positions in sorted(cluster_index.items()):
        region_position = list(positions)
        member_regions = [kept_regions[p] for p in positions]
        intraday = [
            float(v) if np.isfinite(v) else None
            for v in _row_nanmean(profile[:, region_position])
        ]
        extremes = _profile_extremes(intraday)
        finite_profile = [value for value in intraday if value is not None]
        profile_mean = float(np.mean(finite_profile)) if finite_profile else None
        summary = {
            "cluster_id": label,
            "label_zh": f"簇 {label}",
            "region_count": len(positions),
            "regions": member_regions,
            "feature_means": {
                names[f]: float(np.nanmean(matrix[positions, f])) for f in range(len(names))
            },
            "intraday_profile": intraday,
            "normalized_profile": [
                (value / profile_mean) if value is not None and profile_mean and abs(profile_mean) > 1e-12 else None
                for value in intraday
            ],
            "weekly_profile": [float(v) if np.isfinite(v) else None
                               for v in _row_nanmean(weekly[:, region_position])],
            "mean_level": float(np.nanmean(matrix[positions, 0])) if positions else None,
            "peak_hour": extremes["peak_hour"],
            "peak_value": extremes["peak_value"],
            "trough_hour": extremes["trough_hour"],
            "trough_value": extremes["trough_value"],
            "inferred_zone_type": None,
        }
        cluster_summaries.append(summary)

    feature_means_by_cluster = {
        int(summary["cluster_id"]): summary["feature_means"]
        for summary in cluster_summaries
    }
    for summary in cluster_summaries:
        cluster_id = int(summary["cluster_id"])
        pattern_type = _pattern_type(summary["feature_means"], matrix, names)
        characterization = _characterization(cluster_id, feature_means_by_cluster)
        summary["pattern_type"] = pattern_type
        summary["display_name"] = f"簇 {cluster_id}（{pattern_type['label']}）"
        summary["label_zh"] = summary["display_name"]
        summary["characterization"] = characterization
        summary["inferred_zone_type"] = {
            "label": pattern_type["label"],
            "is_inferred": False,
            "hypothesis_zh": pattern_type["hypothesis_zh"],
            "evidence": pattern_type["evidence"],
            "disclaimer_zh": (
                "该名称仅描述当前数据中的统计特征，不代表真实土地用途。"
            ),
        }
        notes = [f"该簇包含 {summary['region_count']} 个区域。"]
        level = "medium"
        if summary["region_count"] < 5:
            level = "low"
            notes.append("成员区域少于 5 个，簇均值容易受个别区域影响。")
        if span_days < 14:
            notes.append(f"观测窗口约 {span_days:.1f} 天，尚不足以稳定验证周周期。")
        notes.append("模式类型用于描述流量形状，不代表已验证的土地用途。")
        summary["reliability"] = {"level": level, "notes": notes}

    pairwise, pair_by_cluster = _build_pairwise_analysis(
        cluster_summaries, scaled, cluster_index, names
    )
    for summary in cluster_summaries:
        summary["differences"] = pair_by_cluster.get(int(summary["cluster_id"]), [])

    sizes = {
        int(summary["cluster_id"]): int(summary["region_count"])
        for summary in cluster_summaries
    }
    assigned_regions = sum(sizes.values())
    assignment = {
        "total_regions": len(kept_regions),
        "assigned_regions": assigned_regions,
        "unique_region_count": len(set(kept_regions)),
        "cluster_sizes": sizes,
        "sum_cluster_counts": assigned_regions,
        "all_regions_assigned_once": assigned_regions == len(kept_regions),
    }
    expected_clusters = None
    if params["algorithm"] == "kmeans":
        expected_clusters = int(params.get("n_clusters", 4))
    elif params["algorithm"] == "spectral":
        expected_clusters = int(params.get("spectral_n_clusters", 4))
    elif params["algorithm"] == "hierarchical":
        expected_clusters = int(params.get("hierarchical_n_clusters", 4))
    elif params["algorithm"] == "gmm":
        expected_clusters = int(params.get("gmm_n_components", 4))
    cluster_count_check = {
        "requested": expected_clusters,
        "actual": int(quality["n_clusters"]),
        "matches": expected_clusters is None or expected_clusters == int(quality["n_clusters"]),
    }
    quality["sample_window_days"] = span_days
    quality["assignment_check"] = assignment
    quality["interpretation"] = _quality_interpretation(quality, span_days)
    quality["notes"].extend(quality["interpretation"])
    standardization = {
        "applied": standardize_applied,
        "method": "Z-score（每个特征减去区域均值并除以总体标准差 ddof=0）",
        "feature_stats": {
            names[index]: {
                "mean": float(scaler_mean[index]),
                "std": float(raw_scaler_std[index]),
                "zero_variance": bool(raw_scaler_std[index] < 1e-12),
                "scaled_mean": float(np.mean(scaled[:, index])) if standardize_applied else None,
                "scaled_std": float(np.std(scaled[:, index])) if standardize_applied else None,
            }
            for index in range(len(names))
        },
        "note_zh": (
            "聚类在标准化后的特征矩阵上执行；原始 Mean/Std 等数值用于解释，不直接决定距离。"
            if standardize_applied
            else "本次未启用标准化，聚类距离直接使用原始特征量级。"
        ),
    }
    pattern_insights = _build_pattern_insights(
        cluster_summaries,
        pairwise,
        quality,
        span_days=span_days,
        assignment=assignment,
    )

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
    pca = _pca_projection(scaled, labels, kept_regions, names)
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
        "standardization": standardization,
        "assignment": assignment,
        "cluster_count_check": cluster_count_check,
        "pairwise_differences": pairwise,
        "pattern_insights": pattern_insights,
        "sample_window_days": span_days,
        "range": resolved.to_public(),
        "pca": pca,
        "dropped_regions": dropped,
        "no_data_regions": [r["region_id"] for r in regions_for(source["source_id"], has_timeseries=False)],
        "time_start": str(ts[0]) if ts.size else None,
        "time_end": str(ts[-1]) if ts.size else None,
        "frequency": frequency,
        "aggregation": aggregation,
        "feature_help": {key: FEATURE_LABELS[key] for key in names if key in FEATURE_LABELS},
        "disclaimer_zh": (
            "簇模式名来自真实流量特征及其在当前有效区域中的统计位置；"
            "不推断商业、办公、住宅或通勤等真实土地用途。"
        ),
        "name_rule_version": "distribution_percentile_v2",
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
