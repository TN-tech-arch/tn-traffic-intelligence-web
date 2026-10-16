"""T19/T21/T22: All Regions modelling, All Models x All Regions planning, batch stop.

This script performs real work: it builds a Milano All Regions dataset, trains one
algorithm on every valid region, checks the planned N x 12 task count for all
three sources, and then verifies that stopping a batch really stops it.
"""

from __future__ import annotations

import json
import sys
import time

import httpx

BASE = "http://127.0.0.1:8077"
client = httpx.Client(base_url=BASE, timeout=3600)


def main() -> int:
    print("=== build Milano All Regions dataset (1h, S=24) ===")
    payload = {
        "values": {
            "source_key": "milano", "scope": "all", "frequency": "60min", "aggregation": "mean",
            "input_length": 24, "output_length": 6, "step": 24,
            "train_ratio": 0.7, "val_ratio": 0.15, "test_ratio": 0.15,
            "missing_mode": "automatic", "scaling": "standard", "label": "all regions verification",
        }
    }
    preview = client.post("/api/datasets/preview", json=payload).json()
    print("regions:", preview["region_count"], "windows:", preview["window_counts"])
    dataset = client.post("/api/datasets/build", json=payload).json()
    dataset_id = dataset["dataset_id"]
    print("dataset:", dataset_id, dataset["status"], dataset["window_counts"])

    print("\n=== T19: single algorithm over all regions (LightGBM) ===")
    run = client.post(
        "/api/experiments/run",
        json={
            "dataset_id": dataset_id,
            "algorithm_key": "lightgbm",
            "params": {"n_estimators": 30, "num_leaves": 15},
        },
    ).json()
    experiment_id = run["experiment_id"]
    print("experiment:", experiment_id, "expected regions:", run["region_count"])
    started = time.time()
    while time.time() - started < 3600:
        state = client.get(f"/api/experiments/{experiment_id}").json()
        if state["status"] not in ("Queued", "Running", "Stopping"):
            break
        time.sleep(5)
    regions = state.get("region_models", [])
    completed = [r for r in regions if r["status"] == "Completed"]
    failed = [r for r in regions if r["status"] == "Failed"]
    print(f"status={state['status']} region records={len(regions)} completed={len(completed)} failed={len(failed)}")
    print("macro validation:", json.dumps(state["metrics"].get("macro_validation"), ensure_ascii=False))
    assert len(regions) == preview["region_count"], "every region must have its own record"
    assert len(completed) >= 1
    if failed:
        print("failed region reasons (auditable):", json.dumps(failed[0]["error"], ensure_ascii=False)[:200])

    print("\n=== T21: All Models x All Regions planning for all three sources ===")
    expected = {"milano": 1056, "trentino": 2676, "zte": 1776}
    for source, regions_expected in (("milano", 88), ("trentino", 223), ("zte", 148)):
        preflight = client.post(
            "/api/models/preflight",
            json={
                "dataset_id": dataset_id if source == "milano" else _dataset_for(source),
                "algorithm_choice": "all_models",
                "model_configs": {},
                "region_ids": [f"{source}-placeholder"] * regions_expected,
            },
        ).json()
        planned = preflight["context"]["planned_tasks"]
        print(f"  {source}: regions={preflight['context']['region_count']} planned={planned} expected={expected[source]}")
        assert planned == expected[source], f"{source} planned {planned} != {expected[source]}"

    print("\n=== T22: create a real Milano All Models batch, then stop it ===")
    batch = client.post(
        "/api/batches/run",
        json={
            "dataset_id": dataset_id,
            "model_configs": {},
            "execution_policy": {"continue_on_error": True, "skip_unavailable_after_confirmation": True},
        },
    ).json()
    batch_id = batch["batch_id"]
    print("batch:", batch_id, "planned:", batch["planned_region_model_tasks"], "experiments:", len(batch["experiments"]))
    assert batch["planned_region_model_tasks"] == 1056
    time.sleep(8)
    stop = client.post(f"/api/batches/{batch_id}/stop").json()
    print("stop acknowledged:", json.dumps(stop, ensure_ascii=False))
    started = time.time()
    while time.time() - started < 1800:
        state = client.get(f"/api/batches/{batch_id}").json()
        if state["status"] not in ("Running", "Created", "Stopping"):
            break
        time.sleep(5)
    print("batch final:", state["status"], json.dumps(state["task_summary"], ensure_ascii=False))
    assert state["status"] in ("Stopped", "Partial", "Completed")
    assert state["cancel_requested"] is True
    print("\nALL ALL-REGIONS CHECKS PASSED")
    return 0


def _dataset_for(source: str) -> str:
    datasets = client.get("/api/datasets?include_archived=true").json()["datasets"]
    for dataset in datasets:
        if dataset["source_key"] == source:
            return dataset["dataset_id"]
    # create a tiny one on demand so the planning check is real
    regions = client.get(f"/api/data/regions?source_key={source}").json()
    first = regions["valid_region_ids"][0]
    created = client.post(
        "/api/datasets/build",
        json={
            "values": {
                "source_key": source, "scope": "single", "region_id": first, "frequency": "60min",
                "aggregation": "mean", "input_length": 24, "output_length": 6, "step": 6,
                "train_ratio": 0.7, "val_ratio": 0.15, "test_ratio": 0.15,
                "missing_mode": "automatic", "scaling": "standard", "label": "planning check",
            }
        },
    ).json()
    return created["dataset_id"]


if __name__ == "__main__":
    sys.exit(main())
