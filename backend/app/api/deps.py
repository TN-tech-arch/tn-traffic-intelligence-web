"""Shared API helpers: durable job creation and structured error answers."""

from __future__ import annotations

import time
from typing import Any

from app.core.errors import Issue, RequestRejected, has_errors
from app.core.ids import job_id as make_job_id, now_utc
from app.db.connection import get_connection, json_dumps


def next_sequence() -> int:
    row = get_connection().execute("SELECT COALESCE(MAX(sequence_no), 0) AS n FROM jobs").fetchone()
    return int(row["n"]) + 1


def raise_if_invalid(issues: list[Issue], *, status_code: int = 422, message: str = "请求参数校验未通过") -> None:
    if has_errors(issues):
        raise RequestRejected(issues, status_code=status_code, message=message)


def create_job(
    *,
    job_type: str,
    payload: dict[str, Any] | None = None,
    parent_batch_id: str | None = None,
    experiment_id: str | None = None,
    evaluation_id: str | None = None,
    cluster_run_id: str | None = None,
    dataset_id: str | None = None,
    region_id: str | None = None,
    sequence_no: int | None = None,
) -> str:
    new_id = make_job_id()
    get_connection().execute(
        """
        INSERT INTO jobs (job_id, job_type, parent_batch_id, experiment_id, evaluation_id, cluster_run_id,
                          dataset_id, region_id, sequence_no, state, progress_json, payload_json, created_at)
        VALUES (?,?,?,?,?,?,?,?,?, 'Queued', '{}', ?, ?)
        """,
        (
            new_id,
            job_type,
            parent_batch_id,
            experiment_id,
            evaluation_id,
            cluster_run_id,
            dataset_id,
            region_id,
            sequence_no if sequence_no is not None else next_sequence(),
            json_dumps(payload or {}),
            now_utc(),
        ),
    )
    return new_id


def job_public(row) -> dict[str, Any]:
    import json

    return {
        "job_id": row["job_id"],
        "job_type": row["job_type"],
        "state": row["state"],
        "progress": json.loads(row["progress_json"] or "{}"),
        "error": row["error"],
        "error_code": row["error_code"],
        "created_at": row["created_at"],
        "started_at": row["started_at"],
        "ended_at": row["ended_at"],
    }
