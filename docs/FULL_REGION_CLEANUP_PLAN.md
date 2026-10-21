# 全区域历史清理计划

生成时间：2026-10-21
清理原则：按数据库 `scope` 字段和真实关联关系识别，不根据 ID 字符串猜测。

## 安全备份

```text
E:\codex\codex10.16\data\backups\tn_traffic-before-all-region-cleanup-20261021T124115Z.db
```

## 待删除记录

| 资源 | 内部 ID | 可读 ID | 范围 | 关联 |
|---|---|---|---|---|
| Dataset | `DS-MILANO-ALL-01M5293ETPAY` | `DS-MILANO-REGIONS-0006` | all，88 区域 | 1 个全区域实验、1 个全区域批次、1 个全区域评价 |
| Experiment | `EXP-LIGHTGBM-01M5293EXECJ` | `EXP-MILANO-REGIONS-LIGHTGBM-0001` | all | 88 条区域模型 |
| Batch | `BATCH-01M5293TQDB2G75Z` | `BATCH-MILANO-REGIONS-MODELS-0001` | all | 当前无成员实验 |
| Evaluation | `EVAL-01M5EKNJF7BCCSD2` | 无独立可读 ID | all | 1 个成员实验、5,280 条预测 |

## 关联明细

- `experiment_region_models`：88 条，全部属于 `EXP-LIGHTGBM-01M5293EXECJ`。
- `evaluation_experiments`：1 条，引用 `EXP-LIGHTGBM-01M5293EXECJ`。
- `evaluation_predictions`：5,280 条，全部属于 `EVAL-01M5EKNJF7BCCSD2`。
- `jobs`：2 条，分别为全区域实验任务和全区域评估任务。
- `history_id_migrations`：1 条 dataset、1 条 experiment、1 条 batch、88 条 region_experiment。
- `audit_events`：1 条全区域实验完成事件。
- 文件：
  - `data/artifacts/datasets/DS-MILANO-ALL-01M5293ETPAY/`
  - `data/artifacts/experiments/EXP-LIGHTGBM-01M5293EXECJ/`
  - `data/artifacts/logs/EXP-LIGHTGBM-01M5293EXECJ.jsonl`

## 保留检查

- 引用全区域数据集的其他单区域实验：0。
- 引用全区域数据集的其他单区域评价：0。
- 全区域评价中引用非全区域实验的成员：0。
- 清理后保留所有 `scope='single'` 的数据集、实验、批次、评价、预测、日志和模型工件。

## 执行顺序

1. 在单个数据库事务中删除预测、评价成员、评价、任务、区域模型、实验、批次和数据集。
2. 删除对应 ID 映射、迁移问题、审计事件和队列任务。
3. 清理专属数据集目录、模型目录和训练日志。
4. 执行外键检查、孤儿检查和单区域记录计数核对。
5. 输出实际删除数量与保留数量。
