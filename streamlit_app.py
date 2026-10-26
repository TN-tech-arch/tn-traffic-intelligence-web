"""Streamlit Community Cloud edition of TN Traffic Intelligence.

This edition keeps the real source observations and real local model training,
but deliberately excludes the desktop shell, background worker and the two
large foundation-model checkpoints.
"""

from __future__ import annotations

import hashlib
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import streamlit as st
from sklearn.ensemble import ExtraTreesRegressor, RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.multioutput import MultiOutputRegressor


ROOT = Path(__file__).resolve().parent
RAW_DIR = ROOT / "data" / "raw"
MAX_DATASETS = 3
MAX_TRAIN_WINDOWS = 1200
MAX_TEST_WINDOWS = 360

SOURCES = {
    "milano": {
        "label": "Milano",
        "csv": "milano_traffic_nid.csv",
        "native": "10 分钟",
        "expected_points": 8928,
        "expected_regions": 88,
    },
    "trentino": {
        "label": "Trentino",
        "csv": "trentino_traffic_nid.csv",
        "native": "10 分钟",
        "expected_points": 8928,
        "expected_regions": 223,
    },
    "zte": {
        "label": "ZTE 4G Downlink",
        "csv": "zte_4g_down.region.csv",
        "native": "15 分钟",
        "expected_points": 2784,
        "expected_regions": 148,
    },
}

ALGORITHMS = {
    "random_forest": "Random Forest",
    "extra_trees": "Extra Trees",
    "xgboost": "XGBoost",
    "lightgbm": "LightGBM",
}


@dataclass(frozen=True)
class SourceData:
    key: str
    label: str
    timestamps: pd.DatetimeIndex
    values: np.ndarray
    region_ids: tuple[str, ...]
    native: str
    fingerprint: str


@st.cache_data(show_spinner=False)
def load_source(source_key: str) -> SourceData:
    definition = SOURCES[source_key]
    path = RAW_DIR / definition["csv"]
    raw = pd.read_csv(path, low_memory=False)
    time_column = raw.columns[0]
    timestamps = pd.to_datetime(raw[time_column], errors="coerce", format="mixed")
    if timestamps.isna().any():
        raise ValueError(f"{path.name} 包含无法解析的时间戳")
    numeric = raw.iloc[:, 1:].apply(pd.to_numeric, errors="coerce")
    keep = numeric.columns[numeric.notna().any(axis=0)]
    numeric = numeric.loc[:, keep]
    order = np.argsort(timestamps.to_numpy())
    timestamps = pd.DatetimeIndex(timestamps.to_numpy()[order])
    values = numeric.to_numpy(dtype="float32")[order]
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return SourceData(
        key=source_key,
        label=definition["label"],
        timestamps=timestamps,
        values=values,
        region_ids=tuple(str(column) for column in keep),
        native=definition["native"],
        fingerprint=digest,
    )


def init_session() -> None:
    if "session_id" not in st.session_state:
        st.session_state.session_id = uuid.uuid4().hex
    if "datasets" not in st.session_state:
        st.session_state.datasets = {}
    if "experiments" not in st.session_state:
        st.session_state.experiments = []
    if "evaluations" not in st.session_state:
        st.session_state.evaluations = []
    if "counters" not in st.session_state:
        st.session_state.counters = {}


def next_id(prefix: str, *parts: str) -> str:
    normalized = [part.upper().replace(" ", "-").replace("/", "-") for part in parts]
    key = "|".join([prefix, *normalized])
    sequence = int(st.session_state.counters.get(key, 0)) + 1
    st.session_state.counters[key] = sequence
    return "-".join([prefix, *normalized, f"{sequence:04d}"])


def clean_series(values: np.ndarray) -> np.ndarray:
    series = pd.Series(values, dtype="float64")
    return series.interpolate(limit_direction="both").ffill().bfill().to_numpy(dtype="float32")


