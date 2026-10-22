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
