from __future__ import annotations

import time

from fastapi import APIRouter

from app import __version__
from app.core.config import settings
from app.db.connection import query_one
from app.db.migrate import schema_version
from app.runtime_paths import current_db_path, current_session_id
from app.services.validation import environment_report

router = APIRouter(tags=["health"])
_started_at = time.time()


@router.get("/api/health")
def health() -> dict:
    db_ok = True
    db_error = None
    counts = {}
    try:
        counts = {
            "data_sources": query_one("SELECT COUNT(*) AS n FROM data_sources")["n"],
            "datasets": query_one("SELECT COUNT(*) AS n FROM dataset_versions WHERE status='Built'")["n"],
            "experiments": query_one("SELECT COUNT(*) AS n FROM experiments")["n"],
            "batches": query_one("SELECT COUNT(*) AS n FROM batches")["n"],
            "evaluations": query_one("SELECT COUNT(*) AS n FROM evaluations")["n"],
        }
        running_jobs = query_one(
            "SELECT COUNT(*) AS n FROM jobs WHERE state IN ('Queued','Running')"
        )["n"]
        worker_row = query_one(
            "SELECT MAX(heartbeat_at) AS last FROM jobs WHERE state='Running'"
        )
    except Exception as exc:  # pragma: no cover
        db_ok = False
        db_error = str(exc)
        running_jobs = None
        worker_row = None
    env = environment_report()
    return {
        "status": "ok" if db_ok else "degraded",
        "version": __version__,
        "uptime_seconds": round(time.time() - _started_at, 1),
        "database": {"ok": db_ok, "path": str(current_db_path()), "schema_version": schema_version(),
                     "error": db_error, "counts": counts},
        "session": {"id": current_session_id(), "ephemeral": current_session_id() != "local"},
        "worker": {"pending_jobs": running_jobs, "last_heartbeat": worker_row["last"] if worker_row else None},
        "environment": env,
        "notes": {
            "gpu_required": False,
            "cuda_available": env.get("cuda_available", False),
            "hf_endpoint": settings.hf_endpoint,
        },
    }


@router.get("/api/environment")
def environment() -> dict:
    return environment_report()