def build_windows(
    series: np.ndarray,
    timestamps: pd.DatetimeIndex,
    input_length: int,
    output_length: int,
    step: int,
    train_ratio: float,
    validation_ratio: float,
) -> dict[str, Any]:
    starts = np.arange(0, len(series) - input_length - output_length + 1, step, dtype=np.int64)
    if len(starts) < 6:
        raise ValueError("有效窗口不足，请缩短输入/输出长度或扩大日期范围")
    x = np.stack([series[start : start + input_length] for start in starts])
    y = np.stack(
        [series[start + input_length : start + input_length + output_length] for start in starts]
    )
    train_end = max(1, int(len(starts) * train_ratio))
    validation_end = max(train_end + 1, int(len(starts) * (train_ratio + validation_ratio)))
    validation_end = min(validation_end, len(starts) - 1)
    split = {
        "train": slice(0, train_end),
        "validation": slice(train_end, validation_end),
        "test": slice(validation_end, len(starts)),
    }
    for name in ("train", "validation", "test"):
        start, stop, _ = split[name].indices(len(starts))
        if stop - start < 1:
            raise ValueError(f"{name} 窗口为空，请调整比例或日期范围")
    return {
        "series": series,
        "timestamps": timestamps,
        "starts": starts,
        "X": x,
        "Y": y,
        "split": split,
        "input_length": input_length,
        "output_length": output_length,
        "step": step,
    }


def metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, float]:
    truth = np.asarray(y_true, dtype="float64").reshape(-1)
    prediction = np.asarray(y_pred, dtype="float64").reshape(-1)
    denominator = np.abs(truth).sum()
    smape_denominator = np.abs(truth) + np.abs(prediction)
    smape_values = np.divide(
        2.0 * np.abs(prediction - truth),
        smape_denominator,
        out=np.zeros_like(truth),
        where=smape_denominator != 0,
    )
    r2_value = float(r2_score(truth, prediction)) if len(truth) > 1 else float("nan")
    return {
        "MAE": float(mean_absolute_error(truth, prediction)),
        "RMSE": float(mean_squared_error(truth, prediction) ** 0.5),
        "WAPE": float(np.abs(prediction - truth).sum() / denominator * 100) if denominator else float("nan"),
        "sMAPE": float(np.mean(smape_values) * 100),
        "R2": r2_value,
        "n_samples": int(len(truth)),
    }


def make_model(key: str):
    if key == "random_forest":
        return RandomForestRegressor(
            n_estimators=120, max_depth=12, min_samples_leaf=2, n_jobs=2, random_state=42
        )
    if key == "extra_trees":
        return ExtraTreesRegressor(
            n_estimators=120, max_depth=12, min_samples_leaf=2, n_jobs=2, random_state=42
        )
    if key == "xgboost":
        from xgboost import XGBRegressor

        return MultiOutputRegressor(
            XGBRegressor(
                n_estimators=120,
                max_depth=5,
                learning_rate=0.06,
                subsample=0.9,
                colsample_bytree=0.9,
                tree_method="hist",
                n_jobs=2,
                random_state=42,
                verbosity=0,
            )
        )
    if key == "lightgbm":
        from lightgbm import LGBMRegressor

        return MultiOutputRegressor(
            LGBMRegressor(
                n_estimators=120,
                max_depth=8,
                num_leaves=31,
                learning_rate=0.06,
                subsample=0.9,
                colsample_bytree=0.9,
                n_jobs=2,
                random_state=42,
                verbosity=-1,
            )
        )
    raise ValueError(f"未知算法: {key}")


