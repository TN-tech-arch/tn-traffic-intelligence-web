import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ.setdefault("TN_DATA_DIR", str(Path(__file__).resolve().parents[2] / "data"))


@pytest.fixture(scope="session", autouse=True)
def apply_schema_and_history_ids():
    from app.db.history_ids import migrate_readable_history_ids
    from app.db.migrate import run_migrations

    run_migrations()
    migrate_readable_history_ids()
