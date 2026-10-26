"""Streamlit Community Cloud demo regression using real source data."""

from pathlib import Path

from streamlit.testing.v1 import AppTest


def test_streamlit_builds_real_dataset_and_trains_first_algorithm():
    entrypoint = Path(__file__).resolve().parents[1] / "streamlit_app.py"
    app = AppTest.from_file(entrypoint, default_timeout=180).run()
    assert not app.exception

    build = next(button for button in app.button if button.label == "构建数据集")
    build.click().run()
    assert not app.exception
    assert any("DS-MILANO-ADRIANO-0001" in item.value for item in app.success)

    algorithm_selector = next(widget for widget in app.multiselect if widget.label == "算法")
    algorithm_selector.set_value(["arima", "prophet", "random_forest", "xgboost", "lightgbm", "mlp", "rnn", "lstm", "gru", "transformer"]).run()
    train = next(button for button in app.button if button.label == "开始训练")
    train.click().run()
    assert not app.exception
    assert len(app.session_state.experiments) == 10
    assert {
        item["algorithm_key"] for item in app.session_state.experiments
    } == {"arima", "prophet", "random_forest", "xgboost", "lightgbm",
          "mlp", "rnn", "lstm", "gru", "transformer"}
    assert all(
        item["experiment_id"].endswith("-0001")
        for item in app.session_state.experiments
    )

    save_evaluation = next(button for button in app.button if button.label == "保存本次评估")
    save_evaluation.click().run()
    assert not app.exception
    assert any("EVAL-0001" in item.value for item in app.success)
