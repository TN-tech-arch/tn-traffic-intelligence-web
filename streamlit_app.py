"""Streamlit Community Cloud edition of TN Traffic Intelligence.

This edition keeps the real source observations and real local model training,
but deliberately excludes the desktop shell, background worker and the two
large foundation-model checkpoints.
"""

from __future__ import annotations

import hashlib
import json
import os
import pickle
import re
import tempfile
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import pydeck as pdk
import streamlit as st
from sklearn.cluster import AgglomerativeClustering, KMeans, SpectralClustering
from sklearn.decomposition import PCA
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    calinski_harabasz_score,
    davies_bouldin_score,
    mean_absolute_error,
    mean_squared_error,
    r2_score,
    silhouette_score,
)
from sklearn.mixture import GaussianMixture
from sklearn.multioutput import MultiOutputRegressor
from sklearn.preprocessing import StandardScaler


ROOT = Path(__file__).resolve().parent
RAW_DIR = ROOT / "data" / "raw"
MAX_DATASETS = 3
MAX_TRAIN_WINDOWS = 720
MAX_TEST_WINDOWS = 120
MAX_DEEP_TRAIN_WINDOWS = 180
MAX_DEEP_TEST_WINDOWS = 45
MAX_STATISTICAL_TEST_WINDOWS = 8
MAX_STATISTICAL_TRAIN_POINTS = 720
SESSION_TTL_SECONDS = 7200
SESSION_ROOT = Path(tempfile.gettempdir()) / "tn_streamlit_sessions"

SOURCES = {
    "milano": {
        "label": "Milano",
        "csv": "milano_traffic_nid.csv",
        "geojson": "milano.geojson",
        "geometry_key": "NIL",
        "native": "10 分钟",
        "expected_points": 8928,
        "expected_regions": 88,
    },
    "trentino": {
        "label": "Trentino",
        "csv": "trentino_traffic_nid.csv",
        "geojson": "trento.geojson",
        "geometry_key": "NAME_3",
        "native": "10 分钟",
        "expected_points": 8928,
        "expected_regions": 223,
    },
    "zte": {
        "label": "ZTE 4G Downlink",
        "csv": "zte_4g_down.region.csv",
        "geojson": "zte_4g_down.traffic.geojson",
        "geometry_key": "unique_id",
        "native": "15 分钟",
        "expected_points": 2784,
        "expected_regions": 148,
    },
}

ALGORITHMS = {
    "arima": "ARIMA",
    "prophet": "Prophet",
    "random_forest": "Random Forest",
    "xgboost": "XGBoost",
    "lightgbm": "LightGBM",
    "mlp": "MLP",
    "rnn": "RNN",
    "lstm": "LSTM",
    "gru": "GRU",
    "transformer": "Transformer",
}

CLUSTER_ALGORITHMS = {
    "kmeans": "K-Means",
    "agglomerative": "层次聚类",
    "gmm": "Gaussian Mixture",
    "spectral": "Spectral Clustering",
}

SESSION_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{24,64}$")


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


SESSION_STATE_KEYS = (
    "datasets",
    "experiments",
    "evaluations",
    "clusters",
    "counters",
    "training_queue",
    "training_dataset",
    "last_training_message",
)


def _new_session_state() -> None:
    st.session_state.datasets = {}
    st.session_state.experiments = []
    st.session_state.evaluations = []
    st.session_state.clusters = []
    st.session_state.counters = {}
    st.session_state.training_queue = []
    st.session_state.training_dataset = None
    st.session_state.last_training_message = None


def _session_file(token: str) -> Path:
    return SESSION_ROOT / f"{token}.pkl"


def persist_session() -> None:
    token = str(st.session_state.session_id)
    SESSION_ROOT.mkdir(parents=True, exist_ok=True)
    payload = {key: st.session_state[key] for key in SESSION_STATE_KEYS}
    target = _session_file(token)
    temporary = target.with_suffix(".tmp")
    with temporary.open("wb") as handle:
        pickle.dump(payload, handle, protocol=pickle.HIGHEST_PROTOCOL)
    os.replace(temporary, target)


def _cleanup_expired_session_files() -> None:
    if not SESSION_ROOT.exists():
        return
    cutoff = time.time() - SESSION_TTL_SECONDS
    for path in SESSION_ROOT.glob("*.pkl"):
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink(missing_ok=True)
        except OSError:
            pass


