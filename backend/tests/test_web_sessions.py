"""Anonymous session workspace isolation regressions."""

from __future__ import annotations

import sqlite3

from app.runtime_paths import use_paths
from app.web_sessions import SessionManager


def _bootstrap_fixture() -> dict:
    from app.runtime_paths import ensure_current_dirs, current_db_path, current_processed_dir

    ensure_current_dirs()
    conn = sqlite3.connect(str(current_db_path()))
    try:
        conn.execute("CREATE TABLE marker(value TEXT NOT NULL)")
        conn.execute("INSERT INTO marker(value) VALUES ('base')")
        conn.commit()
    finally:
        conn.close()
    (current_processed_dir() / "ready.txt").write_text("base", encoding="utf-8")
    return {}


def test_anonymous_sessions_have_independent_databases_and_artifacts(tmp_path):
    manager = SessionManager(_bootstrap_fixture, root=tmp_path / "sessions")
    manager.initialize()
    first = manager.create()
    second = manager.create()
    try:
        assert first.token != second.token
        assert first.paths.db_path != second.paths.db_path
        assert first.paths.artifacts_dir != second.paths.artifacts_dir

        with use_paths(first.paths):
            first_conn = sqlite3.connect(str(first.paths.db_path))
            first_conn.execute("INSERT INTO marker(value) VALUES ('first')")
            first_conn.commit()
            first_conn.close()
            (first.paths.artifacts_dir / "only-first.txt").write_text("1", encoding="utf-8")

        first_rows = sqlite3.connect(str(first.paths.db_path)).execute(
            "SELECT value FROM marker ORDER BY value"
        ).fetchall()
        second_rows = sqlite3.connect(str(second.paths.db_path)).execute(
            "SELECT value FROM marker ORDER BY value"
        ).fetchall()
        assert first_rows == [("base",), ("first",)]
        assert second_rows == [("base",)]
        assert (first.paths.artifacts_dir / "only-first.txt").exists()
        assert not (second.paths.artifacts_dir / "only-first.txt").exists()
    finally:
        manager.shutdown()
