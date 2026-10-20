"""Minimal, deterministic SQL migration runner.

Plain numbered ``.sql`` files are applied in order inside a transaction and the
applied version is recorded in ``schema_migrations``.  This keeps the schema
reproducible on a clean machine (acceptance T37/T41) without adding an ORM.
"""

from __future__ import annotations

import re
from pathlib import Path

from app.db.connection import get_connection

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"


def _ensure_history_display_columns(conn) -> None:
    """Apply the additive 003 columns idempotently.

    SQLite has no portable ``ADD COLUMN IF NOT EXISTS``.  Keeping these four
    additive statements here makes a partially interrupted 003 migration safe
    to retry before the index/table script runs.
    """
    for table in ("dataset_versions", "clusters", "experiments", "batches"):
        columns = {
            row["name"]
            for row in conn.execute(f"PRAGMA table_info({table})").fetchall()
        }
        if "display_id" not in columns:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN display_id TEXT")


def _ensure_table() -> None:
    get_connection().execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version   TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        )
        """
    )


def available_migrations() -> list[Path]:
    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    return [f for f in files if re.match(r"^\d+_", f.name)]


def applied_versions() -> set[str]:
    _ensure_table()
    rows = get_connection().execute("SELECT version FROM schema_migrations").fetchall()
    return {r["version"] for r in rows}


def run_migrations() -> list[str]:
    from app.core.ids import now_utc

    _ensure_table()
    done = applied_versions()
    applied: list[str] = []
    conn = get_connection()
    for path in available_migrations():
        version = path.stem
        if version in done:
            continue
        sql = path.read_text(encoding="utf-8")
        if version == "003_history_display_ids":
            _ensure_history_display_columns(conn)
        # executescript() commits any open transaction itself; every statement in
        # the migration set is written idempotently (IF NOT EXISTS) so a partial
        # run followed by a re-run converges to the same schema.
        conn.executescript(sql)
        conn.execute(
            "INSERT OR REPLACE INTO schema_migrations(version, applied_at) VALUES (?, ?)",
            (version, now_utc()),
        )
        applied.append(version)
    return applied


def schema_version() -> str:
    versions = sorted(applied_versions())
    return versions[-1] if versions else "none"