def init_session() -> None:
    query_token = st.query_params.get("session")
    if isinstance(query_token, list):
        query_token = query_token[0] if query_token else None
    token = str(query_token or "")
    if not SESSION_TOKEN_PATTERN.fullmatch(token):
        token = uuid.uuid4().hex
        st.query_params["session"] = token
    if st.session_state.get("_loaded_session") == token:
        return
    persisted: dict[str, Any] | None = None
    path = _session_file(token)
    if path.exists() and time.time() - path.stat().st_mtime <= SESSION_TTL_SECONDS:
        try:
            with path.open("rb") as handle:
                loaded = pickle.load(handle)
            if isinstance(loaded, dict):
                persisted = loaded
        except (OSError, pickle.PickleError, EOFError):
            persisted = None
    st.session_state.session_id = token
    if persisted:
        for key in SESSION_STATE_KEYS:
            if key in {"datasets", "counters"}:
                default_value: Any = {}
            elif key == "training_dataset" or key == "last_training_message":
                default_value = None
            else:
                default_value = []
            st.session_state[key] = persisted.get(key, default_value)
    else:
        _new_session_state()
    st.session_state._loaded_session = token
    _cleanup_expired_session_files()


def reset_session() -> None:
    old_token = st.session_state.get("session_id")
    if old_token:
        _session_file(str(old_token)).unlink(missing_ok=True)
    st.session_state.clear()
    st.query_params.clear()
    st.rerun()


def next_id(prefix: str, *parts: str) -> str:
    normalized = [part.upper().replace(" ", "-").replace("/", "-") for part in parts]
    key = "|".join([prefix, *normalized])
    sequence = int(st.session_state.counters.get(key, 0)) + 1
    st.session_state.counters[key] = sequence
    return "-".join([prefix, *normalized, f"{sequence:04d}"])


def clean_series(values: np.ndarray) -> np.ndarray:
    series = pd.Series(values, dtype="float64")
    return series.interpolate(limit_direction="both").ffill().bfill().to_numpy(dtype="float32")


@st.cache_data(show_spinner=False)
def load_geojson(source_key: str) -> dict[str, Any]:
    path = RAW_DIR / SOURCES[source_key]["geojson"]
    return json.loads(path.read_text(encoding="utf-8"))


def geojson_region_id(feature: dict[str, Any], source_key: str) -> str:
    properties = feature.get("properties") or {}
    key = SOURCES[source_key]["geometry_key"]
    return str(properties.get(key, properties.get("unique_id", "")))


def _coordinates(value: Any) -> list[tuple[float, float]]:
    if (
        isinstance(value, (list, tuple))
        and len(value) >= 2
        and isinstance(value[0], (int, float))
        and isinstance(value[1], (int, float))
    ):
        return [(float(value[0]), float(value[1]))]
    output: list[tuple[float, float]] = []
    if isinstance(value, (list, tuple)):
        for item in value:
            output.extend(_coordinates(item))
    return output


def geojson_center(source_key: str, geo: dict[str, Any]) -> tuple[float, float]:
    points = [
        point
        for feature in geo.get("features", [])
        for point in _coordinates((feature.get("geometry") or {}).get("coordinates"))
    ]
    if not points:
        return 45.46, 9.19
    return float(np.mean([point[1] for point in points])), float(np.mean([point[0] for point in points]))


def colored_geojson(
    source_key: str,
    assignments: dict[str, tuple[int, str]],
) -> tuple[dict[str, Any], float, float]:
    geo = json.loads(json.dumps(load_geojson(source_key)))
    for feature in geo.get("features", []):
        region_id = geojson_region_id(feature, source_key)
        cluster_id, color = assignments.get(region_id, (-1, "#C9D3E2"))
        feature.setdefault("properties", {})["tn_cluster"] = cluster_id
        feature.setdefault("properties", {})["tn_color"] = color
        feature["properties"]["tn_fill_color"] = [
            int(color[1:3], 16),
            int(color[3:5], 16),
            int(color[5:7], 16),
            210,
        ]
    latitude, longitude = geojson_center(source_key, geo)
    return geo, latitude, longitude


