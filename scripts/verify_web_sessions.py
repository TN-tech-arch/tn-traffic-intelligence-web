"""Verify public anonymous sessions, isolated histories, and reset numbering."""

from __future__ import annotations

import os
import time

import httpx


BASE = os.environ.get("TN_UI_BASE", "http://127.0.0.1:7860")
BUILD_VALUES = {
    "source_key": "milano",
    "scope": "single",
    "region_id": "ADRIANO",
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


def wait_until_ready(timeout: float = 180.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            response = httpx.get(f"{BASE}/api/health", timeout=10.0)
            if response.status_code == 200 and response.json()["status"] == "ok":
                return
        except Exception:
            pass
        time.sleep(2.0)
    raise RuntimeError("web application did not become healthy")


def build_dataset(client: httpx.Client) -> str:
    response = client.post(f"{BASE}/api/datasets/build", json={"values": BUILD_VALUES}, timeout=180.0)
    response.raise_for_status()
    body = response.json()
    assert body["status"] == "Built"
    return str(body["dataset_id"])


def history_count(client: httpx.Client) -> int:
    response = client.get(f"{BASE}/api/datasets?include_archived=true", timeout=30.0)
    response.raise_for_status()
    return len(response.json()["datasets"])


def run_experiment(client: httpx.Client, dataset_id: str) -> str:
    response = client.post(
        f"{BASE}/api/experiments/run",
        json={
            "dataset_id": dataset_id,
            "algorithm_key": "random_forest",
            "params": {
                "n_estimators": 8,
                "max_depth": 4,
                "n_jobs": 1,
                "random_state": 42,
            },
        },
        timeout=60.0,
    )
    response.raise_for_status()
    experiment_id = str(response.json()["experiment_id"])
    assert experiment_id == "EXP-MILANO-ADRIANO-RANDOM-FOREST-0001"
    deadline = time.time() + 180.0
    while time.time() < deadline:
        detail = client.get(f"{BASE}/api/experiments/{experiment_id}", timeout=30.0).json()
        if detail["status"] in {"Completed", "Partial", "Failed"}:
            assert detail["status"] in {"Completed", "Partial"}, detail
            return experiment_id
        time.sleep(1.0)
    raise RuntimeError(f"experiment {experiment_id} did not finish")


def main() -> None:
    wait_until_ready()
    with httpx.Client(follow_redirects=True) as first, httpx.Client(follow_redirects=True) as second:
        assert first.get(f"{BASE}/", timeout=30.0).status_code == 200
        assert second.get(f"{BASE}/", timeout=30.0).status_code == 200
        assert "tn_web_session" in first.cookies
        assert "tn_web_session" in second.cookies
        assert first.cookies["tn_web_session"] != second.cookies["tn_web_session"]
        assert history_count(first) == 0
        assert history_count(second) == 0

        first_id = build_dataset(first)
        second_id = build_dataset(second)
        assert first_id == "DS-MILANO-ADRIANO-0001"
        assert second_id == "DS-MILANO-ADRIANO-0001"
        assert history_count(first) == 1
        assert history_count(second) == 1
        run_experiment(first, first_id)
        run_experiment(second, second_id)

        with httpx.Client(follow_redirects=True) as fresh:
            assert fresh.get(f"{BASE}/", timeout=30.0).status_code == 200
            assert history_count(fresh) == 0
            assert build_dataset(fresh) == "DS-MILANO-ADRIANO-0001"

    print("PASS sessions isolate histories, workers, and sequence numbering")


if __name__ == "__main__":
    main()
