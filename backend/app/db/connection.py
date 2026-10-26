"""SQLite access layer.

SQLite is the local metadata store (spec 12.1).  WAL mode plus a busy timeout is
used because the API process and the worker process are separate OS processes.
"""

from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from app.runtime_paths import current_db_path


_local = threading.local()


def _connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=30.0, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=30000")
    return conn


def get_connection() -> sqlite3.Connection:
    connections = getattr(_local, "connections", None)
    if connections is None:
        connections = {}
        _local.connections = connections
    key = str(current_db_path().resolve())
    conn = connections.get(key)
    if conn is None:
        conn = _connect(current_db_path())
        connections[key] = conn
    return conn


def close_current_connections() -> None:
    """Close only the database connections owned by the current thread."""
    connections = getattr(_local, "connections", None)
    if not connections:
        return
    for conn in connections.values():
        try:
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            conn.close()
        except sqlite3.Error:
            pass
    connections.clear()


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    """Explicit transaction: commits on success, rolls back on any failure."""
    conn = get_connection()
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except Exception:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")


def query_all(sql: str, params: tuple | dict = ()) -> list[sqlite3.Row]:
    return list(get_connection().execute(sql, params).fetchall())


def query_one(sql: str, params: tuple | dict = ()) -> sqlite3.Row | None:
    return get_connection().execute(sql, params).fetchone()


def execute(sql: str, params: tuple | dict = ()) -> sqlite3.Cursor:
    return get_connection().execute(sql, params)


def json_dumps(value) -> str:
    import json

    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)


def json_loads(value):
    import json

    if value in (None, ""):
        return None
    if isinstance(value, (dict, list)):
        return value
    return json.loads(value)

