# 模块三至五单区域工作流与全区域清理报告

日期：2026-10-21
开发网站：<http://127.0.0.1:8077>

## 单区域规则

- 模块三只构建一个具体区域的数据集，不再提供预测范围设置。
- 模块四只接受单区域数据集；单模型和“全部模型”均作用于该数据集唯一区域。
- “全部模型”批次固定为同一区域的 12 个模型实验。
- 模块五只支持单区域评估与比较，可从 Batch 加载同一区域的成功实验。
- 模块五空间评估 Tab 和全区域汇总入口已删除。
- 后端对旧客户端提交的 `scope=all` 请求返回 `MULTI_REGION_REMOVED`，不能仅靠隐藏前端绕过。

## 清理前范围

| 类型 | 总数 | 单区域 | 全区域 |
|---|---:|---:|---:|
| 数据集 | 15 | 14 | 1 |
| 实验 | 65 | 64 | 1 |
| 批量任务 | 6 | 5 | 1 |
| 评价 | 5 | 4 | 1 |
| 区域模型 | 152 | 64 | 88 |
| 评价成员 | 47 | 46 | 1 |
| 预测记录 | 19,080 | 13,800 | 5,280 |

全区域记录：

- Dataset：`DS-MILANO-ALL-01M5293ETPAY`（显示 ID `DS-MILANO-REGIONS-0006`）
- Experiment：`EXP-LIGHTGBM-01M5293EXECJ`（显示 ID `EXP-MILANO-REGIONS-LIGHTGBM-0001`）
- Batch：`BATCH-01M5293TQDB2G75Z`
- Evaluation：`EVAL-01M5EKNJF7BCCSD2`

清理前数据库备份：

```text
E:\codex\codex10.16\data\backups\tn_traffic-before-all-region-cleanup-20261021T124242962609Z.db
```

## 实际删除

| 数据 | 删除数 |
|---|---:|
| 数据集 | 1 |
| 实验 | 1 |
| 区域模型 | 88 |
| 批量任务 | 1 |
| 评价 | 1 |
| 评价成员 | 1 |
| 预测记录 | 5,280 |
| 任务 | 2 |
| 历史 ID 映射 | 91 |
| 审计事件 | 2 |
| 专属文件/目录 | 91 |

清理了数据集工件目录、LightGBM 模型目录、88 个区域模型文件、训练日志和模型缓存相关路径。

## 清理后状态

| 类型 | 保留数 |
|---|---:|
| 数据集 | 14 |
| 实验 | 64 |
| 批量任务 | 5 |
| 评价 | 4 |
| 区域模型 | 64 |
| 评价成员 | 46 |
| 预测记录 | 13,800 |

验证结果：

- 所有历史 `scope` 均为 `single`。
- 全区域数据集、实验、批次、评价数量均为 0。
- `PRAGMA foreign_key_check` 返回 0 行。
- 区域模型、评价成员均无孤立记录。
- 全区域专属数据集目录、模型目录和日志文件均不存在。
- 所有单区域历史、模型文件和评价记录均保留。

## 测试结果

| 测试 | 结果 |
|---|---|
| 完整后端 pytest | 165 passed，2 条既有 ARIMA 警告 |
| 前端类型检查 | passed |
| 前端生产构建 | passed |
| 单区域工作流 Playwright | 8/8 passed |
| 模块四页面 Playwright | 16/16 passed |
| 单区域 ARIMA 实际训练 | Completed，1 个区域、3 条真实日志；验收后已清理测试记录 |
| 单区域 12 模型批次 | `BATCH-ZTE-370102001-MODELS-0004`，12 个成员 |
| 单区域多模型评估 | `EVAL-01M5EK6NFGA273NE`，10 个实验成员 |

## 修改文件

- `backend/app/services/validation.py`
- `backend/app/services/datasets.py`
- `backend/app/api/experiments_api.py`
- `backend/app/api/batches_api.py`
- `backend/app/api/evaluations_api.py`
- `backend/app/db/maintenance.py`
- `backend/app/main.py`
- `frontend/src/pages/DatasetPage.tsx`
- `frontend/src/pages/Training.tsx`
- `frontend/src/pages/Evaluation.tsx`
- `frontend/tests/check_single_region_workflow.mjs`
- `frontend/tests/ui_check.mjs`
- `backend/tests/test_m4_training_history.py`
- `backend/tests/test_validation.py`
- `backend/tests/test_readable_ids_and_native.py`
- `backend/tests/test_single_region_cleanup.py`
- `backend/tests/verify_single_region_workflow.py`
- `README.md`
- `docs/USER_GUIDE.md`
- `docs/ARCHITECTURE.md`
- `AGENTS.md`

## 未完成事项

本轮要求范围内没有未完成功能。最终安装包信息将在安装验收完成后更新到本报告。
