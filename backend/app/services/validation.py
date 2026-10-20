"""Unified parameter validation engine (PROJECT_SPEC 3.5 + 7.7 + 12.4).

One engine validates every editable parameter of Module 1-5, every algorithm
parameter group (including the 12 independent All Models groups) and all
cross-field / environment dependent rules.  The REST layer exposes the same
metadata through ``GET /api/validation/schema`` so the frontend renders and
pre-validates from the *same* rules, and every mutating endpoint calls these
functions again before touching the database.
"""

from __future__ import annotations

import math
from typing import Any, Iterable

from app.core.errors import Issue, error, warning
from app.forecast.registry import MODEL_BY_KEY, MODELS, default_params
from app.services.time_range import resolve_range

# ---------------------------------------------------------------------------
# Generic field checking
# ---------------------------------------------------------------------------


def check_field(spec: dict[str, Any], value: Any, path: str) -> tuple[list[Issue], Any]:
    """Validate a single value against a registry field spec.

    Returns the issues plus the coerced value (used only after a successful
    validation).
    """
    issues: list[Issue] = []
    key = spec.get("key", path)
    code = spec.get("error_code")
    label = spec.get("label_zh") or spec.get("label") or key
    rng = _range_text(spec)
    suggestion = spec.get("suggestion_zh") or ""

    if value is None or (isinstance(value, str) and value.strip() == ""):
        if spec.get("required", True):
            issues.append(
                error(path, "REQUIRED", f"{label} 不能为空。",
                      suggestion or f"请输入合法的{label}{('，' + rng) if rng else ''}。")
            )
        return issues, None

    type_ = spec["type"]
    if type_ == "integer":
        if isinstance(value, bool):
            issues.append(error(path, "NOT_AN_INTEGER", f"{label} 必须是整数，收到布尔值 {value}。",
                                suggestion or "请输入整数。", value))
            return issues, None
        if isinstance(value, str):
            text = value.strip()
            try:
                number = float(text)
            except ValueError:
                issues.append(error(path, "NOT_A_NUMBER", f"{label} 必须是数字，收到 “{value}”。",
                                    suggestion or "请输入整数。", value))
                return issues, None
        else:
            try:
                number = float(value)
            except (TypeError, ValueError):
                issues.append(error(path, "NOT_A_NUMBER", f"{label} 必须是数字，收到 {value!r}。",
                                    suggestion or "请输入整数。", value))
                return issues, None
        if not math.isfinite(number):
            issues.append(error(path, "NOT_A_NUMBER", f"{label} 必须是有限数值。",
                                suggestion or "请输入有限整数。", value))
            return issues, None
        if abs(number - round(number)) > 1e-9:
            issues.append(error(path, "NOT_AN_INTEGER", f"{label} 必须是整数，收到 {value}。",
                                suggestion or "请输入整数，不要使用小数。", value, group=spec.get("group")))
            return issues, None
        coerced: Any = int(round(number))
    elif type_ == "number":
        try:
            coerced = float(value)
        except (TypeError, ValueError):
            issues.append(error(path, "NOT_A_NUMBER", f"{label} 必须是数字，收到 {value!r}。",
                                suggestion or "请输入数值。", value, group=spec.get("group")))
            return issues, None
        if not math.isfinite(coerced):
            issues.append(error(path, "NOT_A_NUMBER", f"{label} 必须是有限数值，收到 {value}。",
                                suggestion or "请输入有限数值。", value, group=spec.get("group")))
            return issues, None
    elif type_ == "boolean":
        if isinstance(value, bool):
            coerced = value
        elif isinstance(value, (int, float)) and value in (0, 1):
            coerced = bool(value)
        elif isinstance(value, str) and value.strip().lower() in ("true", "false"):
            coerced = value.strip().lower() == "true"
        else:
            issues.append(error(path, "TYPE_INVALID", f"{label} 必须是布尔值 true/false，收到 {value!r}。",
                                suggestion or "请选择开关状态。", value, group=spec.get("group")))
            return issues, None
    elif type_ == "enum":
        enum = spec.get("enum") or []
        coerced = value
        if enum and value not in enum:
            issues.append(error(
                path, code or "ENUM_INVALID",
                f"{label} 只能取 {', '.join(str(e) for e in enum)} 之一，收到 “{value}”。",
                suggestion or f"请从合法取值中选择。", value, group=spec.get("group")))
            return issues, None
    elif type_ == "array":
        if not isinstance(value, (list, tuple)):
            issues.append(error(path, "TYPE_INVALID", f"{label} 必须是列表。",
                                suggestion or "请提供列表值。", value, group=spec.get("group")))
            return issues, None
        coerced = list(value)
    else:  # string / other
        coerced = value if isinstance(value, str) else str(value)

    # numeric range checks
    if type_ in ("integer", "number") and isinstance(coerced, (int, float)) and not isinstance(coerced, bool):
        low = spec.get("min")
        high = spec.get("max")
        if low is not None:
            if spec.get("exclusive_min") and coerced <= low:
                issues.append(error(path, code or "OUT_OF_RANGE",
                                    f"{label} 必须大于 {low}，收到 {coerced}。",
                                    suggestion or f"请调整为大于 {low} 的值。", coerced,
                                    group=spec.get("group")))
                return issues, None
            if not spec.get("exclusive_min") and coerced < low:
                issues.append(error(path, code or "OUT_OF_RANGE",
                                    f"{label} 不能小于 {low}，收到 {coerced}。",
                                    suggestion or f"请调整为 {rng} 之间的值。", coerced,
                                    group=spec.get("group")))
                return issues, None
        if high is not None:
            if spec.get("exclusive_max") and coerced >= high:
                issues.append(error(path, code or "OUT_OF_RANGE",
                                    f"{label} 必须小于 {high}，收到 {coerced}。",
                                    suggestion or spec.get("suggestion_zh") or f"请调整为小于 {high} 的值。",
                                    coerced, group=spec.get("group")))
                return issues, None
            if not spec.get("exclusive_max") and coerced > high:
                issues.append(error(path, code or "OUT_OF_RANGE",
                                    f"{label} 不能大于 {high}，收到 {coerced}。",
                                    suggestion or f"请调整为 {rng} 之间的值。", coerced,
                                    group=spec.get("group")))
                return issues, None
        threshold = spec.get("warning_above")
        if threshold is not None and coerced > threshold:
            issues.append(warning(
                path, "LONG_TRAINING",
                spec.get("warning_message_zh") or f"{label} 取值 {coerced} 较大，预计运行时间较长。",
                spec.get("warning_suggestion_zh") or "可适当降低该参数。",
                coerced, group=spec.get("group")))
    return issues, coerced


