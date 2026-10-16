"""Concrete adapters for the 12 algorithms."""

from __future__ import annotations

from typing import Any

from app.forecast.adapters.dl import DeepLearningAdapter
from app.forecast.foundation import ChronosAdapter, TimesFMAdapter
from app.forecast.adapters.ml import GradientBoostingAdapter, RandomForestAdapter
from app.forecast.adapters.statistical import ArimaAdapter, ProphetAdapter

ADAPTERS: dict[str, Any] = {
    "arima": ArimaAdapter,
    "prophet": ProphetAdapter,
    "random_forest": RandomForestAdapter,
    "xgboost": GradientBoostingAdapter,
    "lightgbm": GradientBoostingAdapter,
    "mlp": DeepLearningAdapter,
    "rnn": DeepLearningAdapter,
    "lstm": DeepLearningAdapter,
    "gru": DeepLearningAdapter,
    "transformer": DeepLearningAdapter,
    "timesfm": TimesFMAdapter,
    "chronos": ChronosAdapter,
}


def build_adapter(algorithm_key: str, params: dict, mode: str, context: dict | None = None):
    if algorithm_key not in ADAPTERS:
        raise KeyError(f"未知算法 {algorithm_key}")
    adapter = ADAPTERS[algorithm_key](params, mode, context)
    # xgboost/lightgbm share one implementation class; the instance keeps its own key.
    adapter.algorithm_key = algorithm_key
    return adapter


def adapter_class(algorithm_key: str):
    return ADAPTERS[algorithm_key]
