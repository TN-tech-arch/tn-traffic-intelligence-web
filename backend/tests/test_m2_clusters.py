"""Module 2 integration checks on the real Milano Hierarchical K=4 result."""

import copy
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.api.deps import create_job
from app.core.config import settings
from app.core.ids import cluster_run_id as make_cluster_id, now_utc
from app.db.connection import get_connection, query_one
from app.db.maintenance import purge_legacy_dbscan_history
from app.main import app
from app.services.clustering import refresh_cluster_result_names, run_clustering
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
            "spectral",
            {
                "spectral_n_clusters": 4,
                "spectral_affinity": "nearest_neighbors",
                "spectral_n_neighbors": 10,
                "random_state": 42,
            },
            {"affinity", "n_neighbors", "n_clusters", "implementation"},
            4,
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
        assert result["cluster_count_check"] == {
            "requested": expected_clusters,
            "actual": expected_clusters,
            "matches": True,
        }
        assert state["metrics"]["n_clusters"] == expected_clusters
        assert state["metrics"]["noise_points"] == 0
        assert all(item["cluster_id"] >= 0 for item in result["clusters"])
    finally:
        client.delete(f"/api/clusters/{run_id}")


def test_spectral_rbf_uses_real_spectral_model_and_parameters():
    payload = hierarchical_payload()
    payload["values"].update(
        {
            "algorithm": "spectral",
            "spectral_n_clusters": 4,
            "spectral_affinity": "rbf",
            "spectral_gamma": 0.7,
            "random_state": 17,
        }
    )
    created = client.post("/api/clusters/run", json=payload)
    assert created.status_code == 200, created.text
    run_id = created.json()["cluster_run_id"]
    try:
        result = run_clustering(
            run_id,
            job_id="test-spectral-rbf",
            cancel_requested=lambda: False,
        )
        assert result["algorithm"] == "spectral"
        assert result["algorithm_detail"] == {
            "n_clusters": 4,
            "affinity": "rbf",
            "gamma": 0.7,
            "random_state": 17,
            "implementation": "sklearn.cluster.SpectralClustering",
        }
        assert len(set(result["labels"])) == 4
        assert result["quality"]["noise_points"] == 0
        assert all(item["cluster_id"] >= 0 for item in result["clusters"])
    finally:
        client.delete(f"/api/clusters/{run_id}")


