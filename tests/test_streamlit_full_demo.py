"""Smoke tests for all ten models and all four clustering algorithms."""

from __future__ import annotations

import numpy as np
import pytest

import streamlit_app as app


@pytest.fixture(scope="module")
def real_bundle():
    source = app.load_source("milano")
    region_index = source.region_ids.index("ADRIANO")
    series = app.clean_series(source.values[:1000, region_index])
    timestamps = source.timestamps[:1000]
    bundle = app.build_windows(series, timestamps, 12, 3, 1, 0.7, 0.15)
    split = bundle["split"]
    bundle["x_train"] = bundle["X"][split["train"]][-360:]
    bundle["y_train"] = bundle["Y"][split["train"]][-360:]
    bundle["x_test"] = bundle["X"][split["test"]][-60:]
    bundle["y_test"] = bundle["Y"][split["test"]][-60:]
    return bundle


@pytest.mark.parametrize(
    "algorithm",
    ["arima", "prophet", "random_forest", "xgboost", "lightgbm"],
)
def test_statistical_and_tree_models_produce_real_predictions(real_bundle, algorithm):
    if algorithm == "arima":
        prediction = app.arima_forecast(real_bundle, real_bundle["x_test"])
    elif algorithm == "prophet":
        prediction = app.prophet_forecast(real_bundle, real_bundle["x_test"])
    else:
        model = app.make_model(algorithm)
        model.fit(real_bundle["x_train"], real_bundle["y_train"])
        prediction = model.predict(real_bundle["x_test"])
    assert prediction.shape == real_bundle["y_test"].shape
    assert np.isfinite(prediction).all()


@pytest.mark.parametrize("algorithm", ["mlp", "rnn", "lstm", "gru", "transformer"])
def test_deep_models_produce_real_predictions(real_bundle, algorithm):
    prediction = app.torch_forecast(
        algorithm,
        real_bundle,
        real_bundle["x_train"],
        real_bundle["y_train"],
        real_bundle["x_test"],
    )
    assert prediction.shape == real_bundle["y_test"].shape
    assert np.isfinite(prediction).all()


@pytest.mark.parametrize("algorithm", list(app.CLUSTER_ALGORITHMS))
def test_clustering_algorithms_run_on_real_region_features(algorithm):
    source = app.load_source("milano")
    start = source.timestamps.min().date()
    end = source.timestamps.max().date()
    features = app.region_feature_frame(source, start, end)
    matrix = app.clustering_features(features, ["mean", "std", "cv", "p95"])
    labels = app.compute_clustering(algorithm, matrix, 4)
    assert labels.shape == (len(features),)
    assert len(np.unique(labels)) == 4