def cluster_color(index: int) -> str:
    palette = (
        "#0067C5",
        "#E85D04",
        "#0B8F6A",
        "#8C4BC2",
        "#B21E35",
        "#5A6B7B",
        "#D99A00",
        "#0087A8",
    )
    return palette[index % len(palette)]


def region_feature_frame(source: SourceData, start, end) -> pd.DataFrame:
    mask = (source.timestamps.date >= start) & (source.timestamps.date <= end)
    subset = source.values[mask]
    rows = []
    for index, region_id in enumerate(source.region_ids):
        series = clean_series(subset[:, index])
        finite = np.isfinite(series)
        valid = series[finite]
        mean = float(valid.mean()) if valid.size else float("nan")
        std = float(valid.std()) if valid.size else float("nan")
        positive = valid[valid > 0]
        rows.append(
            {
                "region_id": region_id,
                "mean": mean,
                "std": std,
                "cv": float(std / mean) if mean else float("nan"),
                "maximum": float(valid.max()) if valid.size else float("nan"),
                "p95": float(np.percentile(valid, 95)) if valid.size else float("nan"),
                "zero_ratio": float((valid == 0).mean() * 100) if valid.size else float("nan"),
                "valid_ratio": float(finite.mean() * 100),
                "variation": float(
                    np.mean(np.abs(np.diff(positive))) / np.mean(positive) * 100
                )
                if positive.size > 1 and np.mean(positive)
                else float("nan"),
            }
        )
    return pd.DataFrame(rows)


def clustering_features(features: pd.DataFrame, selected: list[str]) -> np.ndarray:
    values = features[selected].replace([np.inf, -np.inf], np.nan).to_numpy(dtype="float64")
    imputed = SimpleImputer(strategy="median").fit_transform(values)
    return StandardScaler().fit_transform(imputed)


def compute_clustering(
    algorithm_key: str,
    matrix: np.ndarray,
    cluster_count: int,
) -> np.ndarray:
    if algorithm_key == "kmeans":
        model = KMeans(n_clusters=cluster_count, n_init=20, random_state=42)
    elif algorithm_key == "agglomerative":
        model = AgglomerativeClustering(n_clusters=cluster_count, linkage="ward")
    elif algorithm_key == "gmm":
        model = GaussianMixture(n_components=cluster_count, covariance_type="full", random_state=42)
    elif algorithm_key == "spectral":
        model = SpectralClustering(
            n_clusters=cluster_count,
            affinity="nearest_neighbors",
            n_neighbors=min(15, max(2, len(matrix) - 1)),
            assign_labels="kmeans",
            random_state=42,
        )
    else:
        raise ValueError(f"未知聚类算法: {algorithm_key}")
    return np.asarray(model.fit_predict(matrix), dtype="int64")


def region_map(
    source_key: str,
    assignments: dict[str, tuple[int, str]],
    height: int = 470,
) -> None:
    geo, latitude, longitude = colored_geojson(source_key, assignments)
    layer = pdk.Layer(
        "GeoJsonLayer",
        data=geo,
        pickable=True,
        stroked=True,
        filled=True,
        get_fill_color="properties.tn_fill_color",
        get_line_color=[90, 107, 123, 180],
        line_width_min_pixels=1,
    )
    st.pydeck_chart(
        pdk.Deck(
            layers=[layer],
            initial_view_state=pdk.ViewState(
                latitude=latitude,
                longitude=longitude,
                zoom=8,
                pitch=20,
            ),
            map_style=None,
            tooltip={"text": "区域: {unique_id} {NAME_3} {NIL}\n聚类: {tn_cluster}"},
        ),
        height=height,
    )


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


def arima_forecast(bundle: dict[str, Any], x_test: np.ndarray) -> np.ndarray:
    from statsmodels.tsa.arima.model import ARIMA

    split = bundle["split"]
    first_test_start = int(bundle["starts"][split["test"].start])
    fit_end = first_test_start + int(bundle["input_length"])
    fit_start = max(0, fit_end - MAX_STATISTICAL_TRAIN_POINTS)
    fitted = ARIMA(bundle["series"][fit_start:fit_end], order=(1, 1, 1)).fit()
    predictions = []
    for context in x_test:
        applied = fitted.apply(context, refit=False)
        predictions.append(np.asarray(applied.forecast(int(bundle["output_length"])), dtype="float64"))
    return np.vstack(predictions)


