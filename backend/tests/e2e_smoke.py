"""End-to-end smoke test over the real HTTP API.

Run with the API and the worker already started:

    python backend/tests/e2e_smoke.py

It drives the whole chain Home -> Dataset -> Experiment/Batch -> Evaluation with
real data and prints the observed results (no mocks anywhere).
"""

from __future__ import annotations

import json
import sys
import time

import httpx

BASE = "http://127.0.0.1:8077"
CLIENT = httpx.Client(base_url=BASE, timeout=1800)


def step(title: str) -> None:
    print(f"\n=== {title} ===", flush=True)


def wait_experiment(experiment_id: str, timeout: int = 1800) -> dict:
    started = time.time()
    while time.time() - started < timeout:
        payload = CLIENT.get(f"/api/experiments/{experiment_id}").json()
        if payload["status"] not in ("Queued", "Running", "Stopping"):
            return payload
        time.sleep(2)
    raise TimeoutError(experiment_id)


def main() -> int:
    step("health")
    health = CLIENT.get("/api/health").json()
    print(json.dumps({k: health[k] for k in ("status", "version", "database")}, ensure_ascii=False)[:400])
    assert health["database"]["ok"], "database not available"

    step("data sources")
    sources = CLIENT.get("/api/data/sources").json()
    print("totals:", json.dumps(sources["totals"], ensure_ascii=False))
    assert sources["totals"]["series_regions"] == 459
    assert sources["totals"]["gis_regions"] == 473

    step("build dataset (ZTE single region, 1h)")
    payload = {
        "values": {
            "source_key": "zte", "scope": "single", "region_id": "370102001",
            "frequency": "60min", "aggregation": "mean", "input_length": 24, "output_length": 6,
            "step": 2, "train_ratio": 0.7, "val_ratio": 0.15, "test_ratio": 0.15,
            "missing_mode": "automatic", "scaling": "standard", "label": "e2e smoke",
        }
    }
    validate = CLIENT.post("/api/datasets/validate", json=payload).json()
    print("validate:", validate["valid"], [(i["path"], i["code"]) for i in validate["issues"]])
    assert validate["valid"]
    built = CLIENT.post("/api/datasets/build", json=payload).json()
    dataset_id = built["dataset_id"]
    print("dataset:", dataset_id, built["window_counts"])
    assert built["status"] == "Built"

    step("negative API test: bypass the frontend with dropout=1.5")
    bad = CLIENT.post(
        "/api/experiments/run",
        json={"dataset_id": dataset_id, "algorithm_key": "mlp", "params": {"dropout": 1.5}},
    )
    print("status", bad.status_code, "issues", json.dumps(bad.json().get("issues"), ensure_ascii=False)[:240])
    assert bad.status_code == 422
    assert any(i["path"].endswith("dropout") for i in bad.json()["issues"])

    step("single experiment (ARIMA)")
    run = CLIENT.post(
        "/api/experiments/run",
        json={"dataset_id": dataset_id, "algorithm_key": "arima", "params": {}},
    ).json()
    final = wait_experiment(run["experiment_id"])
    print("experiment:", final["experiment_id"], final["status"], final["metrics"].get("macro_validation"))
    assert final["status"] in ("Completed", "Partial")

    step("All Models batch (12 algorithms)")
    batch = CLIENT.post(
        "/api/batches/run",
        json={
            "dataset_id": dataset_id,
            "model_configs": {},
            "execution_policy": {"continue_on_error": True, "skip_unavailable_after_confirmation": True},
            "idempotency_key": f"e2e-{dataset_id}",
        },
    ).json()
    batch_id = batch["batch_id"]
    print("batch:", batch_id, "planned tasks:", batch["planned_region_model_tasks"])
    started = time.time()
    while time.time() - started < 2400:
        state = CLIENT.get(f"/api/batches/{batch_id}").json()
        if state["status"] not in ("Running", "Created", "Stopping"):
            break
        time.sleep(10)
    print("batch status:", state["status"], state["task_summary"])
    assert state["status"] in ("Completed", "Partial")

    step("evaluation (full test, same protocol)")
    experiments = [
        e["experiment_id"]
        for e in state["experiments"]
        if e["status"] in ("Completed", "Partial")
    ]
    evaluation = CLIENT.post(
        "/api/evaluations/run",
        json={
            "dataset_id": dataset_id,
            "scope": "single",
            "region_id": "370102001",
            "experiment_ids": experiments,
            "test_selection": "full",
        },
    ).json()
    evaluation_id = evaluation["evaluation_id"]
    started = time.time()
    while time.time() - started < 2400:
        result = CLIENT.get(f"/api/evaluations/{evaluation_id}").json()
        if result["status"] not in ("Queued", "Running", "Stopping"):
            break
        time.sleep(8)
    print("evaluation:", evaluation_id, result["status"], "predictions:", result.get("prediction_count"))
    for row in result["metrics_summary"].get("ranking", []):
        macro = row["macro"]
        r2 = "N/A" if macro["r2"] is None else round(macro["r2"], 4)
        wape = "N/A" if macro.get("wape") is None else round(macro["wape"], 2)
        print(
            f"  {row['rank']:>2}. {row['algorithm_label']:<14} WAPE={wape} RMSE={macro['rmse']:.4g} "
            f"MAE={macro['mae']:.4g} sMAPE={macro['smape']:.2f} R2={r2}"
        )
    assert result["status"] == "Completed"
    print("\nALL E2E STEPS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
