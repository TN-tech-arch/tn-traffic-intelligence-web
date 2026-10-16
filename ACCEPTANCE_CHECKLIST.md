# TN Traffic Intelligence v3.1 — 从零开发验收清单（51 项）

**初始均为未测试**：Codex 只有实际跑通并给出命令、日志、截图与环境证明后才能打勾。新版 T45–T51 为新增强制参数校验验收项。

| 状态 | 编号 | 场景 | 必须达到的标准 |
|---|---|---|---|
| ☐ | T01 | 原始文件加载 | 3 组、6 文件均成功；8928/8928/2784 时点；来源指纹与文件真实一致 |
| ☐ | T02 | 区域映射 | Milano 88/88、Trentino 223/223、ZTE 148/162；ZTE 14 No Data 清楚标出 |
| ☐ | T03 | 零值与缺失 | ZTE 的 0 保留；不把 0 视为 NaN；缺失处理记录且不越界 |
| ☐ | T04 | M1 时空联动 | GIS 选择区域/时间，右侧曲线与真实统计随之变化 |
| ☐ | T05 | M1 跨地点 | 归一化形状比较，时间与单位免责声明明确，禁原始值直接同量纲比较 |
| ☐ | T06 | M2 四聚类 | KMeans/DBSCAN/Hierarchical/GMM 都真实运行，DBSCAN 噪声/质量 N/A 合理 |
| ☐ | T07 | M2 功能区解释 | 标签为推测，不冒充真实地类；ZTE No Data 不进入簇 |
| ☐ | T08 | M3 L/H/S 窗口 | 对已知序列核对 X/Y 边界、时间与步长、首末合法窗口完全正确 |
| ☐ | T09 | M3 时间切分 | 70/15/15 默认、分割无泄漏、各 split 实际窗口计数一致；非法配置阻止 Save |
| ☐ | T10 | M3 预处理 | Scaler 仅 fit Train、逆变换正确；插值不偷看预测起点之后的目标 |
| ☐ | T11 | M3 持久化 | Save 成功产生 Dataset ID；失败无半成品；历史可查、Reset 不改旧版 |
| ☐ | T12 | 12 模型注册表 | 模型名单恰好 12 且分组正确；All Models 单独位于顶部不计为第 13 算法 |
| ☐ | T13 | 12 算法真实能力 | 每个 adapter 能对合法输入生成形状 [N,H] 的有限输出；真实依赖或资源失败如实记录 |
| ☐ | T14 | 统一参数帮助 | 每个模型 Basic/Advanced 可变、合法范围/说明齐全、非法参数阻止运行 |
| ☐ | T15 | Transformer 验证 | d_model 不能整除 n_heads 时具体报错，修复后能运行 |
| ☐ | T16 | 大模型真实权重 | TimesFM/Chronos 在真实 checkpoint 上 Zero-shot 成功，记录 checkpoint/设备/许可 |
| ☐ | T17 | 大模型资源异常 | 缺缓存/网络/设备时 Unavailable/Failed，不冒充 Completed，不显示虚假 epoch |
| ☐ | T18 | 单模型 Single | 单区单算法：1 Experiment ID、能保存和加载工件 |
| ☐ | T19 | All Regions 单模型 | 对一个地点的全部有效区域分别建模；N 个 region records，部分失败可审计 |
| ☐ | **T20** | **All Models Single** | **1 Batch ID + 12 Experiment IDs；12 模型配置独立、按队列执行、各状态可查** |
| ☐ | **T21** | **All Models + All Regions** | **N×12 计划数正确（Milano 1056 / Trentino 2676 / ZTE 1776），每算法 N 子记录；不跨地点** |
| ☐ | **T22** | **批次 Preflight 和取消** | 资源/非法模型提示具体；Stop Batch 后端确认，未开始任务停止，已完成保留 |
| ☐ | **T23** | **批次刷新及失败恢复** | 浏览器刷新后台仍继续；Running/Partial/Failed/Skipped 状态真实持久化 |
| ☐ | T24 | 训练曲线真实性 | DL epoch 为真实 loss，Boosting 迭代可查，ARIMA/Prophet/Zero-shot 无虚假 epoch |
| ☐ | T25 | Duplicate Experiment | 复制生成草稿但**不**生成新历史 Experiment ID；真正 Run 才生成 |
| ☐ | T26 | M5 Batch 快速选择 | Batch ID 可一次载入成功模型，失败/跳过仍列原因；不能评价的模型不进入排名 |
| ☐ | T27 | 统一 Test 公平性 | 相同 Dataset、H、区域与 Test targets 才可标准排名；不同协议明确阻挡/警告 |
| ☐ | T28 | 评价指标 | MAE/RMSE/sMAPE/R² 与独立手工样例一致；sMAPE 0/0 正常、R² undefined=N/A |
| ☐ | T29 | All 地图与指标 | 4 种空间图层及 Macro/Pooled 区分，区域覆盖/No Data/失败标识正确 |
| ☐ | T30 | 历史依赖保护 | 引用中 Dataset/Experiment 不能硬删；Evaluation 删除只作用本层 |
| ☐ | T31 | 顶部 UI | 两行顶栏、六导航、TN 标识、**无卡通人物**；下方仅三栏；所有规定 Tab 在 |
| ☐ | T32 | 首页真实信息 | 三数据/459 有流量区域/12 算法/5 模块数字准确，Recent Activity 初始空态 |
| ☐ | T33 | Windows 本地运行 | 根据 README 在真实目标系统启动，进入五模块并能完成至少一条真实链路 |
| ☐ | T34 | 网络部署（如作为交付） | 真正部署 HTTPS/URL 可访问，核心 API/worker/数据库状态可用；许可证合规 |
| ☐ | T35 | 文档与源码 | README、API、模型参数、资源/许可、部署、测试报告、Logo 源文件完整 |
| ☐ | T36 | 失败与停止可审计 | 任务失败保留实际 error/log、不覆盖成功 artifact；状态在重启后自洽 |
| ☐ | **T37** | **Greenfield 起点** | 从空目录初始化的全新源代码结构，依赖锁、DB 迁移、六文件导入与首个可运行页面可复现；没有依赖旧项目 |
| ☐ | **T38** | **正式课程交付** | 至少**真实 Windows 安装包**或**已实测公网 HTTPS 地址**之一；本地开发命令及 localhost 不替代正式交付 |
| ☐ | T39 | UI 全部功能状态 | Basic/Advanced/Tooltip/Reset/Delete/Archive/Duplicate、Tab、跳转与空态均可操作，后台状态与视觉一致 |
| ☐ | T40 | 项目资源与 Logo | TN SVG、透明 PNG、favicon、城市道路横幅；任何 UI 页面均不含卡通人物或头像 |
| ☐ | T41 | 干净环境复现 | 按 README 从零安装依赖、初始化数据库、导入数据、启动应用；附实机或容器日志 |
| ☐ | T42 | 完整用户工作流 | Home→M1→M2→M3 Dataset ID→M4 All Models/Batch/Experiment IDs→M5 Evaluation ID，实际可走通且记录重启后存在 |
| ☐ | T43 | 错误条件 UX | 模型缺依赖/无 checkpoint、非法 L/H/S、作业停止、无测试预测等都显示真实原因和重试动作 |
| ☐ | T44 | 双行导航与响应式 | 品牌横幅、六模块项（含 Home）、选中状态和窄屏折叠，内容工作区只三栏不引入全局第四侧栏 |
| ☐ | **T45** | **全参数实时校验覆盖** | M1–M5 的每个可编辑参数（含 Basic/Advanced、All Models 的 12 组）在修改后实时校验；合法修正后提示及时更新；不会漏掉隐藏字段 |
| ☐ | **T46** | **字段下方错误与独立警告** | 错误直接显示在对应输入框下方，含字段/原因/建议；Warning 与 Error 颜色/图标/文字/交互不同，Warning 合法时不误禁用提交；无纯全局模糊弹窗 |
| ☐ | **T47** | **前后端规则一致** | 相同输入的客户端校验和后端 Pydantic/Registry 校验在类型、边界、条件与错误码上一致；真实接口复用 validator，避免两份分叉规则 |
| ☐ | **T48** | **非法请求不能绕过后端** | curl/脚本绕过前端直接传 `dropout=1.5`、`L=0`、不兼容 d_model/heads 等返回 422/409 字段级错误，不能创建 Job/ID/工件，原保存对象不变 |
| ☐ | **T49** | **联动、异步与输入中间态** | 切换算法/Dataset/region 更新相关校验；中途输入空值或 `0.` 不自动覆盖；异步旧响应不反向覆盖新值；未验证状态不显示为已通过 |
| ☐ | **T50** | **All Models 逐算法报错与跳过** | 每个算法可定位 Error/Warning；模型级非法项无法暗中执行，仅用户确认跳过后记录 Skipped/Unavailable；批次级 Error 禁止 Run |
| ☐ | **T51** | **字段帮助与可访问反馈** | 输入框附近 `ⓘ` 显示含义/单位/默认/范围/建议；错误通过文字、图标及 aria-invalid/aria-describedby 暴露，键盘可访问且修复后自动更新 |

每一项记录执行日期、环境（系统、CPU/GPU/内存）、命令、预期与实际结果、Pass/Fail、截图/日志路径和复验结果。
**新增专项强制标准**：任何参数前端校验合格均不代表可以跳过服务器侧检查；单纯前端禁用按钮不等于通过 T47/T48。
课程交付仍须有真实 Windows 安装包或已验证可访问 HTTPS 服务，localhost/静态截图不能替代。
