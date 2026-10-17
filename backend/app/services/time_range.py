"""Analysis time range resolution (dates <-> resampled point indices).

Boundary contract: the selected range is **inclusive on both ends** over the
bucket start timestamps of the chosen resolution, i.e. ``start_at <= t <= end_at``.
This is identical for the UI display and for every statistic.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import numpy as np
import pandas as pd

from app.core.errors import Issue, error, warning
from app.services.series import FREQUENCY_MINUTES, resample_axis


def _parse_epoch(value: str | None, path: str) -> tuple[int | None, list[Issue]]:
    if value in (None, ""):
        return None, []
    text = str(value).strip().replace("Z", "")
    parsed = pd.to_datetime(text, errors="coerce", format="mixed")
    if parsed is pd.NaT or pd.isna(parsed):
        return None, [
            error(path, "INVALID_DATETIME",
                  f"无法解析时间 “{value}”，请使用 YYYY-MM-DD HH:mm:ss 格式。",
                  "例如 2013-11-01 00:00:00。", value)
        ]
    # Source timestamps are naive local time; keep them naive and convert to epoch
    # seconds with the same convention as the stored series.
    epoch = int(pd.Timestamp(parsed).value // 1_000_000_000)
    return epoch, []


def _fmt(epoch: int | None) -> str | None:
    if epoch is None:
        return None
    return pd.Timestamp(int(epoch), unit="s").strftime("%Y-%m-%d %H:%M:%S")


def _span_label(seconds: int) -> str:
    if seconds <= 0:
        return "0 分钟"
    minutes = seconds / 60
    if minutes < 90:
        return f"{minutes:.0f} 分钟"
    hours = minutes / 60
    if hours < 36:
        return f"{hours:.1f} 小时"
    days = hours / 24
    return f"{days:.1f} 天"


@dataclass
class ResolvedRange:
    source_key: str
    frequency: str
    interval_minutes: int
    total_points: int
    start_index: int
    end_index: int  # exclusive
    start_at: str | None
    end_at: str | None
    start_epoch: int | None
    end_epoch: int | None
    source_start_at: str | None
    source_end_at: str | None
    span_seconds: int
    points: int
    truncated_start: bool = False
    truncated_end: bool = False
    issues: list[Issue] = field(default_factory=list)

    def to_public(self) -> dict[str, Any]:
        return {
            "start_at": self.start_at,
            "end_at": self.end_at,
            "start_index": self.start_index,
            "end_index": self.end_index,
            "points": self.points,
            "span_seconds": self.span_seconds,
            "span_label": _span_label(self.span_seconds),
            "interval_minutes": self.interval_minutes,
            "total_points": self.total_points,
            "source_start_at": self.source_start_at,
            "source_end_at": self.source_end_at,
            "boundary": "inclusive [start_at, end_at] on bucket start timestamps",
            "truncated_start": self.truncated_start,
            "truncated_end": self.truncated_end,
        }


def resolve_range(
    source_key: str,
    frequency: str,
    *,
    time_start: str | None = None,
    time_end: str | None = None,
    start_index: int | None = None,
    window_points: int | None = None,
) -> ResolvedRange:
    """Resolve the authoritative analysis range, collecting field level issues."""
    if frequency not in FREQUENCY_MINUTES:
        frequency = "native"
    axis = resample_axis(source_key, frequency)
    total = int(axis.size)
    if total == 0:
        return ResolvedRange(
            source_key=source_key, frequency=frequency, interval_minutes=0, total_points=0,
            start_index=0, end_index=0, start_at=None, end_at=None, start_epoch=None, end_epoch=None,
            source_start_at=None, source_end_at=None, span_seconds=0, points=0,
            issues=[error("m1.time_start", "NO_DATA", "该数据源没有任何可用时间点。", "请先导入数据。")],
        )
    interval = int((axis[1] - axis[0]) // 60) if total > 1 else FREQUENCY_MINUTES.get(frequency) or 10
    source_start, source_end = int(axis[0]), int(axis[-1])
    issues: list[Issue] = []
    truncated_start = truncated_end = False

    start_epoch, start_issues = _parse_epoch(time_start, "m1.time_start")
    end_epoch, end_issues = _parse_epoch(time_end, "m1.time_end")
    issues.extend(start_issues)
    issues.extend(end_issues)

    date_mode = (time_start not in (None, "")) or (time_end not in (None, ""))
    if date_mode and not start_issues and not end_issues:
        start_epoch = source_start if start_epoch is None else start_epoch
        end_epoch = source_end if end_epoch is None else end_epoch
        if start_epoch > end_epoch:
            issues.append(error("m1.time_start", "DATE_ORDER",
                                "开始时间必须早于结束时间。",
                                "请调整 Start / End，或使用高级索引设置。", _fmt(start_epoch)))
            start_epoch, end_epoch = end_epoch, start_epoch
        if start_epoch > source_end or end_epoch < source_start:
            issues.append(error("m1.time_start", "OUT_OF_BOUNDS",
                                f"所选范围完全超出数据边界（{_fmt(source_start)} ～ {_fmt(source_end)}）。",
                                "请把日期时间调整到该数据源的真实观测范围内。", _fmt(start_epoch)))
        if start_epoch < source_start:
            truncated_start = True
            issues.append(warning("m1.time_start", "TRUNCATED_START",
                                  f"开始时间早于数据起点，已从 {_fmt(source_start)} 开始。",
                                  "这是数据边界，不是缺失。", _fmt(start_epoch)))
            start_epoch = source_start
        if end_epoch > source_end:
            truncated_end = True
            issues.append(warning("m1.time_end", "TRUNCATED_END",
                                  f"结束时间晚于数据终点，已截断到 {_fmt(source_end)}。",
                                  "这是数据边界，不是缺失。", _fmt(end_epoch)))
            end_epoch = source_end
        low = int(np.searchsorted(axis, max(start_epoch, source_start), side="left"))
        high = int(np.searchsorted(axis, min(end_epoch, source_end), side="right"))
    else:
        start_index = 0 if start_index is None else int(start_index)
        points = total if window_points is None else int(window_points)
        if start_index < 0 or start_index >= total:
            issues.append(error("m1.start_index", "OUT_OF_RANGE",
                                f"起始索引必须在 0 ～ {total - 1} 之间，收到 {start_index}。",
                                "请减小起始索引或使用日期时间选择。", start_index))
            start_index = min(max(start_index, 0), max(total - 1, 0))
        if points < 1:
            issues.append(error("m1.window_points", "OUT_OF_RANGE",
                                "窗口点数必须大于 0。", "请输入至少 2 个时间点。", points))
            points = 1
        low = start_index
        high = min(start_index + points, total)
        if start_index + points > total:
            issues.append(warning("m1.window_points", "TRUNCATED_WINDOW",
                                  f"窗口超出数据末端，已截断到 {total - start_index} 个点。",
                                  "可按日期时间选择范围以避免手工计算。", points))

    points = max(0, high - low)
    if points == 0:
        issues.append(error("m1.time_range", "NO_POINTS",
                            "所选时间范围内没有任何观测点。",
                            "请扩大范围或检查数据源的时间边界。", None))
    elif points == 1:
        issues.append(error("m1.window_points", "TOO_FEW_POINTS",
                            "所选时间范围只有 1 个观测点，无法进行时间分析。",
                            "请至少选择 2 个采样点（建议覆盖一个完整日周期）。", points))

    start_at = _fmt(int(axis[low])) if points else None
    end_at = _fmt(int(axis[high - 1])) if points else None
    span_seconds = (int(axis[high - 1]) - int(axis[low]) + interval * 60) if points else 0
    return ResolvedRange(
        source_key=source_key,
        frequency=frequency,
        interval_minutes=interval,
        total_points=total,
        start_index=low,
        end_index=high,
        start_at=start_at,
        end_at=end_at,
        start_epoch=int(axis[low]) if points else None,
        end_epoch=int(axis[high - 1]) if points else None,
        source_start_at=_fmt(source_start),
        source_end_at=_fmt(source_end),
        span_seconds=span_seconds,
        points=points,
        truncated_start=truncated_start,
        truncated_end=truncated_end,
        issues=issues,
    )


def has_blocking(issues: list[Issue]) -> bool:
    return any(i.get("severity") == "error" for i in issues)
