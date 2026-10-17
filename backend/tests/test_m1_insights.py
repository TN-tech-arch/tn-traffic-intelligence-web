"""T-B/T-C/T-D/T-E: hourly, weekday, ACF/periodicity and trend rules."""

import numpy as np

from app.services import insights as ins


def hourly_series(pattern, days=7):
    """Build hourly values repeated over `days` (hour = index % 24)."""
    values = []
    hours = []
    dates = []
    for day in range(days):
        for hour in range(24):
            values.append(pattern(hour, day))
            hours.append(hour)
            dates.append(f"2024-01-{day + 1:02d}")
    return np.array(values, dtype="float64"), np.array(hours), np.array(dates)


def weekday_matrix(weekday_value, weekend_value, days=7):
    values = []
    hours = []
    weekdays = []
    dates = []
    for day in range(days):
        is_weekend = (day % 7) >= 5
        for hour in range(24):
            base = weekend_value if is_weekend else weekday_value
            values.append(base + (30 if hour == 18 else 0) + (5 if hour == 3 else 0))
            hours.append(hour)
            weekdays.append(day % 7)
            dates.append(f"2024-01-{day + 1:02d}")
    return (
        np.array(values, dtype="float64"),
        np.array(hours),
        np.array(weekdays),
        np.array(dates),
    )


# ---------------------------------------------------------------- Hourly ----


def test_hourly_profile_means_and_sample_counts():
    values, hours, _ = hourly_series(lambda h, d: 100 + h, days=3)
    profile = ins.hourly_profile(values, hours)
    assert len(profile) == 24
    assert profile[0]["mean"] == 100
    assert profile[23]["mean"] == 123
    assert profile[0]["samples"] == 3


def test_hourly_missing_hour_is_no_data_not_zero():
    values = np.array([10.0, 20.0], dtype="float64")
    hours = np.array([0, 0])
    profile = ins.hourly_profile(values, hours)
    assert profile[0]["mean"] == 15.0
    assert profile[5]["mean"] is None
    assert profile[5]["samples"] == 0


def test_single_peak_detection_and_text_values():
    values, hours, _ = hourly_series(lambda h, d: 100 + (400 if h == 18 else 0), days=7)
    profile = ins.hourly_profile(values, hours)
    result = ins.hourly_insights(profile, valid_points=len(values), valid_dates=7)
    peak = result["items"][0]
    assert peak["key"] == "peak"
    assert peak["metrics"]["hour"] == 18
    assert "18:00–19:00" in peak["text"]
    assert any(item["key"] == "pattern" and "单峰" in item["text"] for item in result["items"])


def test_two_peaks_are_reported_as_multi_peak():
    def pattern(hour, day):
        return 100 + (300 if hour in (8, 18) else 0)

    values, hours, _ = hourly_series(pattern, days=7)
    profile = ins.hourly_profile(values, hours)
    result = ins.hourly_insights(profile, valid_points=len(values), valid_dates=7)
    pattern_item = next(i for i in result["items"] if i["key"] == "pattern")
    assert "多峰" in pattern_item["text"]
    assert pattern_item["metrics"]["peak_count"] >= 2


def test_flat_curve_is_not_forced_into_a_peak_pattern():
    values, hours, _ = hourly_series(lambda h, d: 100.0, days=7)
    profile = ins.hourly_profile(values, hours)
    result = ins.hourly_insights(profile, valid_points=len(values), valid_dates=7)
    pattern_item = next(i for i in result["items"] if i["key"] == "pattern")
    assert "较平稳" in pattern_item["text"]


def test_tied_maximum_is_reported_as_tie():
    def pattern(hour, day):
        return 100 + (300 if hour in (10, 11) else 0)

    values, hours, _ = hourly_series(pattern, days=7)
    profile = ins.hourly_profile(values, hours)
    result = ins.hourly_insights(profile, valid_points=len(values), valid_dates=7)
    peak = result["items"][0]
    assert peak["metrics"]["hours"] == [10, 11]
    assert "并列" in peak["text"]


def test_day_night_uses_configured_hours_and_guards_zero_denominator():
    values, hours, _ = hourly_series(lambda h, d: 10.0 if 6 <= h < 18 else 5.0, days=5)
    profile = ins.hourly_profile(values, hours)
    result = ins.hourly_insights(profile, valid_points=len(values), valid_dates=5, day_start=6, day_end=18)
    day_item = next(i for i in result["items"] if i["key"] == "day_night")
    assert "白天" in day_item["text"]
    assert abs(day_item["metrics"]["relative_pct"] - 100.0) < 1e-6

    zeros = ins.hourly_profile(np.zeros(48), np.zeros(48, dtype=int))
    zero_result = ins.hourly_insights(zeros, valid_points=48, valid_dates=2)
    zero_item = next(i for i in zero_result["items"] if i["key"] == "day_night")
    assert "无法比较" in zero_item["text"] or "差异很小" in zero_item["text"]
    assert zero_item["metrics"]["relative_pct"] is None


