# Module 2–4 历史 ID 迁移报告

功能提交：`ac88cde`  
迁移日期：2026-10-21  
开发网站：<http://127.0.0.1:8077>

## 迁移原则

- 保留原主键、外键和内部 ULID，不改写内部关联协议。
- 在 `dataset_versions`、`clusters`、`experiments`、`batches` 新增独立的
  `display_id` 业务显示 ID。
- `experiment_region_models.region_experiment_id` 持久化区域级 EXP ID。
- 旧内部 ID 和新显示 ID 均可用于详情、日志、停止、删除、评价和模块间查询。
- 迁移与序号分配在同一 SQLite 事务中完成；重复执行不会重新生成 ID。

持久映射：

```text
data/tn_traffic.db
  history_id_migrations
  history_id_migration_issues
  readable_id_sequences
```

迁移前自动备份：

```text
E:\codex\codex10.16\data\backups\tn_traffic-before-history-id-migration-20261020T154439986505Z.db
```

## 迁移统计

| 记录类型 | 总记录 | 迁移前旧格式 | 迁移前已可读 | 分配显示 ID | 失败 |
|---|---:|---:|---:|---:|---:|
| 数据集 Dataset | 15 | 13 | 2 | 15 | 0 |
| 聚类 Cluster | 10 | 0 | 10 | 10 | 0 |
| 区域级实验 Region EXP | 159 | 159（字段为空） | 0 | 159 | 0 |
| 实验 Experiment | 96 | 96 | 0 | 96 | 0 |
| 批量任务 Batch | 6 | 6 | 0 | 6 | 0 |

共写入 286 条持久映射，无法迁移记录 0 条。

## 迁移示例

| 类型 | 旧内部 ID | 新显示 ID |
|---|---|---|
| 单区域数据集 | `DS-MILANO-SINGLE-01M5A4B11TZ3` | `DS-MILANO-ADRIANO-0038` |
| 全区域数据集 | `DS-MILANO-ALL-01M5293ETPAY` | `DS-MILANO-REGIONS-0006` |
| ZTE 数据集 | `DS-ZTE-SINGLE-01M526EDWPZ6` | `DS-ZTE-370102001-0001` |
| 聚类历史 | `CLUS-MILANO-KMEANS-0014` | `CLUS-MILANO-KMEANS-0014` |
| 单区域实验 | `EXP-ARIMA-01M5A1NG0KW8` | `EXP-MILANO-ADRIANO-ARIMA-0004` |
| 全区域实验 | `EXP-LIGHTGBM-01M5293TQEMV` | `EXP-MILANO-REGIONS-LIGHTGBM-0002` |
| 全区域模型批次 | `BATCH-01M5293TQDB2G75Z` | `BATCH-MILANO-REGIONS-MODELS-0001` |
| 单区域多模型批次 | `BATCH-01M547PCH6DKSEMH` | `BATCH-MILANO-ADRIANO-MODELS-0006` |

区域级实验使用 `EXP-{DATASET}-{REGION}-{MODEL}-{SEQUENCE}`，并继续通过内部
`experiment_id` 关联父实验和 BATCH。

## 关联与数据完整性

- `PRAGMA foreign_key_check`：0 条违规。
- 数据集到实验孤儿记录：0。
- BATCH 到实验孤儿记录：0。
- 区域模型到实验孤儿记录：0。
- Evaluation 到实验/数据集孤儿记录：0。
- 3 个评价、36 个评价成员、10,800 条预测记录保持可读。
- 153 个模型工件引用对应的文件均存在，丢失 0。
- 72 个已实际启动的实验日志文件均存在。
- 24 个无日志记录全部为 `Skipped` 或 `Stopped`，从未开始训练，并非迁移丢失。

## 测试结果

| 测试 | 实际结果 |
|---|---|
| 历史 ID 定向 pytest | 8 passed |
| 完整后端 pytest | 157 passed，2 条既有 ARIMA 警告 |
| 前端 TypeScript 类型检查 | passed |
| 前端生产构建 | passed |
| Playwright 历史 ID 回归 | 8/8 passed |
| Windows 安装/启动/训练/评估/卸载 | passed |
| 安装包内代码对迁移前快照重放 | 15/10/96/159/6，286 mappings，0 issues |

## Windows 安装包

```text
E:\codex\codex10.16\packaging\dist\TN-Traffic-Intelligence-Setup-3.2.0.exe
```

- 版本：`3.2.0`
- 大小：267,850,456 bytes
- SHA256：`BAD2A6FE4BF57F89E7BFCB46646065907961F9735F2AAB9C805C7B8349B1D833`

安装验收实际完成安装、启动、数据基线检查、模块三窗口预览、模块四 Random Forest
训练、模块五完整测试集评估、安装包内迁移代码重放及卸载，未发现失败。

## 浏览器证据

- [模块二历史 ID](../data/screenshots/history-ids-module2.png)
- [模块三数据集历史 ID](../data/screenshots/history-ids-module3.png)
- [模块四 BATCH/EXP 历史 ID](../data/screenshots/history-ids-module4.png)
- [模块五关联显示 ID](../data/screenshots/history-ids-module5.png)
- [Playwright 结果 JSON](../data/screenshots/history-id-regression.json)

## 未完成事项

无未迁移或无法迁移的历史记录。旧 ID 兼容查询、批次父子关联、模块三至模块五数据访问
均已通过实际数据库和运行中站点验证。
