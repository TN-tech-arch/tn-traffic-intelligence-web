# 模块三至模块五单区域工作流交付报告

日期：2026-10-21

开发网站：<http://127.0.0.1:8077>

安装包版本：3.2.0

功能实现提交：`c193b6f098a8450a9104fc2716cc81f521c6764a`

批次事务与最终安装验收提交：`a10e94524a5bd102938ce8cf7ccd89445be59338`

## 最终工作流

- 模块三只允许一个真实区域，保留 L/H/S、时间顺序划分、滑动窗口预览、数据质量、数据集管理和历史记录。
- 模块四只接受模块三构建的单区域数据集；单模型和“全部模型”都作用于当前区域。
- “全部模型”固定在同一区域规划 12 个独立实验，不表示训练全部区域。
- 模块五只支持单区域评估与比较，可从历史批次加载所选区域的成功实验。
- 全区域评估、空间评估、空间聚合和相关入口已删除。
- 旧客户端提交 `scope=all` 会被模块三、四、五的后端拒绝；历史列表 API 只返回 `scope=single` 记录。

## 全区域历史清理

清理以数据库 `scope` 和真实关联关系为依据，不使用 ID 字符串猜测范围。

数据库备份：

```text
E:\codex\codex10.16\data\backups\tn_traffic-before-all-region-cleanup-20261021T124242962609Z.db
```

清理前全区域记录：

- Dataset：`DS-MILANO-ALL-01M5293ETPAY`
- Experiment：`EXP-LIGHTGBM-01M5293EXECJ`
- Batch：`BATCH-01M5293TQDB2G75Z`
- Evaluation：`EVAL-01M5EKNJF7BCCSD2`

清理数量：

| 对象 | 删除数 |
|---|---:|
| 全区域数据集 | 1 |
| 全区域实验 | 1 |
| 区域模型 | 88 |
| 全区域批次 | 1 |
| 全区域评价 | 1 |
| 评价成员 | 1 |
| 预测 | 5,280 |
| 任务 | 2 |
| 历史 ID 映射 | 91 |
| 审计事件 | 2 |
| 专属文件/目录 | 91 |

清理后保留并可继续使用：

| 对象 | 保留数 |
|---|---:|
| 单区域数据集 | 14 |
| 单区域实验 | 64 |
| 单区域批次 | 5 |
| 单区域评价 | 4 |
| 区域模型 | 64 |
| 评价成员 | 46 |
| 预测 | 13,800 |

完整性审计结果：

- 14 个数据集目录、64 个模型文件和 64 份训练日志与数据库逐一对应。
- 4 个评价的预测均属于单区域，未发现跨区域引用。
- `PRAGMA foreign_key_check` 返回 0 行。
- 当前数据库的非 `single` 数据集、实验、批次和评价均为 0。
- 单区域历史记录、模型、日志和评价未删除。

## 本轮发现并修复的问题

安装版执行“全部模型”时曾返回 `database is locked`。根因是批次事务已经持有 SQLite 写锁，却在新连接中逐个分配 EXP ID，形成同一批次内的自锁。

修复方式：在同一批次事务连接内调用 `readable_id_on_connection` 分配 12 个 EXP ID，保留可读 ID 持久化序列和删除后不复用规则。新增 `test_batch_single_region_transaction.py` 防止回归。

## 自动化测试结果

| 测试 | 结果 |
|---|---|
| 完整后端 pytest | 166 passed，2 条既有 ARIMA 数值警告 |
| 前端 TypeScript + Vite 生产构建 | passed |
| 开发站模块四 Playwright | 16/16 passed |
| 开发站单区域工作流 Playwright | 8/8 passed |
| 单区域 API 验证脚本 | passed |
| 开发站 12 模型历史批次 | 12 个成员 |
| 开发站单区域多模型评价 | 10 个成员 |

安装包完整验收最终结果：

| 场景 | 实际结果 |
|---|---|
| 静默安装、迁移、启动 | passed |
| 真实数据基线 | 3 个数据源、459 个有效时序区域、473 个 GIS 区域 |
| 模块三 7 天真实范围预览 | 147 个有效测试窗口，X/Y = 24/6 |
| 模块三数据集构建 | `DS-MILANO-ADRIANO-0001` |
| 模块四单模型训练 | Random Forest Completed，日志和模型文件已保存 |
| 模块五单模型评价 | 882 条真实预测 |
| 模块四单区域全部模型批次 | `BATCH-MILANO-ADRIANO-MODELS-0001`，12/12 Completed |
| 模块五单区域多模型评价 | 12 个成员、10,584 条真实预测 |
| 模块四安装版 Playwright | 16/16 passed |
| 单区域安装版 Playwright | 8/8 passed |
| 安装版数据库审计 | 非单区域记录 0，外键异常 0 |
| 打包后历史 ID 迁移 | 数据集 15、聚类 10、实验 96、批次 6、问题 0 |
| 安装版卸载 | 自动卸载成功，安装目录无残留 |

安装验收最终输出：

```text
INSTALL / RUN / UNINSTALL VERIFICATION PASSED
```

## Windows 安装包

```text
E:\codex\codex10.16\packaging\dist\TN-Traffic-Intelligence-Setup-3.2.0.exe
```

- 版本：3.2.0
- 大小：1,151,953,782 字节（约 1,098.6 MB）
- SHA256：`1D9CEA2C596ACEACB65F2257233E608990FAEFA0F52B327C2FFA03805173AEA1`
- 安装包已包含 Python 运行时、应用依赖及已验证的 Chronos/TimesFM 默认权重。
- 安装暂存目录中的 `frontend/dist`、批次事务修复和新增回归测试与源码哈希一致。

## 主要修改文件

- `backend/app/api/batches_api.py`
- `backend/app/services/validation.py`
- `backend/app/services/datasets.py`
- `backend/app/api/experiments_api.py`
- `backend/app/api/evaluations_api.py`
- `backend/app/db/maintenance.py`
- `backend/app/main.py`
- `frontend/src/pages/DatasetPage.tsx`
- `frontend/src/pages/Training.tsx`
- `frontend/src/pages/Evaluation.tsx`
- `frontend/tests/check_single_region_workflow.mjs`
- `backend/tests/test_batch_single_region_transaction.py`
- `backend/tests/test_single_region_cleanup.py`
- `backend/tests/verify_single_region_workflow.py`
- `packaging/build_package.ps1`
- `packaging/test_install.ps1`
- `scripts/audit_single_region_db.py`
- `docs/FULL_REGION_CLEANUP_PLAN.md`
- `docs/SINGLE_REGION_WORKFLOW_REPORT.md`

## 开发站最终状态

- `http://127.0.0.1:8077/api/health` 返回 `status=ok`、版本 3.2.0、数据库正常。
- 当前数据库为 14 个数据集、64 个实验、5 个批次、4 个评价，全部为单区域。
- 模块四页面检查 16/16、单区域工作流检查 8/8 再次通过。

## 未完成事项

本轮要求范围内没有未完成或未验证功能。工作区仅保留了与本任务无关、且不属于本次提交的 Word 临时文件删除状态。