def _range_text(spec: dict[str, Any]) -> str:
    low, high = spec.get("min"), spec.get("max")
    if low is None and high is None:
        return ""
    if low is None:
        return f"建议不超过 {high}"
    if high is None:
        return f"不得小于 {low}"
    left = "(" if spec.get("exclusive_min") else "["
    right = ")" if spec.get("exclusive_max") else "]"
    return f"合法范围 {left}{low}, {high}{right}"


def visible(spec: dict[str, Any], values: dict[str, Any]) -> bool:
    rule = spec.get("visible_when")
    if not rule:
        return True
    return all(values.get(k) == v for k, v in rule.items())


def enabled(spec: dict[str, Any], values: dict[str, Any]) -> bool:
    rule = spec.get("enabled_when")
    if not rule:
        return True
    return all(values.get(k) == v for k, v in rule.items())


def check_model_params(
    algorithm_key: str,
    params: dict[str, Any],
    *,
    mode: str | None = None,
    context: dict[str, Any] | None = None,
    path_prefix: str | None = None,
) -> tuple[list[Issue], dict[str, Any]]:
    """Validate one algorithm parameter group (Basic + Advanced)."""
    if algorithm_key not in MODEL_BY_KEY:
        return [error(path_prefix or "algorithm", "UNKNOWN_ALGORITHM",
                      f"未知算法 {algorithm_key}。", "请从 12 个算法中选择。", algorithm_key)], {}
    model = MODEL_BY_KEY[algorithm_key]
    context = context or {}
    prefix = path_prefix or f"model_configs.{algorithm_key}.params"
    merged = default_params(algorithm_key)
    merged.update({k: v for k, v in (params or {}).items()})
    issues: list[Issue] = []
    coerced: dict[str, Any] = {}
    specs = model["params"]
    if model.get("foundation"):
        specs = _foundation_specs(model, merged)
    for spec in specs:
        if not visible(spec, merged):
            continue
        field_path = f"{prefix}.{spec['key']}"
        if not enabled(spec, merged):
            continue
        field_issues, value = check_field(spec, merged.get(spec["key"]), field_path)
        issues.extend(field_issues)
        coerced[spec["key"]] = value if value is not None else merged.get(spec["key"])
    issues.extend(cross_field_model_checks(algorithm_key, coerced, model, context, prefix, mode))
    return issues, coerced


def _foundation_specs(model: dict[str, Any], merged: dict[str, Any]) -> list[dict[str, Any]]:
    """Inject the real, dynamically detected checkpoint list before validating."""
    from app.forecast.foundation import chronos_status, timesfm_status

    status = timesfm_status() if model["foundation"] == "timesfm" else chronos_status()
    specs: list[dict[str, Any]] = []
    available = [c for c in status["checkpoints"] if c["available"]]
    for spec in model["params"]:
        entry = dict(spec)
        if entry["key"] == "checkpoint_id":
            entry["enum"] = [c["id"] for c in status["checkpoints"]]
            entry["enum_labels"] = [
                f"{c['id']} ({c['license']})" + ("" if c["available"] else " — 未下载")
                for c in status["checkpoints"]
            ]
            entry["enum_meta"] = status["checkpoints"]
            default = status["default_checkpoint"] if available else (entry["enum"][0] if entry["enum"] else "")
            if not merged.get("checkpoint_id"):
                merged["checkpoint_id"] = default
            entry["default"] = default
            entry["suggestion_zh"] = (
                "已就绪的 checkpoint 可直接运行；未下载的会先自动下载（需要网络/镜像）。"
            )
        specs.append(entry)
    return specs


def cross_field_model_checks(
    algorithm_key: str,
    params: dict[str, Any],
    model: dict[str, Any],
    context: dict[str, Any],
    prefix: str,
    mode: str | None = None,
) -> list[Issue]:
    issues: list[Issue] = []
    train_samples = context.get("train_samples")

    def _int(key):
        value = params.get(key)
        return value if isinstance(value, int) and not isinstance(value, bool) else None

    if algorithm_key == "transformer":
        d_model = _int("d_model")
        heads = _int("n_heads")
        if d_model and heads and d_model % heads != 0:
            issues.append(error(
                f"{prefix}.n_heads", "DIVISIBLE",
                f"n_heads={heads} 不能整除 d_model={d_model}（{d_model} % {heads} = {d_model % heads}）。",
                f"请将 d_model 调整为 {heads} 的整数倍（例如 {(d_model // heads) * heads} 或 {((d_model // heads) + 1) * heads}），"
                f"或修改 n_heads。",
                heads))
        feedforward = _int("dim_feedforward")
        if feedforward and d_model and feedforward < d_model // 2:
            issues.append(warning(
                f"{prefix}.dim_feedforward", "SMALL_FEEDFORWARD",
                f"dim_feedforward={feedforward} 明显小于 d_model={d_model}，模型表达力受限。",
                "通常取 d_model 的 2-4 倍。", feedforward))
    if algorithm_key == "lightgbm":
        leaves = _int("num_leaves")
        depth = _int("max_depth")
        if leaves and depth and leaves > 2 ** min(depth, 20):
            issues.append(error(
                f"{prefix}.num_leaves", "LEAVES_EXCEED_DEPTH",
                f"num_leaves={leaves} 超过 2^max_depth={2 ** min(depth, 20)} 的上限。",
                "请降低 num_leaves 或提高 max_depth。", leaves))
        if params.get("bagging_fraction", 1) not in (1, None) and params.get("bagging_freq") == 0:
            issues.append(warning(
                f"{prefix}.bagging_fraction", "BAGGING_DISABLED",
                "bagging_freq=0 时 bagging_fraction 不会生效。",
                "将 bagging_freq 设为大于 0 的整数，或保持 bagging_fraction=1。",
                params.get("bagging_fraction")))
    if algorithm_key == "arima":
        d = _int("d")
        trend = params.get("trend")
        allowed = {0: ["n", "c", "t", "ct"], 1: ["n", "t"], 2: ["n"]}.get(d or 0, ["n"])
        if trend and trend not in allowed:
            issues.append(error(
                f"{prefix}.trend", "TREND_INCOMPATIBLE_WITH_DIFFERENCING",
                f"statsmodels ARIMA 在 d={d} 时不允许 trend='{trend}'：差分会把低阶趋势项消掉，"
                f"该组合会被库直接拒绝。",
                f"请将 trend 改为 {' / '.join(allowed)}，或把 d 调整为 0。",
                trend))
    if algorithm_key in ("rnn", "lstm", "gru") and _int("num_layers") == 1:
        dropout = params.get("dropout")
        if isinstance(dropout, (int, float)) and dropout > 0:
            issues.append(warning(
                f"{prefix}.dropout", "DROPOUT_IGNORED_SINGLE_LAYER",
                f"num_layers=1 时层间 dropout={dropout} 不会生效。",
                "将 num_layers 设为大于 1，或把 dropout 设为 0。", dropout))
    if algorithm_key in ("arima", "prophet") and mode and mode != "fit":
        issues.append(error(
            f"{prefix}.mode", "MODE_NOT_SUPPORTED",
            f"{model['label']} 只支持 Fit 模式，收到 {mode}。",
            "请将执行模式改为 fit。", mode))

    # Dynamic, context aware checks (never a blanket rule)
    batch_size = _int("batch_size")
    if batch_size is not None and isinstance(train_samples, int) and train_samples > 0 and batch_size > train_samples:
        issues.append(warning(
            f"{prefix}.batch_size", "BATCH_LARGER_THAN_SAMPLES",
            f"batch_size={batch_size} 大于训练样本数 {train_samples}；本实现会对最后一批做完整批次处理，"
            "因此可以运行，但每个 epoch 只有极少数批次。",
            "建议将 batch_size 调整为不超过训练样本数。", batch_size))
    return issues