def train_experiment(dataset_id: str, algorithm_key: str) -> dict[str, Any]:
    bundle = st.session_state.datasets[dataset_id]
    split = bundle["split"]
    x_train = bundle["X"][split["train"]][-MAX_TRAIN_WINDOWS:]
    y_train = bundle["Y"][split["train"]][-MAX_TRAIN_WINDOWS:]
    x_test = bundle["X"][split["test"]][-MAX_TEST_WINDOWS:]
    y_test = bundle["Y"][split["test"]][-MAX_TEST_WINDOWS:]
    started = time.perf_counter()
    model = make_model(algorithm_key)
    model.fit(x_train, y_train)
    prediction = np.asarray(model.predict(x_test), dtype="float64")
    elapsed = time.perf_counter() - started
    per_horizon = []
    for horizon in range(y_test.shape[1]):
        values = metrics(y_test[:, horizon], prediction[:, horizon])
        per_horizon.append({"h": horizon + 1, **values})
    overall = metrics(y_test, prediction)
    return {
        "experiment_id": next_id(
            "EXP", bundle["dataset"]["source_key"], bundle["dataset"]["region_id"], algorithm_key
        ),
        "dataset_id": dataset_id,
        "source_key": bundle["dataset"]["source_key"],
        "region_id": bundle["dataset"]["region_id"],
        "algorithm_key": algorithm_key,
        "algorithm": ALGORITHMS[algorithm_key],
        "metrics": overall,
        "per_horizon": per_horizon,
        "duration_seconds": round(elapsed, 3),
        "train_windows": int(len(x_train)),
        "test_windows": int(len(x_test)),
        "preview_truth": y_test[:100].tolist(),
        "preview_prediction": prediction[:100].tolist(),
        "created_at": pd.Timestamp.now(tz="Asia/Shanghai").strftime("%Y-%m-%d %H:%M:%S"),
    }


def source_summary(source: SourceData) -> None:
    values = source.values
    columns = st.columns(4)
    columns[0].metric("时间点", f"{len(source.timestamps):,}")
    columns[1].metric("可用区域", f"{len(source.region_ids):,}")
    columns[2].metric("原生采样", source.native)
    columns[3].metric("有效数值", f"{int(np.isfinite(values).sum()):,}")


def page_header() -> None:
    st.title("TN Traffic Intelligence")
    st.caption("真实原生观测数据 · 真实机器学习训练 · Streamlit Community Cloud 演示版")
    with st.expander("会话与功能说明", expanded=False):
        st.markdown(
            f"""
- 当前匿名会话：`{st.session_state.session_id[:12]}`
- 刷新页面保留当前会话历史；新浏览器会话重新从空历史开始。
- 数据集、实验和评估编号均从 `0001` 开始。
- 本版仅运行轻量本地算法，不运行 TimesFM/Chronos，也不模拟任何结果。
- 每次构建和训练都直接使用仓库中的真实原始数据。
"""
        )


def exploration_tab() -> None:
    source_key = st.selectbox(
        "数据源",
        options=list(SOURCES),
        format_func=lambda key: SOURCES[key]["label"],
    )
    with st.spinner("读取真实原始数据..."):
        source = load_source(source_key)
    source_summary(source)
    region_id = st.selectbox("区域", source.region_ids, index=0)
    default_start = source.timestamps.min().date()
    default_end = source.timestamps.max().date()
    selected_range = st.date_input(
        "分析时间范围",
        value=(default_start, default_end),
        min_value=default_start,
        max_value=default_end,
    )
    if isinstance(selected_range, tuple) and len(selected_range) == 2:
        start, end = selected_range
    else:
        start, end = default_start, default_end
    mask = (source.timestamps.date >= start) & (source.timestamps.date <= end)
    region_index = source.region_ids.index(region_id)
    series = clean_series(source.values[mask, region_index])
    timestamps = source.timestamps[mask]
    frame = pd.DataFrame({"流量": series}, index=timestamps)
    st.line_chart(frame, height=330)
    st.dataframe(
        pd.DataFrame(
            [
                {
                    "区域": region_id,
                    "起始时间": timestamps.min(),
                    "结束时间": timestamps.max(),
                    "有效点": int(np.isfinite(series).sum()),
                    "均值": round(float(np.mean(series)), 3),
                    "最大值": round(float(np.max(series)), 3),
                    "最小值": round(float(np.min(series)), 3),
                }
            ]
        ),
        width="stretch",
        hide_index=True,
    )


