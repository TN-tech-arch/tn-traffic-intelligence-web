"""Module 2 integration checks on the real Milano Hierarchical K=4 result."""

import numpy as np
from fastapi.testclient import TestClient

from app.main import app
from app.services.clustering import run_clustering

client = TestClient(app)


def hierarchical_payload():
    return {
        "values": {
            "source_key": "milano",
            "frequency": "native",
            "aggregation": "mean",
            "start_index": 0,
            "window_points": 1008,
            "features": [
                "mean",
                "std",
                "cv",
                "intraday_peak_ratio",
                "day_night_ratio",
                "weekday_weekend_ratio",
                "daily_seasonality",
            ],
            "standardize": True,
            "algorithm": "hierarchical",
            "hierarchical_n_clusters": 4,
            "linkage": "ward",
            "metric": "euclidean",
            "random_state": 42,
        }
    }


def test_hierarchical_k4_has_unique_assignments_and_distinct_explanations():
    created = client.post("/api/clusters/run", json=hierarchical_payload())
    assert created.status_code == 200, created.text
    run_id = created.json()["cluster_run_id"]
    try:
        result = run_clustering(
            run_id,
            job_id="test-clustering-job",
            cancel_requested=lambda: False,
        )
        state = client.get(f"/api/clusters/{run_id}").json()
        assert state["status"] == "Completed"
        assert state["metrics"]["n_clusters"] == 4
        assert state["result"]["cluster_count_check"] == {
            "requested": 4,
            "actual": 4,
            "matches": True,
        }

        assignment = result["assignment"]
        assert assignment["cluster_sizes"] == {0: 13, 1: 40, 2: 11, 3: 24}
        assert assignment["assigned_regions"] == 88
        assert assignment["unique_region_count"] == 88
        assert assignment["sum_cluster_counts"] == 88
        assert assignment["all_regions_assigned_once"] is True

        assert result["standardization"]["applied"] is True
        scale_stats = result["standardization"]["feature_stats"].values()
        assert max(abs(float(item["scaled_mean"])) for item in scale_stats) < 1e-9
        assert all(
            item["zero_variance"] or abs(float(item["scaled_std"]) - 1.0) < 1e-9
            for item in result["standardization"]["feature_stats"].values()
        )
        assert result["algorithm_detail"]["linkage"] == "ward"
        assert result["algorithm_detail"]["metric"] == "euclidean"

        clusters = {cluster["cluster_id"]: cluster for cluster in result["clusters"]}
        assert clusters[0]["pattern_type"]["key"] == clusters[2]["pattern_type"]["key"]
        assert clusters[1]["pattern_type"]["key"] == clusters[3]["pattern_type"]["key"]
        assert clusters[0]["pattern_type"]["key"] != clusters[1]["pattern_type"]["key"]
        assert clusters[0]["characterization"]["summary_zh"] != clusters[2]["characterization"]["summary_zh"]
        assert clusters[1]["characterization"]["summary_zh"] != clusters[3]["characterization"]["summary_zh"]
        cluster1_vs_0 = next(
            item for item in clusters[1]["differences"]
            if item["other_cluster_id"] == 0
        )
        assert cluster1_vs_0["summary_zh"].startswith("与簇 0 相比")
        assert "分别为" in cluster1_vs_0["why_separated_zh"]

        insight_keys = [item["key"] for item in result["pattern_insights"]["items"]]
        assert insight_keys == ["peak_trough", "pair_0_2", "pair_1_3", "reliability"]
        pairs = {
            tuple(sorted((pair["left_cluster_id"], pair["right_cluster_id"]))): pair
            for pair in result["pairwise_differences"]
        }
        assert {(0, 2), (1, 3)}.issubset(pairs)
        assert pairs[(0, 2)]["profile_correlation"] > 0.9
        assert pairs[(1, 3)]["profile_correlation"] > 0.9
        assert "两条 24 小时曲线相关" in pairs[(0, 2)]["why_separated_zh"]
        assert result["pattern_insights"]["reliability"]["level"] == "low"

        quality = state["metrics"]
        assert quality["silhouette"] is not None
        assert quality["davies_bouldin"] is not None
        assert quality["calinski_harabasz"] is not None
        assert quality["sample_window_days"] == 7.0
        assert any("7.0 天" in note for note in quality["notes"])
    finally:
        client.delete(f"/api/clusters/{run_id}")


def test_quality_metrics_explain_when_clusters_are_insufficient():
    from app.services.clustering import _quality_metrics

    matrix = np.array([[0.0, 1.0], [1.0, 2.0], [2.0, 3.0]])
    metrics = _quality_metrics(matrix, np.array([0, 0, 0]))
    assert metrics["silhouette"] is None
    assert metrics["davies_bouldin"] is None
    assert metrics["calinski_harabasz"] is None
    assert "不适用" in metrics["notes"][0]