# ---------------------------------------------------------------------------
# Module level schemas
# ---------------------------------------------------------------------------

M1_SCHEMA: list[dict[str, Any]] = [
    {"key": "source_key", "label": "Data Source", "label_zh": "数据源", "type": "enum",
     "default": "milano", "enum": ["milano", "trentino", "zte"],
     "help_zh": "选择要分析的一个地点数据集。", "suggestion_zh": "三个来源单位不同，不能直接比较绝对数值。"},
    {"key": "region_ids", "label": "Regions", "label_zh": "区域", "type": "array", "default": [],
     "help_zh": "可在地图上点选多个区域进行对比（最多 6 个）。",
     "suggestion_zh": "单区域分析时只选一个。", "required": False},
    {"key": "time_start", "label": "Start Date & Time", "label_zh": "开始日期时间", "type": "string",
     "default": "", "required": False,
     "help_zh": "分析时间范围的起点（含边界，按重采样后的时间桶起点计）。"
                "与结束时间一起决定所有统计、图表与自动结论使用哪些观测。",
     "suggestion_zh": "格式 YYYY-MM-DD HH:mm:ss；不能早于数据起点，也不能晚于结束时间。"},
    {"key": "time_end", "label": "End Date & Time", "label_zh": "结束日期时间", "type": "string",
     "default": "", "required": False,
     "help_zh": "分析时间范围的终点（含边界）。所有图表只使用该闭区间内的真实观测。",
     "suggestion_zh": "格式 YYYY-MM-DD HH:mm:ss；不能超过数据终点。"},
    # Native frequency and mean aggregation are fixed by the pipeline.
    {"key": "max_regions", "label": "Max Compare Regions", "label_zh": "最多对比区域数", "type": "integer",
     "default": 12, "min": 1, "max": 12,
     "help_zh": "内部多区域对比上限（界面上不暴露该参数）。", "suggestion_zh": "默认 12。"},
    {"key": "start_index", "label": "Start Index", "label_zh": "起始索引（高级）", "type": "integer",
     "default": 0, "min": 0, "level": "advanced",
     "help_zh": "按重采样后的时间点数计算的起点索引，与日期时间选择双向同步。",
     "suggestion_zh": "普通使用建议直接用日期时间选择；索引用于精确复现。"},
    {"key": "window_points", "label": "Window Points", "label_zh": "窗口点数（高级）", "type": "integer",
     "default": 1008, "min": 2, "max": 200000, "level": "advanced",
     "help_zh": "从起始索引开始连续取多少个重采样时间点。10 分钟频率下 1008 点＝7 天，"
                "15 分钟频率下 1008 点＝10.5 天。",
     "suggestion_zh": "默认 1008 点；也可直接用日期时间范围指定。"},
    {"key": "acf_max_lag", "label": "Max Lag", "label_zh": "ACF 最大滞后步数", "type": "integer",
     "default": 0, "min": 0, "max": 5000,
     "help_zh": "自相关图最多计算到第几个滞后步。0 表示自动（按数据长度选择，最多覆盖一个周周期）。"
                "10 分钟频率下 Lag 6＝1 小时、Lag 144＝24 小时、Lag 1008＝7 天；"
                "15 分钟频率下 Lag 4＝1 小时、Lag 96＝24 小时、Lag 672＝7 天。",
     "suggestion_zh": "检查日周期至少需要覆盖 24 小时的 Lag；检查周周期需要 7 天的 Lag 与至少两周的观测。"},
    {"key": "day_start_hour", "label": "Day Start Hour", "label_zh": "白天起始小时", "type": "integer",
     "default": 6, "min": 0, "max": 23, "level": "advanced",
     "help_zh": "昼夜对比中“白天”的起始小时（0–23）。默认从 06:00 开始。",
     "suggestion_zh": "默认 6 点；必须小于结束小时。"},
    {"key": "day_end_hour", "label": "Day End Hour", "label_zh": "白天结束小时", "type": "integer",
     "default": 18, "min": 1, "max": 24, "level": "advanced",
     "help_zh": "昼夜对比中“白天”的结束小时（不含该小时）。默认到 18:00 结束。",
     "suggestion_zh": "默认 18 点。"},
]

