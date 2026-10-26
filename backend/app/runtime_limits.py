"""Process-wide resource limits shared by all anonymous web sessions."""

from __future__ import annotations

import os
import threading


def _positive_int(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError:
        return default
    return max(1, value)


MAX_SESSIONS = _positive_int("TN_MAX_SESSIONS", 8)
SESSION_TTL_SECONDS = _positive_int("TN_SESSION_TTL_SECONDS", 7200)
REQUESTS_PER_MINUTE = _positive_int("TN_REQUESTS_PER_MINUTE", 300)
MAX_MODEL_JOBS = _positive_int("TN_MAX_MODEL_JOBS", 2)

MODEL_JOB_SLOTS = threading.BoundedSemaphore(MAX_MODEL_JOBS)
