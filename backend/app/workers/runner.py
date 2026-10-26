"""Durable worker process.

Jobs live in the ``jobs`` table; the worker claims them in order, writes real
progress and heartbeat data, honours cooperative cancellation and survives
browser refreshes or restarts (spec 13.3 / 10.2).

Run with:  python -m app.workers.runner
"""

from __future__ import annotations

import os
import signal
import socket
import sys
import time
import traceback

from app.core.config import settings
from app.core.ids import now_utc, ulid
from app.db.connection import get_connection, json_dumps, json_loads, query_all, query_one
from app.db.maintenance import purge_legacy_dbscan_history
from app.db.migrate import run_migrations
from app.runtime_limits import MODEL_JOB_SLOTS
from app.runtime_paths import ensure_current_dirs
from app.workers.tasks import ProgressReporter, run_clustering, run_evaluation, run_experiment

WORKER_ID = f"{socket.gethostname()}-{os.getpid()}-{ulid()[:6]}"
_stop = False


def _handle_signal(signum, frame):  # pragma: no cover
    global _stop
    _stop = True
    print(f"[worker] signal {signum} received, finishing current job then exiting", flush=True)


def recover_stale_jobs() -> int:
    """Jobs whose worker died are marked Interrupted instead of pretending to run."""
    conn = get_connection()
    rows = query_all(
        "SELECT job_id, job_type, experiment_id, evaluation_id, cluster_run_id FROM jobs WHERE state = 'Running'"
    )
    if not rows:
        return 0
    for row in rows:
        conn.execute(
            "UPDATE jobs SET state='Interrupted', error_code='WORKER_RESTART', "
            "error='worker restarted while job was running', ended_at=? WHERE job_id=?",
            (now_utc(), row["job_id"]),
        )
        if row["experiment_id"]:
            conn.execute(
                "UPDATE experiments SET status=CASE WHEN region_completed>0 THEN 'Partial' ELSE 'Failed' END, "
                "error='worker restarted', ended_at=? WHERE experiment_id=? AND status IN ('Running','Queued','Stopping')",
                (now_utc(), row["experiment_id"]),
            )
            conn.execute(
                "UPDATE experiment_region_models SET status='Failed', error='worker restarted' "
                "WHERE experiment_id=? AND status IN ('Running','Queued')",
                (row["experiment_id"],),
            )
        if row["evaluation_id"]:
            conn.execute(
                "UPDATE evaluations SET status='Failed', error='worker restarted', ended_at=? "
                "WHERE evaluation_id=? AND status IN ('Running','Queued','Stopping')",
                (now_utc(), row["evaluation_id"]),
            )
        if row["cluster_run_id"]:
            conn.execute(
                "UPDATE clusters SET status='Failed', error='worker restarted' WHERE cluster_run_id=?",
                (row["cluster_run_id"],),
            )
    return len(rows)


def _cancel_requested(row) -> bool:
    if row["cancel_requested"]:
        return True
    if row["parent_batch_id"]:
        batch = query_one("SELECT cancel_requested FROM batches WHERE batch_id=?", (row["parent_batch_id"],))
        if batch and batch["cancel_requested"]:
            return True
    if row["experiment_id"]:
        exp = query_one("SELECT cancel_requested FROM experiments WHERE experiment_id=?", (row["experiment_id"],))
        if exp and exp["cancel_requested"]:
            return True
    if row["evaluation_id"]:
        ev = query_one("SELECT cancel_requested FROM evaluations WHERE evaluation_id=?", (row["evaluation_id"],))
        if ev and ev["cancel_requested"]:
            return True
    return False


