"""Rule based, fully data driven analysis insights for Module 1.

Every sentence produced here is derived from the numbers returned alongside it,
so the UI can show the same evidence in the expanded details and can never drift
from the chart.  No language model is involved and nothing is hard coded.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

HOURS = tuple(range(24))
WEEKDAY_NAMES = ("周一", "周二", "周三", "周四", "周五", "周六", "周日")


# ---------------------------------------------------------------------------
# formatting helpers
# ---------------------------------------------------------------------------


def fmt_num(value: float | None, *, digits: int = 2) -> str:
    if value is None or not np.isfinite(value):
        return "—"
    magnitude = abs(value)
    if magnitude >= 1e9:
        return f"{value / 1e9:.2f}B"
    if magnitude >= 1e6:
        return f"{value / 1e6:.2f}M"
    if magnitude >= 1e5:
        return f"{value / 1e3:.1f}k"
    return f"{value:,.{digits}f}"


def fmt_pct(value: float | None, *, digits: int = 1) -> str:
    if value is None or not np.isfinite(value):
        return "—"
    return f"{value:+.{digits}f}%"


def hour_label(hour: int) -> str:
    return f"{hour:02d}:00–{(hour + 1) % 24:02d}:00"


def duration_label(minutes: float) -> str:
    minutes = float(minutes)
    if minutes < 60:
        return f"{minutes:.0f} 分钟"
    hours = minutes / 60
    if hours < 24:
        return f"{hours:.1f} 小时"
    return f"{hours / 24:.1f} 天"


def relative_change(new: float | None, base: float | None) -> float | None:
    """(new - base) / |base| * 100, guarded against a zero denominator."""
    if new is None or base is None or not np.isfinite(new) or not np.isfinite(base):
        return None
    if abs(base) <= 1e-9:
        return None
    return (new - base) / abs(base) * 100.0


def _severity(level: str) -> str:
    return "warning" if level == "warning" else "info"


def item(key: str, label: str, text: str, *, level: str = "info", metrics: dict[str, Any] | None = None) -> dict:
    return {"key": key, "label": label, "text": text, "level": _severity(level), "metrics": metrics or {}}


# ---------------------------------------------------------------------------
# Hourly profile + insights
# ---------------------------------------------------------------------------


def hourly_profile(values: np.ndarray, hours: np.ndarray) -> list[dict[str, Any]]:
    """24 hourly means with their real sample counts (missing hours stay None)."""
    out: list[dict[str, Any]] = []
    finite = np.isfinite(values)
    for hour in HOURS:
        selector = finite & (hours == hour)
        count = int(selector.sum())
        out.append(
            {
                "hour": hour,
                "mean": float(values[selector].mean()) if count else None,
                "samples": count,
            }
        )
    return out


def _circular_smooth(means: np.ndarray) -> np.ndarray:
    """3-point circular moving average; keeps NaN when a neighbour is missing."""
    smoothed = np.full(24, np.nan)
    for hour in range(24):
        window = [means[(hour - 1) % 24], means[hour], means[(hour + 1) % 24]]
        if all(np.isfinite(v) for v in window):
            smoothed[hour] = float(np.mean(window))
    return smoothed


def detect_hourly_peaks(profile: list[dict[str, Any]]) -> dict[str, Any]:
    """Local maxima on the smoothed profile with a relative prominence rule.

    A merely largest hour is *not* automatically a significant peak: the hour
    must exceed its local neighbourhood by >= 3% of the daily mean and be at
    least 3% above the overall hourly mean.
    """
    means = np.array([p["mean"] if p["mean"] is not None else np.nan for p in profile], dtype="float64")
    coverage = int(np.isfinite(means).sum())
    if coverage < 6:
        return {"peaks": [], "coverage": coverage / 24, "reason": "有效小时少于 6 个，无法判断日内高峰模式。"}
    smoothed = _circular_smooth(means)
    if int(np.isfinite(smoothed).sum()) < 6:
        smoothed = means
    overall = float(np.nanmean(means))
    peaks: list[dict[str, Any]] = []
    for hour in range(24):
        center = smoothed[hour]
        if not np.isfinite(center):
            continue
        neighbours = [smoothed[(hour + delta) % 24] for delta in (-2, -1, 1, 2)]
        neighbours = [v for v in neighbours if np.isfinite(v)]
        if not neighbours:
            continue
        if center < max(neighbours) - 1e-12:
            continue
        if center < smoothed[(hour - 1) % 24] or center < smoothed[(hour + 1) % 24]:
            continue
        prominence = center - min(neighbours)
        threshold = 0.03 * abs(overall) if abs(overall) > 1e-9 else 0.0
        relative = relative_change(center, overall) or 0.0
        if prominence < threshold or relative < 3.0:
            continue
        peaks.append(
            {
                "hour": hour,
                "value": float(center),
                "smoothed_value": float(center),
                "prominence": float(prominence),
                "relative_to_mean_pct": relative,
            }
        )
    # A smoothed single spike spreads over its neighbours (e.g. a 500 spike at
    # 18:00 makes 17:00 and 19:00 look like maxima). Merge candidates within two
    # hours and keep the hour with the highest *raw* mean.
    merged: list[dict[str, Any]] = []
    for peak in sorted(peaks, key=lambda p: p["hour"]):
        if merged and (peak["hour"] - merged[-1]["hour"]) <= 2:
            if means[peak["hour"]] > means[merged[-1]["hour"]]:
                merged[-1] = peak
            continue
        merged.append(peak)
    if len(merged) > 1 and (merged[0]["hour"] + 24 - merged[-1]["hour"]) <= 2:
        if means[merged[0]["hour"]] >= means[merged[-1]["hour"]]:
            merged.pop(0)
        else:
            merged.pop()
    for peak in merged:
        raw_value = float(means[peak["hour"]])
        peak["smoothed_value"] = peak["value"]
        peak["value"] = raw_value
        peak["relative_to_mean_pct"] = relative_change(raw_value, overall) or 0.0
    return {"peaks": merged, "coverage": coverage / 24, "reason": None, "smoothed": smoothed.tolist()}


def hourly_insights(
    profile: list[dict[str, Any]],
    *,
    valid_points: int,
    valid_dates: int,
    day_start: int = 6,
    day_end: int = 18,
) -> dict[str, Any]:
    means = [p["mean"] for p in profile]
    finite = [(h, means[h]) for h in HOURS if means[h] is not None]
    items: list[dict[str, Any]] = []
    warnings: list[str] = []
    details: list[dict[str, Any]] = []
    if not finite:
        return {
            "available": False,
            "items": [item("no_data", "日内规律", "当前时间范围内没有有效观测，无法生成日内分析。", level="warning")],
            "warnings": ["没有可用数据。"],
            "details": [],
            "reliability": {"level": "none", "notes": ["有效观测为 0。"]},
        }
    overall = float(np.mean([v for _, v in finite]))
    maximum = max(finite, key=lambda pair: pair[1])
    minimum = min(finite, key=lambda pair: pair[1])
    tie_tolerance = max(abs(maximum[1]) * 1e-9, 1e-9)
    tied = [h for h, v in finite if abs(v - maximum[1]) <= tie_tolerance]
    peak_delta = relative_change(maximum[1], overall)
    tied_text = "、".join(hour_label(h) for h in tied)
    if len(tied) > 1:
        items.append(
            item(
                "peak",
                "主要高峰",
                f"当前分析范围内 {tied_text} 的平均流量并列最高，为 {fmt_num(maximum[1])}"
                + (f"，高于日内小时平均水平 {fmt_pct(peak_delta)}。" if peak_delta is not None else "。"),
                metrics={"hours": tied, "value": maximum[1], "relative_to_mean_pct": peak_delta},
            )
        )
    else:
        items.append(
            item(
                "peak",
                "主要高峰",
                f"{hour_label(maximum[0])} 的平均流量最高，为 {fmt_num(maximum[1])}"
                + (f"，高于日内小时平均水平 {fmt_pct(peak_delta)}。" if peak_delta is not None else "。"),
                metrics={"hour": maximum[0], "value": maximum[1], "relative_to_mean_pct": peak_delta},
            )
        )
    drop = relative_change(minimum[1], maximum[1])
    items.append(
        item(
            "valley",
            "主要低谷",
            f"{hour_label(minimum[0])} 为平均流量最低的时段，平均 {fmt_num(minimum[1])}"
            + (f"，比最高时段低 {abs(drop):.1f}%（相差 {fmt_num(maximum[1] - minimum[1])}）。" if drop is not None else "。"),
            metrics={"hour": minimum[0], "value": minimum[1], "difference": maximum[1] - minimum[1]},
        )
    )
    detection = detect_hourly_peaks(profile)
    peaks = detection["peaks"]
    coverage = detection["coverage"]
    if detection.get("reason"):
        items.append(item("pattern", "日内模式", detection["reason"], level="warning",
                          metrics={"coverage": coverage}))
    elif len(peaks) == 0:
        items.append(
            item(
                "pattern",
                "日内模式",
                f"日内曲线整体较平稳：没有检测到显著高峰（最高小时仅比全天平均高 "
                f"{peak_delta:.1f}%）。",
                metrics={"peak_count": 0, "coverage": coverage},
            )
        )
    elif len(peaks) == 1:
        peak = peaks[0]
        items.append(
            item(
                "pattern",
                "日内模式",
                f"单峰型：在 {hour_label(peak['hour'])} 附近出现一个显著高峰，"
                f"比相邻时段平均高约 {fmt_num(peak['prominence'])}（相对全天均值 "
                f"{peak['relative_to_mean_pct']:.1f}%）。",
                metrics={"peak_count": 1, "coverage": coverage, "peaks": peaks},
            )
        )
    else:
        described = "、".join(f"{hour_label(p['hour'])}（{p['relative_to_mean_pct']:.0f}%）" for p in peaks[:4])
        items.append(
            item(
                "pattern",
                "日内模式",
                f"多峰型：检测到 {len(peaks)} 个显著高峰，分别位于 {described}；"
                "数值为各峰相对全天小时均值的偏离幅度。",
                metrics={"peak_count": len(peaks), "coverage": coverage, "peaks": peaks},
            )
        )
    day_selector = [v for h, v in finite if day_start <= h < day_end]
    night_selector = [v for h, v in finite if not (day_start <= h < day_end)]
    day_mean = float(np.mean(day_selector)) if day_selector else None
    night_mean = float(np.mean(night_selector)) if night_selector else None
    day_diff = relative_change(day_mean, night_mean)
    day_text = (
        f"白天（{day_start:02d}:00–{day_end:02d}:00）平均 {fmt_num(day_mean)}，"
        f"夜间（其余小时）平均 {fmt_num(night_mean)}"
    )
    if day_diff is None:
        day_text += "；其中一组没有有效数据，无法比较。"
    elif abs(day_diff) < 3:
        day_text += f"，两者差异很小（{fmt_pct(day_diff)}）。"
    else:
        day_text += f"，白天比夜间{'高' if day_diff > 0 else '低'} {abs(day_diff):.1f}%。"
    items.append(
        item("day_night", "昼夜差异", day_text,
             metrics={"day_mean": day_mean, "night_mean": night_mean, "relative_pct": day_diff,
                      "day_hours": [day_start, day_end]})
    )
    thin_hours = [p["hour"] for p in profile if p["mean"] is not None and p["samples"] < 3]
    reliability_level = "high"
    reliability_notes = [f"有效日期 {valid_dates} 天，有效观测 {valid_points} 点。"]
    if valid_dates < 2:
        reliability_level = "low"
        reliability_notes.append("只覆盖 1 个有效日期，日内规律可能只是单日特例。")
        warnings.append("当前有效样本较少（少于 2 个有效日期），日内规律可能不具有充分代表性。")
    elif valid_dates < 7:
        reliability_level = "medium"
        reliability_notes.append("有效日期少于 7 天，周期性结论的稳定性有限。")
    if thin_hours:
        reliability_notes.append(
            "以下小时的有效样本少于 3 个：" + "、".join(f"{h:02d}:00" for h in thin_hours[:8])
        )
        if reliability_level == "high":
            reliability_level = "medium"
    if coverage < 0.7:
        warnings.append(f"只有 {coverage * 100:.0f}% 的小时有有效观测，部分小时为 No Data。")
    details.extend(
        [
            {"label": "有效观测", "value": f"{valid_points} 点 / {valid_dates} 天"},
            {"label": "小时覆盖率", "value": f"{coverage * 100:.1f}%"},
            {"label": "日内小时均值", "value": fmt_num(overall)},
            {"label": "高峰判定规则", "value": "3 点圆周平滑后的局部极大值；相对全天均值 ≥3%，且局部突出度 ≥ 均值的 3%"},
            {"label": "昼夜划分", "value": f"白天 {day_start:02d}:00–{day_end:02d}:00，其余为夜间"},
        ]
    )
    return {
        "available": True,
        "items": items[:4],
        "warnings": warnings,
        "details": details,
        "reliability": {"level": reliability_level, "notes": reliability_notes},
        "hourly_table": profile,
        "overall_mean": overall,
    }


# ---------------------------------------------------------------------------
# Weekday vs weekend
# ---------------------------------------------------------------------------


def summary_insights(
    statistics: list[dict[str, Any]],
    *,
    points: int,
    span_label: str,
    interval_minutes: int,
    unit_label: str = "",
) -> dict[str, Any]:
    """Multi-region statistical comparison (never a blend of several regions).

    Used by the central Statistical Summary. With a single selected region it
    deliberately produces a single-region description instead of a fake ranking.
    """
    available = [
        s for s in statistics
        if (s.get("valid_points") or 0) > 0 and s.get("mean") is not None
    ]
    details = [
        {
            "label": s["region_id"],
            "value": f"均值 {fmt_num(s.get('mean'))} · 标准差 {fmt_num(s.get('std'))} · "
                     f"P95 {fmt_num(s.get('p95'))} · CV {s.get('cv'):.3f}" if s.get("cv") is not None
            else f"均值 {fmt_num(s.get('mean'))} · 有效点 {s.get('valid_points')}",
        }
        for s in statistics
    ]
    details.append(
        {"label": "统计范围", "value": f"{span_label} · {points} 个时间点 · {interval_minutes} 分钟/点"}
    )
    if unit_label:
        details.append({"label": "单位", "value": unit_label})
    if not available:
        return {
            "available": False,
            "items": [item("no_data", "多区域统计", "当前所选区域在该时间范围内都没有有效观测。", level="warning")],
            "warnings": ["没有可用数据。"],
            "details": details,
            "reliability": {"level": "none", "notes": ["所有已选区域均为 No Data。"]},
        }
    missing = [s for s in statistics if s not in available]
    warnings: list[str] = []
    items: list[dict[str, Any]] = []
    if len(available) == 1:
        only = available[0]
        items.append(
            item(
                "single",
                "单区域概况",
                f"当前只选择了 1 个有效区域（{only['region_id']}）：平均 {fmt_num(only['mean'])}，"
                f"最大 {fmt_num(only.get('max'))}，最小 {fmt_num(only.get('min'))}，"
                f"P95 {fmt_num(only.get('p95'))}"
                + (f"，CV {only['cv']:.3f}" if only.get("cv") is not None else "")
                + "。如需区域间比较，请再选择至少一个区域。",
                metrics={"region_id": only["region_id"], "mean": only["mean"], "cv": only.get("cv")},
            )
        )
    else:
        ranked = sorted(available, key=lambda s: s["mean"], reverse=True)
        high, low = ranked[0], ranked[-1]
        gap = relative_change(high["mean"], low["mean"])
        items.append(
            item(
                "level",
                "平均流量对比",
                f"平均流量最高的是 {high['region_id']}（{fmt_num(high['mean'])}），"
                f"最低的是 {low['region_id']}（{fmt_num(low['mean'])}）"
                + (f"，两者相差 {gap:.1f}%。" if gap is not None else "；其中一组均值为 0，未计算百分比。"),
                metrics={"highest": high["region_id"], "lowest": low["region_id"], "gap_pct": gap},
            )
        )
        with_cv = [s for s in available if s.get("cv") is not None]
        if len(with_cv) >= 2:
            most = max(with_cv, key=lambda s: s["cv"])
            least = min(with_cv, key=lambda s: s["cv"])
            items.append(
                item(
                    "volatility",
                    "波动程度",
                    f"相对波动最大的是 {most['region_id']}（CV={most['cv']:.3f}，"
                    f"标准差 {fmt_num(most.get('std'))}），最小的是 {least['region_id']}（CV={least['cv']:.3f}）。"
                    "CV 越大表示相对波动越剧烈。",
                    metrics={"most_volatile": most["region_id"], "cv_max": most["cv"],
                             "least_volatile": least["region_id"], "cv_min": least["cv"]},
                )
            )
        with_p95 = [s for s in available if s.get("p95") is not None]
        if len(with_p95) >= 2:
            p95_high = max(with_p95, key=lambda s: s["p95"])
            p95_low = min(with_p95, key=lambda s: s["p95"])
            p95_gap = relative_change(p95_high["p95"], p95_low["p95"])
            items.append(
                item(
                    "p95",
                    "高位水平（P95）",
                    f"P95 最高的是 {p95_high['region_id']}（{fmt_num(p95_high['p95'])}），"
                    f"最低的是 {p95_low['region_id']}（{fmt_num(p95_low['p95'])}）"
                    + (f"，相差 {p95_gap:.1f}%。" if p95_gap is not None else "。"),
                    metrics={"highest": p95_high["region_id"], "lowest": p95_low["region_id"],
                             "gap_pct": p95_gap},
                )
            )
    thinnest = min(available, key=lambda s: s.get("valid_points") or 0)
    coverage = (thinnest.get("valid_points") or 0) / points if points else 0
    reliability_level = "high"
    notes = [f"{len(available)} 个有效区域参与统计（共选择 {len(statistics)} 个）。"]
    if missing:
        notes.append("以下区域没有有效观测：" + "、".join(s["region_id"] for s in missing[:6]))
        warnings.append(f"{len(missing)} 个已选区域在当前范围没有有效观测，未参与排名。")
        reliability_level = "medium"
    if coverage < 0.5:
        warnings.append(
            f"区域 {thinnest['region_id']} 的有效观测覆盖率仅 {coverage * 100:.0f}%，对比结论需谨慎。"
        )
        reliability_level = "low" if coverage < 0.2 else "medium"
    counts = [s.get("valid_points") or 0 for s in available]
    if counts and max(counts) >= 4 * max(1, min(counts)):
        warnings.append("各区域的有效样本数量差异较大，区域间比较可能受覆盖不均衡影响。")
        if reliability_level == "high":
            reliability_level = "medium"
    notes.append(
        f"最新样本覆盖：最少 {thinnest['region_id']} {thinnest.get('valid_points')} 点"
        f"（{coverage * 100:.0f}%），统计窗口 {points} 点。"
    )
    return {
        "available": True,
        "items": items[:4],
        "warnings": warnings,
        "details": details,
        "reliability": {"level": reliability_level, "notes": notes},
        "summary": {
            "regions_compared": len(available),
            "regions_selected": len(statistics),
            "highest_mean": available[0]["region_id"] if len(available) == 1 else
            max(available, key=lambda s: s["mean"])["region_id"],
            "lowest_mean": available[0]["region_id"] if len(available) == 1 else
            min(available, key=lambda s: s["mean"])["region_id"],
        },
    }


# ---------------------------------------------------------------------------
# Spatial Analysis (top / bottom / distribution at one time slice)
# ---------------------------------------------------------------------------


def _spatial_block(items: list[dict[str, Any]], warnings: list[str], details: list[dict[str, Any]],
                   level: str = "high") -> dict[str, Any]:
    return {
        "available": bool(items),
        "items": items[:4],
        "warnings": warnings,
        "details": details,
        "reliability": {"level": level, "notes": []},
    }


def spatial_insights(
    *,
    entries: list[dict[str, Any]],
    top: list[dict[str, Any]],
    bottom: list[dict[str, Any]],
    bins: list[dict[str, Any]],
    stats: dict[str, Any],
    time_at: str | None,
    no_data_count: int,
    unit_label: str = "",
) -> dict[str, Any]:
    """Insights for the three spatial charts (all valid regions at one slice)."""
    valid = [e for e in entries if e.get("value") is not None]
    n = len(valid)
    lower_unit = (unit_label or "").lower()
    if "traffic volume" in lower_unit:
        short_unit = "源单位"
    elif "4g" in lower_unit:
        short_unit = "4G 下行单位"
    else:
        short_unit = unit_label or ""
    unit = f"（{short_unit}）" if short_unit else ""
    empty = {
        "high": {
            "available": False,
            "items": [item("no_data", "高流量区域", "当前时间截面没有有效区域观测，无法生成排名。", level="warning")],
            "warnings": ["当前截面所有区域均为 No Data。"],
            "details": [],
            "reliability": {"level": "none", "notes": ["有效区域为 0。"]},
        },
        "low": {
            "available": False,
            "items": [item("no_data", "低流量区域", "当前时间截面没有有效区域观测，无法生成排名。", level="warning")],
            "warnings": ["当前截面所有区域均为 No Data。"],
            "details": [],
            "reliability": {"level": "none", "notes": ["有效区域为 0。"]},
        },
        "distribution": {
            "available": False,
            "items": [item("no_data", "空间分布", "当前时间截面没有有效区域观测，无法分箱。", level="warning")],
            "warnings": ["当前截面所有区域均为 No Data。"],
            "details": [],
            "reliability": {"level": "none", "notes": ["有效区域为 0。"]},
        },
    }
    if n == 0 or not top:
        return empty

    mean = stats.get("mean")
    std = stats.get("std")
    median = stats.get("median")
    zeros = sum(1 for e in valid if e["value"] == 0)
    highest, lowest = top[0], bottom[0]
    total = sum(e["value"] for e in valid)
    high_items: list[dict[str, Any]] = []
    low_items: list[dict[str, Any]] = []
    dist_items: list[dict[str, Any]] = []
    high_warnings: list[str] = []
    low_warnings: list[str] = []
    dist_warnings: list[str] = []
    high_details: list[dict[str, Any]] = []
    low_details: list[dict[str, Any]] = []
    dist_details: list[dict[str, Any]] = []

    high_items.append(
        item(
            "highest",
            "最高流量区域",
            f"当前截面（{time_at or '—'}）流量最高的是 {highest['region_id']}，为 "
            f"{fmt_num(highest['value'])}{unit}。",
            metrics={"region_id": highest["region_id"], "value": highest["value"]},
        )
    )
    diff_mean = None if mean is None else highest["value"] - mean
    pct_mean = relative_change(highest["value"], mean)
    high_items.append(
        item(
            "vs_mean",
            "与整体平均对比",
            f"全部 {n} 个有效区域的平均流量为 {fmt_num(mean)}{unit}；最高区域"
            + (f"比平均值高 {pct_mean:.1f}%（相差 {fmt_num(diff_mean)}）。" if pct_mean is not None
               else f"与平均值相差 {fmt_num(diff_mean)}（平均值为 0，未计算百分比）。"),
            metrics={"mean": mean, "difference": diff_mean, "relative_pct": pct_mean},
        )
    )
    if len(top) >= 2:
        last = top[-1]
        spread = highest["value"] - last["value"]
        spread_pct = relative_change(highest["value"], last["value"])
        high_items.append(
            item(
                "top_spread",
                f"Top {len(top)} 内部差异",
                f"第 1 名 {highest['region_id']} 与第 {len(top)} 名 {last['region_id']} 相差 "
                f"{fmt_num(spread)}" + (f"（{spread_pct:.1f}%）。" if spread_pct is not None else "。"),
                metrics={"first": highest["region_id"], "last": last["region_id"],
                         "difference": spread, "relative_pct": spread_pct},
            )
        )
    else:
        high_items.append(
            item("top_spread", "Top 内部差异", "当前只有 1 个有效区域，无法比较排名内部差异。",
                 level="warning")
        )
    if total > 0:
        top3_share = sum(e["value"] for e in top[:3]) / total * 100
        equal_share = min(3, n) / n * 100
        ratio = top3_share / equal_share if equal_share > 0 else None
        if ratio is not None and ratio >= 2:
            judgment = "高值相对集中在少数区域"
        elif ratio is not None and ratio < 1.2:
            judgment = "高值并不集中，整体较为均衡"
        else:
            judgment = "高值集中程度中等"
        high_items.append(
            item(
                "concentration",
                "高值集中度",
                f"当前排名前 3 的区域合计占全部有效区域流量总和的 {top3_share:.1f}%"
                + (f"（若各区域完全相同应为 {equal_share:.1f}%，当前约为其 {ratio:.1f} 倍）" if ratio else "")
                + f"，{judgment}。"
                "该指标只描述数值分布，不代表拥堵或功能区属性。",
                metrics={"top3_share_pct": top3_share, "equal_share_pct": equal_share, "ratio": ratio},
            )
        )
    if n < 10:
        high_warnings.append(f"当前只有 {n} 个有效区域，排名代表性有限。")
    high_details.append({"label": "排名范围", "value": f"当前数据源全部有效区域（{n} 个）"})
    for rank, entry in enumerate(top, start=1):
        high_details.append(
            {"label": f"#{rank} {entry['region_id']}", "value": f"{fmt_num(entry['value'])}{unit}"}
        )

    low_items.append(
        item(
            "lowest",
            "最低流量区域",
            f"当前截面流量最低的是 {lowest['region_id']}，为 {fmt_num(lowest['value'])}{unit}。",
            metrics={"region_id": lowest["region_id"], "value": lowest["value"]},
        )
    )
    if len(bottom) >= 2:
        last = bottom[-1]
        spread = last["value"] - lowest["value"]
        low_items.append(
            item(
                "bottom_spread",
                f"Bottom {len(bottom)} 内部差异",
                f"最低的 {lowest['region_id']} 与第 {len(bottom)} 低的 {last['region_id']} 相差 "
                f"{fmt_num(spread)}{unit}。",
                metrics={"first": lowest["region_id"], "last": last["region_id"], "difference": spread},
            )
        )
    diff_low = None if mean is None else lowest["value"] - mean
    pct_low = relative_change(lowest["value"], mean)
    low_items.append(
        item(
            "vs_mean",
            "与整体平均对比",
            f"最低区域"
            + (f"比全部有效区域的平均值低 {abs(pct_low):.1f}%（相差 {fmt_num(abs(diff_low))}）。"
               if pct_low is not None else "与平均值一致（或平均值为 0，未计算百分比）。"),
            metrics={"mean": mean, "difference": diff_low, "relative_pct": pct_low},
        )
    )
    if zeros:
        low_items.append(
            item(
                "zeros",
                "真实零值",
                f"当前截面有 {zeros} 个区域的流量为真实 0（有效观测，不是缺失），已正常参与排名与分布。",
                level="warning",
                metrics={"zero_regions": zeros},
            )
        )
    else:
        low_items.append(item("zeros", "真实零值", "当前截面没有真实 0 值区域。", metrics={"zero_regions": 0}))
    if lowest.get("range_mean") is not None:
        rel = relative_change(lowest["value"], lowest["range_mean"])
        low_items.append(
            item(
                "range_mean",
                "当前值 vs 范围均值",
                f"{lowest['region_id']} 当前值 {fmt_num(lowest['value'])}，所选日期范围内的平均值为 "
                f"{fmt_num(lowest['range_mean'])}"
                + (f"，当前值{'高' if (rel or 0) >= 0 else '低'} {abs(rel):.1f}%。" if rel is not None else "。")
                + "（两者口径不同：前者是单一时刻，后者是整段平均。）",
                metrics={"current": lowest["value"], "range_mean": lowest["range_mean"], "relative_pct": rel},
            )
        )
    if no_data_count:
        low_warnings.append(f"有 {no_data_count} 个区域在该时刻没有有效观测，未参与排名。")
    if n < 6:
        low_warnings.append(f"有效区域少于 6 个，Bottom 排名只展示实际存在的 {n} 个区域。")
    low_details.append({"label": "排名范围", "value": f"当前数据源全部有效区域（{n} 个）"})
    for rank, entry in enumerate(bottom, start=1):
        detail = f"{fmt_num(entry['value'])}{unit}"
        if entry.get("range_mean") is not None:
            detail += f" · 范围均值 {fmt_num(entry['range_mean'])}"
        low_details.append({"label": f"#{rank} {entry['region_id']}", "value": detail})

    if bins:
        main = max(bins, key=lambda b: b["count"])
        main_pct = main["count"] / n * 100
        dist_items.append(
            item(
                "main_bin",
                "主要数值区间",
                f"区域最集中的区间是 {fmt_num(main['start'])}–{fmt_num(main['end'])}{unit}，"
                f"共 {main['count']} 个区域（{main_pct:.1f}%）。",
                metrics={"start": main["start"], "end": main["end"], "count": main["count"],
                         "pct": main_pct},
            )
        )
        ordered = sorted(bins, key=lambda b: b["count"], reverse=True)
        covered = 0
        used = 0
        for b in ordered:
            covered += b["count"]
            used += 1
            if covered >= n * 0.8:
                break
        dist_items.append(
            item(
                "concentration",
                "分布集中度",
                f"约 80% 的区域集中在 {used} 个数值区间内（共 {len(bins)} 个区间），"
                + ("分布较集中。" if used <= max(1, len(bins) * 0.4) else "分布相对分散。"),
                metrics={"bins_covering_80pct": used, "bin_count": len(bins)},
            )
        )
    if mean is not None and median is not None:
        diff = mean - median
        spread = std if std and std > 1e-12 else None
        if spread is None:
            desc = "所有有效区域数值相同，均值与中位数一致，无偏斜信息。"
        elif abs(diff) <= 0.2 * spread:
            desc = "均值与中位数接近，分布大致对称（描述性判断）。"
        elif diff > 0:
            desc = "均值高于中位数，数值分布可能右偏（描述性判断，未做统计检验）。"
        else:
            desc = "均值低于中位数，数值分布可能左偏（描述性判断，未做统计检验）。"
        dist_items.append(
            item("mean_median", "均值与中位数",
                 f"均值 {fmt_num(mean)}，中位数 {fmt_num(median)}{unit}；{desc}",
                 metrics={"mean": mean, "median": median, "difference": diff})
        )
    if std is not None and mean is not None and std > 1e-12:
        hi_z = (stats.get("max") - mean) / std if stats.get("max") is not None else None
        lo_z = (stats.get("min") - mean) / std if stats.get("min") is not None else None
        tails = []
        if hi_z is not None and hi_z >= 2:
            tails.append(f"最高值约为均值 +{hi_z:.1f}σ")
        if lo_z is not None and lo_z <= -2:
            tails.append(f"最低值约为均值 {lo_z:.1f}σ")
        dist_items.append(
            item(
                "tails",
                "高低值与整体差异",
                (("；".join(tails) + "，存在远离主体的数值。") if tails else
                 "最高/最低值都在均值 ±2σ 之内，没有明显远离主体的极端值。")
                + f" 当前标准差 {fmt_num(std)}，CV "
                + (f"{stats.get('cv'):.3f}" if stats.get("cv") is not None else "N/A")
                + "。",
                metrics={"max_z": hi_z, "min_z": lo_z, "std": std, "cv": stats.get("cv")},
            )
        )
    if stats.get("single_value"):
        dist_warnings.append("当前所有有效区域数值相同，直方图只有一个区间，无法判断分布形态。")
    if n < 10:
        dist_warnings.append(f"有效区域只有 {n} 个，分箱与分布判断的稳定性有限。")
    if no_data_count:
        dist_warnings.append(f"{no_data_count} 个 No Data 区域未参与分箱。")
    dist_details.append(
        {"label": "统计口径", "value": f"当前时间截面 {time_at or '—'}，全部 {n} 个有效区域"}
    )
    for b in bins:
        dist_details.append(
            {"label": f"{fmt_num(b['start'])}–{fmt_num(b['end'])}",
             "value": f"{b['count']} 个区域（{b['count'] / n * 100:.1f}%）"}
        )
    dist_details.append(
        {"label": "分箱规则", "value": "等宽分箱，左闭右开，最后一个区间包含右端点；各区间计数之和等于有效区域总数"}
    )

    level_high = "medium" if n < 10 else "high"
    return {
        "high": {
            **_spatial_block(high_items, high_warnings, high_details, level_high),
            "reliability": {
                "level": level_high,
                "notes": [f"参与排名的有效区域：{n} 个。", f"No Data 区域：{no_data_count} 个。"],
            },
        },
        "low": {
            **_spatial_block(low_items, low_warnings, low_details,
                             "medium" if n < 10 else "high"),
            "reliability": {
                "level": "medium" if n < 10 else "high",
                "notes": [f"参与排名的有效区域：{n} 个。", f"真实零值区域：{zeros} 个。"],
            },
        },
        "distribution": {
            **_spatial_block(dist_items, dist_warnings, dist_details,
                             "low" if stats.get("single_value") else ("medium" if n < 10 else "high")),
            "reliability": {
                "level": "low" if stats.get("single_value") else ("medium" if n < 10 else "high"),
                "notes": [f"有效区域 {n} 个，分箱 {len(bins)} 个。"],
            },
        },
    }


def weekday_profiles(values: np.ndarray, hours: np.ndarray, weekdays: np.ndarray, dates: np.ndarray) -> dict[str, Any]:
    finite = np.isfinite(values)
    out: dict[str, Any] = {}
    for key, selector_mask in (("weekday", weekdays < 5), ("weekend", weekdays >= 5)):
        profile = []
        for hour in HOURS:
            selector = finite & selector_mask & (hours == hour)
            count = int(selector.sum())
            profile.append(
                {"hour": hour, "mean": float(values[selector].mean()) if count else None, "samples": count}
            )
        group_values = values[finite & selector_mask]
        group_dates = sorted({str(d) for d in dates[finite & selector_mask]})
        out[key] = {
            "profile": profile,
            "mean": float(group_values.mean()) if group_values.size else None,
            "samples": int(group_values.size),
            "valid_dates": len(group_dates),
            "dates": group_dates,
            "hours_with_data": int(sum(1 for p in profile if p["mean"] is not None)),
        }
    return out


def weekday_insights(data: dict[str, Any]) -> dict[str, Any]:
    weekday = data["weekday"]
    weekend = data["weekend"]
    have_weekday = weekday["samples"] > 0
    have_weekend = weekend["samples"] > 0
    warnings: list[str] = []
    details: list[dict[str, Any]] = []
    items: list[dict[str, Any]] = []
    for key, label in (("weekday", "工作日"), ("weekend", "周末")):
        group = data[key]
        details.append(
            {
                "label": label,
                "value": f"{group['valid_dates']} 个有效日期 / {group['samples']} 个观测 / "
                         f"{group['hours_with_data']}/24 小时有数据",
            }
        )
    if not have_weekday and not have_weekend:
        return {
            "available": False,
            "items": [item("no_data", "工作日/周末", "当前时间范围内没有任何有效观测，无法比较。", level="warning")],
            "warnings": ["没有可用数据。"],
            "details": details,
            "reliability": {"level": "none", "notes": ["两组都没有有效数据。"]},
        }
    if not have_weekend:
        items.append(
            item(
                "overall",
                "整体差异",
                f"当前时间范围只有工作日数据（{weekday['valid_dates']} 天，平均 {fmt_num(weekday['mean'])}），"
                "没有有效周末数据，因此无法计算工作日与周末的整体差异。",
                level="warning",
                metrics={"weekday_mean": weekday["mean"], "weekend_mean": None},
            )
        )
    elif not have_weekday:
        items.append(
            item(
                "overall",
                "整体差异",
                f"当前时间范围只有周末数据（{weekend['valid_dates']} 天，平均 {fmt_num(weekend['mean'])}），"
                "没有有效工作日数据，因此无法计算完整的工作日与周末差异。",
                level="warning",
                metrics={"weekday_mean": None, "weekend_mean": weekend["mean"]},
            )
        )
    else:
        common_hours = [
            h for h in HOURS
            if weekday["profile"][h]["mean"] is not None and weekend["profile"][h]["mean"] is not None
        ]
        aligned_weekday = (
            float(np.mean([weekday["profile"][h]["mean"] for h in common_hours])) if common_hours else None
        )
        aligned_weekend = (
            float(np.mean([weekend["profile"][h]["mean"] for h in common_hours])) if common_hours else None
        )
        raw_diff = relative_change(weekday["mean"], weekend["mean"])
        diff = relative_change(aligned_weekday, aligned_weekend)
        if diff is None:
            items.append(
                item(
                    "overall", "整体差异",
                    f"工作日平均 {fmt_num(weekday['mean'])}，周末平均 {fmt_num(weekend['mean'])}；"
                    "其中一组均值为 0，无法计算可靠的百分比差异。",
                    level="warning",
                    metrics={"weekday_mean": weekday["mean"], "weekend_mean": weekend["mean"]},
                )
            )
        else:
            direction = "高" if diff > 0 else "低"
            note = ""
            if len(common_hours) < 20:
                note = f"（只使用两组都有数据的 {len(common_hours)} 个相同小时对比）"
            elif abs((raw_diff or 0) - diff) > 2:
                note = "（已按共同小时对齐，避免采样覆盖不均衡造成偏差）"
            items.append(
                item(
                    "overall",
                    "整体差异",
                    f"工作日平均流量为 {fmt_num(weekday['mean'])}，周末为 {fmt_num(weekend['mean'])}；"
                    f"按共同小时口径，工作日比周末{direction} {abs(diff):.1f}%{note}。",
                    metrics={
                        "weekday_mean": weekday["mean"], "weekend_mean": weekend["mean"],
                        "relative_pct": diff, "aligned_relative_pct": diff, "common_hours": common_hours,
                    },
                )
            )
    peaks: dict[str, int | None] = {}
    for key in ("weekday", "weekend"):
        profile = data[key]["profile"]
        candidates = [(p["hour"], p["mean"]) for p in profile if p["mean"] is not None]
        peaks[key] = max(candidates, key=lambda pair: pair[1])[0] if candidates else None
    if peaks["weekday"] is not None and peaks["weekend"] is not None:
        gap = abs(peaks["weekday"] - peaks["weekend"])
        gap = min(gap, 24 - gap)
        items.append(
            item(
                "peak",
                "高峰时间",
                f"工作日流量最高时段为 {peaks['weekday']:02d}:00，周末为 {peaks['weekend']:02d}:00，"
                f"两组高峰在一天内相差 {gap} 小时。",
                metrics={"weekday_peak_hour": peaks["weekday"], "weekend_peak_hour": peaks["weekend"], "gap_hours": gap},
            )
        )
    else:
        items.append(
            item(
                "peak",
                "高峰时间",
                "缺少其中一组的有效数据，无法比较工作日与周末的高峰时间。",
                level="warning",
                metrics={"weekday_peak_hour": peaks["weekday"], "weekend_peak_hour": peaks["weekend"]},
            )
        )
    largest = None
    for hour in HOURS:
        a = weekday["profile"][hour]["mean"]
        b = weekend["profile"][hour]["mean"]
        if a is None or b is None:
            continue
        diff_abs = abs(a - b)
        if largest is None or diff_abs > largest["difference"]:
            largest = {
                "hour": hour, "weekday": a, "weekend": b, "difference": diff_abs,
                "higher": "weekday" if a > b else ("weekend" if b > a else "equal"),
            }
    if largest:
        items.append(
            item(
                "largest_hour",
                "最大时段差异",
                f"差异最大的小时是 {hour_label(largest['hour'])}：工作日 {fmt_num(largest['weekday'])}，"
                f"周末 {fmt_num(largest['weekend'])}，相差 {fmt_num(largest['difference'])}"
                + ("（两组相等）。" if largest["higher"] == "equal" else
                   f"，{'工作日' if largest['higher'] == 'weekday' else '周末'}更高。"),
                metrics=largest,
            )
        )
    else:
        items.append(
            item("largest_hour", "最大时段差异", "两组没有共同的可用小时，无法计算最大差异。", level="warning")
        )
    common = [
        h for h in HOURS
        if weekday["profile"][h]["mean"] is not None and weekend["profile"][h]["mean"] is not None
    ]
    similarity = None
    if len(common) >= 8:
        left = np.array([weekday["profile"][h]["mean"] for h in common])
        right = np.array([weekend["profile"][h]["mean"] for h in common])
        if left.std() > 1e-12 and right.std() > 1e-12:
            similarity = float(np.corrcoef(left, right)[0, 1])
    if similarity is not None:
        details.append({"label": "两条日内曲线相关系数", "value": f"r = {similarity:.3f}（{len(common)} 个共同小时）"})
    if have_weekday and have_weekend and similarity is not None:
        if similarity >= 0.8:
            message = "工作日与周末的日内形态较为相似，主要差别体现在整体水平而不是高峰位置。"
        elif similarity >= 0.4:
            message = "工作日与周末的日内形态存在一定差异，但仍有部分时段走势一致。"
        else:
            message = "工作日与周末的日内形态差异较明显，高峰与低谷出现的时间并不一致。"
        details.append({"label": "形态差异判断", "value": message})
    reliability_level = "high"
    reliability_notes = []
    for key, label in (("weekday", "工作日"), ("weekend", "周末")):
        group = data[key]
        if group["samples"] == 0:
            reliability_level = "low"
            reliability_notes.append(f"没有有效的{label}数据。")
        elif group["valid_dates"] < 2:
            reliability_level = "low" if reliability_level != "low" else reliability_level
            reliability_notes.append(f"{label}只有 {group['valid_dates']} 个有效日期，代表性有限。")
            warnings.append(f"{label}仅覆盖 {group['valid_dates']} 天，结论可能不稳定。")
        elif group["valid_dates"] < 4 and reliability_level == "high":
            reliability_level = "medium"
            reliability_notes.append(f"{label}只有 {group['valid_dates']} 个有效日期。")
    if have_weekday and have_weekend:
        a, b = weekday["samples"], weekend["samples"]
        if a and b and max(a, b) / max(1, min(a, b)) >= 4:
            reliability_notes.append(f"两组的观测数量不均衡（工作日 {a} vs 周末 {b}）。")
            if reliability_level == "high":
                reliability_level = "medium"
    if not have_weekend:
        warnings.append("当前选择的时间范围不包含有效周末数据，无法进行完整的工作日与周末比较。")
    if not have_weekday:
        warnings.append("当前选择的时间范围不包含有效工作日数据，无法进行完整的工作日与周末比较。")
    details.extend(
        [
            {"label": "工作时间口径", "value": "逐小时平均后，在两组都有数据的相同小时上再取平均（避免覆盖不均衡偏差）"},
            {"label": "相对差异", "value": "(工作日 − 周末) / |周末| × 100%，分母为 0 时不输出百分比"},
        ]
    )
    return {
        "available": have_weekday or have_weekend,
        "items": items[:4],
        "warnings": warnings,
        "details": details,
        "reliability": {"level": reliability_level, "notes": reliability_notes},
        "peaks": peaks,
        "similarity": similarity,
    }


# ---------------------------------------------------------------------------
# ACF, periodicity and trend
# ---------------------------------------------------------------------------


def acf_curve(values: np.ndarray, max_lag: int) -> dict[str, Any]:
    """Pairwise ACF on the resampled grid, robust to internal missing values.

    For lag k only pairs (v[i], v[i+k]) where *both* are observed are used, so a
    gap never gets silently treated as a regular observation.  The 95% band is
    the white-noise approximation 1.96/sqrt(n_pairs).
    """
    array = np.asarray(values, dtype="float64")
    n = int(array.size)
    finite = np.isfinite(array)
    if finite.sum() < 6:
        return {
            "available": False,
            "lags": [], "values": [], "ci": [], "pairs": [],
            "reason": "有效观测少于 6 个，无法计算自相关。",
            "max_lag": 0,
        }
    max_lag = int(max(2, min(max_lag, n - 2)))
    lags: list[int] = []
    acf: list[float | None] = []
    ci: list[float | None] = []
    pairs_count: list[int] = []
    for lag in range(1, max_lag + 1):
        left = array[:-lag]
        right = array[lag:]
        mask = np.isfinite(left) & np.isfinite(right)
        count = int(mask.sum())
        lags.append(lag)
        pairs_count.append(count)
        if count < 3:
            acf.append(None)
            ci.append(None)
            continue
        a = left[mask]
        b = right[mask]
        if a.std() <= 1e-12 or b.std() <= 1e-12:
            acf.append(None)
            ci.append(None)
            continue
        acf.append(float(np.corrcoef(a, b)[0, 1]))
        ci.append(1.96 / math.sqrt(count))
    return {
        "available": True,
        "lags": lags,
        "values": acf,
        "ci": ci,
        "pairs": pairs_count,
        "max_lag": max_lag,
        "reason": None,
        "method": "pairwise Pearson correlation on the resampled grid; missing pairs skipped",
        "ci_assumption": "95% white-noise band ≈ 1.96 / sqrt(有效配对样本数)",
    }


def detrend(values: np.ndarray) -> np.ndarray:
    array = np.asarray(values, dtype="float64")
    mask = np.isfinite(array)
    if mask.sum() < 3:
        return array.copy()
    x = np.arange(array.size, dtype="float64")[mask]
    y = array[mask]
    slope, intercept = np.polyfit(x, y, 1)
    out = array.copy()
    out[mask] = y - (slope * x + intercept)
    return out


def detect_periodicity(
    values: np.ndarray,
    *,
    interval_minutes: int,
    max_lag: int,
    span_seconds: int,
) -> dict[str, Any]:
    """Look for hourly / daily / weekly peaks near the expected lags."""
    detrended = detrend(values)
    curve = acf_curve(detrended, max_lag)
    n_valid = int(np.isfinite(values).sum())
    candidates = []
    covered_minutes = max_lag * interval_minutes
    span_minutes = span_seconds / 60
    for name, minutes in (
        ("1 小时（小时级）", 60),
        ("24 小时（日周期）", 1440),
        ("7 天（周周期）", 10080),
    ):
        lag = int(round(minutes / interval_minutes))
        entry: dict[str, Any] = {
            "name": name,
            "lag": lag,
            "duration_minutes": minutes,
            "duration_label": duration_label(minutes),
            "available": False,
            "status": "insufficient",
            "reason": None,
            "peak_value": None,
            "peak_lag": None,
            "prominence": None,
            "pairs": 0,
            "expected_pairs": 0,
            "coverage_ratio": None,
            "repetitions": round(span_minutes / minutes, 2) if minutes else None,
            "reliability": "none",
            "evidence": [],
        }
        if lag < 2:
            entry["reason"] = f"当前采样间隔 {interval_minutes} 分钟，无法分辨 {name} 周期。"
            candidates.append(entry)
            continue
        if lag > max_lag:
            entry["reason"] = (
                f"当前 Max Lag={max_lag}，只覆盖约 {duration_label(covered_minutes)}，"
                f"尚未覆盖 {duration_label(minutes)} 周期。建议增加 Max Lag。"
            )
            candidates.append(entry)
            continue
        probe = max(2, int(round(lag * 0.10)))
        if lag + probe > max_lag:
            entry["reason"] = (
                f"Max Lag={max_lag} 刚好止于候选周期 Lag={lag} 附近，后面没有足够滞后用于确认"
                f"该处是否为局部峰值；请把 Max Lag 增加到至少 {lag + probe}。"
            )
            candidates.append(entry)
            continue
        if span_minutes < 2 * minutes:
            entry["reason"] = (
                f"所选时间跨度约 {duration_label(span_minutes)}，不足 {duration_label(minutes)} 的两个完整周期，"
                "无法可靠判断该周期。"
            )
            candidates.append(entry)
            continue
        if not curve["available"]:
            entry["reason"] = curve.get("reason") or "数据不足，无法计算。"
            candidates.append(entry)
            continue
        lags = curve["lags"]
        values_list = curve["values"]
        window = probe
        low = max(1, lag - window)
        high = min(len(lags) - 1, lag + window)
        segment = [(lags[i], values_list[i]) for i in range(low, high + 1) if values_list[i] is not None]
        if not segment:
            entry["reason"] = "候选周期附近没有足够的 ACF 值。"
            candidates.append(entry)
            continue
        # Only a real local maximum counts as a peak. Without this check a
        # monotonically decaying ACF would report the window edge as a "peak"
        # (which is how a weekly sine could masquerade as a daily cycle).
        local_peaks = []
        for i in range(low, high + 1):
            value = values_list[i]
            if value is None:
                continue
            left = values_list[i - 1] if i - 1 >= 0 else None
            right = values_list[i + 1] if i + 1 < len(values_list) else None
            if left is None or right is None:
                continue
            if value >= left and value >= right and (value > left or value > right):
                local_peaks.append((lags[i], value))
        if not local_peaks:
            entry["reason"] = (
                f"候选 Lag={lag}（{duration_label(minutes)}）附近的自相关没有形成局部峰值"
                "（ACF 在此区间单调变化），不能视为周期证据。"
            )
            candidates.append(entry)
            continue
        peak_lag, peak_value = max(local_peaks, key=lambda pair: pair[1])
        deviation = abs(peak_lag - lag) / max(1, lag)
        entry["candidate_lag"] = lag
        if deviation > 0.2:
            entry["reason"] = (
                f"候选 Lag={lag}（{duration_label(minutes)}）附近的最大 ACF 出现在 Lag={peak_lag}"
                f"（{duration_label(peak_lag * interval_minutes)}），偏离候选周期 {deviation * 100:.0f}%，"
                "不足以判定为该周期。"
            )
            candidates.append(entry)
            continue
        neighbour_values = [v for l, v in segment if abs(l - peak_lag) >= 2]
        baseline = min(neighbour_values) if neighbour_values else 0.0
        prominence = peak_value - baseline
        pairs = int(curve["pairs"][min(len(curve["pairs"]) - 1, peak_lag - 1)])
        expected_pairs = max(1, n_valid - peak_lag)
        coverage_ratio = pairs / expected_pairs
        repetitions = span_minutes / minutes
        covered = span_minutes >= 2 * minutes
        base_ok = peak_value >= 0.25 and prominence >= 0.05 and pairs >= 30 and covered
        # A period is only "confirmed" when there are at least three full repeats
        # and at least two overlapping samples per lag (2*lag pairs), plus a
        # reasonably strong autocorrelation. Everything weaker stays a candidate.
        confirmed = base_ok and repetitions >= 3 and pairs >= 2 * lag and peak_value >= 0.4
        candidate = base_ok and not confirmed
        entry.update(
            {
                "available": base_ok,
                "status": "confirmed" if confirmed else ("candidate" if candidate else "insufficient"),
                "peak_value": float(peak_value),
                "peak_lag": int(peak_lag),
                "prominence": float(prominence),
                "pairs": pairs,
                "expected_pairs": int(expected_pairs),
                "coverage_ratio": float(coverage_ratio),
                "repetitions": round(repetitions, 2),
                "reliability": (
                    "high" if confirmed and peak_value >= 0.5 and repetitions >= 4
                    else "medium" if confirmed
                    else "low"
                ),
            }
        )
        entry["evidence"].append(
            f"候选 Lag={lag}（{duration_label(minutes)}）；去趋势 ACF 在 Lag={peak_lag}"
            f"（约 {duration_label(peak_lag * interval_minutes)}）处为 {peak_value:.3f}"
        )
        entry["evidence"].append(f"局部突出度 {prominence:.3f}，有效配对 {pairs} 个")
        entry["evidence"].append(f"观测跨度约 {span_minutes / minutes:.1f} 个候选周期")
        if confirmed:
            entry["evidence"].append(
                f"至少 {repetitions:.1f} 个完整重复；该滞后处有效配对 {pairs} 个（覆盖 {coverage_ratio * 100:.0f}%）"
            )
        elif candidate:
            reasons = []
            if repetitions < 3:
                reasons.append(f"只有约 {repetitions:.1f} 个完整重复（确认需要 ≥3）")
            if pairs < 2 * lag:
                reasons.append(f"该滞后处只有 {pairs} 个有效配对（确认需要 ≥{2 * lag}）")
            if peak_value < 0.4:
                reasons.append(f"ACF 峰值 {peak_value:.3f} 低于确认阈值 0.4")
            entry["reason"] = "候选周期，证据尚不足以确认：" + "；".join(reasons)
        else:
            if peak_value < 0.25:
                entry["reason"] = f"候选周期附近的最大 ACF 只有 {peak_value:.3f}，低于 0.25 的判定阈值。"
            elif prominence < 0.05:
                entry["reason"] = "候选周期附近没有明显的局部峰值（突出度不足 0.05）。"
            elif pairs < 30:
                entry["reason"] = f"有效配对样本只有 {pairs} 个，统计可靠性不足。"
        candidates.append(entry)
    return {"candidates": candidates, "max_lag": max_lag, "interval_minutes": interval_minutes,
            "covered_minutes": covered_minutes, "span_minutes": span_minutes,
            "method": "先去趋势再做成对 ACF；候选周期 ±5% 邻域内取局部峰值；"
                      "“候选”需相关度≥0.25、突出度≥0.05、配对≥30；"
                      "“确认”还需 ≥3 个完整重复、该滞后配对 ≥2×Lag 且峰值≥0.4"}


def trend_analysis(values: np.ndarray, interval_minutes: int) -> dict[str, Any]:
    array = np.asarray(values, dtype="float64")
    mask = np.isfinite(array)
    n = int(mask.sum())
    if n < 3:
        return {"available": False, "reason": "有效观测少于 3 个，无法估计趋势。", "n": n}
    x = np.arange(array.size, dtype="float64")[mask]
    y = array[mask]
    slope, intercept = np.polyfit(x, y, 1)
    fitted = slope * x + intercept
    ss_res = float(np.sum((y - fitted) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    r2 = None if ss_tot <= 1e-12 else 1.0 - ss_res / ss_tot
    mean = float(y.mean())
    per_hour = float(slope) * (60.0 / interval_minutes)
    per_day = per_hour * 24
    relative_day = (per_day / abs(mean) * 100) if abs(mean) > 1e-9 else None
    if relative_day is None:
        direction = "flat"
        label = "没有明显线性趋势"
    elif abs(relative_day) < 0.5:
        direction = "flat"
        label = "没有明显线性趋势（日均变化不足均值的 0.5%）"
    elif r2 is not None and r2 < 0.05:
        direction = "flat"
        label = (
            f"没有明显线性趋势（日均变化约 {relative_day:+.1f}%，但 R²={r2:.3f}，"
            "线性拟合几乎解释不了数据波动）"
        )
    elif per_day > 0:
        direction = "up"
        label = "整体呈上升趋势"
    else:
        direction = "down"
        label = "整体呈下降趋势"
    strength = "weak"
    if r2 is not None:
        if r2 >= 0.3:
            strength = "strong"
        elif r2 >= 0.1:
            strength = "moderate"
    return {
        "available": True,
        "slope_per_point": float(slope),
        "slope_per_hour": per_hour,
        "slope_per_day": per_day,
        "intercept": float(intercept),
        "r2": r2,
        "direction": direction,
        "direction_label": label,
        "strength": strength,
        "relative_daily_pct": relative_day,
        "n": n,
        "interval_minutes": interval_minutes,
        "note": "线性最小二乘拟合，仅描述所选区间内的平均变化，不代表未来走势。",
    }


def acf_trend_insights(
    *,
    acf: dict[str, Any],
    periodicity: dict[str, Any],
    trend: dict[str, Any],
    interval_minutes: int,
    valid_points: int,
    span_seconds: int,
    max_lag: int,
) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    warnings: list[str] = []
    details: list[dict[str, Any]] = []
    if not acf.get("available"):
        return {
            "available": False,
            "items": [item("no_acf", "自相关", acf.get("reason") or "无法计算自相关。", level="warning")],
            "warnings": [acf.get("reason") or "无法计算自相关。"],
            "details": [],
            "reliability": {"level": "none", "notes": ["有效样本不足。"]},
        }
    values = acf["values"]
    usable = [(lag, value) for lag, value in zip(acf["lags"], values) if value is not None]
    small = [value for lag, value in usable if lag <= max(3, int(0.02 * max_lag))]
    short_term = float(np.mean(small)) if small else None
    if short_term is None:
        text = "短期滞后没有足够的有效配对样本。"
        level = "warning"
    elif short_term >= 0.6:
        text = (f"较短时间滞后下表现出较强正相关（Lag 1–{max(3, int(0.02 * max_lag))} 平均 ACF={short_term:.3f}），"
                "说明相邻时间点的流量变化具有明显连续性。")
        level = "info"
    elif short_term >= 0.3:
        text = f"较短滞后下为中等正相关（平均 ACF={short_term:.3f}），相邻观测有一定连续性。"
        level = "info"
    elif short_term >= 0:
        text = f"短期相关性较弱（平均 ACF={short_term:.3f}），相邻时间点之间没有明显连续性。"
        level = "info"
    else:
        text = f"短期滞后平均 ACF 为 {short_term:.3f}，相邻时间点呈现轻微的反向变化倾向。"
        level = "info"
    items.append(item("short_term", "短期相关性", text,
                      level=level, metrics={"mean_acf": short_term, "lags_used": len(small)}))

    quarters = np.array_split(np.array([v for _, v in usable], dtype="float64"), 4) if len(usable) >= 8 else []
    decay_text = None
    if len(quarters) == 4 and all(q.size for q in quarters):
        first = float(np.nanmean(quarters[0]))
        last = float(np.nanmean(quarters[-1]))
        drop = first - last
        lowest_index = int(np.nanargmin(np.array([v for _, v in usable], dtype="float64")))
        later_peak = None
        if lowest_index < len(usable) - 5:
            tail = usable[lowest_index + 1:]
            later_peak = max((value for _, value in tail if value is not None), default=None)
        if drop >= 0.2:
            decay_text = (f"相关性随滞后明显衰减：前 1/4 滞后平均 ACF={first:.3f}，后 1/4 降到 {last:.3f}。")
        elif drop <= -0.2:
            decay_text = (f"相关性没有单调下降：前 1/4 平均 {first:.3f}，后 1/4 反而回升到 {last:.3f}，"
                          "提示可能存在周期性结构。")
        else:
            decay_text = f"相关性变化较平缓（前 1/4 平均 {first:.3f}，后 1/4 平均 {last:.3f}）。"
        if later_peak is not None and lowest_index < len(usable) * 0.5 and later_peak >= 0.25:
            decay_text += f" 在 Lag≈{usable[lowest_index][0]} 之后 ACF 重新上升到 {later_peak:.3f}，提示周期或重复模式。"
        details.append({"label": "衰减统计", "value": f"首段 {first:.3f} → 末段 {last:.3f}；最低点 Lag≈{usable[lowest_index][0]}"})
    if decay_text:
        items.append(item("decay", "相关性衰减", decay_text, metrics={"quarters": 4}))

    negative = min((pair for pair in usable if pair[1] is not None), key=lambda p: p[1], default=None)
    if negative and negative[1] <= -0.2:
        items.append(
            item(
                "negative",
                "负相关特征",
                f"在 Lag={negative[0]}（约 {duration_label(negative[0] * interval_minutes)}）处 ACF={negative[1]:.3f}，"
                "说明相隔这一时长的流量相对平均水平可能朝相反方向变化；这不代表流量本身为负。",
                metrics={"lag": negative[0], "value": negative[1],
                         "duration_minutes": negative[0] * interval_minutes},
            )
        )

    confirmed = [c for c in periodicity["candidates"] if c.get("status") == "confirmed"]
    candidates_only = [c for c in periodicity["candidates"] if c.get("status") == "candidate"]
    missing = [c for c in periodicity["candidates"] if not c["available"] and c.get("reason")]
    if confirmed:
        parts = [
            f"{c['name']}：Lag={c['peak_lag']}（{duration_label(c['peak_lag'] * interval_minutes)}），"
            f"ACF={c['peak_value']:.3f}，{c['repetitions']:.1f} 个完整重复，有效配对 {c['pairs']}"
            for c in confirmed
        ]
        candidate_note = ""
        if candidates_only:
            candidate_parts = [
                f"{c['name']}（Lag={c['peak_lag']}，ACF={c['peak_value']:.3f}，仅 {c['repetitions']:.1f} 个重复）"
                for c in candidates_only
            ]
            candidate_note = "；另有候选周期但证据不足、未确认：" + "、".join(candidate_parts)
        items.append(
            item("periodicity", "潜在周期性",
                 "已确认的周期证据：" + "；".join(parts) + "。" + candidate_note,
                 metrics={"candidates": confirmed, "unconfirmed": candidates_only})
        )
        for c in confirmed:
            details.append({"label": f"{c['name']} 证据", "value": "；".join(c["evidence"])})
        for c in candidates_only:
            details.append({"label": f"{c['name']}（候选，未确认）", "value": c["reason"] or ""})
    elif candidates_only:
        parts = [
            f"{c['name']}：Lag={c['peak_lag']}（{duration_label(c['peak_lag'] * interval_minutes)}），"
            f"ACF={c['peak_value']:.3f}，仅 {c['repetitions']:.1f} 个完整重复、{c['pairs']} 个有效配对"
            for c in candidates_only
        ]
        items.append(
            item(
                "periodicity", "潜在周期性",
                "发现候选周期，但证据不足以确认：" + "；".join(parts)
                + "。需要更长的观测或更多重复才能确认。",
                level="warning",
                metrics={"candidates": candidates_only},
            )
        )
        for c in candidates_only:
            details.append({"label": f"{c['name']} 候选原因", "value": c["reason"] or ""})
    else:
        reasons = "；".join(f"{c['name']}：{c['reason']}" for c in missing[:3])
        items.append(
            item("periodicity", "潜在周期性",
                 "当前数据没有检测到统计上足够明显的周期信号。" + (f"（{reasons}）" if reasons else ""),
                 metrics={"candidates": periodicity["candidates"]})
        )
    for c in missing:
        details.append({"label": f"{c['name']} 无法判定", "value": c["reason"]})

    if trend.get("available"):
        r2_text = f"，R²={trend['r2']:.3f}" if trend.get("r2") is not None else "，R² 无法计算"
        items.append(
            item(
                "trend",
                "线性趋势",
                f"在当前选择的时间范围内，线性拟合斜率为 {fmt_num(trend['slope_per_hour'])} / 小时"
                f"（{fmt_num(trend['slope_per_day'])} / 天）{r2_text}，{trend['direction_label']}。"
                + ("由于序列波动较明显，该斜率只表示区间内的平均线性变化，不代表未来趋势。"
                   if trend["strength"] == "weak"
                   else "线性拟合解释力有限（R²<0.3），该斜率只表示区间内的平均变化，不代表未来走势。"
                   if (trend.get("r2") is not None and trend["r2"] < 0.3)
                   else "该结果仅描述所选区间，不代表未来走势。"),
                level="warning" if trend["strength"] == "weak" else "info",
                metrics={
                    "slope_per_hour": trend["slope_per_hour"],
                    "slope_per_day": trend["slope_per_day"],
                    "r2": trend.get("r2"),
                    "direction": trend["direction"],
                },
            )
        )
        details.append({"label": "趋势单位", "value": f"每点 = 每 {interval_minutes} 分钟；已换算为每小时 / 每天"})
        details.append({"label": "拟合样本", "value": f"{trend['n']} 个有效观测参与最小二乘拟合"})
        if trend["strength"] == "weak":
            warnings.append("线性拟合的解释力较弱（R² 较低），不宜据此判断趋势强弱。")
    else:
        items.append(item("trend", "线性趋势", trend.get("reason") or "无法估计趋势。", level="warning"))

    actions: list[str] = []
    if max_lag * interval_minutes < 1440:
        actions.append(f"当前 Max Lag={max_lag} 仅覆盖 {duration_label(max_lag * interval_minutes)}，"
                       "如需检查 24 小时日周期请增加 Max Lag。")
    if span_seconds / 60 < 10080:
        actions.append(f"当前跨度约 {duration_label(span_seconds / 60)}，不足 7 天，无法可靠判断周周期。")
    if valid_points < 100:
        actions.append("有效观测较少，建议扩大时间范围后再判断周期性。")
    if not confirmed and not candidates_only:
        actions.append("可尝试扩大时间范围、增加 Max Lag，或检查数据中是否存在长时间缺失。")
    if actions:
        items.append(item("actions", "建议", " ".join(actions[:2]), metrics={"actions": actions[:3]}))
    details.extend(
        [
            {"label": "ACF 方法", "value": acf.get("method", "")},
            {"label": "置信带", "value": acf.get("ci_assumption", "")},
            {"label": "有效样本", "value": f"{valid_points} 个观测"},
            {"label": "Max Lag", "value": f"{max_lag}（约 {duration_label(max_lag * interval_minutes)}）"},
        ]
    )
    return {
        "available": True,
        "items": items[:6],
        "warnings": warnings,
        "details": details,
        "reliability": {
            "level": "high" if valid_points >= 288 and span_seconds >= 86400 else "medium",
            "notes": [f"有效观测 {valid_points} 个，跨度 {duration_label(span_seconds / 60)}。"],
        },
    }