M2_SCHEMA: list[dict[str, Any]] = [
    {"key": "source_key", "label": "Data Source", "label_zh": "数据源", "type": "enum",
     "default": "milano", "enum": ["milano", "trentino", "zte"],
     "help_zh": "聚类使用的数据源。", "suggestion_zh": "ZTE 的 No Data 区域不会参与聚类。"},
    # Native frequency and mean aggregation are fixed by the pipeline.
    {"key": "time_start", "label": "Start Date & Time", "label_zh": "开始日期时间", "type": "string",
     "default": "", "required": False,
     "help_zh": "聚类特征使用的起始时间（含边界，按当前时间分辨率的时间桶起点计）。",
     "suggestion_zh": "格式 YYYY-MM-DD HH:mm:ss；必须早于结束时间。"},
    {"key": "time_end", "label": "End Date & Time", "label_zh": "结束日期时间", "type": "string",
     "default": "", "required": False,
     "help_zh": "聚类特征使用的结束时间（含边界）。",
     "suggestion_zh": "不能超过数据源真实结束时间。"},
    {"key": "start_index", "label": "Start Index", "label_zh": "起始时间点", "type": "integer",
     "default": 0, "min": 0, "level": "advanced", "help_zh": "特征提取窗口起点（内部索引，界面默认使用日期时间）。",
     "suggestion_zh": "普通使用请选择日期时间。"},
    {"key": "window_points", "label": "Window Points", "label_zh": "窗口点数", "type": "integer",
     "default": 1008, "min": 2, "max": 100000, "level": "advanced",
     "help_zh": "参与特征提取的连续时间点数（内部索引，界面默认根据日期范围计算）。",
     "suggestion_zh": "普通使用请选择日期时间。"},
    {"key": "features", "label": "Features", "label_zh": "聚类特征", "type": "array",
     "default": ["mean", "std", "cv", "intraday_peak_ratio", "day_night_ratio", "weekday_weekend_ratio", "daily_seasonality"],
     "help_zh": "从真实时间序列提取的特征集合。", "suggestion_zh": "至少选择 2 个特征。"},
    {"key": "standardize", "label": "Standardize", "label_zh": "特征标准化", "type": "boolean",
     "default": True, "help_zh": "聚类前对特征做 z-score 标准化。", "suggestion_zh": "建议开启。"},
    {"key": "algorithm", "label": "Algorithm", "label_zh": "聚类算法", "type": "enum", "default": "kmeans",
     "enum": ["kmeans", "spectral", "hierarchical", "gmm"],
     "enum_labels": ["K-Means", "Spectral Clustering", "Hierarchical", "GMM"],
     "help_zh": "四选一的真实聚类算法；谱聚类依据区域特征的相似关系分组。",
     "suggestion_zh": "先看 K-Means，再用谱聚类对比相似关系。"},
    {"key": "n_clusters", "label": "Clusters (K)", "label_zh": "簇数量 K", "type": "integer",
     "default": 4, "min": 2, "max": 30, "help_zh": "K-Means / Hierarchical 的簇数量。",
     "suggestion_zh": "3-8 之间便于解释。", "visible_when": {"algorithm": "kmeans"},
     "enabled_when": {"algorithm": "kmeans"}},
    {"key": "hierarchical_n_clusters", "label": "Clusters (K)", "label_zh": "簇数量 K", "type": "integer",
     "default": 4, "min": 2, "max": 30, "help_zh": "层次聚类的簇数量。",
     "suggestion_zh": "与 K-Means 比较时使用相同 K。", "visible_when": {"algorithm": "hierarchical"},
     "enabled_when": {"algorithm": "hierarchical"}},
    {"key": "n_init", "label": "n_init", "label_zh": "初始化次数", "type": "integer", "default": 10,
     "min": 1, "max": 100, "level": "advanced", "help_zh": "K-Means 重复初始化的次数，取最优惯性。",
     "suggestion_zh": "10 是稳健默认值。", "visible_when": {"algorithm": "kmeans"},
     "enabled_when": {"algorithm": "kmeans"}},
    {"key": "spectral_n_clusters", "label": "Clusters (K)", "label_zh": "簇数量 K", "type": "integer",
     "default": 4, "min": 2, "max": 30, "help_zh": "谱聚类最终划分的簇数量。",
     "suggestion_zh": "3-8 之间便于解释。", "visible_when": {"algorithm": "spectral"},
     "enabled_when": {"algorithm": "spectral"}},
    {"key": "spectral_affinity", "label": "Affinity", "label_zh": "相似度构建方式", "type": "enum",
     "default": "nearest_neighbors", "enum": ["nearest_neighbors", "rbf"],
     "enum_labels": ["nearest_neighbors", "rbf"],
     "help_zh": "谱聚类构图方式：近邻图按局部邻居关系连接；RBF 按距离核建立相似度。",
     "suggestion_zh": "区域较多时先用 nearest_neighbors。", "visible_when": {"algorithm": "spectral"},
     "enabled_when": {"algorithm": "spectral"}},
    {"key": "spectral_n_neighbors", "label": "Neighbors", "label_zh": "邻居数量", "type": "integer",
     "default": 10, "min": 2, "max": 200,
     "help_zh": "nearest_neighbors 模式下每个区域连接的邻居数量，必须小于有效区域数。",
     "suggestion_zh": "通常设置为有效区域数的 5%-15%。",
     "visible_when": {"algorithm": "spectral", "spectral_affinity": "nearest_neighbors"},
     "enabled_when": {"algorithm": "spectral", "spectral_affinity": "nearest_neighbors"}},
    {"key": "spectral_gamma", "label": "Gamma", "label_zh": "RBF 相似度参数", "type": "number",
     "default": 1.0, "min": 0, "exclusive_min": True,
     "help_zh": "rbf 模式下控制相似度随距离衰减的速度，必须大于 0。",
     "suggestion_zh": "默认 1.0；增大 gamma 会强化局部相似关系。",
     "visible_when": {"algorithm": "spectral", "spectral_affinity": "rbf"},
     "enabled_when": {"algorithm": "spectral", "spectral_affinity": "rbf"}},
    {"key": "linkage", "label": "Linkage", "label_zh": "连接方式", "type": "enum", "default": "ward",
     "enum": ["ward", "complete", "average", "single"],
     "enum_labels": ["ward", "complete", "average", "single"],
     "level": "advanced", "help_zh": "层次聚类连接准则；ward 只能配合欧氏距离。",
     "suggestion_zh": "默认 ward。", "visible_when": {"algorithm": "hierarchical"},
     "enabled_when": {"algorithm": "hierarchical"}},
    {"key": "metric", "label": "Metric", "label_zh": "距离度量", "type": "enum", "default": "euclidean",
     "enum": ["euclidean", "manhattan", "cosine"],
     "enum_labels": ["euclidean", "manhattan", "cosine"],
     "level": "advanced", "help_zh": "距离度量；ward 仅支持欧氏距离。",
     "suggestion_zh": "默认 euclidean。", "enabled_when": {"algorithm": "hierarchical"}},
    {"key": "gmm_n_components", "label": "Components", "label_zh": "高斯分量数", "type": "integer",
     "default": 4, "min": 1, "max": 30, "help_zh": "GMM 高斯分量个数。", "suggestion_zh": "3-8。",
     "visible_when": {"algorithm": "gmm"}, "enabled_when": {"algorithm": "gmm"}},
    {"key": "covariance_type", "label": "Covariance Type", "label_zh": "协方差类型", "type": "enum",
     "default": "full", "enum": ["full", "tied", "diag", "spherical"],
     "enum_labels": ["full", "tied", "diag", "spherical"], "level": "advanced",
     "help_zh": "GMM 协方差结构；样本少时 full 可能不可靠。", "suggestion_zh": "样本充足时用 full。",
     "visible_when": {"algorithm": "gmm"}, "enabled_when": {"algorithm": "gmm"}},
    {"key": "reg_covar", "label": "Regularization", "label_zh": "协方差正则", "type": "number",
     "default": 0.000001, "min": 0, "exclusive_min": True, "level": "advanced",
     "help_zh": "GMM 协方差对角线正则项，必须大于 0 以保证数值稳定。", "suggestion_zh": "1e-6 起。",
     "visible_when": {"algorithm": "gmm"}, "enabled_when": {"algorithm": "gmm"}},
    {"key": "random_state", "label": "Random State", "label_zh": "随机种子", "type": "integer",
     "default": 42, "min": 0, "max": 2**31 - 1, "level": "advanced",
     "help_zh": "固定 K-Means、GMM 或谱聚类中的随机过程以便复现。",
     "suggestion_zh": "默认 42。"},
]