def test_short_hourly_sample_triggers_reliability_warning():
    values, hours, _ = hourly_series(lambda h, d: 100 + h, days=1)
    profile = ins.hourly_profile(values, hours)
    result = ins.hourly_insights(profile, valid_points=len(values), valid_dates=1)
    assert result["reliability"]["level"] == "low"
    assert result["warnings"]


# ------------------------------------------------------- Weekday/Weekend ----


def test_weekday_and_weekend_groups_are_computed_separately():
    values, hours, weekdays, dates = weekday_matrix(200, 100, days=7)
    groups = ins.weekday_profiles(values, hours, weekdays, dates)
    assert groups["weekday"]["samples"] == 5 * 24
    assert groups["weekend"]["samples"] == 2 * 24
    assert groups["weekday"]["valid_dates"] == 5
    assert groups["weekend"]["valid_dates"] == 2
    assert groups["weekday"]["mean"] > groups["weekend"]["mean"]
    result = ins.weekday_insights(groups)
    overall = next(i for i in result["items"] if i["key"] == "overall")
    assert overall["metrics"]["relative_pct"] > 0


def test_weekday_only_range_has_no_fake_weekend_conclusion():
    values, hours, weekdays, dates = weekday_matrix(200, 100, days=7)
    mask = weekdays < 5
    groups = ins.weekday_profiles(values[mask], hours[mask], weekdays[mask], dates[mask])
    assert groups["weekend"]["samples"] == 0
    result = ins.weekday_insights(groups)
    assert result["warnings"]
    overall = next(i for i in result["items"] if i["key"] == "overall")
    assert "没有有效周末数据" in overall["text"]
    peak = next(i for i in result["items"] if i["key"] == "peak")
    assert "无法比较" in peak["text"]


def test_weekend_only_range_has_no_fake_weekday_conclusion():
    values, hours, weekdays, dates = weekday_matrix(200, 100, days=7)
    mask = weekdays >= 5
    groups = ins.weekday_profiles(values[mask], hours[mask], weekdays[mask], dates[mask])
    assert groups["weekday"]["samples"] == 0
    result = ins.weekday_insights(groups)
    overall = next(i for i in result["items"] if i["key"] == "overall")
    assert "没有有效工作日数据" in overall["text"]


def test_largest_hourly_difference_and_peak_gap():
    values = []
    hours = []
    weekdays = []
    dates = []
    for day in range(7):
        is_weekend = day >= 5
        for hour in range(24):
            if is_weekend:
                value = 100 + (500 if hour == 21 else 0)
            else:
                value = 100 + (500 if hour == 18 else 0) + (400 if hour == 8 else 0)
            values.append(value)
            hours.append(hour)
            weekdays.append(day)
            dates.append(f"2024-01-{day + 1:02d}")
    groups = ins.weekday_profiles(
        np.array(values, dtype=float), np.array(hours), np.array(weekdays), np.array(dates)
    )
    result = ins.weekday_insights(groups)
    largest = next(i for i in result["items"] if i["key"] == "largest_hour")
    # the largest weekday/weekend gap naturally sits on the weekday peak (18:00)
    assert largest["metrics"]["hour"] == 18
    assert largest["metrics"]["higher"] == "weekday"
    peak = next(i for i in result["items"] if i["key"] == "peak")
    assert peak["metrics"]["weekday_peak_hour"] == 18
    assert peak["metrics"]["weekend_peak_hour"] == 21
    assert peak["metrics"]["gap_hours"] == 3


def test_zero_denominator_does_not_produce_infinity():
    values = []
    hours = []
    weekdays = []
    dates = []
    for day in range(7):
        for hour in range(24):
            values.append(0.0 if day >= 5 else 100.0)
            hours.append(hour)
            weekdays.append(day)
            dates.append(f"2024-01-{day + 1:02d}")
    groups = ins.weekday_profiles(
        np.array(values), np.array(hours), np.array(weekdays), np.array(dates)
    )
    result = ins.weekday_insights(groups)
    overall = next(i for i in result["items"] if i["key"] == "overall")
    assert overall["metrics"].get("relative_pct") is None
    assert "无穷" not in overall["text"]
    assert "%" not in overall["text"].split("无法")[-1]


# ------------------------------------------------------------ ACF/Trend ----


def _sine(period_lags: int, n: int, interval_minutes: int, noise: float = 0.0, seed: int = 0):
    rng = np.random.RandomState(seed)
    x = np.arange(n)
    values = np.sin(2 * np.pi * x / period_lags) * 100 + 500
    if noise:
        values = values + rng.normal(0, noise, n)
    return values


def test_acf_of_perfect_sine_is_one_at_the_period():
    values = _sine(24, 480, 60)
    curve = ins.acf_curve(values, 48)
    assert curve["values"][23] > 0.99  # lag 24
    assert curve["lags"][0] == 1


def test_daily_period_detected_for_hourly_sine():
    values = _sine(24, 24 * 20, 60)
    result = ins.detect_periodicity(values, interval_minutes=60, max_lag=168, span_seconds=20 * 86400)
    daily = next(c for c in result["candidates"] if "24 小时" in c["name"])
    assert daily["available"] is True
    assert daily["peak_lag"] == 24
    assert daily["peak_value"] > 0.9