def dataset_tab() -> None:
    st.subheader("单区域预测数据集")
    source_key = st.selectbox(
        "数据源",
        options=list(SOURCES),
        format_func=lambda key: SOURCES[key]["label"],
        key="dataset_source",
    )
    source = load_source(source_key)
    region_id = st.selectbox("区域", source.region_ids, key="dataset_region")
    start_default = source.timestamps.min().date()
    end_default = source.timestamps.max().date()
    selected_range = st.date_input(
        "构建范围",
        value=(start_default, end_default),
        min_value=start_default,
        max_value=end_default,
        key="dataset_range",
    )
    if isinstance(selected_range, tuple) and len(selected_range) == 2:
        start, end = selected_range
    else:
        start, end = start_default, end_default
    left, middle, right = st.columns(3)
    input_length = left.number_input("输入长度 L", min_value=4, max_value=288, value=24)
    output_length = middle.number_input("输出长度 H", min_value=1, max_value=24, value=6)
    step = right.number_input("滑动步长 S", min_value=1, max_value=24, value=1)
    train_ratio = st.slider("训练集比例", 0.5, 0.9, 0.7, 0.01)
    validation_ratio = st.slider("验证集比例", 0.05, 0.25, 0.15, 0.01)
    test_ratio = 1.0 - train_ratio - validation_ratio
    st.caption(f"测试集比例：{test_ratio:.2f}")
    if test_ratio <= 0:
        st.error("训练集与验证集比例之和必须小于 1。")
    if st.button("构建数据集", type="primary", width="stretch"):
        try:
            mask = (source.timestamps.date >= start) & (source.timestamps.date <= end)
            region_index = source.region_ids.index(region_id)
            timestamps = source.timestamps[mask]
            series = clean_series(source.values[mask, region_index])
            bundle = build_windows(
                series,
                timestamps,
                int(input_length),
                int(output_length),
                int(step),
                float(train_ratio),
                float(validation_ratio),
            )
            dataset_id = next_id("DS", source_key, region_id)
            bundle["dataset"] = {
                "dataset_id": dataset_id,
                "source_key": source_key,
                "source_label": source.label,
                "region_id": region_id,
                "time_start": str(timestamps.min()),
                "time_end": str(timestamps.max()),
                "fingerprint": source.fingerprint,
            }
            st.session_state.datasets[dataset_id] = bundle
            while len(st.session_state.datasets) > MAX_DATASETS:
                oldest = next(iter(st.session_state.datasets))
                st.session_state.datasets.pop(oldest, None)
            st.success(f"已构建 {dataset_id}")
        except Exception as exc:
            st.error(f"构建失败：{type(exc).__name__}: {exc}")

    if not st.session_state.datasets:
        st.info("当前会话还没有数据集。")
        return
    dataset_id = st.selectbox("当前数据集", list(st.session_state.datasets), key="dataset_current")
    bundle = st.session_state.datasets[dataset_id]
    counts = {
        name: bundle["split"][name].stop - bundle["split"][name].start
        for name in ("train", "validation", "test")
    }
    columns = st.columns(3)
    columns[0].metric("训练窗口", counts["train"])
    columns[1].metric("验证窗口", counts["validation"])
    columns[2].metric("测试窗口", counts["test"])
    st.dataframe(
        pd.DataFrame(
            [
                {
                    **bundle["dataset"],
                    "L": bundle["input_length"],
                    "H": bundle["output_length"],
                    "S": bundle["step"],
                }
            ]
        ),
        width="stretch",
        hide_index=True,
    )
    index = st.slider("预览窗口", 0, max(0, len(bundle["X"]) - 1), 0)
    preview = pd.DataFrame(
        {
            "历史输入": np.pad(
                bundle["X"][index],
                (0, bundle["output_length"]),
                constant_values=np.nan,
            ),
            "真实未来": np.pad(
                bundle["Y"][index],
                (bundle["input_length"], 0),
                constant_values=np.nan,
            ),
        }
    )
    st.line_chart(preview, height=280)