def test_removed_dbscan_algorithm_is_rejected_without_persisting_a_run():
    payload = hierarchical_payload()
    payload["values"]["algorithm"] = "dbscan"
    payload["values"]["eps"] = 1.2
    payload["values"]["min_samples"] = 3
    before = len(client.get("/api/clusters?limit=500").json()["runs"])
    rejected = client.post("/api/clusters/run", json=payload)
    assert rejected.status_code == 422
    assert any(
        issue["path"] == "m2.algorithm" and issue["code"] == "ENUM_INVALID"
        for issue in rejected.json()["issues"]
    )
    after = len(client.get("/api/clusters?limit=500").json()["runs"])
    assert after == before


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
        assert clusters[0]["display_name"] == "簇 0（高流量·高波动型）"
        assert clusters[1]["display_name"] == "簇 1（中高流量·波动适中型）"
        assert clusters[2]["display_name"] == "簇 2（中低流量·高波动型）"
        assert clusters[3]["display_name"] == "簇 3（中流量·平稳型）"
        assert len({cluster["display_name"] for cluster in clusters.values()}) == 4
        assert clusters[0]["pattern_type"]["is_hypothesis"] is False
        assert clusters[0]["pattern_type"]["evidence"]["mean_percentile"] > 0.85
        assert clusters[2]["pattern_type"]["evidence"]["cv_percentile"] > 0.75
        assert clusters[0]["characterization"]["summary_zh"] != clusters[2]["characterization"]["summary_zh"]
        assert clusters[1]["characterization"]["summary_zh"] != clusters[3]["characterization"]["summary_zh"]
        cluster1_vs_0 = next(
            item for item in clusters[1]["differences"]
            if item["other_cluster_id"] == 0
        )
        assert cluster1_vs_0["summary_zh"].startswith("与簇 0 相比")
        assert "分别为" in cluster1_vs_0["why_separated_zh"]

        insight_keys = [item["key"] for item in result["pattern_insights"]["items"]]
        assert insight_keys == ["peak_trough", "pairwise_center", "reliability"]
        pairs = {
            tuple(sorted((pair["left_cluster_id"], pair["right_cluster_id"]))): pair
            for pair in result["pairwise_differences"]
        }
        assert {(0, 2), (1, 3)}.issubset(pairs)
        assert pairs[(0, 2)]["profile_correlation"] > 0.9
        assert pairs[(1, 3)]["profile_correlation"] > 0.9
        assert "两条 24 小时曲线相关" in pairs[(0, 2)]["why_separated_zh"]
        assert result["pattern_insights"]["reliability"]["level"] == "low"

        labels_before = list(result["labels"])
        membership_before = [
            (item["region_id"], item["cluster_id"]) for item in result["regions"]
        ]
        names_before = [
            cluster["display_name"] for cluster in result["clusters"]
        ]
        refreshed = refresh_cluster_result_names(copy.deepcopy(result))
        assert refreshed["labels"] == labels_before
        assert [
            (item["region_id"], item["cluster_id"]) for item in refreshed["regions"]
        ] == membership_before
        assert [
            cluster["display_name"] for cluster in refreshed["clusters"]
        ] == names_before

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


def test_dbscan_cleanup_is_scoped_and_preserves_other_histories():
    conn = get_connection()
    source = query_one("SELECT source_id FROM data_sources WHERE key = 'milano'")
    assert source is not None
    run_id = make_cluster_id()
    preserved_before = conn.execute(
        "SELECT COUNT(*) AS n FROM clusters WHERE lower(algorithm_key) <> 'dbscan'"
    ).fetchone()["n"]
    artifact = Path(settings.artifacts_dir) / "clusters" / run_id
    artifact.mkdir(parents=True, exist_ok=True)
    (artifact / "result.json").write_text('{"legacy":true}', encoding="utf-8")
    conn.execute(
        """
        INSERT INTO clusters (
            cluster_run_id, source_id, algorithm_key, params_json, features_json,
            frequency, aggregation, region_count, cluster_count, noise_count,
            status, artifact_ref, created_at
        ) VALUES (?, ?, 'dbscan', '{}', '{}', 'native', 'mean', 88, 2, 22,
                  'Completed', ?, ?)
        """,
        (run_id, source["source_id"], str(artifact), now_utc()),
    )
    job_id = create_job(
        job_type="clustering",
        payload={"cluster_run_id": run_id},
        cluster_run_id=run_id,
    )
    conn.execute(
        "INSERT INTO audit_events (resource, resource_id, action, detail_json, created_at) "
        "VALUES ('cluster', ?, 'finished', '{}', ?)",
        (run_id, now_utc()),
    )

    cleanup = purge_legacy_dbscan_history()

    assert run_id in cleanup["cluster_run_ids"]
    assert cleanup["cluster_rows_deleted"] == 1
    assert cleanup["job_rows_deleted"] == 1
    assert cleanup["audit_rows_deleted"] == 1
    assert not artifact.exists()
    assert query_one(
        "SELECT cluster_run_id FROM clusters WHERE cluster_run_id = ?", (run_id,)
    ) is None
    assert query_one(
        "SELECT job_id FROM jobs WHERE job_id = ?", (job_id,)
    ) is None
    preserved_after = conn.execute(
        "SELECT COUNT(*) AS n FROM clusters WHERE lower(algorithm_key) <> 'dbscan'"
    ).fetchone()["n"]
    assert preserved_after == preserved_before


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
