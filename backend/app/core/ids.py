"""Readable, collision-resistant identifier helpers (spec 7.3 / 10.1)."""

from __future__ import annotations

import secrets
import time
import unicodedata
from datetime import datetime, timezone


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


def dataset_id(source_key: str, scope: str) -> str:
    return f"DS-{slug(source_key)}-{slug(scope, 'SINGLE')}-{ulid()[:12]}"


def experiment_id(algorithm_key: str) -> str:
    return f"EXP-{slug(algorithm_key)}-{ulid()[:12]}"


def batch_id() -> str:
    return f"BATCH-{ulid()[:16]}"


def evaluation_id() -> str:
    return f"EVAL-{ulid()[:16]}"


def cluster_run_id() -> str:
    return f"CLUS-{ulid()[:16]}"


def job_id() -> str:
    return f"JOB-{ulid()[:16]}"


def now_utc() -> str:
    """ISO-8601 UTC timestamp, second resolution, suffix kept as Z."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