def training_tab() -> None:
    st.subheader("真实模型训练")
    if not st.session_state.datasets:
        st.info("请先在“数据集构建”中创建数据集。")
        return
    dataset_id = st.selectbox("训练数据集", list(st.session_state.datasets), key="train_dataset")
    algorithms = st.multiselect(
        "算法",
        options=list(ALGORITHMS),
        default=["random_forest"],
        format_func=lambda key: ALGORITHMS[key],
    )
    st.caption("免费演示版限制训练窗口数量，确保 Community Cloud 实例可稳定完成。")
    if st.button("开始训练", type="primary", width="stretch", disabled=not algorithms):
        progress = st.progress(0, text="准备训练")
        for index, algorithm_key in enumerate(algorithms):
            progress.progress(index / len(algorithms), text=f"正在训练 {ALGORITHMS[algorithm_key]}")
            try:
                experiment = train_experiment(dataset_id, algorithm_key)
                st.session_state.experiments.insert(0, experiment)
                st.success(f"{experiment['experiment_id']} 训练完成，用时 {experiment['duration_seconds']} 秒")
            except Exception as exc:
                st.error(f"{ALGORITHMS[algorithm_key]} 训练失败：{type(exc).__name__}: {exc}")
            progress.progress((index + 1) / len(algorithms), text=f"{ALGORITHMS[algorithm_key]} 已处理")
        progress.empty()

    if not st.session_state.experiments:
        st.info("当前会话还没有训练记录。")
        return
    rows = [
        {
            "EXP ID": item["experiment_id"],
            "数据集": item["dataset_id"],
            "算法": item["algorithm"],
            "WAPE": round(item["metrics"]["WAPE"], 3),
            "MAE": round(item["metrics"]["MAE"], 3),
            "RMSE": round(item["metrics"]["RMSE"], 3),
            "训练秒": item["duration_seconds"],
            "时间": item["created_at"],
        }
        for item in st.session_state.experiments
    ]
    st.dataframe(pd.DataFrame(rows), width="stretch", hide_index=True)


def evaluation_tab() -> None:
    st.subheader("测试集模型对比")
    experiments = st.session_state.experiments
    if not experiments:
        st.info("请先完成至少一个模型训练。")
        return
    labels = {item["experiment_id"]: f"{item['experiment_id']} · {item['algorithm']}" for item in experiments}
    selected = st.multiselect(
        "选择实验",
        options=list(labels),
        default=list(labels)[: min(3, len(labels))],
        format_func=lambda key: labels[key],
    )
    chosen = [item for item in experiments if item["experiment_id"] in selected]
    if not chosen:
        return
    rows = [
        {
            "排名": rank,
            "模型": item["algorithm"],
            "EXP ID": item["experiment_id"],
            **{name: round(item["metrics"][name], 4) for name in ("MAE", "RMSE", "WAPE", "sMAPE", "R2")},
        }
        for rank, item in enumerate(sorted(chosen, key=lambda item: item["metrics"]["WAPE"]), 1)
    ]
    st.dataframe(pd.DataFrame(rows), width="stretch", hide_index=True)
    chart = pd.DataFrame(
        {"WAPE": [item["metrics"]["WAPE"] for item in chosen]},
        index=[item["experiment_id"] for item in chosen],
    )
    st.bar_chart(chart, height=280)
    experiment_id = st.selectbox("查看逐时域指标", list(selected))
    chosen_experiment = next(item for item in chosen if item["experiment_id"] == experiment_id)
    per_horizon = pd.DataFrame(chosen_experiment["per_horizon"]).set_index("h")
    st.dataframe(per_horizon.round(4), width="stretch")
    if st.button("保存本次评估"):
        evaluation_id = next_id("EVAL")
        st.session_state.evaluations.insert(
            0,
            {
                "evaluation_id": evaluation_id,
                "experiments": list(selected),
                "created_at": pd.Timestamp.now(tz="Asia/Shanghai").strftime("%Y-%m-%d %H:%M:%S"),
            },
        )
        st.success(f"已保存 {evaluation_id}")
    if st.session_state.evaluations:
        st.dataframe(pd.DataFrame(st.session_state.evaluations), width="stretch", hide_index=True)


def main() -> None:
    st.set_page_config(
        page_title="TN Traffic Intelligence",
        page_icon="🚦",
        layout="wide",
        initial_sidebar_state="collapsed",
    )
    init_session()
    page_header()
    exploration, dataset, training, evaluation = st.tabs(
        ["1 · 数据探索", "2 · 数据集构建", "3 · 模型训练", "4 · 预测评估"]
    )
    with exploration:
        exploration_tab()
    with dataset:
        dataset_tab()
    with training:
        training_tab()
    with evaluation:
        evaluation_tab()
    st.divider()
    st.caption(
        "数据来源：Milano、Trentino、ZTE 4G 原始数据文件。"
        " Streamlit 版为轻量公开演示，不是 Windows 完整产品包。"
    )


if __name__ == "__main__":
    main()
