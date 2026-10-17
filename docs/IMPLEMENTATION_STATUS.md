# 实现状态（IMPLEMENTATION_STATUS）

状态定义：**Implemented** = 代码已实现；**Verified** = 已真实运行并留有证据；**Blocked** = 受外部条件阻塞。
“Implemented 但未 Verified”的项目会明确标注，绝不提前打勾。

## 阶段总览

| 阶段 | 内容 | 状态 | 证据 |
|---|---|---|---|
| P0 | 工程初始化、依赖锁定、数据导入校验、数据库迁移、测试框架 | Verified | `scripts/import_data.ps1` 输出；`backend/tests/test_api.py::test_sources_match_the_real_data_baseline` |
| P1 | TN 品牌资产、两行导航、Home、三栏模板、统一设计 Token | Verified | `data/screenshots/01-home.png`；`frontend/tests/ui_check.mjs` 35/35 |
| P2 | M1 时空/空间/跨地点分析、M2 四种真实聚类 | Verified | `data/screenshots/02-module1-exploration.png`、`03-module2-clustering.png`；`/api/clusters/run` 真实运行 |
| P3 | M3 滑窗/切分/因果预处理/三个预览/Dataset ID/管理 | Verified | `data/screenshots/04-module3-dataset.png`；`backend/tests/test_windows.py`；端到端脚本构建真实 Dataset |
| P4 | 10 个常规算法适配器 + 真实训练 Worker + Experiment ID | Verified | `backend/tests/test_adapters.py`；`data/logs/e2e_smoke.out.log` |
| P5 | TimesFM / Chronos 官方权重真实 Zero-shot | Verified | `docs/MODEL_REGISTRY.md` 实测记录；`backend/tests/test_adapters.py::test_foundation_adapters_use_real_weights_or_report_unavailable` |
| P6 | All Models：Batch ID → 12 Experiment ID、逐区域任务、停止与失败处理 | Verified | `data/logs/e2e_smoke.out.log`（12/12 Completed）；`data/logs/verify_all_regions.log`（计划 1056/2676/1776、批次停止） |
| P7 | M5 真实 Test 推理、四视图、三 Tab + 历史管理、Evaluation ID | Verified | `data/logs/e2e_smoke.out.log`（12 模型排名、3600 条预测）；`06-module5-evaluation.png` |
| P8 | 安装包、文档、51 项验收 | 部分 Verified | 安装包实测安装/运行/卸载（`data/logs/install_test.log`）；公网部署 Blocked |

## 功能清单

| 功能 | 状态 | 说明 |
|---|---|---|
| 六文件真实导入与指纹校验 | Verified | 8928/8928/2784 时点；88/88、223/223、148/162；ZTE 735 零值、14 No Data |
| 原生/30min/1h/1day 重采样（sum/mean） | Verified | 不完整桶记为缺失 |
| GIS 多边形 + No Data 渲染 | Verified | Leaflet Canvas 渲染，88/223/162 多边形与真实指标涂色 |
| M1 三个右侧 Tab | Verified | 浏览器测试逐项断言 |
| M2 四种聚类 + 四个 Tab + 质量指标 N/A 语义 | Verified | DBSCAN 噪声 -1；簇类型标注为推测 |
| M3 L/H/S、70/15/15、无泄漏切分、因果插值、标准化 | Verified | 单测 + 端到端 |
| M3 Dataset ID、原子构建、Archive/Delete 依赖保护 | Verified | 失败无半成品；被引用数据集删除返回 409 |
| M4 12 算法注册表与参数 schema | Verified | `test_registry_has_exactly_twelve_algorithms` 等 |
| M4 12 算法真实训练/推理 | Verified | 见 MODEL_REGISTRY 实测表 |
| M4 All Models（Single 与 All Regions） | Verified | Single: 12/12 完成；All Regions: 计划 1056/2676/1776，停止流程实测 |
| M4 停止/重试/复制草稿/归档/删除 | Verified | Stop 后端确认；Duplicate 不产生新 ID；被评价引用的实验禁止硬删 |
| M5 held-out Test 公平评价与排名 | Verified | 同一 Dataset/H/Test 锚点；不兼容组合被阻挡或降级为警告 |
| M5 指标（MAE/RMSE/sMAPE/R²）与边界 | Verified | 手工样例单测；sMAPE 0/0 记 0；常量真值 R²=N/A |
| M5 四视图 + 三 Tab + 历史管理 + CSV 导出 | Verified | 浏览器测试 + `/{id}/export` |
| M1 日期时间范围 + 双向索引同步 + 统一时间口径 | Verified | `test_m1_time_range.py`（11 项）、`test_m1_api.py`、浏览器 `check_m1_insights.mjs` |
| M1 三张图自动分析（Hourly / Weekday / ACF & Trend） | Verified | `test_m1_insights.py`（26 项）+ 截图 `data/screenshots/12-m1-insights.png` |
| M1 ACF Max Lag、置信带与周期检测 | Verified | 构造正弦序列检出 24h 周期；白噪声不产生周期结论；覆盖不足时说明原因 |
| M1 最后一轮修复（截面范围夹紧 / Auto Max Lag / 周期候选分级） | Verified | `check_m1_fixes.mjs` 12/12 + `pytest 110 passed` |
| M1 布局 25/40/35 + 三个二级 Tab + 放大查看 + 响应式 | Verified | `check_m1_layout.mjs` 13/13；1200/900px 无横向溢出 |
| 全参数实时校验（前端字段下方 + 后端强制） | Verified | `ui_check.mjs` + `test_api.py` 负向测试（dropout=1.5、L=0、d_model/n_heads） |
| 结构化错误（path/code/severity/message/suggestion/request_id） | Verified | main.py 异常处理器；失败无副作用（事务 + 临时目录） |
| 品牌资产（SVG/ICO/横幅、无卡通人物） | Verified | `frontend/public/brand/*`；UI 测试断言无头像资源 |
| Windows 安装包（安装/运行/卸载） | Verified | `packaging/dist/TN-Traffic-Intelligence-Setup-3.1.0.exe` + `test_install.ps1` |
| TimesFM / Chronos Fine-tuning | Implemented=false (Blocked) | 版本未确证支持 + 未实现；UI 保持 Disabled，不显示伪造 epoch |
| 公网 HTTPS 部署 | Blocked | 需要服务器/域名/凭据授权（见 DEPLOYMENT.md 第 4 节） |
| GPU 性能数据 | Blocked | 本机无 CUDA；已在报告中标注全部为 CPU 实测 |
| All Regions × All Models 全量 1000+ 任务实跑 | 部分 Verified | 计划数与停止流程已实测；全量训练需要数小时 CPU 时间，按 spec 要求报告“设计容量 vs 实测批次”，不虚报完成 |

## 已知限制与诚实声明

1. **大模型权重许可**：仅使用 Apache-2.0 的 Chronos-Bolt 与 TimesFM 2.5。TimesFM 3.0 系列权重在官方渠道受限/需授权，本项目不使用、不下载、不宣称使用。
2. **数据单位**：Milano/Trentino 物理单位未证实，ZTE 为 4G 下行流量；跨来源比较只做归一化形状，不做绝对量纲比较。
3. **CPU 推理速度**：TimesFM 2.5-200M 在无 GPU 机器上约为每窗口 0.5 秒；大批量任务耗时较长，界面会如实说明“无法可靠估计耗时”。
4. **全量批次**：Milano All Regions × All Models 计划 1056 个区域-算法任务，本报告只声明“计划与队列机制已实测”，不声明已全部训练完成。