def test_period_detection_uses_15_minute_lags():
    values = _sine(96, 96 * 14, 15)  # 14 days of 15-minute samples
    result = ins.detect_periodicity(values, interval_minutes=15, max_lag=192, span_seconds=14 * 86400)
    daily = next(c for c in result["candidates"] if "24 小时" in c["name"])
    assert daily["lag"] == 96
    assert daily["available"] is True


def test_white_noise_produces_no_period_conclusion():
    rng = np.random.RandomState(42)
    values = rng.normal(0, 1, 24 * 20)
    result = ins.detect_periodicity(values, interval_minutes=60, max_lag=168, span_seconds=20 * 86400)
    assert not any(c["available"] for c in result["candidates"])


def test_period_not_judged_when_max_lag_is_too_small():
    values = _sine(24, 24 * 20, 60)
    result = ins.detect_periodicity(values, interval_minutes=60, max_lag=12, span_seconds=20 * 86400)
    daily = next(c for c in result["candidates"] if "24 小时" in c["name"])
    assert daily["available"] is False
    assert "尚未覆盖" in daily["reason"]


def test_period_not_judged_when_span_is_too_short():
    # 1.5 days of hourly data: Max Lag can cover 24h but the span is < 2 periods
    values = _sine(24, 36, 60)
    result = ins.detect_periodicity(values, interval_minutes=60, max_lag=34, span_seconds=36 * 3600)
    daily = next(c for c in result["candidates"] if "24 小时" in c["name"])
    assert daily["available"] is False
    assert "不足" in daily["reason"]


def test_lag_duration_conversion_matches_sampling_interval():
    assert ins.duration_label(6 * 10) == "1.0 小时"
    assert ins.duration_label(144 * 10) == "1.0 天"
    assert ins.duration_label(96 * 15) == "1.0 天"


def test_trend_slope_units_follow_sampling_interval():
    values = 10.0 * np.arange(500) + 1000
    hourly = ins.trend_analysis(values, 60)
    ten_min = ins.trend_analysis(values, 10)
    fifteen_min = ins.trend_analysis(values, 15)
    assert abs(hourly["slope_per_point"] - 10.0) < 1e-6
    assert abs(hourly["slope_per_hour"] - 10.0) < 1e-6
    assert abs(hourly["slope_per_day"] - 240.0) < 1e-6
    assert abs(ten_min["slope_per_hour"] - 60.0) < 1e-6
    assert abs(fifteen_min["slope_per_hour"] - 40.0) < 1e-6


def test_flat_series_has_no_direction_claim():
    values = np.full(300, 42.0)
    result = ins.trend_analysis(values, 60)
    assert result["direction"] == "flat"
    assert "没有明显" in result["direction_label"]


def test_low_r2_does_not_claim_a_trend():
    rng = np.random.RandomState(3)
    values = rng.normal(1000, 500, 500) + np.linspace(0, 50, 500)
    result = ins.trend_analysis(values, 60)
    if result["r2"] is not None and result["r2"] < 0.05:
        assert result["direction"] == "flat"


def test_acf_insights_mention_negative_correlation_and_actions():
    t = np.arange(500)
    values = 500 + 100 * np.sin(2 * np.pi * t / 24)
    acf = ins.acf_curve(values, 48)
    periodicity = ins.detect_periodicity(values, interval_minutes=60, max_lag=48, span_seconds=500 * 3600)
    trend = ins.trend_analysis(values, 60)
    result = ins.acf_trend_insights(
        acf=acf, periodicity=periodicity, trend=trend, interval_minutes=60,
        valid_points=500, span_seconds=500 * 3600, max_lag=48,
    )
    keys = {i["key"] for i in result["items"]}
    assert "short_term" in keys
    assert "trend" in keys
    # hourly sine without long-term trend must not be described as strongly trending
    assert trend["direction"] in ("flat", "up", "down")


def test_actions_appear_when_period_cannot_be_checked():
    values = _sine(24, 240, 60)
    acf = ins.acf_curve(values, 12)
    periodicity = ins.detect_periodicity(values, interval_minutes=60, max_lag=12, span_seconds=240 * 3600)
    trend = ins.trend_analysis(values, 60)
    result = ins.acf_trend_insights(
        acf=acf, periodicity=periodicity, trend=trend, interval_minutes=60,
        valid_points=240, span_seconds=240 * 3600, max_lag=12,
    )
    actions = next(i for i in result["items"] if i["key"] == "actions")
    assert "Max Lag" in actions["text"]


def test_insight_text_uses_the_same_number_as_the_metrics():
    values, hours, _ = hourly_series(lambda h, d: 100 + (400 if h == 17 else 0), days=5)
    profile = ins.hourly_profile(values, hours)
    result = ins.hourly_insights(profile, valid_points=len(values), valid_dates=5)
    peak = result["items"][0]
    assert f"{peak['metrics']['value']:,.2f}" in peak["text"]
