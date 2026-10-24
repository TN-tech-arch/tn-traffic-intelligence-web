"""Clear all Module 2-5 history while preserving source data and GIS metadata."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.db.maintenance import clear_all_history
from app.db.migrate import run_migrations


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually delete history. Without this flag no data is changed.",
    )
    args = parser.parse_args()
    run_migrations()
    if not args.apply:
        print(json.dumps({"applied": False, "message": "Use --apply to delete all history."}, ensure_ascii=False))
        return 0
    print(json.dumps({"applied": True, **clear_all_history()}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