def prophet_forecast(bundle: dict[str, Any], x_test: np.ndarray) -> np.ndarray:
    from prophet import Prophet

    split = bundle["split"]
    first_test_start = int(bundle["starts"][split["test"].start])
    fit_end = first_test_start + int(bundle["input_length"])
    fit_start = max(0, fit_end - MAX_STATISTICAL_TRAIN_POINTS)
    timestamps = pd.DatetimeIndex(bundle["timestamps"])
    interval = pd.to_timedelta(np.median(np.diff(timestamps.to_numpy()).astype("timedelta64[ns]")))
    training = pd.DataFrame(
        {
            "ds": timestamps[fit_start:fit_end],
            "y": bundle["series"][fit_start:fit_end],
        }
    )
    model = Prophet(
        daily_seasonality=True,
        weekly_seasonality=True,
        yearly_seasonality="auto",
        interval_width=0.8,
    )
    model.fit(training)
    predictions = []
    horizon = int(bundle["output_length"])
    for offset in range(len(x_test)):
        last_timestamp = timestamps[first_test_start + offset + int(bundle["input_length"]) - 1]
        future = pd.DataFrame(
            {"ds": [last_timestamp + interval * (step + 1) for step in range(horizon)]}
        )
        predictions.append(model.predict(future)["yhat"].to_numpy(dtype="float64"))
    return np.vstack(predictions)


def torch_forecast(
    kind: str,
    bundle: dict[str, Any],
    x_train: np.ndarray,
    y_train: np.ndarray,
    x_test: np.ndarray,
) -> np.ndarray:
    import torch
    from torch import nn

    torch.manual_seed(42)
    torch.set_num_threads(min(2, os.cpu_count() or 1))
    x_mean = float(np.mean(x_train))
    x_std = float(np.std(x_train)) or 1.0
    y_mean = float(np.mean(y_train))
    y_std = float(np.std(y_train)) or 1.0
    x_train_scaled = (x_train - x_mean) / x_std
    y_train_scaled = (y_train - y_mean) / y_std
    x_test_scaled = (x_test - x_mean) / x_std
    input_length = x_train.shape[1]
    output_length = y_train.shape[1]

    class Forecaster(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.kind = kind
            if kind == "mlp":
                self.network = nn.Sequential(
                    nn.Flatten(),
                    nn.Linear(input_length, 64),
                    nn.ReLU(),
                    nn.Dropout(0.08),
                    nn.Linear(64, 32),
                    nn.ReLU(),
                    nn.Linear(32, output_length),
                )
                self.sequence = None
            else:
                if kind == "rnn":
                    self.sequence = nn.RNN(1, 32, batch_first=True)
                elif kind == "lstm":
                    self.sequence = nn.LSTM(1, 32, batch_first=True)
                elif kind == "gru":
                    self.sequence = nn.GRU(1, 32, batch_first=True)
                else:
                    self.sequence = nn.TransformerEncoder(
                        nn.TransformerEncoderLayer(
                            d_model=16,
                            nhead=4,
                            dim_feedforward=32,
                            dropout=0.08,
                            batch_first=True,
                        ),
                        num_layers=1,
                    )
                self.input_projection = nn.Linear(1, 16) if kind == "transformer" else None
                feature_size = 16 if kind == "transformer" else 32
                self.head = nn.Sequential(nn.LayerNorm(feature_size), nn.Linear(feature_size, output_length))
            self.register_buffer("position", torch.arange(input_length, dtype=torch.float32).unsqueeze(1))

        def forward(self, value: torch.Tensor) -> torch.Tensor:
            if self.kind == "mlp":
                return self.network(value)
            sequence = value.unsqueeze(-1)
            if self.kind == "transformer":
                position = self.position.unsqueeze(0) / 16.0
                projected = self.input_projection(sequence) + position
                encoded = self.sequence(projected)
                return self.head(encoded.mean(dim=1))
            encoded, _ = self.sequence(sequence)
            return self.head(encoded[:, -1, :])

    model = Forecaster()
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.003, weight_decay=0.0005)
    loss_function = nn.MSELoss()
    x_tensor = torch.tensor(x_train_scaled, dtype=torch.float32)
    y_tensor = torch.tensor(y_train_scaled, dtype=torch.float32)
    epochs = 18 if kind in {"mlp", "transformer"} else 14
    batch_size = min(64, len(x_tensor))
    generator = torch.Generator().manual_seed(42)
    model.train()
    for _ in range(epochs):
        order = torch.randperm(len(x_tensor), generator=generator)
        for start in range(0, len(order), batch_size):
            batch = order[start : start + batch_size]
            optimizer.zero_grad()
            loss = loss_function(model(x_tensor[batch]), y_tensor[batch])
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
    model.eval()
    with torch.inference_mode():
        prediction = model(torch.tensor(x_test_scaled, dtype=torch.float32)).numpy()
    return prediction * y_std + y_mean


