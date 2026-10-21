# Module 4 预测模型训练重构报告

功能提交：`8a03ef9`
日期：2026-10-21
页面：<http://127.0.0.1:8077/training>

## 页面结构

- 严格两栏布局：左侧配置区与实验历史，中央当前实验详情与训练监控。
- 两栏比例与模块三一致：左侧 `32%`，中央 `68%`。
- 左侧标题不编号：`配置区（Configuration）`、`实验历史（Experiment History）`。
- 中央标题按顺序编号：`1 · 当前实验详情（Current Experiment Details）`、`2 · 训练监控（Training Monitor）`。
- 左侧配置参数不编号，统一使用与模块三相同的 `ParamField` 标签、字体、间距、控件高度和 ⓘ 注释样式。
- 删除右侧独立区域及其中的重复历史、日志和详情面板。
- 实验历史支持数据集、算法、状态筛选和分页。
- 每条实验历史只保留“打开”和“删除记录”两个操作。
- 删除保存模型、复制为草稿、归档和开始评估入口。

## 中央监控

- 顶部只显示实验 ID、算法、状态、开始时间和运行时长。
- 删除参数快照、实验概览、评估指标和独立数据集信息卡片。
- 显示真实总体进度和区域级状态。
- 仅支持单区域训练；同一区域的 12 模型批次使用分页展示成员状态。
- 仅对实际提供 epoch 历史的算法绘制训练/验证 Loss。
- ARIMA、Prophet 等算法明确显示无标准 epoch 过程，不生成模拟曲线。
- 训练日志直接读取后端日志，并支持下载。
- 训练过程与训练日志不再使用二级标签页，在同一页面从上到下排列。
- 训练监控不展示 MAE、RMSE、sMAPE、R² 或测试集预测结果。

## 后端与行为

- 区域开始训练时写入 `Running` 和真实 `started_at`。
- 区域完成、失败或停止时保留开始时间并写入 `ended_at`。
- 批量任务成员和区域摘要返回真实开始/结束时间。
- 删除实验继续使用现有安全规则：有模块五引用时拒绝硬删除；其他实验删除时清理区域记录、作业、日志和模型目录。
- 模块五继续支持通过内部 ID 或可读 EXP ID 关联训练结果。

## 修改文件

- `frontend/src/pages/Training.tsx`
- `frontend/src/styles/global.css`
- `backend/app/api/experiments_api.py`
- `backend/app/api/batches_api.py`
- `backend/app/workers/tasks.py`
- `backend/tests/test_m4_training_history.py`
- `frontend/tests/check_m4_redesign.mjs`
- `packaging/test_install.ps1`

## 实际测试

| 验证项 | 结果 |
|---|---|
| 完整后端 pytest | 161 passed，2 条既有 ARIMA 数值警告 |
| 前端 TypeScript 类型检查 | passed |
| 前端生产构建 | passed |
| 开发站 Playwright | 16/16 passed |
| 安装版 Playwright | 16/16 passed |
| 真实单算法训练 | `EXP-ZTE-370102001-ARIMA-0012` 完成，区域开始/结束时间和日志正确 |
| 失败任务 | `EXP-MILANO-ADRIANO-TIMESFM-0002`，正确显示失败状态 |
| 全部模型批次 | `BATCH-ZTE-370102001-MODELS-0004`，Completed，12 个成员 |
| 模块五关联 | 使用 M4 可读 EXP ID 验证通过 |
| 删除清理 | 测试实验记录、模型目录和日志文件均删除 |

测试训练记录在验收后已删除，不保留为正式历史。

## 浏览器截图

- [新版完成实验页面](../data/screenshots/module4-redesign-final.png)
- [新版历史打开与日志](../data/screenshots/module4-redesign-selected.png)
- [失败任务状态](../data/screenshots/module4-redesign-failed.png)
- [窄屏单栏响应式](../data/screenshots/module4-redesign-responsive.png)

## Windows 安装包

```text
E:\codex\codex10.16\packaging\dist\TN-Traffic-Intelligence-Setup-3.2.0.exe
```

- 版本：`3.2.0`
- 大小：267,851,799 bytes
- SHA256：`3C9E4BE9279844EB3773DAF318AD0F8F00CE87D9B3FE3EFC227AF6E552566D31`

安装验收实际完成安装、启动、模块三预览、模块四训练、模块五评估、安装版模块四
Playwright 回归、迁移快照重放和卸载。

## 未完成事项

本轮要求范围内没有未完成或未验证事项。
