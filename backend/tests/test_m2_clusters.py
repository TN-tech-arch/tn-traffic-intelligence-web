"""Module 2 integration checks on the real Milano Hierarchical K=4 result."""

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.clustering import run_clustering
from app.services.series import resample

client = TestClient(app)


def hierarchical_payload():
    return {
        "values": {
            "source_key": "milano",
            "frequency": "native",
            "aggregation": "mean",
            "time_start": "2013-11-01 00:00:00",
            "time_end": "2013-11-07 23:50:00",
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


@pytest.mark.parametrize(
    ("algorithm", "algorithm_params", "detail_keys", "expected_clusters"),
    [
        (
            "kmeans",
            {"n_clusters": 4, "n_init": 10, "random_state": 42},
            {"inertia", "n_iter"},
            4,
        ),
        (
            "dbscan",
            {"eps": 1.2, "min_samples": 3},
            {"core_samples"},
            None,
        ),
        (
            "hierarchical",
            {
                "hierarchical_n_clusters": 4,
                "linkage": "ward",
                "metric": "euclidean",
            },
            {"linkage", "metric"},
            4,
        ),
        (
            "gmm",
            {
                "gmm_n_components": 4,
                "covariance_type": "diag",
                "reg_covar": 1e-6,
                "random_state": 42,
            },
            {"converged", "n_iter", "bic"},
            4,
        ),
    ],
)
def test_all_four_algorithms_execute_and_persist_real_results(
    algorithm, algorithm_params, detail_keys, expected_clusters
):
    payload = hierarchical_payload()
    payload["values"]["algorithm"] = algorithm
    payload["values"].update(algorithm_params)

    created = client.post("/api/clusters/run", json=payload)
    assert created.status_code == 200, created.text
    run_id = created.json()["cluster_run_id"]
    try:
        result = run_clustering(
            run_id,
            job_id=f"test-{algorithm}",
            cancel_requested=lambda: False,
        )
        state = client.get(f"/api/clusters/{run_id}").json()

        assert state["status"] == "Completed"
        assert state["algorithm_key"] == algorithm
        assert state["result"]["algorithm"] == algorithm
        assert result["range"]["points"] == 1008
        assert result["pca"]["available"] is True
        assert detail_keys.issubset(result["algorithm_detail"])
        assert len(result["labels"]) == 88
        assert len(result["regions"]) == 88
        assert len({item["region_id"] for item in result["regions"]}) == 88

        assignment = result["assignment"]
        assert assignment["unique_region_count"] == 88
        assert (
            assignment["assigned_regions"] + result["quality"]["noise_points"] == 88
        )
        persisted_assignment = state["metrics"]["assignment_check"]
        assert {
            key: value for key, value in persisted_assignment.items() if key != "cluster_sizes"
        } == {
            key: value for key, value in assignment.items() if key != "cluster_sizes"
        }
        # JSON object keys are strings after the result has been persisted.
        assert {
            int(key): value for key, value in persisted_assignment["cluster_sizes"].items()
        } == assignment["cluster_sizes"]
        if expected_clusters is not None:
            assert result["cluster_count_check"] == {
                "requested": expected_clusters,
                "actual": expected_clusters,
                "matches": True,
            }
            assert state["metrics"]["n_clusters"] == expected_clusters
            assert state["metrics"]["noise_points"] == 0
        else:
            assert result["cluster_count_check"]["requested"] is None
            assert result["algorithm_detail"]["core_samples"] > 0
            assert len(result["clusters"]) > 1
    finally:
        client.delete(f"/api/clusters/{run_id}")


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
        assert result["range"]["start_at"] == "2013-11-01 00:00:00"
        assert result["range"]["end_at"] == "2013-11-07 23:50:00"
        assert result["range"]["points"] == 1008
        assert result["pca"]["available"] is True
        assert len(result["pca"]["explained_variance_ratio"]) == 2
        assert sum(result["pca"]["explained_variance_ratio"]) <= 1.0 + 1e-9
        assert len(result["pca"]["projection"]) == 88

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


def test_date_range_preview_and_invalid_range_rejection():
    payload = hierarchical_payload()
    preview = client.post("/api/clusters/range", json=payload)
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["valid"] is True
    assert body["range"]["points"] == 1008
    assert body["valid_time_points"] == 1008
    assert body["valid_observations"] > 0

    before = len(client.get("/api/clusters?limit=500").json()["runs"])
    invalid = hierarchical_payload()
    invalid["values"]["time_start"] = "2013-11-08 00:00:00"
    invalid["values"]["time_end"] = "2013-11-01 00:00:00"
    rejected = client.post("/api/clusters/run", json=invalid)
    assert rejected.status_code == 422
    assert any(
        issue["path"] == "m2.time_start" and issue["code"] == "DATE_ORDER"
        for issue in rejected.json()["issues"]
    )
    after = len(client.get("/api/clusters?limit=500").json()["runs"])
    assert after == before


def test_time_range_actually_changes_the_feature_input():
    payload = hierarchical_payload()
    payload["values"]["time_end"] = "2013-11-03 23:50:00"
    preview = client.post("/api/clusters/range", json=payload).json()
    assert preview["valid"] is True
    assert preview["range"]["points"] == 432
    assert any(
        issue["code"] == "LIMITED_PERIOD" and issue["severity"] == "warning"
        for issue in preview["issues"]
    )

    created = client.post("/api/clusters/run", json=payload)
    assert created.status_code == 200, created.text
    run_id = created.json()["cluster_run_id"]
    try:
        result = run_clustering(
            run_id,
            job_id="test-clustering-range",
            cancel_requested=lambda: False,
        )
        assert result["range"]["points"] == 432
        data = resample("milano", frequency="native", aggregation="mean")
        start = int(result["range"]["start_index"])
        end = int(result["range"]["end_index"])
        column = data.values[start:end, data.region_ids.index("ADRIANO")]
        expected_mean = float(np.nanmean(column))
        row = next(item for item in result["regions"] if item["region_id"] == "ADRIANO")
        # Source matrices are stored as float32; compare at float32 precision.
        assert abs(row["features"]["mean"] - expected_mean) < 1e-3
    finally:
        client.delete(f"/api/clusters/{run_id}")
