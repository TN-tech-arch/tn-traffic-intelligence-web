"""Central multi-region Statistical Summary insights."""

from app.services.insights import summary_insights


def stat(region, mean, cv=0.2, p95=None, valid=1000, std=None):
    return {
        "region_id": region,
        "mean": mean,
        "max": mean * 1.5,
        "min": mean * 0.5,
        "std": std if std is not None else mean * cv,
        "p95": p95 if p95 is not None else mean * 1.3,
        "cv": cv,
        "zero_points": 0,
        "valid_points": valid,
    }


def test_multi_region_ranking_uses_real_values():
    result = summary_insights(
        [stat("A", 100.0, cv=0.10, p95=120), stat("B", 300.0, cv=0.30, p95=500)],
        points=1000, span_label="7.0 天", interval_minutes=10,
    )
    level = next(i for i in result["items"] if i["key"] == "level")
    assert level["metrics"]["highest"] == "B"
    assert level["metrics"]["lowest"] == "A"
    assert abs(level["metrics"]["gap_pct"] - 200.0) < 1e-6
    assert "B" in level["text"] and "300.00" in level["text"]
    vol = next(i for i in result["items"] if i["key"] == "volatility")
    assert vol["metrics"]["most_volatile"] == "B"
    assert result["summary"]["regions_compared"] == 2


def test_single_region_has_no_fake_ranking():
    result = summary_insights([stat("A", 100.0)], points=1000, span_label="7.0 天", interval_minutes=10)
    assert len(result["items"]) == 1
    item = result["items"][0]
    assert item["key"] == "single"
    assert "只选择了 1 个有效区域" in item["text"]
    assert "最高的是" not in item["text"]


def test_all_no_data_is_explicit():
    empty = {"region_id": "X", "mean": None, "max": None, "min": None, "std": None,
             "p95": None, "cv": None, "zero_points": 0, "valid_points": 0}
    result = summary_insights([empty], points=500, span_label="3.0 天", interval_minutes=10)
    assert result["available"] is False
    assert result["items"][0]["level"] == "warning"


def test_region_without_data_is_excluded_and_reported():
    empty = {"region_id": "X", "mean": None, "max": None, "min": None, "std": None,
             "p95": None, "cv": None, "zero_points": 0, "valid_points": 0}
    result = summary_insights(
        [stat("A", 100.0), stat("B", 200.0), empty],
        points=1000, span_label="7.0 天", interval_minutes=10,
    )
    assert result["summary"]["regions_compared"] == 2
    assert result["summary"]["regions_selected"] == 3
    assert any("1 个已选区域" in warning for warning in result["warnings"])
    assert any("X" in detail["label"] for detail in result["details"])


def test_low_coverage_reduces_reliability():
    result = summary_insights(
        [stat("A", 100.0, valid=1000), stat("B", 110.0, valid=50)],
        points=1000, span_label="7.0 天", interval_minutes=10,
    )
    assert result["reliability"]["level"] in ("low", "medium")
    assert result["warnings"]


def test_unit_and_range_are_reported_in_details():
    result = summary_insights(
        [stat("A", 100.0)],
        points=1008, span_label="7.0 天", interval_minutes=10, unit_label="Traffic volume",
    )
    labels = {d["label"]: d["value"] for d in result["details"]}
    assert "统计范围" in labels and "1008" in labels["统计范围"]
    assert labels["单位"] == "Traffic volume"
