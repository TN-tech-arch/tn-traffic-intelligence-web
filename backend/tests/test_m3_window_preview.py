"""Module 3 sliding-window preview and saved-dataset consistency tests."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _payload() -> dict:
    return {
        "values": {
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
            "label": "window preview integration",
        }
    }


def test_preview_exposes_all_real_windows_and_navigation_payload():
    response = client.post("/api/datasets/preview", json=_payload())
    assert response.status_code == 200, response.text
    preview = response.json()
    split = preview["preview_split"]
    stats = preview["preview_window_stats"][split]

    assert preview["preview_window_total"] > 2
    assert stats["valid_windows"] == preview["preview_window_total"]
    assert stats["candidate_windows"] >= stats["valid_windows"]
    assert stats["excluded_windows"] == stats["candidate_windows"] - stats["valid_windows"]
    assert preview["preview_overlap_points"] == 23

    selected = client.post(
        "/api/datasets/preview-window",
        json={
            "values": _payload()["values"],
            "split": split,
            "window_index": 1,
            "preview_region_id": preview["preview_region_id"],
        },
    )
    assert selected.status_code == 200, selected.text
    body = selected.json()
    assert body["window_index"] == 1
    assert body["total_windows"] == preview["preview_window_total"]
    assert body["candidate_windows"] == stats["candidate_windows"]
    assert body["excluded_windows"] == stats["excluded_windows"]
    window = body["window"]
    assert len(window["X"]) == 24
    assert len(window["Y"]) == 6
    assert len(window["X_timestamps"]) == 24
    assert len(window["Y_timestamps"]) == 6
    assert window["X_timestamps"][-1] < window["Y_timestamps"][0]
    assert all(value is not None for value in window["Y"])

    rejected = client.post(
        "/api/datasets/preview-window",
        json={
            "values": _payload()["values"],
            "split": split,
            "window_index": body["total_windows"],
            "preview_region_id": preview["preview_region_id"],
        },
    )
    assert rejected.status_code == 409
    assert rejected.json()["code"] == "WINDOW_INDEX_OUT_OF_RANGE"


def test_preview_window_matches_the_saved_dataset_window():
    payload = _payload()
    preview = client.post("/api/datasets/preview", json=payload).json()
    split = preview["preview_split"]
    region_id = preview["preview_region_id"]
    index = 2
    preview_window = client.post(
        "/api/datasets/preview-window",
        json={
            "values": payload["values"],
            "split": split,
            "window_index": index,
            "preview_region_id": region_id,
        },
    ).json()

    built = client.post("/api/datasets/build", json=payload)
    assert built.status_code == 200, built.text
    dataset_id = built.json()["dataset_id"]
    try:
        saved = client.get(
            f"/api/datasets/{dataset_id}/windows",
            params={"split": split, "region_id": region_id, "offset": index, "limit": 1},
        )
        assert saved.status_code == 200, saved.text
        saved_window = saved.json()["windows"][0]
        assert saved_window["origin_index"] == preview_window["window"]["origin_index"]
        assert saved_window["input_start_at"] == preview_window["window"]["input_start_at"]
        assert saved_window["input_end_at"] == preview_window["window"]["input_end_at"]
        assert saved_window["target_start_at"] == preview_window["window"]["target_start_at"]
        assert saved_window["target_end_at"] == preview_window["window"]["target_end_at"]
        assert saved_window["X"] == preview_window["window"]["X"]
        assert saved_window["Y"] == preview_window["window"]["Y"]
    finally:
        client.delete(f"/api/datasets/{dataset_id}")