def claim_next_job():
    conn = get_connection()
    conn.execute("BEGIN IMMEDIATE")
    try:
        row = conn.execute(
            """
            SELECT * FROM jobs WHERE state = 'Queued'
            ORDER BY sequence_no ASC, created_at ASC LIMIT 1
            """
        ).fetchone()
        if row is None:
            conn.execute("COMMIT")
            return None
        conn.execute(
            "UPDATE jobs SET state='Running', worker_id=?, started_at=?, heartbeat_at=? WHERE job_id=?",
            (WORKER_ID, now_utc(), now_utc(), row["job_id"]),
        )
    except Exception:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")
    return query_one("SELECT * FROM jobs WHERE job_id=?", (row["job_id"],))


def skip_pending_jobs_of_cancelled_batches() -> int:
    """Batch stop must mark not-yet-started jobs as Skipped, never leave them queued."""
    conn = get_connection()
    stale = query_all(
        """
        SELECT j.job_id, j.experiment_id FROM jobs j
        JOIN batches b ON b.batch_id = j.parent_batch_id
        WHERE b.cancel_requested = 1 AND j.state = 'Queued'
        """
    )
    for row in stale:
        conn.execute(
            "UPDATE jobs SET state='Skipped', error_code='BATCH_STOPPED', "
            "error='batch stop requested before this job started', ended_at=? WHERE job_id=?",
            (now_utc(), row["job_id"]),
        )
        if row["experiment_id"]:
            conn.execute(
                "UPDATE experiments SET status='Skipped', ended_at=?, "
                "error='batch stop requested before job started' WHERE experiment_id=? AND status='Queued'",
                (now_utc(), row["experiment_id"]),
            )
    return len(stale)


def finalise_batch(batch_id: str) -> None:
    """Derive real batch status/summary from its member experiments."""
    rows = query_all("SELECT * FROM experiments WHERE batch_id=?", (batch_id,))
    if not rows:
        return
    counts: dict[str, int] = {}
    for row in rows:
        counts[row["status"]] = counts.get(row["status"], 0) + 1
    total = len(rows)
    completed = counts.get("Completed", 0)
    partial = counts.get("Partial", 0)
    failed = counts.get("Failed", 0)
    skipped = counts.get("Skipped", 0) + counts.get("Unavailable", 0)
    stopped = counts.get("Stopped", 0)
    running = counts.get("Running", 0) + counts.get("Queued", 0) + counts.get("Stopping", 0)
    if running:
        status = "Running"
    elif stopped and completed + partial == 0:
        status = "Stopped"
    elif partial or (completed and (failed or skipped)):
        status = "Partial"
    elif failed and not completed:
        status = "Failed"
    elif skipped == total:
        status = "Failed"
    else:
        status = "Completed"
    summary = {
        "total": total,
        "completed": completed,
        "partial": partial,
        "failed": failed,
        "skipped": skipped,
        "stopped": stopped,
        "running": running,
        "by_status": counts,
    }
    get_connection().execute(
        "UPDATE batches SET status=?, task_summary_json=?, ended_at=CASE WHEN ? IN "
        "('Completed','Partial','Failed','Stopped') THEN ? ELSE ended_at END WHERE batch_id=?",
        (status, json_dumps(summary), status, now_utc(), batch_id),
    )


