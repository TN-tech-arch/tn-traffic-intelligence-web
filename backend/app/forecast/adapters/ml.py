"""Random Forest, XGBoost and LightGBM adapters (real library training)."""

from __future__ import annotations

from typing import Any

import numpy as np

from app.forecast.base import (
    Adapter,
    CancelCallback,
    FitResult,
    ProgressCallback,
    RegionContext,
    WindowBatch,
    never_cancel,
    noop_progress,
)


class RandomForestAdapter(Adapter):
    algorithm_key = "random_forest"
    operates_in = "scaled"
    has_epoch_progress = False
    stage_names = ("Fit", "Ready")

    def _build(self):
        from sklearn.ensemble import RandomForestRegressor

        max_features = self.params.get("max_features", "sqrt")
        if max_features == "all":
            max_features = 1.0
        elif max_features == "0.5":
            max_features = 0.5
        elif max_features == "sqrt":
            max_features = "sqrt"
        elif max_features == "log2":
            max_features = "log2"
        return RandomForestRegressor(
            n_estimators=int(self.params["n_estimators"]),
            max_depth=int(self.params["max_depth"]),
            min_samples_split=int(self.params["min_samples_split"]),
            min_samples_leaf=int(self.params.get("min_samples_leaf", 1)),
            max_features=max_features,
            bootstrap=bool(self.params.get("bootstrap", True)),
            random_state=int(self.params.get("random_state", 42)),
            n_jobs=int(self.params.get("n_jobs", -1)),
        )

    def fit(self, *, region, train, validation, progress=noop_progress, cancel=never_cancel) -> FitResult:
        progress("Fit", 5.0, "训练 Random Forest（真实 sklearn 训练）")
        strategy = self.params.get("multi_output_strategy", "native")
        if strategy == "direct":
            from sklearn.multioutput import MultiOutputRegressor

            estimator = MultiOutputRegressor(self._build(), n_jobs=int(self.params.get("n_jobs", -1)))
        else:
            estimator = self._build()
        estimator.fit(train.X_scaled, train.Y_scaled)
        self.check_cancel(cancel)
        progress("Fit", 90.0, "Random Forest 训练完成")
        import io
        import pickle

        buffer = io.BytesIO()
        pickle.dump(estimator, buffer)
        return FitResult(
            state={"model_bytes": buffer.getvalue(), "strategy": strategy},
            history={"type": "ensemble", "no_epochs": True, "trees": int(self.params["n_estimators"]),
                     "strategy": strategy},
            notes=[
                f"sklearn RandomForestRegressor，策略={strategy}，树数={self.params['n_estimators']}。",
                "该实现没有 epoch 概念，训练曲线只提供真实拟合耗时与树数量。",
            ],
        )

    def predict(self, *, region, state, batch, progress=noop_progress, cancel=never_cancel) -> np.ndarray:
        import pickle

        model = pickle.loads(state["model_bytes"])
        self.check_cancel(cancel)
        return np.asarray(model.predict(batch.X_scaled), dtype="float64")