M3_SCHEMA: list[dict[str, Any]] = [
    {"key": "source_key", "label": "Data Source", "label_zh": "数据源", "type": "enum", "default": "milano",
     "enum": ["milano", "trentino", "zte"], "help_zh": "选择数据集所在的地点来源。",
     "suggestion_zh": "一个数据集只能属于一个地点。"},
    {"key": "scope", "label": "Prediction Scope", "label_zh": "预测范围", "type": "enum", "default": "single",
     "enum": ["single", "all"], "enum_labels": ["Single Region", "All Regions"],
     "help_zh": "Single Region 只建模一个区域；All Regions 对当前地点全部有效区域分别建模（区域独立）。",
     "suggestion_zh": "课程演示建议先用 Single Region。"},
    {"key": "region_id", "label": "Region", "label_zh": "区域", "type": "string", "default": "",
     "help_zh": "Single Region 时必须选择一个有数据的区域。",
     "suggestion_zh": "从区域列表中选择；No Data 区域不可选。", "required": False,
     "visible_when": {"scope": "single"}},
    {"key": "time_start", "label": "Start Date & Time", "label_zh": "开始日期时间", "type": "string",
     "default": "", "required": False,
     "help_zh": "数据集构建时间范围的起点（含边界）。默认使用所选数据源完整有效范围。",
     "suggestion_zh": "格式 YYYY-MM-DD HH:mm:ss；不能早于数据起点或晚于结束时间。"},
    {"key": "time_end", "label": "End Date & Time", "label_zh": "结束日期时间", "type": "string",
     "default": "", "required": False,
     "help_zh": "数据集构建时间范围的终点（含边界）。默认使用所选数据源完整有效范围。",
     "suggestion_zh": "格式 YYYY-MM-DD HH:mm:ss；不能超过数据终点。"},
    # Native frequency and mean aggregation are fixed by the pipeline.
    {"key": "input_length", "label": "Input Length (L)", "label_zh": "输入长度 L", "type": "integer",
     "default": 24, "min": 1, "max": 5000, "unit_zh": "点",
     "help_zh": "每个样本的历史输入点数（按重采样后的点计）。", "suggestion_zh": "10 分钟频率下 144 点 ≈ 1 天。"},
    {"key": "output_length", "label": "Output Length (H)", "label_zh": "预测长度 H", "type": "integer",
     "default": 6, "min": 1, "max": 5000, "unit_zh": "点",
     "help_zh": "每个样本的预测目标点数，Module 4/5 继承该值（不可在训练页修改）。",
     "suggestion_zh": "先用 6-24 验证流程。"},
    {"key": "step", "label": "Sliding Step (S)", "label_zh": "滑动步长 S", "type": "integer",
     "default": 1, "min": 1, "max": 5000, "unit_zh": "点",
     "help_zh": "相邻窗口起点的间隔（点数）。", "suggestion_zh": "S 越大窗口越少、训练越快。"},
    {"key": "train_ratio", "label": "Train Ratio", "label_zh": "训练比例", "type": "number", "default": 0.7,
     "min": 0.05, "max": 0.95, "unit_zh": "比例", "help_zh": "按时序划分的训练段比例。",
     "suggestion_zh": "常用 0.7。"},
    {"key": "val_ratio", "label": "Validation Ratio", "label_zh": "验证比例", "type": "number",
     "default": 0.15, "min": 0.0, "max": 0.9, "unit_zh": "比例", "help_zh": "验证段比例。",
     "suggestion_zh": "常用 0.15。"},
    {"key": "test_ratio", "label": "Test Ratio", "label_zh": "测试比例", "type": "number", "default": 0.15,
     "min": 0.0, "max": 0.9, "unit_zh": "比例", "help_zh": "测试段比例（Module 5 的正式评分来源）。",
     "suggestion_zh": "常用 0.15。"},
    {"key": "missing_mode", "label": "Missing Handling", "label_zh": "缺失值处理", "type": "enum",
     "default": "automatic", "enum": ["automatic", "causal_interpolation", "drop_invalid"],
     "enum_labels": ["Automatic (前向填充)", "Causal-safe Interpolation", "Drop Invalid Windows"],
     "level": "advanced",
     "help_zh": "automatic 只用过去值前向填充；causal_interpolation 在两个已观测端点间插值，"
                "但窗口的预测起点必须晚于右侧端点，否则该窗口作废；drop_invalid 直接丢弃含缺失的窗口。",
     "suggestion_zh": "ZTE 的真实零值不会被视为缺失。"},
    {"key": "scaling", "label": "Scaling", "label_zh": "标准化", "type": "enum", "default": "standard",
     "enum": ["standard", "minmax", "none"], "enum_labels": ["StandardScaler", "MinMaxScaler", "None"],
     "level": "advanced",
     "help_zh": "仅用训练段已观测样本拟合；评估时逆变换回源单位。", "suggestion_zh": "默认 StandardScaler。"},
]

M5_SCHEMA: list[dict[str, Any]] = [
    {"key": "dataset_id", "label": "Dataset", "label_zh": "数据集", "type": "string", "default": "",
     "help_zh": "Module 3 已成功构建的数据集，测试集由该数据集冻结。", "suggestion_zh": "选择一个 Built 状态的数据集。"},
    {"key": "scope", "label": "Evaluation Scope", "label_zh": "评价范围", "type": "enum", "default": "single",
     "enum": ["single", "all"], "enum_labels": ["Single Region", "All Regions"],
     "help_zh": "Single 评价单个区域；All 仅允许来自全区域实验组的模型。",
     "suggestion_zh": "与实验的 Scope 保持一致。"},
    {"key": "region_id", "label": "Region", "label_zh": "区域", "type": "string", "default": "",
     "help_zh": "Single 范围下要评价的区域。", "suggestion_zh": "从数据集区域中选择。",
     "required": False, "visible_when": {"scope": "single"}},
    {"key": "experiment_ids", "label": "Experiments", "label_zh": "实验", "type": "array", "default": [],
     "help_zh": "选择 1..N 个实验进行同口径比较。", "suggestion_zh": "可用 Batch ID 一键载入。"},
    {"key": "test_selection", "label": "Test Selection", "label_zh": "测试范围", "type": "enum",
     "default": "full", "enum": ["full", "range"],
     "enum_labels": ["Full Test（正式成绩）", "Selected Test Range"],
     "help_zh": "Full Test 为正式评分；Selected Range 只是可视化子集，会标注子集来源。",
     "suggestion_zh": "提交成绩请用 Full Test。"},
    {"key": "range_start_at", "label": "Range Start", "label_zh": "子集起点", "type": "string", "default": "",
     "help_zh": "Selected Range 的起始时间（ISO 格式）。", "suggestion_zh": "格式 2024-08-01 00:00:00。",
     "required": False, "visible_when": {"test_selection": "range"}},
    {"key": "range_end_at", "label": "Range End", "label_zh": "子集终点", "type": "string", "default": "",
     "help_zh": "Selected Range 的结束时间（ISO 格式）。", "suggestion_zh": "格式 2024-08-05 23:45:00。",
     "required": False, "visible_when": {"test_selection": "range"}},
    {"key": "horizon_step", "label": "Horizon Step", "label_zh": "显示步长", "type": "integer", "default": 1,
     "min": 1, "help_zh": "图表默认展示的 horizon step（不改动 H，也不影响指标协议）。",
     "suggestion_zh": "默认 1。"},
]

