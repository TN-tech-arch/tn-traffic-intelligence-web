"""T-A: date <-> index conversion, bounds and empty ranges (Module 1)."""

import pytest

from app.services.time_range import resolve_range
from app.services.validation import validate_m1


def errors(issues):
    return [i for i in issues if i["severity"] == "error"]


def warnings(issues):
    return [i for i in issues if i["severity"] == "warning"]


def test_milano_seven_days_is_1008_points():
    resolved = resolve_range(
        "milano", "native",
        time_start="2013-11-04 00:00:00", time_end="2013-11-10 23:50:00",
    )
    assert resolved.points == 1008
    assert resolved.start_at == "2013-11-04 00:00:00"
    assert resolved.end_at == "2013-11-10 23:50:00"
    assert resolved.interval_minutes == 10
    assert resolved.span_seconds == 7 * 86400
    assert not errors(resolved.issues)


def test_zte_seven_days_is_672_points():
    """ZTE is sampled every 15 minutes, so the same 7 days contain 672 buckets."""
    resolved = resolve_range(
        "zte", "native",
        time_start="2024-07-29 00:00:00", time_end="2024-08-04 23:45:00",
    )
    assert resolved.points == 672
    assert resolved.interval_minutes == 15
    assert resolved.span_seconds == 7 * 86400


def test_resampled_axis_changes_point_count_not_dates():
    hourly = resolve_range(
        "milano", "60min",
        time_start="2013-11-04 00:00:00", time_end="2013-11-10 23:00:00",
    )
    assert hourly.points == 168
    assert hourly.interval_minutes == 60
    native = resolve_range(
        "milano", "native",
        time_start="2013-11-04 00:00:00", time_end="2013-11-10 23:50:00",
    )
    assert native.points == 1008
    assert native.start_at == hourly.start_at


def test_index_mode_converts_back_to_dates():
    resolved = resolve_range("milano", "native", start_index=432, window_points=1008)
    assert resolved.start_at == "2013-11-04 00:00:00"
    assert resolved.end_at == "2013-11-10 23:50:00"
    assert resolved.start_index == 432
    assert resolved.end_index == 1440


def test_start_after_end_is_an_error():
    resolved = resolve_range(
        "milano", "native",
        time_start="2013-11-10 00:00:00", time_end="2013-11-04 00:00:00",
    )
    codes = [i["code"] for i in errors(resolved.issues)]
    assert "DATE_ORDER" in codes


def test_range_outside_source_is_rejected():
    resolved = resolve_range(
        "milano", "native",
        time_start="2020-01-01 00:00:00", time_end="2020-01-02 00:00:00",
    )
    assert "OUT_OF_BOUNDS" in [i["code"] for i in errors(resolved.issues)]


def test_range_partially_outside_is_truncated_with_warning():
    resolved = resolve_range(
        "milano", "native",
        time_start="2013-10-01 00:00:00", time_end="2013-11-02 00:00:00",
    )
    assert resolved.truncated_start is True
    assert resolved.start_at == "2013-11-01 00:00:00"
    assert "TRUNCATED_START" in [i["code"] for i in warnings(resolved.issues)]
    assert not errors(resolved.issues)


def test_range_without_any_bucket_is_rejected():
    """00:05–00:09 contains no 10-minute bucket start, so nothing can be analysed."""
    resolved = resolve_range(
        "milano", "native",
        time_start="2013-11-02 00:05:00", time_end="2013-11-02 00:09:00",
    )
    assert resolved.points == 0
    assert "NO_POINTS" in [i["code"] for i in errors(resolved.issues)]


def test_invalid_datetime_is_a_field_error():
    resolved = resolve_range("milano", "native", time_start="not-a-date", time_end="2013-11-02 00:00:00")
    issues = errors(resolved.issues)
    assert issues and issues[0]["path"] == "m1.time_start"
    assert issues[0]["code"] == "INVALID_DATETIME"


def test_short_range_produces_warning_not_error():
    values = {
        "source_key": "milano",
        "region_ids": ["ADRIANO"],
        "frequency": "native",
        "aggregation": "mean",
        "time_start": "2013-11-02 00:00:00",
        "time_end": "2013-11-02 06:00:00",
        "acf_max_lag": 6,
        "day_start_hour": 6,
        "day_end_hour": 18,
    }
    issues = validate_m1(values, available_regions=["ADRIANO"])
    assert not errors(issues)
    assert any(i["code"] == "SHORT_RANGE" for i in warnings(issues))
    assert any(i["code"] == "LAG_BELOW_DAY" for i in warnings(issues))


def test_day_range_must_be_ordered():
    issues = validate_m1(
        {
            "source_key": "milano", "region_ids": ["ADRIANO"], "frequency": "native",
            "aggregation": "mean", "time_start": "2013-11-02 00:00:00",
            "time_end": "2013-11-03 00:00:00",
            "day_start_hour": 20, "day_end_hour": 6,
        },
        available_regions=["ADRIANO"],
    )
    assert any(i["code"] == "DAY_RANGE" for i in errors(issues))


def test_analysis_rejects_empty_range_but_keeps_other_fields():
    """A range error must be field level and must not fabricate other errors."""
    resolved = resolve_range(
        "milano", "native",
        time_start="2013-11-02 00:05:00", time_end="2013-11-02 00:09:00",
    )
    assert [i["path"] for i in errors(resolved.issues)] == ["m1.time_range"]
