# 模型注册表（MODEL_REGISTRY）

注册表位置：`backend/app/forecast/registry.py`。它同时驱动三件事：
前端渲染与即时校验、`GET /api/validation/schema` 与 `GET /api/models/registry` 输出、
服务端权威校验（`services/validation.py`）。因此前端与后端**不会出现两套规则**。

## 1. 12 个算法（固定，不增不减）

| # | 分类 | 算法 | 默认模式 | Adapter |
|---:|---|---|---|---|
| 1 | Statistical | ARIMA | fit | `adapters/statistical.py` |
| 2 | Statistical | Prophet | fit | `adapters/statistical.py` |
| 3 | Machine Learning | Random Forest | train | `adapters/ml.py` |
| 4 | Machine Learning | XGBoost | train | `adapters/ml.py` |
| 5 | Machine Learning | LightGBM | train | `adapters/ml.py` |
| 6 | Deep Learning | MLP | train | `adapters/dl.py` |
| 7 | Deep Learning | RNN | train | `adapters/dl.py` |
| 8 | Deep Learning | LSTM | train | `adapters/dl.py` |
| 9 | Deep Learning | GRU | train | `adapters/dl.py` |
| 10 | Deep Learning | Transformer | train | `adapters/dl.py` |
| 11 | Foundation Model | TimesFM | zero_shot | `forecast/foundation.py` |
| 12 | Foundation Model | Chronos | zero_shot | `forecast/foundation.py` |

`All Models` 位于模型选择列表顶部，是 12 个算法的批量编排（`is_algorithm: false`），不是第 13 种算法。

## 2. 参数（Basic / Advanced）与关键约束

下表列出每个算法的主要可编辑参数；完整范围、单位、中文帮助、默认值、联动条件与告警阈值
都以 `/api/validation/schema` 为准（前端直接读取该 schema）。

| 算法 | Basic | Advanced（节选） | 跨字段 / 环境规则 |
|---|---|---|---|
| ARIMA | p=3, d=1, q=2 | trend=n, enforce_stationarity, enforce_invertibility, maxiter, refit_interval | `trend` 必须与差分阶数兼容：d=0 允许 n/c/t/ct；d=1 只允许 n/t；d≥2 只允许 n（违反 → Error `TREND_INCOMPATIBLE_WITH_DIFFERENCING`） |
| Prophet | growth=linear, seasonality_mode=additive, daily/weekly=auto | changepoint_prior_scale, seasonality_prior_scale, n_changepoints, daily_fourier_order=4, holiday_country=auto, random_seed=42 | 训练段仅拟合一次并序列化；测试直接加载该模型，不提供滚动重拟合、残差校准或不确定性区间参数；logistic 需要 cap/floor（由数据自动取上限并在快照记录） |
| Random Forest | n_estimators=200, max_depth=10, min_samples_split=2 | max_features, min_samples_leaf, bootstrap, random_state, n_jobs, multi_output_strategy | 无 epoch 概念（不显示训练曲线） |
| XGBoost | n_estimators=300, max_depth=6, learning_rate=0.05 | subsample, colsample_bytree, reg_lambda, reg_alpha, tree_method, early_stopping_rounds | 记录真实迭代指标；无 eval_set 时不伪造曲线 |
| LightGBM | n_estimators=300, num_leaves=31, learning_rate=0.05 | max_depth, feature_fraction, bagging_fraction/freq, min_child_samples, early_stopping_rounds | `num_leaves ≤ 2^max_depth`（否则 Error）；bagging_freq=0 时 bagging_fraction 不生效 → Warning |
| MLP | hidden_layers=2, hidden_units=128, dropout=0.2, learning_rate=0.001 | activation, epochs=100, batch_size=64, early_stopping, patience, weight_decay | dropout ∈ [0,1)；epochs > 500 → Warning |
| RNN | hidden_size=64, num_layers=2, dropout=0.2, learning_rate=0.001 | nonlinearity, epochs, batch_size, gradient_clip, early_stopping | num_layers=1 且 dropout>0 → Warning（层间 dropout 不生效） |
| LSTM | hidden_size=128, num_layers=2, dropout=0.2, learning_rate=0.001 | bidirectional, epochs, batch_size, weight_decay, gradient_clip, early_stopping | 同上 |
| GRU | hidden_size=128, num_layers=2, dropout=0.2, learning_rate=0.001 | epochs, batch_size, gradient_clip, early_stopping | 同上 |
| Transformer | d_model=128, n_heads=8, encoder_layers=3, dropout=0.1 | dim_feedforward, learning_rate, positional_encoding, warmup, epochs, batch_size, early_stopping | **`d_model % n_heads == 0`**（否则 Error `DIVISIBLE`，并给出最近的合法取值） |
| TimesFM | checkpoint_id, mode=zero_shot, effective_context_length=0(自动) | device, dtype, inference_batch_size, normalize_input | checkpoint 未下载 → `CHECKPOINT_UNAVAILABLE`；依赖未安装 → `DEPENDENCY_MISSING`；`device=cuda` 但无 CUDA → Error |
| Chronos | checkpoint_id, mode=zero_shot, effective_context_length=0(自动) | prediction_mode(median/mean), device, dtype, inference_batch_size, temperature(仅采样变体可见) | 同上；Bolt 变体不显示 temperature |

