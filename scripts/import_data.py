"""Import and verify the six source files, printing the real verification report."""

from __future__ import annotations

from app.db.migrate import run_migrations
from app.services.ingest import import_all


def main() -> int:
    print("migrations:", run_migrations())
    report = import_all()
    failed = 0
    for key, value in report.items():
        print(
            "{0}: points={1} series_regions={2} gis={3} zeros={4} nan={5} checks_passed={6}".format(
                key, value["time_points"], value["region_columns"], value["gis_features"],
                value["zero_count"], value["nan_count"], value["all_expected_checks_passed"],
            )
        )
        for check in value["checks"]:
            if not check["passed"]:
                failed += 1
                print("   FAILED:", check)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