MODULE_SCHEMAS = {"m1": M1_SCHEMA, "m2": M2_SCHEMA, "m3": M3_SCHEMA, "m5": M5_SCHEMA}


def check_module(kind: str, values: dict[str, Any]) -> tuple[list[Issue], dict[str, Any]]:
    schema = MODULE_SCHEMAS[kind]
    merged = {spec["key"]: spec["default"] for spec in schema}
    merged.update(values or {})
    issues: list[Issue] = []
    coerced: dict[str, Any] = {}
    for spec in schema:
        if not visible(spec, merged):
            continue
        path = f"{kind}.{spec['key']}"
        if not enabled(spec, merged):
            coerced[spec["key"]] = merged.get(spec["key"])
            continue
        field_issues, value = check_field(spec, merged.get(spec["key"]), path)
        issues.extend(field_issues)
        coerced[spec["key"]] = value if value is not None else merged.get(spec["key"])
    if kind in ("m1", "m2", "m3"):
        # Resampling is no longer a user-facing choice.  Enforce the same rule
        # on the server so an old client cannot produce a different result.
        coerced["frequency"] = "native"
        coerced["aggregation"] = "mean"
    return issues, coerced


def validate_m3(values: dict[str, Any], *, dataset_context: dict[str, Any] | None = None) -> list[Issue]:
    issues, coerced = check_module("m3", values)
    train, val, test = coerced.get("train_ratio"), coerced.get("val_ratio"), coerced.get("test_ratio")
    if isinstance(train, (int, float)) and isinstance(val, (int, float)) and isinstance(test, (int, float)):
        total = train + val + test
        if abs(total - 1.0) > 1e-6:
            issues.append(error(
                "m3.test_ratio", "RATIO_SUM",
                f"Train/Validation/Test 比例之和必须为 100%，当前为 {total * 100:.2f}%"
                f"（{train:.2f} + {val:.2f} + {test:.2f}）。",
                "请调整比例使其总和等于 1.0。", total, group="split"))
    L, H, S = coerced.get("input_length"), coerced.get("output_length"), coerced.get("step")
    if all(isinstance(v, int) for v in (L, H, S)):
        if L + H < 2:
            issues.append(error("m3.output_length", "WINDOW_TOO_SHORT",
                                f"L+H 至少需要 2 个点，当前为 {L + H}。", "请增大 L 或 H。", H))
    if values.get("scope") == "single" and not values.get("region_id"):
        issues.append(error("m3.region_id", "REGION_REQUIRED",
                            "Single Region 必须选择一个区域。", "请在地图或列表中选择一个有效区域。", None))
    source_key = coerced.get("source_key")
    if source_key:
        try:
            resolved = resolve_range(
                str(source_key),
                "native",
                time_start=coerced.get("time_start") or None,
                time_end=coerced.get("time_end") or None,
                path_prefix="m3",
            )
            issues.extend(resolved.issues)
        except Exception as exc:  # unknown source is reported by the API layer
            issues.append(warning("m3.time_start", "RANGE_CHECK_FAILED",
                                  f"时间范围暂时无法校验：{exc}",
                                  "请确认数据源已导入。", None))
    if dataset_context:
        empty = dataset_context.get("empty_splits") or []
        for name in empty:
            issues.append(error(
                f"m3.{name}_ratio", "EMPTY_SPLIT",
                f"按当前 L/H/S 与比例配置，{name} 集合没有任何合法窗口。",
                "请减小 L/H、减小 S 或调整比例，使每个集合至少包含一个窗口。", None, group="split"))
        if dataset_context.get("windows_below_minimum"):
            issues.append(warning(
                "m3.input_length", "FEW_WINDOWS",
                f"训练集可用窗口仅 {dataset_context['train_windows']} 个，深度学习模型可能难以收敛。",
                "可减小 L/H/S 或降低时间分辨率以获得更多窗口。", dataset_context["train_windows"]))
        for key in ("train_ratio", "val_ratio", "test_ratio"):
            if dataset_context.get(f"{key}_zero"):
                issues.append(warning(
                    f"m3.{key}", "SPLIT_TOO_SMALL",
                    f"{key} 对应的时间段过短，可能无法产生窗口。",
                    "请提高该比例或降低 L/H。", coerced.get(key)))
    return issues