class GradientBoostingAdapter(Adapter):
    """XGBoost / LightGBM, both with true per-horizon direct regression."""

    operates_in = "scaled"
    has_epoch_progress = True
    stage_names = ("Train", "Ready")

    def _make_estimator(self):
        if self.algorithm_key == "xgboost":
            from xgboost import XGBRegressor

            return XGBRegressor(
                n_estimators=int(self.params["n_estimators"]),
                max_depth=int(self.params["max_depth"]),
                learning_rate=float(self.params["learning_rate"]),
                subsample=float(self.params.get("subsample", 0.8)),
                colsample_bytree=float(self.params.get("colsample_bytree", 0.8)),
                reg_lambda=float(self.params.get("reg_lambda", 1.0)),
                reg_alpha=float(self.params.get("reg_alpha", 0.0)),
                tree_method=self.params.get("tree_method", "hist"),
                random_state=int(self.params.get("random_state", 42)
                                 if "random_state" in self.params else 42),
                n_jobs=int(self.params.get("n_jobs", -1)) if "n_jobs" in self.params else -1,
                verbosity=0,
            )
        from lightgbm import LGBMRegressor

        return LGBMRegressor(
            n_estimators=int(self.params["n_estimators"]),
            num_leaves=int(self.params["num_leaves"]),
            learning_rate=float(self.params["learning_rate"]),
            max_depth=int(self.params.get("max_depth", 6)),
            feature_fraction=float(self.params.get("feature_fraction", 0.9)),
            bagging_fraction=float(self.params.get("bagging_fraction", 0.9)),
            bagging_freq=int(self.params.get("bagging_freq", 1)),
            min_child_samples=int(self.params.get("min_child_samples", 20)),
            random_state=int(self.params.get("random_state", 42)
                             if "random_state" in self.params else 42),
            n_jobs=int(self.params.get("n_jobs", -1)) if "n_jobs" in self.params else -1,
            verbose=-1,
        )

    def _fit_one(self, X, y, X_val, y_val, history, cancel):
        estimator = self._make_estimator()
        if self.algorithm_key == "xgboost":
            from xgboost import XGBRegressor

            early = int(self.params.get("early_stopping_rounds", 0) or 0)
            fit_kwargs: dict[str, Any] = {}
            if early > 0 and X_val is not None and X_val.size:
                fit_kwargs["eval_set"] = [(X_val, y_val)]
                fit_kwargs["verbose"] = False
            estimator.fit(X, y, **fit_kwargs)
            try:
                record = estimator.evals_result() if hasattr(estimator, "evals_result") else {}
            except Exception:
                record = {}
            for name, metrics in (record or {}).items():
                for key, values in metrics.items():
                    history.setdefault(name, {}).setdefault(key, [float(v) for v in values])
        else:
            from lightgbm import LGBMRegressor

            callbacks = []
            early = int(self.params.get("early_stopping_rounds", 0) or 0)
            fit_kwargs = {}
            if early > 0 and X_val is not None and X_val.size:
                try:
                    from lightgbm import early_stopping as lgb_early

                    callbacks.append(lgb_early(early, verbose=False))
                except Exception:
                    pass
                fit_kwargs["eval_set"] = [(X_val, y_val)]
                fit_kwargs["eval_metric"] = "l2"
            estimator.fit(X, y, callbacks=callbacks or None, **fit_kwargs)
            if hasattr(estimator, "evals_result_"):
                for name, metrics in estimator.evals_result_.items():
                    for key, values in metrics.items():
                        history.setdefault(name, {}).setdefault(key, [float(v) for v in values])
        self.check_cancel(cancel)
        return estimator

    def fit(self, *, region, train, validation, progress=noop_progress, cancel=never_cancel) -> FitResult:
        H = train.Y_scaled.shape[1]
        history: dict[str, Any] = {"type": "boosting"}
        models = []
        for step in range(H):
            progress("Train", 100.0 * step / H, f"{self.algorithm_key.upper()} 训练 horizon {step + 1}/{H}")
            models.append(
                self._fit_one(
                    train.X_scaled,
                    train.Y_scaled[:, step],
                    validation.X_scaled if validation else None,
                    validation.Y_scaled[:, step] if validation else None,
                    history,
                    cancel,
                )
            )
        progress("Train", 95.0, f"{self.algorithm_key.upper()} 全部 horizon 训练完成")
        import io
        import pickle

        buffer = io.BytesIO()
        pickle.dump(models, buffer)
        iterations = [int(getattr(m, "best_iteration", getattr(m, "n_estimators", 0)) or 0) for m in models]
        metrics_seen = history.get("validation_0", {})
        detail = list(metrics_seen.values())[0] if metrics_seen else []
        return FitResult(
            state={"model_bytes": buffer.getvalue(), "horizons": H, "strategy": "direct"},
            history={
                **history,
                "iterations_per_horizon": iterations,
                "iteration_metric": detail,
                "no_epochs": False,
            },
            notes=[
                f"{self.algorithm_key.upper()} 使用逐 horizon 直接回归（{H} 个子模型），"
                "每个 horizon 的真实迭代指标已记录。",
            ],
        )

    def predict(self, *, region, state, batch, progress=noop_progress, cancel=never_cancel) -> np.ndarray:
        import pickle

        models = pickle.loads(state["model_bytes"])
        out = np.empty((batch.size, len(models)), dtype="float64")
        for step, model in enumerate(models):
            self.check_cancel(cancel)
            out[:, step] = np.asarray(model.predict(batch.X_scaled), dtype="float64")
        return out
