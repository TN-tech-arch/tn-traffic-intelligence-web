"""Audit a TN database for removed full-region records and broken references."""

from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path


def main() -> int:
    configured = os.environ.get("TN_DATA_DIR")
    data_dir = Path(configured) if configured else Path(__file__).resolve().parents[1] / "data"
    conn = sqlite3.connect(str(data_dir / "tn_traffic.db"), timeout=30)
    try:
        non_single = {
            table: conn.execute(
                f"SELECT COUNT(*) FROM {table} WHERE scope != 'single'"
            ).fetchone()[0]
            for table in ("dataset_versions", "experiments", "batches", "evaluations")
        }
        foreign_key_violations = len(conn.execute("PRAGMA foreign_key_check").fetchall())
    finally:
        conn.close()
    result = {
        "datasets": non_single["dataset_versions"],
        "experiments": non_single["experiments"],
        "batches": non_single["batches"],
        "evaluations": non_single["evaluations"],
        "foreign_key_violations": foreign_key_violations,
    }
    print(json.dumps(result, ensure_ascii=False))
    return 1 if any(result.values()) else 0


if __name__ == "__main__":
    raise SystemExit(main())