def validate_m2(values: dict[str, Any], *, region_count: int | None = None) -> list[Issue]:
    issues, coerced = check_module("m2", values)
    source_key = coerced.get("source_key")
    if source_key:
        resolved = resolve_range(
            str(source_key),
            str(coerced.get("frequency") or "native"),
            time_start=coerced.get("time_start") or None,
            time_end=coerced.get("time_end") or None,
            start_index=coerced.get("start_index"),
            window_points=coerced.get("window_points"),
            path_prefix="m2",
        )
        issues.extend(resolved.issues)
        if resolved.points > 0 and resolved.span_seconds < 86400:
            issues.append(
                warning(
                    "m2.time_range",
                    "SHORT_RANGE",
                    f"所选范围仅约 {resolved.span_seconds / 3600:.1f} 小时，"
                    "日内与工作日/周末特征的代表性不足。",
                    "建议至少覆盖 7 天以稳定估计周内模式。",
                    resolved.points,
                )
            )
        elif resolved.points > 0 and resolved.span_seconds < 7 * 86400:
            issues.append(
                warning(
                    "m2.time_range",
                    "LIMITED_PERIOD",
                    f"所选范围约 {resolved.span_seconds / 86400:.1f} 天，"
                    "周期特征和功能区模式仍可能不稳定。",
                    "建议覆盖至少 7 天，并谨慎解释簇名称。",
                    resolved.points,
                )
            )
    algorithm = coerced.get("algorithm")
    features = values.get("features") or []
    if isinstance(features, list) and len(features) < 2:
        issues.append(error("m2.features", "TOO_FEW_FEATURES",
                            "至少需要选择 2 个聚类特征。", "请补充特征或恢复默认特征集。", features))
    if algorithm == "hierarchical":
        linkage = coerced.get("linkage")
        metric = coerced.get("metric")
        if linkage == "ward" and metric not in (None, "euclidean"):
            issues.append(error("m2.metric", "LINKAGE_METRIC",
                                f"Ward 连接只支持欧氏距离，当前 metric={metric}。",
                                "请将 metric 改为 euclidean 或更换 linkage。", metric))
    if algorithm == "spectral" and region_count is not None:
        spectral_clusters = coerced.get("spectral_n_clusters") or 0
        if spectral_clusters >= region_count:
            issues.append(error("m2.spectral_n_clusters", "CLUSTERS_GT_SAMPLES",
                                f"spectral_n_clusters={spectral_clusters} 必须小于可用区域数 {region_count}。",
                                "请减小簇数量，确保至少留下一个有效区域用于谱嵌入。",
                                spectral_clusters))
        if coerced.get("spectral_affinity") == "nearest_neighbors":
            neighbors = coerced.get("spectral_n_neighbors") or 0
            if neighbors >= region_count:
                issues.append(error("m2.spectral_n_neighbors", "NEIGHBORS_GT_SAMPLES",
                                    f"n_neighbors={neighbors} 必须小于可用区域数 {region_count}。",
                                    f"请把邻居数量调整为 2-{max(1, region_count - 1)}。",
                                    neighbors))
    if algorithm == "kmeans" and region_count is not None and (coerced.get("n_clusters") or 0) > region_count:
        issues.append(error("m2.n_clusters", "CLUSTERS_GT_SAMPLES",
                            f"n_clusters={coerced.get('n_clusters')} 大于可用区域数 {region_count}。",
                            "请减小簇数量。", coerced.get("n_clusters")))
    if algorithm == "gmm" and region_count is not None and coerced.get("covariance_type") == "full":
        if region_count < 10 * (coerced.get("gmm_n_components") or 1):
            issues.append(warning("m2.covariance_type", "FULL_COVARIANCE_RISK",
                                  "样本较少时 full 协方差容易退化，GMM 可能收敛困难。",
                                  "可改用 diag 或减少分量数。", coerced.get("covariance_type")))
    return issues