通用规则：

* **Epochs / 迭代数** 只对真正有 epoch 的模型显示；ARIMA / Prophet / Random Forest / 两个 Zero-shot 大模型都不显示训练曲线。
* **H（预测长度）** 永远继承 Dataset（只读），训练面板不允许改动。
* `batch_size > 训练样本数` 是 **Warning**（本实现使用完整批次），不是非法值。

## 3. 能力与动态状态

`GET /api/models/foundation` 返回真实检测结果（依赖是否安装、有哪些 checkpoint、是否已缓存、设备与许可）。
前端据此渲染 checkpoint 下拉框、设备选项与 `supports_finetune`，不硬编码不存在的能力。

关键字段：

* `package_installed`：官方推理包（`timesfm` / `chronos`）是否可用。
* `checkpoints[].available`：该权重是否已在本地缓存目录（`models_cache/hf`）中。
* `device_available`：`{cuda, device, torch}`，无 CUDA 时 `device=cuda` 会被判为不可运行。
* `supports_finetune`：当前为 `false`（版本未确证支持 + 未实现），UI 不会显示可用的微调开关。

## 4. 实测记录（本机：i5-1135G7 / 16 GB / 无独显 CPU）

| 算法 | 实测结果（ZTE 370102001，1 小时粒度，L=24/H=6/S=2，验证集） |
|---|---|
| ARIMA(3,1,2) | 完成，RMSE ≈ 4.32e6（源单位） |
| Prophet | 完成，RMSE ≈ 2.97e6 |
| Random Forest | 完成，RMSE ≈ 1.84e6 |
| XGBoost | 完成，RMSE ≈ 1.86e6 |
| LightGBM | 完成，RMSE ≈ 1.92e6 |
| MLP | 完成，RMSE ≈ 1.62e6 |
| RNN | 完成，RMSE ≈ 1.97e6 |
| LSTM | 完成，RMSE ≈ 1.76e6 |
| GRU | 完成，RMSE ≈ 1.84e6 |
| Transformer | 完成，RMSE ≈ 1.60e6 |
| TimesFM（2.5-200M，CPU Zero-shot） | 完成，RMSE ≈ 3.32e6；权重加载 ≈ 7 s，12 窗口推理 ≈ 5.6 s |
| Chronos（Bolt-tiny，CPU Zero-shot） | 完成，RMSE ≈ 2.72e6；权重加载 ≈ 13 s，8 窗口推理 ≈ 0.014 s |

Test 集统一评价结果见 `docs/TEST_REPORT.md`（同一 Dataset、同一 H、同一 Test 目标时间）。
