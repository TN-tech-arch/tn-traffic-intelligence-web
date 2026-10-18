# CODEX_START — 全新项目，从零完整开发（TN Traffic Intelligence v3.1）

## 请直接把下面的任务交给 Codex

你是此项目的完整全栈开发执行者。本项目**目前没有开发任何软件**。请在我指定的**空白工程目录**从零创建真实可运行的 `TN Traffic Intelligence（智能流量分析与预测平台）`，**不要把此前的“先审计现有代码、保留已完成模块”流程用于本任务**。完整且最高优先级需求位于项目根目录 `PROJECT_SPEC.md v3.1`，详细验收在 `ACCEPTANCE_CHECKLIST.md`，六份数据在 `data/raw/`，最终视觉参考在 `ui_reference/`。

### 核心要求（所有细节以 PROJECT_SPEC 为准）

1. **必须从零完成整个 Web 全栈软件**：React + TypeScript + Vite 前端、FastAPI + Python 数据/算法服务、数据库与迁移、真实后台任务 Worker、实时状态和测试。工程初始可为空目录，不能因“没有旧代码”而停止。
2. **UI 使用最终确认的蓝白科技风**：上方两行（TN Logo 与城市/道路主题品牌横幅；下一行 Home / Exploration / Clustering / Dataset / Training / Evaluation 六导航）；首页欢迎/数据概览/流程/真实最近记录；模块内部只有左 Configuration / 中 Visualization / 右 Information 三栏，无全局左侧导航；**不放卡通人物/头像**。所有规定的右侧 Tab 与历史管理都要可用。
3. **数据必须真实**：Milano CSV+GeoJSON（88 区、10min）、Trentino（223 区、10min）、ZTE（148 个有时序区域、162 个 GIS 多边形、15min），对 14 个无数据区域标 No Data，保留真实零值。文件中的字段/频率/数量须实际自动检查；不能模拟分析。
4. **M1** GIS + Temporal、Spatial、Multi-City 三右侧 Tab；**M2** K-Means、Spectral Clustering、Hierarchical、GMM 以及三个右侧分析 Tab、中央区域列表和地图/簇指标；**M3** `Single Region / All Regions`、时间分辨率、滑动 L/H/S、70/15/15 默认按时间 Train/Validation/Test、因果预处理、中央三个上下堆叠的真实预览、Dataset ID、三个右侧 Tab 加 Dataset Management。
5. **M4 恰好 12 个算法**：ARIMA、Prophet、Random Forest、XGBoost、LightGBM、MLP、RNN、LSTM、GRU、Transformer、TimesFM、Chronos。各模型核心参数和 Basic/Advanced 可调、参数帮助、预检、训练/执行状态与 Stop、实验快照、日志、历史管理。大模型必须使用合规**真实预训练权重** Zero-shot；仅在版本确实支持时启用 Fine-tuning。所有指标/曲线来源真实计算。
6. **M4 模型选择顶部额外一个 All Models（不是第 13 个算法）**：Single 时 1 Batch ID + 12 Experiment ID；All Regions 时同一数据源 N 区 × 12 算法任务，各算法有独立参数及子模型/区域状态，默认顺序执行，资源预检、确认、Stop/Partial/Skipped/Unavailable 及真实日志可用。All Regions 不是跨城合并也不是联合空间建模。
7. **M5** Single/All、单模型或按 Batch ID 载入多个 Experiment、Full Test 默认、真实 Actual/Predicted、Error、Horizon、All Regions GIS Spatial 四个中央视图；右侧 Metrics/Ranking/Regional Performance 三 Tab + Evaluation History；使用相同 held-out Test 对普通算法与两个大模型公平比较，保存 Evaluation ID。注意 ZTE 真零与 sMAPE 0/0、R² 常数序列等边界。
8. **对象关系** Dataset ID → Experiment ID → Evaluation ID；All Models 的 Batch ID 是关联 12 个算法实验的容器，模型的训练与评估结果不可被 Reset 覆盖；Delete/Archive/Stop/Duplicate 依赖安全。
9. **正式课程交付条件**：完整源代码 **加** 至少一种经真实验收的成果：（A）真正 Windows 安装包，可安装运行且可卸载；或（B）公网可实际访问的 HTTPS 网址且有真实后端功能。`npm run dev`、localhost 和纯静态演示不等于课程交付。任何公网部署/付费资源需先获得授权。提供真实 README、操作指南、架构/API/模型表、部署/许可证说明、测试结果、TN SVG/透明 PNG/Favicon。

### 新增最高优先级：所有参数实时校验（必须实现，不可只做前端）

**完整按 `PROJECT_SPEC.md` 的 3.5、7.7、12.4、13.1/13.4 节执行。所有可编辑参数都必须实时校验，Error 优先展示在对应输入框下方，Warning 与 Error 严重度和操作行为分开；前端和后端共享同一套字段 Schema / Registry 的校验规则，后端对任何 Save、Build、Run、Batch、Evaluation 请求都必须重新校验。未经前端而直接请求 API 的非法参数，必须返回包含 `field/path`、`code`、`severity`、`message`、`suggestion` 的结构化错误，拒绝创建作业与修改数据。All Models 要逐算法定位错误/警告。**

验收新增 T45–T51；请执行浏览器交互测试以及后端绕过前端的负向 API 测试，留下实际证据。不能把“前端红框”当作校验功能全部完成。

### 工作方式：必须自动连续推进

- **P0**：初始化工程，核验数据、锁定依赖，创建数据库/测试框架，真实启动最小 API/前端。
- **P1–P3**：完成双行品牌 UI、首页、M1/M2、M3，并逐阶段通过端到端真实数据测试。
- **P4–P6**：实现 10 个普通算法、2 个 Foundation 的真实推理、All Models 批处理，保存 Experiment/Batch/逐区域产物，确认 Worker 状态持久可靠。
- **P7**：实现 M5 完整预测、评估、对比、GIS 和结果管理。
- **P8**：在干净运行环境完成安装/公开网址交付，以及全部 51 项验收检查与操作文档。

每个阶段自动运行相关测试、修复错误、更新 `docs/IMPLEMENTATION_STATUS.md` 和 `docs/TEST_REPORT.md`，**然后主动继续下一阶段，不要只停在规划或问我要不要继续**。可报告阶段进度，但没有真实执行的环节必须标明 Not Verified。缺 GPU/模型权重/部署授权等真实外部阻塞时，说明问题、替代合法 checkpoint/实施方案和对验收的影响，等待必要的决策；**不能伪造模型结果、宣称安装已完成或用 mock 数据顶替**。

先开始 P0 新建工程及六份数据检查，然后一路实现直至 P8 验收完成或遇到明确的外部阻塞。
