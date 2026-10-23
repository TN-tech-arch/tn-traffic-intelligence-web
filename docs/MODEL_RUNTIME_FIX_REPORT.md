# 预测模型运行问题检查与修复报告

日期：2026-10-22

## 结论

在完整 Milano/ADRIANO 数据集（8,928 个十分钟时间点）上，ARIMA 原先运行十余分钟仍未完成。修复后，同一数据集、同一参数、同一验证窗口数量的真实训练耗时降至 33.95 秒。

## ARIMA 根因

滚动验证循环在每一行重复执行：

```python
fitted.append(series[train_end + 1:origin + 1], refit=False)
```

`statsmodels` 的 `append()` 只应接收尚未加入模型状态的新观测。旧实现每次重新追加累计区间，导致：

- 已追加观测被重复加入；
- 模型状态持续膨胀；
- 验证预测从线性增量退化为近似二次增长；
- 验证阶段仍可能影响滚动预测状态。

修复后记录最后已经追加的位置，每次仅追加新增观测：

```python
increment = series[last_origin + 1:origin + 1]
fitted = fitted.append(increment, refit=False)
last_origin = origin
```

预测阶段还改为通过已保存参数调用 `model.smooth(params)` 恢复状态，避免重复执行参数优化。

## 进度问题

训练 worker 原先在验证预测阶段传入空进度回调，页面因此长期停留在拟合完成时的 80%。

修复后：

- 模型拟合映射到 0%–80%；
- 验证预测映射到 80%–98%；
- 保存完成后更新到 100%；
- 模块五测试推理也会持续上报当前实验和区域进度。

## 其他模型检查

- Random Forest、XGBoost、LightGBM、MLP、RNN、LSTM、GRU、Transformer：验证窗口采用矩阵批量推理，没有逐窗口重复追加状态的问题。
- Prophet：修复预测阶段布尔型 `daily_seasonality` / `weekly_seasonality` 与训练阶段解析规则不一致的问题。
- XGBoost：修复 `early_stopping_rounds` 只读取但未传入估计器的问题。
- Chronos、TimesFM：使用分块批量推理，未发现同类状态膨胀；修复最后一块可能上报超过 100% 的进度上限。
- Chronos、TimesFM：在 worker 进程内缓存已加载的官方 checkpoint，批量训练后的评估阶段直接复用，避免重复读盘和初始化。

## Prophet 滚动校准改进

原 Prophet 预测只在训练段拟合一次，之后直接预测测试集全部目标时间，不使用预测起点之前已经发生的验证/测试观测。同时 `refit_interval` 参数虽存在，但预测代码没有使用。

改进后：

- 默认模式仍只拟合一次，但每个预测窗口使用最近 6 个已观测点的残差中位数校正预测水平；
- `refit_interval > 0` 时，按指定间隔使用截止预测起点的真实历史重新拟合；
- 每个窗口只使用目标时间之前的观测，不读取未来目标；
- 关闭不参与点预测的 Prophet 不确定性采样，减少无效计算。

真实指标对比：

| 数据集 | 修复前 MAE | 修复后 MAE | 修复前 RMSE | 修复后 RMSE | 修复前 R² | 修复后 R² |
|---|---:|---:|---:|---:|---:|---:|
| Milano/ADRIANO 验证集 | 372.15 | 146.55 | 443.17 | 181.82 | 0.359 | 0.892 |
| ZTE `refit_interval=24` 验证集 | 2,231,635.32 | 1,364,497.07 | 2,970,098.24 | 1,741,353.94 | 0.765 | 0.919 |

新增真实实验结果：

- `EXP-MILANO-ADRIANO-PROPHET-0003`：默认滚动残差校准。
- `EXP-ZTE-370102001-PROPHET-0009`：`refit_interval=24` 真实重拟合。

评价进度现在同时写入任务记录和评价记录，长耗时的基础模型推理可以在 Module 5 页面看到真实进度。

## 测试结果

- 模型适配器专项测试：`16 passed`
- 完整后端 pytest：`169 passed`，2 条既有 ARIMA 数值警告
- 真实完整数据集 ARIMA：
  - 实验：`EXP-MILANO-ADRIANO-ARIMA-0012`
  - 状态：Completed
  - 耗时：33.948 秒
  - 验证样本：8,004
  - MAE：110.3651
  - RMSE：145.6601
  - R²：0.9308
- 验证阶段观察到页面/API 进度达到 92.144%，随后正常完成，不再固定在 80%。

## 修改文件

- `backend/app/forecast/adapters/statistical.py`
- `backend/app/forecast/adapters/ml.py`
- `backend/app/forecast/foundation.py`
- `backend/app/workers/tasks.py`
- `backend/tests/test_adapters.py`
- `docs/MODEL_RUNTIME_FIX_REPORT.md`
