# 验收报告（ACCEPTANCE_REPORT）— ACCEPTANCE_CHECKLIST 51 项

环境与命令汇总见 `docs/TEST_REPORT.md`。每项的证据都来自真实执行（日志/截图/数据库记录）。
状态：**Pass** = 已实测通过；**Partial** = 部分验证（说明差异）；**Blocked** = 外部条件不允许，已如实标注。

| 状态 | 编号 | 实测命令 / 依据 | 结果 |
|---|---|---|---|
| ☑ Pass | T01 | `scripts\import_data.ps1`；`test_api.py::test_sources_match_the_real_data_baseline` | 三组六文件全部成功；时点 8928 / 8928 / 2784；SHA-256 与 `DATA_MANIFEST_SHA256.txt` 一致 |
| ☑ Pass | T02 | `/api/data/regions`、`/api/data/geometry`；UI 测试断言 88 个多边形 | Milano 88/88、Trentino 223/223、ZTE 148/162；14 个 No Data 在质量报告、地图（灰蓝）与列表中标出 |
| ☑ Pass | T03 | 质量报告 `zero_count=735`、`nan_count=0` | ZTE 真实零值保留（不视为 NaN）；缺失点为 0；插值/丢弃规则记录在 Dataset 质量报告中且不越界 |
| ☑ Pass | T04 | `ui_check.mjs`：GIS 常驻、切 Tab 不消失、88 多边形渲染；`/api/analysis/spatial` 随 `time_index` 变化 | 地图选择区域/时间 → 右侧曲线与真实统计随之变化 |
| ☑ Pass | T05 | `/api/analysis/compare` 返回 z-score 归一化形状 + 免责声明；UI Tag「时间与单位免责声明」 | 明确禁止原始值同量纲比较，并说明时段不重叠与 ZTE 为 4G 下行流量 |
| ☑ Pass | T06 | `/api/clusters/run` + `services/clustering.py` | K-Means/Spectral/Hierarchical/GMM 均真实运行（sklearn）；谱聚类的 affinity、邻居数与 gamma 实际生效；有效簇不足 2 时质量指标返回 N/A 并给原因 |
| ☑ Pass | T07 | 簇摘要 `inferred_zone_type.is_inferred=true` + 免责声明 | 标签明示为推测；ZTE 无时序区域不进入聚类（`dropped_regions` / `no_data_regions` 记录） |
| ☑ Pass | T08 | `test_windows.py`（窗口定义/边界）+ UI 三个预览区 | X/Y 边界、时间与步长、首末合法窗口均与规范一致；L=0 在前端与后端均被拒绝 |
| ☑ Pass | T09 | `test_ratio_sum_must_be_one`、`test_targets_never_cross_split_boundaries`、UI 比例报错 | 默认 70/15/15；分割无泄漏；各 split 实际窗口数与预览一致；非法配置阻止 Save（前端禁用 + 后端 422） |
| ☑ Pass | T10 | `test_scaler_is_fitted_on_train_only_and_inverts_exactly`、`test_causal_interpolation_*` | Scaler 仅用训练段拟合且可逆；插值不引用预测起点之后的值（窗口作废）；目标从不用插值值 |
| ☑ Pass | T11 | e2e 构建返回 `DS-ZTE-SINGLE-…`（Built）；比例非法时 Build 返回 422 且数据集数量不变 | Save 成功产生 Dataset ID；失败无半成品；历史可查；Reset 只改草稿 |
| ☑ Pass | T12 | `test_registry_has_exactly_twelve_algorithms`、`test_registry_exposes_exactly_twelve_models_and_all_models_entry` | 恰好 12 个且分组正确；`All Models` 独立置顶且 `is_algorithm=false` |
| ☑ Pass | T13 | `test_adapters.py::test_standard_adapters_produce_finite_output`（10 个算法参数化） | 每个 adapter 对合法输入产出形状 `[N,H]` 的有限输出；依赖/资源失败如实记录 |
| ☑ Pass | T14 | 注册表 schema 校验（每字段均有 help_zh）+ UI 字段帮助测试 | Basic/Advanced 均可调、范围与说明齐全、非法参数阻止运行 |
| ☑ Pass | T15 | UI：d_model=130 & n_heads=8 → n_heads 下方报错；改 128 后立即清除；`test_transformer_d_model_must_be_divisible_by_heads` | 具体报错并给出最近合法取值；修复后可运行 |
| ☑ Pass | T16 | `test_foundation_adapters_use_real_weights_or_report_unavailable`（真实权重通过） | TimesFM（google/timesfm-2.5-200m-pytorch，Apache-2.0）与 Chronos（amazon/chronos-bolt-tiny，Apache-2.0）Zero-shot 真实推理成功，记录 checkpoint/设备/许可 |
| ☑ Pass | T17 | `test_foundation_adapter_reports_missing_weights_instead_of_faking`；`/api/models/foundation` 的 available 标记 | 缺权重/未知 checkpoint/缺依赖/无 CUDA 时明确报错或标记 Unavailable，不冒充 Completed，且不显示 epoch |
| ☑ Pass | T18 | e2e：ARIMA 单区单算法 → 1 Experiment ID，工件落盘可再加载（M5 直接复用） | 通过 |
| ☑ Pass | T19 | `verify_all_regions.py`：LightGBM All Regions → 88 个 region records，88/88 Completed | 每个区域独立建模；失败区域可单独审计（`region_models[].error`） |
| ☑ Pass | T20 | e2e：All Models Single → 1 Batch ID + 12 Experiment ID，12/12 Completed | 12 组参数独立、按队列执行、各状态可查 |
| ☑ Pass | T21 | `verify_all_regions.py` 计划检查 | Milano 1056 / Trentino 2676 / ZTE 1776；每算法 N 子记录；不跨地点 |
| ☑ Pass | T22 | `verify_all_regions.py` 批次创建 + Stop | Preflight 逐模型提示；Stop 由后端确认，未开始任务 `Stopped`，已完成保留 |
| ☑ Pass | T23 | Worker 独立进程 + `jobs` 表心跳；`recover_stale_jobs` 把过期 Running 改判 | 浏览器刷新/关闭不影响后台执行；状态真实持久化（Job 表 + 审计事件） |
| ☑ Pass | T24 | DL 记录真实 `train_loss/validation_loss`（每 epoch）；Boosting 记录真实迭代指标；ARIMA/Prophet/Zero-shot `no_epochs=true` | 无伪造曲线 |
| ☑ Pass | T25 | `/api/experiments/{id}/duplicate` 返回 `creates_experiment_id=false`；UI Duplicate 只填草稿 | 真正 Run 时才创建新 Experiment ID |
| ☑ Pass | T26 | `/api/evaluations/validate` 的 `eligible_experiments` / `non_eligible`（含原因） | Batch ID 一键载入成功模型；失败/跳过列原因；不可评价者不进入排名 |
| ☑ Pass | T27 | e2e 评价：12 个实验全部来自同一 Dataset、同一 H、同一 Test 目标时间；`same_dataset/same_scope/standard_ranking_allowed` | 不同协议会被阻挡或降级为警告，不混排 |
| ☑ Pass | T28 | `test_metrics.py`（手工样例）+ 评价结果表 | MAE/RMSE/sMAPE/R² 与手工计算一致；sMAPE 0/0 记 0；常量真值 R²=N/A |
| ☑ Pass | T29 | M5 四视图（含 4 种空间图层）+ Macro/Pooled 区分 | 区域覆盖、No Data、失败均在图中与指标中区分（不把无数据区填 0） |
| ☑ Pass | T30 | `test_delete_protection_for_referenced_dataset`（409 DATASET_REFERENCED）；评价删除只删本层 | 引用中的 Dataset/Experiment 不能硬删；Evaluation 删除不影响上游 |
| ☑ Pass | T31 | `ui_check.mjs` 逐项断言 + 截图 | 两行顶栏、六导航、TN 标识、无卡通人物；模块仅三栏；所有规定 Tab 均在 |
| ☑ Pass | T32 | 首页断言 `3,459,12,5`；Recent Activity 来自数据库 | 数字准确；初始为空态（不造假 ID/时间戳/Completed） |
| ☑ Pass | T33 | 源码方式启动（scripts）与安装版启动均实测，完成 Home→M1→M2→M3→M4→M5 真实链路 | 通过 |
| ☑ Partial | T34 | `docker-compose.yml` + `Dockerfile` 已提供，**未在公网部署** | 缺少服务器/域名/凭据授权，未声称已发布网址；正式交付改由路线 A 完成 |
| ☑ Pass | T35 | README、ARCHITECTURE、API、MODEL_REGISTRY、DEPLOYMENT、TEST_REPORT、ACCEPTANCE_REPORT、LICENSE_NOTICES、品牌 SVG/ICO | 文档与 Logo 源文件齐全 |
| ☑ Pass | T36 | 单区域失败不阻塞其余区域；实验状态 Failed/Partial 保留真实错误与日志；重启后 Job 自洽 | 通过（`region_models.error`、`experiments.error`、`jobs.error`、实验日志 jsonl） |
| ☑ Pass | T37 | 空目录初始化：`migrations/001_init.sql`、`requirements.lock.txt`、六文件导入、首个可运行页面 | 从零构建，无旧项目依赖 |
| ☑ Pass | T38 | `packaging/dist/TN-Traffic-Intelligence-Setup-3.1.0.exe` + `packaging\test_install.ps1`（安装→运行→数据基线→卸载全部通过） | 真实 Windows 安装包（含卸载），已满足正式交付要求之一 |
| ☑ Pass | T39 | UI 测试覆盖 Basic/Advanced 切换、Reset、Delete/Archive/Duplicate、Tab、跳转、空态；状态与后端一致 | 通过 |
| ☑ Pass | T40 | `frontend/public/brand/tn-logo.svg`、`tn-favicon.svg`、`packaging/payload/tn.ico`；UI 断言无头像资源 | 通过 |
| ☑ Pass | T41 | `check_environment.ps1` + 安装包在测试目录的干净安装（无预置 venv） | 六数据导入 → M3 → M4 → M5 均可复现；日志已附 |
| ☑ Pass | T42 | e2e + `verify_all_regions.py` + 安装版验证 | Home→M1→M2→M3(Dataset ID)→M4(Batch/Experiment ID)→M5(Evaluation ID) 完整走通；记录在重启后仍存在（SQLite 持久化） |
| ☑ Pass | T43 | 缺依赖/无 checkpoint → Error 与下载指引；非法 L/H/S → 字段错误；停止 → 后端确认；无测试预测 → 明确失败原因 | 均有真实原因与重试动作 |
| ☑ Pass | T44 | 品牌横幅 + 六模块（含 Home）+ 选中态；900px 窄屏折叠为单列；无第四侧栏 | 通过 |
| ☑ Pass | T45 | UI：M1–M5 每个可编辑参数改动后即时校验；`useValidation` 在 schema 变化（切换算法/数据集/区域）后重新校验 | 覆盖 Basic/Advanced 与 All Models 的 12 组；不显示“已通过”直到校验完成 |
| ☑ Pass | T46 | UI：错误在输入框下方（含原因与建议）；Warning 独立配色/图标/文案且不误禁用提交 | 数量：`/api/validation/check` 返回的 warning 与 error 分离；无纯全局模糊弹窗 |
| ☑ Pass | T47 | 前端 `validation/engine.ts` 与后端 `services/validation.py` 使用同一份 registry 元数据；`test_validation.py` 与 UI 测试对比同一输入 | 类型、边界、条件与错误码一致 |
| ☑ Pass | T48 | `test_experiment_run_rejects_dropout_1_5_bypassing_the_frontend`、`test_experiment_run_rejects_transformer_head_mismatch`、比例非法阻止 Build | 直接调用 API 返回 422 字段级错误，不创建 Job/ID/工件，原保存对象不变 |
| ☑ Pass | T49 | UI：切换算法联动隐藏/启用字段；数字输入保留 `""`/`-`/`0.` 中间态；`useValidation` 用请求序号丢弃过期响应 | 未验证状态不显示为绿色通过 |
| ☑ Pass | T50 | UI：All Models 每组显示 `可运行 / N Error / N Warning` 并可定位；`test_all_models_reports_every_algorithm_individually`；批次级 Error 阻止 Run | 跳过项记录 Skipped/Unavailable 与原因，不当作 12 个全部完成 |
| ☑ Pass | T51 | UI：每个字段旁 ⓘ 显示含义/单位/默认/范围/建议；错误通过文字+图标+`aria-invalid`+`aria-describedby` 暴露；键盘可聚焦帮助 | 修复后提示立即更新 |

## 汇总

* **Pass：50 项**，**Partial：1 项（T34 公网部署）**，Blocked 项：TimesFM/Chronos Fine-tuning（不在 51 项必测范围内，已在实现状态中标注）。
* 正式课程交付（T38）：已用**真实 Windows 安装包**满足；安装/运行/卸载均在实机通过。
* 未完成项均已在 `docs/IMPLEMENTATION_STATUS.md` 与 `docs/TEST_REPORT.md` 中列出原因，未做任何虚假声明。
