"""Readable, collision-resistant identifier helpers (spec 7.3 / 10.1).

Human-facing history IDs (DS / CLUS / EXP / BATCH) use a persisted sequence per
prefix.  The sequence table is advanced atomically in its own connection, so a
deleted record never frees its number for reuse and two API requests cannot
receive the same value.
"""

from __future__ import annotations

import secrets
import sqlite3
import time
import unicodedata
from datetime import datetime, timezone

from app.core.config import settings


_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def _crockford(value: int, length: int) -> str:
    out = []
    for _ in range(length):
        out.append(_ALPHABET[value % 32])
        value //= 32
    return "".join(reversed(out))


def ulid() -> str:
    """26 character lexicographically sortable ULID."""
    ts = int(time.time() * 1000)
    randomness = secrets.randbits(80)
    return _crockford(ts, 10) + _crockford(randomness, 16)


def slug(text: str, fallback: str = "SRC") -> str:
    """ASCII-safe uppercase slug used inside identifiers."""
    normalized = unicodedata.normalize("NFKD", text or "")
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    cleaned = "".join(ch if ch.isalnum() else "-" for ch in ascii_only.upper())
    while "--" in cleaned:
        cleaned = cleaned.replace("--", "-")
    cleaned = cleaned.strip("-")
    return cleaned[:24] or fallback


def _next_sequence(key: str) -> int:
    """Allocate the next sequence for ``key`` without reusing deleted numbers.

    A short-lived autocommit connection is deliberate: if the surrounding
    business transaction rolls back, the consumed sequence is not rolled back
    and can never be reassigned to a different record.
    """
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(settings.db_path), timeout=30.0, isolation_level=None)
    try:
        conn.execute("PRAGMA busy_timeout=30000")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS readable_id_sequences (
                sequence_key TEXT PRIMARY KEY,
                next_value   INTEGER NOT NULL,
                updated_at   TEXT NOT NULL
            )
            """
        )
        row = conn.execute(
            """
            INSERT INTO readable_id_sequences (sequence_key, next_value, updated_at)
            VALUES (?, 2, ?)
            ON CONFLICT(sequence_key) DO UPDATE
                SET next_value = readable_id_sequences.next_value + 1,
                    updated_at = excluded.updated_at
            RETURNING next_value - 1
            """,
            (key, now_utc()),
        ).fetchone()
        if row is None:  # pragma: no cover - SQLite >= 3.35 always returns a row
            raise RuntimeError(f"无法分配 ID 序号: {key}")
        return int(row[0])
    finally:
        conn.close()


def readable_id(prefix: str, parts: list[str]) -> str:
    normalized = [slug(part, "NA") for part in parts if part not in (None, "")]
    key = "|".join([prefix, *normalized])
    sequence = _next_sequence(key)
    return "-".join([prefix, *normalized, f"{sequence:04d}"])


def readable_ids(prefix: str, parts_list: list[list[str]]) -> list[str]:
    """Allocate several readable IDs in one durable SQLite transaction."""
    if not parts_list:
        return []
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(settings.db_path), timeout=30.0, isolation_level=None)
    try:
        conn.execute("PRAGMA busy_timeout=30000")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS readable_id_sequences (
                sequence_key TEXT PRIMARY KEY,
                next_value   INTEGER NOT NULL,
                updated_at   TEXT NOT NULL
            )
            """
        )
        conn.execute("BEGIN IMMEDIATE")
        output: list[str] = []
        for parts in parts_list:
            normalized = [slug(part, "NA") for part in parts if part not in (None, "")]
            key = "|".join([prefix, *normalized])
            row = conn.execute(
                """
                INSERT INTO readable_id_sequences (sequence_key, next_value, updated_at)
                VALUES (?, 2, ?)
                ON CONFLICT(sequence_key) DO UPDATE
                    SET next_value = readable_id_sequences.next_value + 1,
                        updated_at = excluded.updated_at
                RETURNING next_value - 1
                """,
                (key, now_utc()),
            ).fetchone()
            if row is None:  # pragma: no cover
                raise RuntimeError(f"无法分配 ID 序号: {key}")
            output.append("-".join([prefix, *normalized, f"{int(row[0]):04d}"]))
        conn.execute("COMMIT")
        return output
    except Exception:
        try:
            conn.execute("ROLLBACK")
        except sqlite3.Error:
            pass
        raise
    finally:
        conn.close()


def dataset_id(source_key: str, scope: str, region_id: str | None = None) -> str:
    region = "REGIONS" if scope == "all" else (slug(region_id or "", "REGION"))
    return readable_id("DS", [source_key, region])


def cluster_run_id(source_key: str, algorithm_key: str) -> str:
    return readable_id("CLUS", [source_key, algorithm_key])


def experiment_id(
    source_key: str,
    scope: str,
    model_key: str,
    region_id: str | None = None,
) -> str:
    region = "REGIONS" if scope == "all" else (slug(region_id or "", "REGION"))
    return readable_id("EXP", [source_key, region, model_key])


def region_experiment_ids(
    source_key: str,
    model_key: str,
    region_ids: list[str],
) -> dict[str, str]:
    ids = readable_ids("EXP", [[source_key, region_id, model_key] for region_id in region_ids])
    return dict(zip(region_ids, ids))


def batch_id(
    source_key: str,
    scope: str,
    *,
    model_key: str | None = None,
    region_id: str | None = None,
) -> str:
    """BATCH-{DATASET}-{REGION|REGIONS}-{MODEL|MODELS}-{SEQUENCE}."""
    region = "REGIONS" if scope == "all" else (slug(region_id or "", "REGION"))
    model = slug(model_key, "MODELS") if model_key else "MODELS"
    return readable_id("BATCH", [source_key, region, model])


def evaluation_id() -> str:
    return f"EVAL-{ulid()[:16]}"


def job_id() -> str:
    return f"JOB-{ulid()[:16]}"


def now_utc() -> str:
    """ISO-8601 UTC timestamp, second resolution, suffix kept as Z."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

