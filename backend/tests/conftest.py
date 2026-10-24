import os
import shutil
import sys
import tempfile
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SOURCE_DATA_DIR = PROJECT_ROOT / "data"
TEST_DATA_DIR = Path(tempfile.mkdtemp(prefix="tn-traffic-pytest-"))

shutil.copytree(SOURCE_DATA_DIR / "raw", TEST_DATA_DIR / "raw")
os.environ["TN_DATA_DIR"] = str(TEST_DATA_DIR)
os.environ["TN_DB_PATH"] = str(TEST_DATA_DIR / "tn_traffic.db")
os.environ["TN_MODEL_CACHE"] = str(PROJECT_ROOT / "models_cache")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture(scope="session", autouse=True)
def apply_schema_and_history_ids():
    from app.core.ids import now_utc
    from app.db.connection import get_connection, json_dumps
    from app.db.history_ids import migrate_readable_history_ids
    from app.db.migrate import run_migrations
    from app.services.datasets import create_dataset
    from app.services.ingest import import_all

    run_migrations()
    migrate_readable_history_ids()
    import_all()

    base_payload = {
        "source_key": "milano",
        "scope": "single",
        "frequency": "native",
        "aggregation": "mean",
        "input_length": 24,
        "output_length": 6,
        "step": 1,
        "train_ratio": 0.7,
        "val_ratio": 0.15,
        "test_ratio": 0.15,
        "missing_mode": "automatic",
        "scaling": "standard",
        "time_start": "2013-11-01 00:00:00",
        "time_end": "2013-11-07 23:50:00",
    }
    adriano = create_dataset({**base_payload, "region_id": "ADRIANO"})
    brera = create_dataset({**base_payload, "region_id": "BRERA"})

    experiment_id = "EXP-MILANO-ADRIANO-RANDOM-FOREST-0001"
    failed_experiment_id = "EXP-MILANO-ADRIANO-ARIMA-0001"
    batch_id = "BATCH-MILANO-ADRIANO-MODELS-0001"
    cluster_id = "CLUS-MILANO-KMEANS-0001"
    evaluation_id = "EVAL-0001"
    created_at = now_utc()
    snapshot = {
        "dataset_snapshot": {
            "dataset_id": adriano["dataset_id"],
            "hash": adriano["hash"],
            "L": adriano["L"],
            "H": adriano["H"],
            "S": adriano["S"],
            "frequency": adriano["frequency"],
            "split_boundaries": adriano["split_boundaries"],
            "preprocess": adriano["preprocess"],
        },
        "algorithm_params": {"n_estimators": 30, "max_depth": 6, "random_state": 42},
        "mode": "direct",
        "region_ids": ["ADRIANO"],
        "region_experiment_ids": {"ADRIANO": experiment_id},
        "batch_id": batch_id,
        "frozen_at": created_at,
    }
    failed_snapshot = {
        **snapshot,
        "algorithm_params": {"order": [1, 1, 1]},
        "region_experiment_ids": {"ADRIANO": failed_experiment_id},
        "batch_id": None,
    }
    conn = get_connection()
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute(
            """
            INSERT INTO clusters (
                cluster_run_id, display_id, source_id, algorithm_key, params_json,
                features_json, frequency, aggregation, region_count, cluster_count,
                noise_count, status, metrics_json, result_json, created_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,'Completed','{}','{}',?)
            """,
            (
                cluster_id,
                cluster_id,
                "SRC-MILANO",
                "kmeans",
                json_dumps({"n_clusters": 4}),
                json_dumps({"selected": ["mean", "std"]}),
                "native",
                "mean",
                88,
                4,
                0,
                created_at,
            ),
        )
        conn.execute(
            """
            INSERT INTO batches (
                batch_id, display_id, dataset_id, scope, algorithm_count, region_count,
                planned_tasks, policy_json, params_snapshot_json, task_summary_json,
                status, created_at, started_at, ended_at
            ) VALUES (?,?,?,'single',12,1,12,'{}','{}','{}','Completed',?,?,?)
            """,
            (
                batch_id,
                batch_id,
                adriano["dataset_id"],
                created_at,
                created_at,
                created_at,
            ),
        )
        for current_id, status, error, current_snapshot in (
            (experiment_id, "Completed", None, snapshot),
            (failed_experiment_id, "Failed", "fixture failure", failed_snapshot),
        ):
            current_batch = batch_id if current_id == experiment_id else None
            conn.execute(
                """
                INSERT INTO experiments (
                    experiment_id, dataset_id, batch_id, algorithm_key, algorithm_label,
                    display_id, category, mode, scope, params_json, snapshot_json, status,
                    region_total, region_completed, region_failed, error, metrics_json,
                    created_at, started_at, ended_at
                ) VALUES (?,?,?,?,?,?,?,?,?,'{}',?,?,1,?,0,?, '{}',?,?,?)
                """,
                (
                    current_id,
                    adriano["dataset_id"],
                    current_batch,
                    "random_forest" if current_id == experiment_id else "arima",
                    "Random Forest" if current_id == experiment_id else "ARIMA",
                    current_id,
                    "machine_learning" if current_id == experiment_id else "statistical",
                    "direct",
                    "single",
                    json_dumps(current_snapshot),
                    status,
                    1 if status == "Completed" else 0,
                    error,
                    created_at,
                    created_at,
                    created_at,
                ),
            )
            conn.execute(
                """
                INSERT INTO experiment_region_models (
                    experiment_id, region_id, region_experiment_id, status,
                    metrics_json, started_at, ended_at, error
                ) VALUES (?,?,?,?,'{}',?,?,?)
                """,
                (
                    current_id,
                    "ADRIANO",
                    current_id,
                    status,
                    created_at,
                    created_at,
                    error,
                ),
            )
        conn.execute(
            """
            INSERT INTO evaluations (
                evaluation_id, dataset_id, batch_id, source_id, scope, region_id,
                protocol_json, test_range_json, metrics_summary_json, status,
                progress_json, created_at, started_at, ended_at
            ) VALUES (?,?,?,?,'single','ADRIANO','{}','{}','{}','Completed','{}',?,?,?)
            """,
            (
                evaluation_id,
                adriano["dataset_id"],
                batch_id,
                "SRC-MILANO",
                created_at,
                created_at,
                created_at,
            ),
        )
        conn.execute(
            """
            INSERT INTO evaluation_experiments (
                evaluation_id, experiment_id, algorithm_key, coverage_regions,
                sample_count, metrics_json, status
            ) VALUES (?,?,'random_forest',1,0,'{}','Completed')
            """,
            (evaluation_id, experiment_id),
        )
    except Exception:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")