def validate_m1(values: dict[str, Any], *, available_regions: list[str] | None = None) -> list[Issue]:
    issues, coerced = check_module("m1", values)
    region_ids = values.get("region_ids") or []
    max_regions = coerced.get("max_regions") or 12
    if isinstance(region_ids, list):
        if len(region_ids) > max_regions:
            issues.append(error("m1.region_ids", "TOO_MANY_REGIONS",
                                f"最多可对比 {max_regions} 个区域，当前选择了 {len(region_ids)} 个。",
                                "请减少选择数量或提高“最多对比区域数”。", len(region_ids)))
        if available_regions:
            unknown = [r for r in region_ids if r not in available_regions]
            if unknown:
                issues.append(error("m1.region_ids", "UNKNOWN_REGION",
                                    f"以下区域不属于该数据源: {', '.join(unknown[:5])}。",
                                    "请重新在地图上选择区域。", unknown))
    start_index = coerced.get("start_index")
    window_points = coerced.get("window_points")
    if isinstance(start_index, int) and isinstance(window_points, int) and window_points < 2:
        issues.append(error("m1.window_points", "WINDOW_TOO_SHORT",
                            "窗口点数至少为 2。", "请增大窗口点数。", window_points))
    day_start = coerced.get("day_start_hour")
    day_end = coerced.get("day_end_hour")
    if isinstance(day_start, int) and isinstance(day_end, int) and day_start >= day_end:
        issues.append(error("m1.day_end_hour", "DAY_RANGE",
                            f"白天结束小时必须大于起始小时（当前 {day_start} → {day_end}）。",
                            "例如白天 06:00–18:00 表示 start=6, end=18。", day_end))
    # Real time range resolution (date <-> index, data bounds, empty ranges).
    source_key = values.get("source_key")
    frequency = "native"
    if source_key:
        from app.services.time_range import resolve_range

        try:
            resolved = resolve_range(
                source_key,
                frequency,
                time_start=values.get("time_start"),
                time_end=values.get("time_end"),
                start_index=values.get("start_index"),
                window_points=values.get("window_points"),
            )
            seen = {(i["path"], i["code"]) for i in issues}
            for issue in resolved.issues:
                key = (issue["path"], issue["code"])
                if key not in seen:
                    issues.append(issue)
                    seen.add(key)
            interval = resolved.interval_minutes or 10
            day_lag = max(1, 1440 // max(1, interval))
            max_lag = coerced.get("acf_max_lag")
            if isinstance(max_lag, int) and 0 < max_lag < day_lag:
                issues.append(warning(
                    "m1.acf_max_lag", "LAG_BELOW_DAY",
                    f"Max Lag={max_lag} 只覆盖约 {max_lag * interval / 60:.1f} 小时，"
                    "无法检查 24 小时日周期。",
                    f"如需检查日周期，请将 Max Lag 设为至少 {day_lag}（24 小时）。", max_lag))
            if isinstance(max_lag, int) and max_lag > max(2, resolved.points - 2):
                issues.append(error(
                    "m1.acf_max_lag", "LAG_TOO_LARGE",
                    f"Max Lag={max_lag} 超过当前序列可支持的范围"
                    f"（{resolved.points} 个时间点，最多 {max(2, resolved.points - 2)}）。",
                    f"请将 Max Lag 设为 2–{max(2, resolved.points - 2)}，或使用 Auto（0）。", max_lag))
            if isinstance(max_lag, int) and 0 < max_lag < 2:
                issues.append(error(
                    "m1.acf_max_lag", "LAG_TOO_SMALL",
                    "手动 Max Lag 至少需要 2。", "请输入 ≥2 的整数，或使用 Auto（0）。", max_lag))
            if resolved.points and resolved.span_seconds < 86400:
                issues.append(warning(
                    "m1.time_end", "SHORT_RANGE",
                    f"所选范围仅约 {resolved.span_seconds / 3600:.1f} 小时，"
                    "日内规律与工作日/周末比较的代表性有限。",
                    "建议至少覆盖若干完整天（7 天更佳）。", resolved.points))
        except Exception as exc:  # unknown source etc. is reported elsewhere
            issues.append(warning("m1.time_start", "RANGE_CHECK_FAILED",
                                  f"时间范围暂时无法校验：{exc}",
                                  "请确认数据源已导入。", None))
    return issues


def validate_m5(
    values: dict[str, Any],
    *,
    experiments: Iterable[dict[str, Any]] | None = None,
    dataset: dict[str, Any] | None = None,
) -> list[Issue]:
    issues, coerced = check_module("m5", values)
    experiment_ids = values.get("experiment_ids") or []
    if not experiment_ids:
        issues.append(error("m5.experiment_ids", "REQUIRED",
                            "至少需要选择一个 Experiment 才能运行评价。",
                            "请从实验列表中选择，或使用 Batch ID 一键载入。", None))
    if values.get("scope") == "single" and not values.get("region_id"):
        issues.append(error("m5.region_id", "REGION_REQUIRED",
                            "Single Region 评价必须指定区域。", "请选择要评价的区域。", None))
    if values.get("test_selection") == "range" and not (
        values.get("range_start_at") and values.get("range_end_at")
    ):
        issues.append(error("m5.range_start_at", "RANGE_REQUIRED",
                            "Selected Test Range 需要同时提供起点与终点。",
                            "请填写 ISO 格式的时间范围。", None))
    experiments = list(experiments or [])
    if experiments and dataset:
        incompatible: list[str] = []
        for exp in experiments:
            if exp.get("status") not in ("Completed", "Partial"):
                issues.append(warning(
                    f"m5.experiment_ids.{exp['experiment_id']}", "EXPERIMENT_NOT_READY",
                    f"实验 {exp['experiment_id']}（{exp.get('algorithm_label')}）状态为 {exp.get('status')}，"
                    "无法进入正式排名。",
                    "请等待完成或选择其它实验；失败原因可在实验历史查看。", exp.get("status")))
                continue
            if exp.get("dataset_id") != dataset.get("dataset_id"):
                incompatible.append(exp["experiment_id"])
                issues.append(warning(
                    f"m5.experiment_ids.{exp['experiment_id']}", "DATASET_MISMATCH",
                    f"实验 {exp['experiment_id']} 使用数据集 {exp.get('dataset_id')}，"
                    f"与当前数据集 {dataset.get('dataset_id')} 不同，测试目标时间不可比。",
                    "请在相同 Dataset 下重新训练后再比较。", exp.get("dataset_id")))
            if exp.get("scope") == "single" and exp.get("region_ids") and values.get("scope") == "single":
                if values.get("region_id") and values["region_id"] not in exp["region_ids"]:
                    issues.append(error(
                        f"m5.experiment_ids.{exp['experiment_id']}", "REGION_MISMATCH",
                        f"实验 {exp['experiment_id']} 未覆盖区域 {values['region_id']}。",
                        "请选择与该实验匹配的区域，或选择其它实验。", values["region_id"]))
        if values.get("scope") == "all" and any(e.get("scope") == "single" for e in experiments):
            issues.append(error(
                "m5.experiment_ids", "SCOPE_MISMATCH",
                "All Regions 评价只允许来自全区域实验组的 Experiment，不能用单个区域实验临时拼装。",
                "请选择 All Regions 训练得到的实验。", None))
    return issues


# ---------------------------------------------------------------------------
# Environment / resource preflight
# ---------------------------------------------------------------------------


def environment_report() -> dict[str, Any]:
    import os
    import platform
    import shutil

    report: dict[str, Any] = {
        "platform": platform.platform(),
        "python": platform.python_version(),
        "cpu_count": os.cpu_count(),
    }
    try:
        import psutil

        memory = psutil.virtual_memory()
        report["ram_total_gb"] = round(memory.total / 1e9, 2)
        report["ram_available_gb"] = round(memory.available / 1e9, 2)
        disk = shutil.disk_usage(str(os.path.abspath(os.sep)))
        report["disk_free_gb"] = round(disk.free / 1e9, 2)
    except Exception:  # pragma: no cover
        pass
    try:
        import torch

        report["torch"] = torch.__version__
        report["cuda_available"] = bool(torch.cuda.is_available())
        report["device_count"] = torch.cuda.device_count()
    except Exception:
        report["torch"] = None
        report["cuda_available"] = False
        report["device_count"] = 0
    return report


def resource_warnings(
    *,
    algorithms: list[str],
    region_count: int,
    planned_tasks: int,
    deep_learning_tasked: bool,
) -> list[Issue]:
    issues: list[Issue] = []
    env = environment_report()
    if region_count * len(algorithms) > 100:
        issues.append(warning(
            "batch.planned_tasks", "LARGE_BATCH",
            f"本次计划任务数 {planned_tasks}（{region_count} 区域 × {len(algorithms)} 算法），"
            "需要较长时间与磁盘空间，默认顺序执行。",
            "可从少量区域或单个算法开始验证流程，确认无误后再运行完整批次。", planned_tasks))
    if deep_learning_tasked and (env.get("ram_available_gb") or 0) < 2 and env.get("ram_available_gb"):
        issues.append(warning(
            "batch.deep_learning", "LOW_MEMORY",
            f"当前可用内存约 {env['ram_available_gb']} GB，深度学习训练可能失败。",
            "请关闭其他程序或减少 batch_size/hidden_size。", env.get("ram_available_gb")))
    if not env.get("cuda_available"):
        issues.append(issue_note_cpu_only())
    return issues


def issue_note_cpu_only() -> Issue:
    env = environment_report()
    return warning(
        "batch.device", "CPU_ONLY",
        f"当前环境未检测到可用 CUDA 设备（torch: {env.get('torch') or '未安装'}），"
        "所有模型将在 CPU 上运行。",
        "深度学习与大模型推理会较慢；可选择较小 checkpoint 或减少 epochs。", None)


def all_models_summary(
    model_configs: dict[str, Any],
    *,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Per-algorithm issue report for the All Models batch (spec 3.5.6 / 7.4)."""
    context = context or {}
    per_model: list[dict[str, Any]] = []
    blocking = 0
    for model in MODELS:
        config = (model_configs or {}).get(model["key"], {})
        params = config.get("params") if isinstance(config, dict) else None
        mode = config.get("mode") if isinstance(config, dict) else None
        issues, coerced = check_model_params(
            model["key"], params or {}, mode=mode or model["default_mode"], context=context,
            path_prefix=f"model_configs.{model['key']}.params",
        )
        errors = [i for i in issues if i["severity"] == "error"]
        warnings = [i for i in issues if i["severity"] == "warning"]
        blocking += len(errors)
        per_model.append(
            {
                "algorithm_key": model["key"],
                "label": model["label"],
                "category": model["category"],
                "mode": mode or model["default_mode"],
                "customized": bool(params),
                "errors": errors,
                "warnings": warnings,
                "runnable": not errors,
                "params": coerced,
            }
        )
    batch_issues = resource_warnings(
        algorithms=[m["key"] for m in MODELS],
        region_count=int(context.get("region_count") or 1),
        planned_tasks=int(context.get("planned_tasks") or 12),
        deep_learning_tasked=True,
    )
    return {
        "models": per_model,
        "batch_issues": batch_issues,
        "blocking_error_count": blocking,
        "runnable_count": sum(1 for m in per_model if m["runnable"]),
        "warning_count": sum(len(m["warnings"]) for m in per_model),
    }