def execute_job(row) -> tuple[str, str | None]:
    job_id = row["job_id"]
    reporter = ProgressReporter(job_id, row["experiment_id"])
    cancel = lambda: _cancel_requested(row)  # noqa: E731

    def run_experiment_with_stop():
        exp = query_one("SELECT status FROM experiments WHERE experiment_id=?", (row["experiment_id"],))
        if exp and exp["status"] == "Skipped":
            return {"status": "Skipped"}
        get_connection().execute(
            "UPDATE experiments SET status='Running', started_at=? WHERE experiment_id=?",
            (now_utc(), row["experiment_id"]),
        )
        return run_experiment(row["experiment_id"], job_id=job_id, cancel_requested=cancel, progress=reporter)

    try:
        if row["job_type"] == "experiment":
            result = run_experiment_with_stop()
        elif row["job_type"] == "evaluation":
            get_connection().execute(
                "UPDATE evaluation_experiments SET status='Running' WHERE evaluation_id=? AND status='Queued'",
                (row["evaluation_id"],),
            )
            result = run_evaluation(row["evaluation_id"], job_id=job_id, cancel_requested=cancel, progress=reporter)
        elif row["job_type"] == "clustering":
            result = run_clustering(row["cluster_run_id"], job_id=job_id, cancel_requested=cancel, progress=reporter)
        else:
            raise ValueError(f"未知作业类型 {row['job_type']}")
        status = result.get("status", "Completed") if isinstance(result, dict) else "Completed"
        final_state = "Completed" if status not in ("Failed",) else "Failed"
        if status == "Stopped":
            final_state = "Stopped"
        get_connection().execute(
            "UPDATE jobs SET state=?, ended_at=?, progress_json=? WHERE job_id=?",
            (final_state, now_utc(), json_dumps({**reporter.payload, "percent": 100.0}), job_id),
        )
        if row["parent_batch_id"]:
            finalise_batch(row["parent_batch_id"])
        return final_state, None
    except Exception as exc:
        detail = f"{type(exc).__name__}: {exc}"
        get_connection().execute(
            "UPDATE jobs SET state='Failed', error_code=?, error=?, ended_at=? WHERE job_id=?",
            (type(exc).__name__, f"{detail}\n{traceback.format_exc(limit=4)}", now_utc(), job_id),
        )
        if row["experiment_id"]:
            get_connection().execute(
                "UPDATE experiments SET status='Failed', error=?, ended_at=? WHERE experiment_id=?",
                (detail, now_utc(), row["experiment_id"]),
            )
        if row["evaluation_id"]:
            get_connection().execute(
                "UPDATE evaluations SET status='Failed', error=?, ended_at=? WHERE evaluation_id=?",
                (detail, now_utc(), row["evaluation_id"]),
            )
        if row["cluster_run_id"]:
            get_connection().execute(
                "UPDATE clusters SET status='Failed', error=? WHERE cluster_run_id=?",
                (detail, row["cluster_run_id"]),
            )
        if row["parent_batch_id"]:
            finalise_batch(row["parent_batch_id"])
        return "Failed", detail


def run_worker_loop(stop_event=None, *, identity: str = "standalone") -> None:
    """Run the durable queue loop in either a process or a session thread."""
    ensure_current_dirs()
    applied = run_migrations()
    purge_legacy_dbscan_history()
    recovered = recover_stale_jobs()
    print(
        f"[worker] id={WORKER_ID} scope={identity} db={get_connection().execute('PRAGMA database_list').fetchone()['file']} "
        f"migrations={applied or 'up-to-date'} "
        f"recovered_stale_jobs={recovered}",
        flush=True,
    )
    idle_since = time.time()
    while not _stop and not (stop_event and stop_event.is_set()):
        skipped = skip_pending_jobs_of_cancelled_batches()
        if skipped:
            print(f"[worker] marked {skipped} queued jobs as Skipped after batch stop", flush=True)
        job = claim_next_job()
        if job is None:
            if time.time() - idle_since > 3600:
                print("[worker] idle for 1h, still alive", flush=True)
                idle_since = time.time()
            time.sleep(settings.worker_poll_seconds)
            continue
        idle_since = time.time()
        print(f"[worker] start job {job['job_id']} type={job['job_type']}", flush=True)
        started = time.time()
        with MODEL_JOB_SLOTS:
            state, error = execute_job(job)
        print(
            f"[worker] job {job['job_id']} -> {state} in {time.time() - started:.1f}s"
            + (f" error={error}" if error else ""),
            flush=True,
        )
    print("[worker] stopped", flush=True)


def main() -> None:
    global _stop
    signal.signal(signal.SIGINT, _handle_signal)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _handle_signal)
    run_worker_loop()


if __name__ == "__main__":
    sys.exit(main() or 0)
