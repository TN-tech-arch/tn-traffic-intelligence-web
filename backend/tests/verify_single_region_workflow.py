"""Verify that M3-M5 expose and run only the single-region workflow."""

from __future__ import annotations

import json
import sys

import httpx

BASE = "http://127.0.0.1:8077"
client = httpx.Client(base_url=BASE, timeout=1800)


def main() -> int:
    datasets = client.get("/api/datasets?include_archived=true").json()["datasets"]
    experiments = client.get("/api/experiments?limit=500").json()["experiments"]
    batches = client.get("/api/batches?limit=200").json()["batches"]
    evaluations = client.get("/api/evaluations?limit=200").json()["evaluations"]

    assert datasets and experiments and batches and evaluations
    assert all(item["scope"] == "single" for item in datasets)
    assert all(item["scope"] == "single" for item in experiments)
    assert all(item["scope"] == "single" for item in batches)
    assert all(item["scope"] == "single" for item in evaluations)

    dataset = next(item for item in datasets if item["region_count"] == 1)
    region = dataset["region_ids"][0]
    rejected_m3 = client.post(
        "/api/datasets/preview",
        json={"source_key": dataset["source_key"], "scope": "all", "region_id": region},
    )
    assert rejected_m3.status_code in (409, 422)

    rejected_m4 = client.post(
        "/api/experiments/run",
        json={
            "dataset_id": dataset["dataset_id"],
            "algorithm_key": "arima",
            "scope": "all",
            "params": {},
        },
    )
    assert rejected_m4.status_code == 409
    assert rejected_m4.json()["code"] == "MULTI_REGION_REMOVED"

    rejected_m5 = client.post(
        "/api/evaluations/validate",
        json={
            "dataset_id": dataset["dataset_id"],
            "scope": "all",
            "region_id": region,
            "experiment_ids": [],
        },
    )
    rejected_body = rejected_m5.json()
    assert rejected_body["valid"] is False
    assert any(item["code"] == "MULTI_REGION_REMOVED" for item in rejected_body["issues"])

    batch_detail = next(
        detail
        for item in batches
        if item["algorithm_count"] == 12
        for detail in [client.get(f"/api/batches/{item['batch_id']}").json()]
        if detail["experiments"]
    )
    print(
        json.dumps(
            {
                "datasets": len(datasets),
                "experiments": len(experiments),
                "batches": len(batches),
                "evaluations": len(evaluations),
                "batch": batch_detail["display_id"],
                "batch_members": len(batch_detail["experiments"]),
                "all_region_api_rejected": True,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