def train_experiment(dataset_id: str, algorithm_key: str) -> dict[str, Any]:
    bundle = st.session_state.datasets[dataset_id]
    split = bundle["split"]
    deep = algorithm_key in {"mlp", "rnn", "lstm", "gru", "transformer"}
    train_limit = MAX_DEEP_TRAIN_WINDOWS if deep else MAX_TRAIN_WINDOWS
    if algorithm_key in {"arima", "prophet"}:
        test_limit = MAX_STATISTICAL_TEST_WINDOWS
    elif deep:
        test_limit = MAX_DEEP_TEST_WINDOWS
    else:
        test_limit = MAX_TEST_WINDOWS
    x_train = bundle["X"][split["train"]][-train_limit:]
    y_train = bundle["Y"][split["train"]][-train_limit:]
    x_test = bundle["X"][split["test"]][-test_limit:]
    y_test = bundle["Y"][split["test"]][-test_limit:]
    started = time.perf_counter()
    if algorithm_key == "arima":
        prediction = arima_forecast(bundle, x_test)
    elif algorithm_key == "prophet":
        prediction = prophet_forecast(bundle, x_test)
    elif deep:
        prediction = torch_forecast(algorithm_key, bundle, x_train, y_train, x_test)
    else:
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
    title_column, action_column = st.columns([5, 1])
    with title_column:
        st.title("TN Traffic Intelligence")
    with action_column:
        if st.button("新建会话", width="stretch"):
            reset_session()
    st.caption("真实原生观测数据 · 真实机器学习训练 · Streamlit Community Cloud 演示版")
    with st.expander("会话与功能说明", expanded=False):
        st.markdown(
            f"""
- 当前匿名会话：`{st.session_state.session_id[:12]}`
- 刷新页面通过 URL 会话令牌保留当前会话历史；新浏览器会话从空历史开始。
- 数据集、实验和评估编号均从 `0001` 开始。
- 本版运行 10 种本地算法和 4 种聚类算法；不运行 TimesFM/Chronos，也不模拟任何结果。
- 匿名会话地址包含随机令牌，请勿把个人会话 URL 作为公开链接传播。
- 每次构建和训练都直接使用仓库中的真实原始数据。
"""
        )


def exploration_tab() -> None:
    source_key = st.selectbox(
        "数据源",
        options=list(SOURCES),
        format_func=lambda key: SOURCES[key]["label"],
        key="explore_source",
    )
    with st.spinner("读取真实原始数据..."):
        source = load_source(source_key)
    source_summary(source)
    control_left, control_right = st.columns([1, 2])
    region_id = control_left.selectbox("区域", source.region_ids, index=0, key="explore_region")
    default_start = source.timestamps.min().date()
    default_end = source.timestamps.max().date()
    selected_range = control_right.date_input(
        "分析时间范围",
        value=(default_start, default_end),
        min_value=default_start,
        max_value=default_end,
        key="explore_range",
    )
    if isinstance(selected_range, tuple) and len(selected_range) == 2:
        start, end = selected_range
    else:
        start, end = default_start, default_end
    mask = (source.timestamps.date >= start) & (source.timestamps.date <= end)
    region_index = source.region_ids.index(region_id)
    series = clean_series(source.values[mask, region_index])
    timestamps = source.timestamps[mask]
    metrics_columns = st.columns(6)
    metrics_columns[0].metric("有效点", f"{int(np.isfinite(series).sum()):,}")
    metrics_columns[1].metric("均值", f"{np.mean(series):,.2f}")
    metrics_columns[2].metric("标准差", f"{np.std(series):,.2f}")
    metrics_columns[3].metric("最大值", f"{np.max(series):,.2f}")
    metrics_columns[4].metric("P95", f"{np.percentile(series, 95):,.2f}")
    metrics_columns[5].metric("零值比例", f"{np.mean(series == 0) * 100:.2f}%")

    temporal_tab, map_tab, compare_tab = st.tabs(
        ["时间分析", "空间地图", "多区域对比"]
    )
    with temporal_tab:
        st.line_chart(pd.DataFrame({"原始观测": series}, index=timestamps), height=310)
        hourly = pd.Series(series).groupby(timestamps.hour).mean()
        weekday_mask = timestamps.day_of_week < 5
        weekday_profile = pd.Series(series[weekday_mask]).groupby(timestamps.hour[weekday_mask]).mean()
        weekend_profile = pd.Series(series[~weekday_mask]).groupby(timestamps.hour[~weekday_mask]).mean()
        profile = pd.DataFrame(
            {
                "全部日期": hourly,
                "工作日": weekday_profile,
                "周末": weekend_profile,
            }
        )
        st.subheader("日内小时画像")
        st.line_chart(profile, height=290)
        try:
            from statsmodels.tsa.stattools import acf

            acf_values = acf(series, nlags=min(96, len(series) - 2), fft=True)
            st.subheader("自相关 ACF")
            st.line_chart(pd.DataFrame({"ACF": acf_values}), height=220)
        except Exception as exc:
            st.warning(f"ACF 计算失败：{exc}")

    with map_tab:
        feature_frame = region_feature_frame(source, start, end)
        finite_means = feature_frame["mean"].replace([np.inf, -np.inf], np.nan).dropna()
        if finite_means.empty:
            st.info("当前范围没有可显示的区域均值。")
        else:
            edges = np.quantile(finite_means, [0, 0.2, 0.4, 0.6, 0.8, 1.0])
            assignments: dict[str, tuple[int, str]] = {}
            for row in feature_frame.itertuples(index=False):
                value = float(row.mean) if np.isfinite(row.mean) else float("nan")
                level = int(np.searchsorted(edges[1:-1], value, side="right")) if np.isfinite(value) else 5
                color = cluster_color(level)
                assignments[str(row.region_id)] = (level + 1, color)
            region_map(source_key, assignments)
            st.caption("地图按所选时间范围的区域平均流量分为 5 个等级。")

    with compare_tab:
        candidates = list(source.region_ids)
        default_regions = candidates[: min(3, len(candidates))]
        selected_regions = st.multiselect(
            "对比区域",
            candidates,
            default=default_regions,
            max_selections=5,
            key="explore_compare_regions",
        )
        if selected_regions:
            step = max(1, len(timestamps) // 2500)
            comparison = pd.DataFrame(index=timestamps[::step])
            summary_rows = []
            for candidate in selected_regions:
                candidate_index = source.region_ids.index(candidate)
                candidate_series = clean_series(source.values[mask, candidate_index])
                comparison[candidate] = candidate_series[::step]
                summary_rows.append(
                    {
                        "区域": candidate,
                        "均值": round(float(np.mean(candidate_series)), 3),
                        "最大值": round(float(np.max(candidate_series)), 3),
                        "标准差": round(float(np.std(candidate_series)), 3),
                    }
                )
            st.line_chart(comparison, height=330)
            st.dataframe(pd.DataFrame(summary_rows), width="stretch", hide_index=True)

    st.dataframe(feature_frame, width="stretch", hide_index=True)


def clustering_tab() -> None:
    st.subheader("功能区聚类")
    source_key = st.selectbox(
        "聚类数据源",
        list(SOURCES),
        format_func=lambda key: SOURCES[key]["label"],
        key="cluster_source",
    )
    source = load_source(source_key)
    start_default = source.timestamps.min().date()
    end_default = source.timestamps.max().date()
    selected_range = st.date_input(
        "聚类时间范围",
        value=(start_default, end_default),
        min_value=start_default,
        max_value=end_default,
        key="cluster_range",
    )
    if isinstance(selected_range, tuple) and len(selected_range) == 2:
        start, end = selected_range
    else:
        start, end = start_default, end_default
    left, middle, right = st.columns(3)
    algorithm_key = left.selectbox(
        "聚类算法",
        list(CLUSTER_ALGORITHMS),
        format_func=lambda key: CLUSTER_ALGORITHMS[key],
    )
    cluster_count = middle.slider("聚类数量", 2, 8, 4)
    feature_options = ["mean", "std", "cv", "maximum", "p95", "zero_ratio", "variation"]
    selected_features = right.multiselect(
        "聚类特征",
        feature_options,
        default=["mean", "std", "cv", "p95"],
    )
    if st.button(
        "运行聚类",
        type="primary",
        width="stretch",
        disabled=not selected_features,
    ):
        try:
            with st.spinner("计算区域特征并运行真实聚类..."):
                feature_frame = region_feature_frame(source, start, end)
                matrix = clustering_features(feature_frame, selected_features)
                labels = compute_clustering(algorithm_key, matrix, int(cluster_count))
                unique = sorted(int(value) for value in np.unique(labels))
                score_row = feature_frame.loc[:, ["region_id"]].copy()
                score_row["cluster"] = labels
                quality = {}
                if 1 < len(unique) < len(labels):
                    quality = {
                        "silhouette": float(silhouette_score(matrix, labels)),
                        "calinski_harabasz": float(calinski_harabasz_score(matrix, labels)),
                        "davies_bouldin": float(davies_bouldin_score(matrix, labels)),
                    }
                cluster_mapping = {
                    str(row.region_id): int(row.cluster)
                    for row in score_row.itertuples(index=False)
                }
                mask = (source.timestamps.date >= start) & (source.timestamps.date <= end)
                hourly_profiles: dict[str, np.ndarray] = {}
                for cluster_id in unique:
                    member_ids = [
                        region_id
                        for region_id, value in cluster_mapping.items()
                        if value == cluster_id
                    ]
                    indices = [source.region_ids.index(region_id) for region_id in member_ids]
                    cluster_values = source.values[mask][:, indices]
                    profile = pd.DataFrame(cluster_values).groupby(source.timestamps[mask].hour).mean().mean(axis=1)
                    hourly_profiles[f"C{cluster_id + 1}"] = profile.reindex(range(24)).to_numpy()
                cluster_id = next_id("CLUS", source_key, algorithm_key)
                result = {
                    "cluster_id": cluster_id,
                    "source_key": source_key,
                    "source_label": source.label,
                    "algorithm_key": algorithm_key,
                    "algorithm": CLUSTER_ALGORITHMS[algorithm_key],
                    "cluster_count": len(unique),
                    "features": selected_features,
                    "quality": quality,
                    "cluster_mapping": cluster_mapping,
                    "profile": hourly_profiles,
                    "created_at": pd.Timestamp.now(tz="Asia/Shanghai").strftime("%Y-%m-%d %H:%M:%S"),
                }
                st.session_state.clusters.insert(0, result)
                persist_session()
                st.success(f"已保存 {cluster_id}")
        except Exception as exc:
            st.error(f"聚类失败：{type(exc).__name__}: {exc}")

    if not st.session_state.clusters:
        st.info("当前会话还没有聚类记录。")
        return
    labels = {
        item["cluster_id"]: f"{item['cluster_id']} · {item['algorithm']}"
        for item in st.session_state.clusters
    }
    selected_cluster = st.selectbox(
        "聚类历史",
        list(labels),
        format_func=lambda key: labels[key],
    )
    result = next(item for item in st.session_state.clusters if item["cluster_id"] == selected_cluster)
    score_columns = st.columns(3)
    score_columns[0].metric("簇数量", result["cluster_count"])
    score_columns[1].metric(
        "轮廓系数",
        f"{result['quality'].get('silhouette', float('nan')):.4f}",
    )
    score_columns[2].metric(
        "Calinski-Harabasz",
        f"{result['quality'].get('calinski_harabasz', float('nan')):.2f}",
    )
    assignments = {
        region_id: (cluster + 1, cluster_color(cluster))
        for region_id, cluster in result["cluster_mapping"].items()
    }
    region_map(result["source_key"], assignments)
    profile_frame = pd.DataFrame(result["profile"])
    profile_frame.index.name = "小时"
    st.subheader("各簇典型日内模式")
    st.line_chart(profile_frame, height=310)
    st.dataframe(
        pd.DataFrame(
            [
                {
                    "区域": region_id,
                    "簇": f"C{cluster + 1}",
                }
                for region_id, cluster in result["cluster_mapping"].items()
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
            persist_session()
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
    action_left, action_right = st.columns([1, 3])
    if action_left.button("选择全部 10 种", width="stretch"):
        st.session_state.training_algorithms = list(ALGORITHMS)
        st.rerun()
    action_right.caption(
        "全部模型按顺序真实训练；每个完成的实验会立即写入当前匿名会话，单个算法失败不会伪造结果。"
    )
    if "training_algorithms" not in st.session_state:
        st.session_state.training_algorithms = ["random_forest"]
    algorithms = st.multiselect(
        "算法",
        options=list(ALGORITHMS),
        format_func=lambda key: ALGORITHMS[key],
        key="training_algorithms",
    )
    st.caption(
        "免费演示版限制训练窗口和网络规模；ARIMA、Prophet 与四种深度学习模型耗时更长。"
    )
    queue_active = bool(st.session_state.training_queue)
    if st.button(
        "开始训练",
        type="primary",
        width="stretch",
        disabled=not algorithms or queue_active,
    ):
        st.session_state.training_queue = list(algorithms)
        st.session_state.training_dataset = dataset_id
        st.session_state.last_training_message = None
        persist_session()
        st.rerun()

    if st.session_state.training_queue:
        algorithm_key = st.session_state.training_queue[0]
        st.info(
            f"正在训练 {ALGORITHMS[algorithm_key]}，队列剩余 "
            f"{len(st.session_state.training_queue)} 个模型。"
        )
        try:
            experiment = train_experiment(
                str(st.session_state.training_dataset or dataset_id),
                algorithm_key,
            )
            st.session_state.experiments.insert(0, experiment)
            st.session_state.last_training_message = (
                f"{experiment['experiment_id']} 训练完成，用时 {experiment['duration_seconds']} 秒"
            )
        except Exception as exc:
            st.session_state.last_training_message = (
                f"{ALGORITHMS[algorithm_key]} 训练失败：{type(exc).__name__}: {exc}"
            )
        st.session_state.training_queue.pop(0)
        persist_session()
        if st.session_state.training_queue:
            st.rerun()

    if st.session_state.last_training_message:
        message = str(st.session_state.last_training_message)
        if "失败" in message:
            st.error(message)
        else:
            st.success(message)

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
    horizon = st.slider(
        "预测时域",
        1,
        int(chosen[0]["per_horizon"][-1]["h"]),
        1,
    )
    comparison = pd.DataFrame(
        {
            "真实值": np.asarray(chosen[0]["preview_truth"], dtype="float64")[:60, horizon - 1],
        }
    )
    for item in chosen:
        prediction = np.asarray(item["preview_prediction"], dtype="float64")[:60, horizon - 1]
        comparison[item["experiment_id"]] = prediction
    st.subheader("预测值对比")
    st.line_chart(comparison, height=300)
    horizon_rows = []
    for item in chosen:
        horizon_row = next(row for row in item["per_horizon"] if int(row["h"]) == horizon)
        horizon_rows.append(
            {
                "模型": item["algorithm"],
                "EXP ID": item["experiment_id"],
                "MAE": round(horizon_row["MAE"], 4),
                "RMSE": round(horizon_row["RMSE"], 4),
                "WAPE": round(horizon_row["WAPE"], 4),
                "sMAPE": round(horizon_row["sMAPE"], 4),
            }
        )
    st.dataframe(pd.DataFrame(horizon_rows), width="stretch", hide_index=True)
    experiment_id = st.selectbox("查看单模型逐时域指标", list(selected))
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
        persist_session()
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
    exploration, clustering, dataset, training, evaluation = st.tabs(
        [
            "1 · 数据探索",
            "2 · 功能区聚类",
            "3 · 数据集构建",
            "4 · 模型训练",
            "5 · 预测评估",
        ]
    )
    with exploration:
        exploration_tab()
    with clustering:
        clustering_tab()
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
