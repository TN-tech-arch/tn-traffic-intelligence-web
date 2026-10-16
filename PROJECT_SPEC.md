# TN Traffic Intelligence｜智能流量分析与预测平台

> **PROJECT_SPEC v3.1 · Codex 可执行开发需求说明书**  
> 版本日期：2026-10-15  
> 项目作者／品牌：田诺（TianNuo / TN）  
> 交付形态：可在 Windows 本地启动的 Web 应用；可另行部署到服务器通过有效网址访问  
> 文档状态：**最终需求基准；当前项目尚未开发，所有实现均需从零开始。说明书不是实现证明。**

## 给 Codex 的最高优先级规则：全新项目，从零完整开发

**项目目前没有任何已完成的软件功能。** 必须以空白项目为起点，创建可运行的全栈 Web 应用，不执行“扫描现有业务代码/保留旧模块/差距分析后不动工”的旧流程。若目标文件夹中有旧 `PROJECT_SPEC`、演示截图、脚本或空目录，它们只是参考资料，**不得推定存在已实现产品**；仅确认工作目录、开发环境及六个原始数据文件，并从零创建工程结构、依赖锁、前后端、数据库、任务队列、模型接口、五个模块与测试。

开发过程须**持续执行 P0–P8 直至满足全部验收项**，每阶段完成真实运行与自动化测试后进入下一阶段。可以简报阶段进展，但**不能只交付计划、接口桩、静态 UI 或假模型结果后宣称完成**。遇到确实需要用户凭据/服务器资源、权重许可决定或目标机器硬件限制时，准确列出阻塞及解决方案，不要擅自删除要求或伪称成功。

**唯一项目目标**：五个可工作的核心模块、三套真实数据、十二个真实预测算法（含 TimesFM 与 Chronos）、All Models 批处理、顶部双行蓝白导航与 TN Logo、Dataset → Batch/Experiment → Evaluation 的可持续追踪、真实测试集评估，最终**源代码 + 经实测可安装的软件包或可公开访问的网址**。

---

## 目录

0. 从零开发约定与验收起点
1. 项目定位、范围和交付
2. 原始数据与数据字典
3. 系统总体界面、品牌与统一参数校验
4. Module 1：探索性流量分析
5. Module 2：潜在功能区聚类
6. Module 3：预测数据集构建
7. Module 4：模型训练与 All Models
8. 12 算法参数及模型适配规范
9. Module 5：预测展示与评价
10. 全局对象 ID、生命周期及管理
11. 核心算法协议、时间泄漏与评价一致性
12. 技术架构、数据库、文件系统
13. API、后台任务及前端交互契约
14. 品牌资产、部署、性能和安全
15. 分阶段开发计划及 DoD
16. 验收测试矩阵
17. 交付目录、部署检查与 Codex 执行指令
18. 技术参考及需实测事项


---

# 0. Greenfield 开发约定（强制）

## 0.1 起点和权限边界

- **初始状态为空项目**；Codex 可在指定工作目录从零建立 `frontend/`、`backend/` 等目录，而不是等待读取旧代码后才决定是否重建。
- 附带六个原始文件应按原样放在 `data/raw/`，保留文件名、内容与 hash。找不到文件时首先检查解压路径并明确提示；不允许下载看起来相似的网上数据来代替。
- 可以自动创建源代码、数据库迁移、测试、Logo SVG 与本地启动脚本；不得未经授权购买云服务、开通计费项目或创建公网账户。实际公网部署需要用户提供已授权的服务器/域名或其他合法目标。
- 不对不存在的旧业务文件做“兼容保留”或“差距分析”。**先初始化仓库，再读取数据做质量基线，再按 P1–P8 开发。**
- 编码不是一次性任务：各阶段应有可运行验收，失败则修复。最终提交必须附实测命令及日志；没有跑过的项目不能写“已验证”。

## 0.2 需求优先顺序

1. **本 `PROJECT_SPEC.md v3.1` 中经用户最终确认的要求**优先。
2. 数据语义以附带六个原始文件及程序重新验证为准，文档给出预期数据数量用作断言，若发现偏差应报告而不是“修数据以凑数”。
3. `ACCEPTANCE_CHECKLIST.md` 和 `CODEX_START.md` 是执行索引；内容如与本文件不一致，以本文件为准。
4. `ui_reference/` 的图片只用于视觉观感：示意图里任何数字、训练曲线、实验 ID、地名或频率都**不是**可硬编码的事实。

## 0.3 完工定义和最终软件形态

本项目首先实现**桌面浏览器 Web 全栈系统**（React/TypeScript + Python FastAPI/Worker），支持 Windows 本地开发与生产运行。课程要求的正式交付形式必须**至少达成下面之一**：

- **路线 A（安装运行）**：提交真实的 Windows 可安装软件包（例如受支持安装器包装的 Web 应用/本地服务器组件，具备卸载、配置与可实际打开 UI 的启动入口），并在干净 Windows 机器上完成安装及端到端验收；**仅有 README 和启动开发服务器的命令不算正式安装包**。
- **路线 B（网络访问）**：真实部署可访问的 HTTPS 网站及后端/Worker，在外部网络经实际测试，提供真实 URL 和必要登录/授权方式；`localhost`、示例域名和不能推理的静态托管不算达标。

建议先用 Windows 本地 Web 运行模式保障所有功能，再依据可用部署/打包条件优先完成一种**正式课程交付物**；另一种可选。若正式安装/公开部署受当前环境/授权阻塞，必须**明确标记未完成**，不能把本地测试当成交付达标。

## 0.4 一眼核对的最终约束

| 项目 | 已确定规则 |
|---|---|
| 顶部品牌 | 双行顶部：TN / TianNuo + 城市道路主题背景；六个页面导航；**无卡通人物** |
| 模块内部 | 只保留 Configuration / Visualization / Information 三栏；既定右侧 Tab 全保留并整合历史管理 |
| 核心模块 | M1 时空探索、M2 功能区聚类、M3 预测数据集构建、M4 训练、M5 预测与评估 |
| 区域范围 | M3–M5 仅 `Single Region` / `All Regions`；后者仅当前一个地点全部**有数据**区域，逐区域独立预测 |
| 算法 | ARIMA、Prophet、RF、XGBoost、LightGBM、MLP、RNN、LSTM、GRU、Transformer、TimesFM、Chronos，恰好 12 种 |
| 批处理 | `All Models` 位于模型选择最上方，是 12 算法的批量操作，不是第十三种算法 |
| 大模型 | 两种官方可验证预训练模型真实 Zero-shot；仅在指定版本确实支持时提供微调 |
| 关系 | Dataset ID → Experiment ID → Evaluation ID；All Models 额外 Batch ID，一个 Batch 关联 12 算法计划 |
| 指标 | 所有排行榜使用真正 held-out Test、相同时间目标与评价协议；不允许模拟训练图表和预测曲线 |
| 参数校验（新增） | 所有可编辑参数实时校验，Error 紧贴输入框、Warning 单独提示，前端与后端规则一致且后端不可绕过（3.5 节） |
| 最终材料 | 源代码、正式可安装包或真实网址、TN 标识与项目文档、可复现测试证据 |

---

# 1. 项目定位、范围和交付

## 1.1 产品目标

开发一套真正能够安装／运行或经网络访问的交互式智能流量分析平台，使用三组真实区域时序流量数据，完成以下闭环：

**探索性时空分析 → 区域聚类 → 预测数据构建 → 模型运行／批量训练 → 测试集预测／公平评价。**

五个核心模块固定如下：

| 模块 | 英文名称 | 核心交付 |
|---|---|---|
| M1 | Exploratory Traffic Analysis | GIS 区域、时序、空间与跨地点模式分析 |
| M2 | Functional Zone Clustering | K-Means、DBSCAN、Hierarchical、GMM 及 GIS 聚类图 |
| M3 | Forecasting Dataset Construction | 时间窗口、无泄漏切分、Dataset ID |
| M4 | Model Training | **12 种预测算法 + All Models 批处理 + Batch/Experiment IDs** |
| M5 | Prediction & Evaluation | held-out Test 真实对比、评价、GIS 与 Evaluation ID |

## 1.2 必须交付的实体成果

1. **完整源代码**：前端、后端、数据处理、12 算法适配器、数据库迁移、任务工作进程、自动化测试与配置示例。
2. **真正可启动的系统**：Windows 本地启动方式（推荐），并且至少满足课程要求的“本地可运行的安装/启动交付”或“真实可访问的公网网址”之一。推荐同时提供两者，但绝不能虚构公网 URL；只有启动脚本而没有成功运行验证不能算验收。
3. **五大模块可用**：所有界面绑定实际服务；数据集／实验／评价状态刷新后仍存在。
4. **自有 TN Logo**：导航、网页图标和应用品牌区真实使用。**不要使用、嵌入或展示用户此前提供的卡通人物或头像**（最新确定需求）。
5. **专业 UI**：顶部两行结构、科技蓝／白色、三栏内容、响应式、参数帮助、错误提示及历史管理。
6. **文档／证据**：README、部署/操作/架构/API/算法说明、测试报告、实机 UI 截图或演示材料。
7. **许可合规**：不得默认重分发受限制的模型权重；大模型来源、使用许可、首次下载与资源要求需要文档化。

## 1.3 明确排除与必须澄清的语义

- 数据不等于道路车辆数量。原始样本是区域流量序列，其中 ZTE 明确对应 4G 下行流量，Milano/Trentino 的精确物理单位未证实。页面不能擅自写“车辆/分钟”或给不同来源套同一量纲。
- **All Regions** = 所选**一个**地点数据集内的全部**有合法时序数据**的区域；不是 Milano+Trentino+ZTE 的并集。不提供“Multiple Regions 自选多个区域”的第三种范围。
- All Regions 并不自动启用空间联合预测。默认**每个区域独立建模**，可共享算法配置/预训练 checkpoint，但预测输出与模型工件要能逐区域追踪。
- 第五模块的正式成绩来自 **Test**，不是 Validation 或训练集。
- All Models **不是第 13 种算法**；只是依次运行固定 12 种算法的编排操作。

## 1.4 优先级

**P0 不可删减：** 真实数据读取与 GIS、五模块、12 模型可运行适配、两个 Foundation 的真实 Zero-shot、All Models 任务管理、M3/M4/M5 持久 ID、测试评价、本地启动与 TN 标识。  
**P1 增强：** 大模型经验证的微调、导出丰富格式、复杂资源估算与高级质量诊断。注意：**课程要求的正式安装包或可访问网址属于交付 P0，二者至少实现其一，不是 P1。**  
**禁止假完成：** 没有权重、缺 GPU/内存、依赖无法安装时，必须显式为 Unavailable/Failed 并保留原因，不得用常数模型/模拟曲线冒名顶替大模型。

---

# 2. 原始数据与数据字典

## 2.1 六个原始文件及确定性信息

| 地点 | 时序 CSV | GIS GeoJSON | 时间点 | 原生频率 | GIS 区域数 | 有效时序区域数 | 时间范围（本地原始时间戳） |
|---|---|---|---:|---|---:|---:|---|
| Milano | `milano_traffic_nid.csv` | `milano.geojson` | 8,928 | 10 min | 88 | 88 | 2013-11-01 00:00 — 2014-01-01 23:50 |
| Trentino | `trentino_traffic_nid.csv` | `trento.geojson` | 8,928 | 10 min | 223 | 223 | 2013-11-01 00:00 — 2014-01-01 23:50 |
| ZTE | `zte_4g_down.region.csv` | `zte_4g_down.traffic.geojson` | 2,784 | 15 min | 162 | 148 | 2024-07-28 00:00 — 2024-08-25 23:45 |

时序区域数合计 **459（88+223+148）**。GIS 多边形总数 **473（88+223+162）**，两者不得混写；不能使用旧示意图中的 359。

- Milano/Trentino CSV 第一列 `Unnamed: 0` 为时间戳，其余列是区域名称；Milano 地图按 `NIL` 关联，Trentino 地图按 `NAME_3` 关联。
- ZTE CSV 第一列 `date`，其余是区域编码；GeoJSON 属性 `unique_id` 对应区域键；`cid` 不应当作区域 ID。
- ZTE **14 个 GIS 多边形无时序列**：地图灰色标 `No Data`，不能参加预测／聚类；**735 个原始数值为零**：保留零值，不能误判 NaN 或自动删除。导入时重新核验该计数，若检测值与预期不符，报告实际差异，不能强行修正数据以迎合预期。
- 数据来源单位使用 `Traffic volume (source unit unknown)` 或 `4G downlink traffic (unit unspecified)` 等谨慎标签，实际数值展示原始标度。不同来源的绝对数值不可直接比较，M1 跨地点比较应使用明确的归一化方式。
- 源数据必须只读保留，运行产物放独立目录。

## 2.2 数据导入和检查流程

1. 自动扫描配置中的目录；找不到文件时提供有明确路径提示的 Import/Locate Data，而不是硬编码开发者的 `E:\...`。
2. 检查 CSV/GeoJSON 可读性、时间戳解析、时间索引单调/重复、预期采样间隔、正/负/零/NaN/∞ 数量、区域 ID 双向映射、几何合法性、缺测和实际数据量。
3. 统一表征：`source_id, region_id, timestamp, observed_value, is_valid, native_frequency, unit_label`；GIS geometry 单独持有，按 `(source_id, region_id)` 关联。
4. 显示可用区域数、无数据区域数、时间范围、零值数量和单位声明；异常都需要可访问的质量报告。
5. 为原始数据生成不可变的 `source_fingerprint`，后续模型与评价快照均引用该版本；换源文件需要重新构建 Dataset，历史不可暗中改变。

## 2.3 聚合分辨率

- 原生频率、30min、1h、1day；必须是原始频率的整数倍。固定时间边界（例如整点）且明确时区/原始数据时区未知时的解释。
- `sum` 与 `mean` 由用户显式选择并显示：sum 是采样值求和，mean 是样本平均；由于源单位未确认，界面不能把它自动解释成物理“总流量”。
- 缺失采样聚合标明是否完整；不完整时间桶按选定规则视为缺测/剔除，不能悄悄计算出看似完整的值。

---

# 3. 系统总体界面与品牌（最终已确定）

## 3.1 视觉总体方向

采用**浅蓝色科技风＋白色卡片＋城市／道路主题横幅＋TN Logo**，现代、简洁、专业。页面禁止放卡通人物。现有参考示意图属于**风格参考**，其中数字/记录/图表均不可当作事实；正式首页统计从后端获取。

品牌固定：

- 主品牌：`TN`（田诺名字缩写）＋ `TianNuo Traffic Intelligence`。
- 中文副标题：`智能流量分析与预测平台`。
- 可选简短标语：`From Data to Smarter Mobility`。
- Logo 需独立设计为可缩放 SVG，再导出透明 PNG 和 favicon；不直接截取别人的商业标识。
- 主色建议 `#2467E8`，深色文字 `#142B52`，页面底 `#F3F7FC`，卡片 `#FFFFFF`，弱分割线 `#E3EBF6`，辅助青绿/橙用于数据语义而非装饰。

## 3.2 全局顶部两行导航：**不设永久左侧模块导航**

**第一行：品牌区（Hero Header）**：TN Logo、平台名称、中文副标题，背景为**淡蓝色城市/道路景观**（注意对比度）；右端放帮助、设置、品牌图标或运行状态，不放人像。建议高度 94–120px，屏幕较小时可压缩背景而不是让标题变窄。  
**第二行：模块导航**，固定六项：`Home / Exploration / Clustering / Dataset / Training / Evaluation`。每项图标＋主标签＋小型副标签，选中项为科技蓝强调底色、其它为白/透明，选中状态清晰。导航可 sticky 保持可见，不因模块滚动而消失。  
**正文标题行**：`Module N / 模块英文标题`、简短用途、当前已保存 Dataset 概况/当前地点。  
**模块工作区**：仅三栏，比例约 **25% Configuration / 45% Visualization / 30% Information**；不得再额外加入“第四栏全局侧边导航”。超宽屏限制页面合理最大宽度，窄屏左/右面板可折叠，GIS/图表优先。

文字框架：

```text
┌─────────────────────────────────────────────────────────────────┐
│ [TN Logo] TianNuo Traffic Intelligence     城市/道路横幅  设置 │  第一行
├─────────────────────────────────────────────────────────────────┤
│ Home │ Exploration │ Clustering │ Dataset │ Training │ Evaluation│ 第二行
├─────────────────────────────────────────────────────────────────┤
│ Module Title / Current Dataset                                   │
├─────────────────┬─────────────────────────┬─────────────────────┤
│ Configuration   │ Visualization           │ Information +       │
│ （25%）         │ （45%）                 │ History（30%）      │
└─────────────────┴─────────────────────────┴─────────────────────┘
```

## 3.3 Home / Dashboard

- 欢迎主横幅：名称、平台简介、`Start Exploring`、城市/交通背景（**不使用动画人物**）。
- Dataset Overview：Milano 88 / 10min；Trentino 223 / 10min；ZTE 148 有时序（162 GIS）/ **15min**；三数据来源。
- Overview 统计：3 Data Sources、**459 Valid Regions**、12 Forecasting Algorithms、5 Core Modules；如果显示已建立 Dataset、已完成 Experiment、Evaluation 数量，必须真实查询数据库。
- Five-Module Workflow：五阶段入口，可点击跳转。
- Recent Activity：真实 Dataset/Experiment/Evaluation 记录；初次启动为空态，不造假 ID、时间戳和 Completed 状态。
- About / Help 通过顶部帮助入口访问；TN 作者署名显示“田诺”，不放头像。

## 3.4 全局交互规则

- 参数旁有 `ⓘ` 帮助：说明含义、单位、合法范围、默认值、与其他参数的联动、计算资源影响和调整建议。Basic/Advanced 可切换。
- **强制统一参数校验规范（详见 3.5）**：**所有可编辑参数都必须实时校验；错误优先显示在对应输入框下方；警告不得与错误混淆；前端与后端采用一致的校验规则，禁止仅靠前端拦截。** 所有模块、All Models 逐算法参数及高级选项均必须执行此规则。
- 切换模块保留草稿；未保存修改要提示丢弃/继续编辑，不隐式保存。
- 状态包含 Initial/Loading/Empty/Ready/Running/Completed/Partial/Failed/Unavailable；任何失败要有复现提示、后端错误标识及重试。
- 所有 GIS 和图表支持 hover、时间轴、图例、缩放和导出；地图与图表分别按实际数据渲染。
- 可访问性：文本对比度、键盘焦点、表单标签、色盲友好图例；成功失败不能仅通过颜色区分。
- 表格支持搜索/分页、滚动；右侧各模块的历史管理**必须增加，不替换既定 Tab**。

## 3.5 全项目参数解释、实时校验、错误与警告（新增：不可删减的 P0 需求）

> **最终确定的强制要求（原文）**：**“所有可编辑参数都必须实时校验，错误优先显示在对应输入框下方，警告不应与错误混淆；前端与后端采用一致的校验规则，禁止仅靠前端拦截。”** 这是所有页面通用的必须实现功能，而不是仅限 Module 4 的 LSTM 演示。

### 3.5.1 范围与触发时机

- 覆盖 **Module 1–5** 所有可编辑的数字、百分比、时间范围、区域、枚举开关、算法超参数、Advanced 选项和 All Models 各模型独立设置；并覆盖跨字段、跨 Dataset、跨算法/环境的依赖检查。
- 用户改变字段值时，前端同步检查**格式、必填、类型、取值区间、枚举**等能即时确定的条件；字段间相关性（例如比例之和、`d_model % n_heads`、L/H/S 可生成窗口数）随相关字段变化重新检查。对涉及大数据统计、checkpoint/设备/许可等异步检查，可在短暂防抖后请求后端并显示 `Checking`，**不能**把“尚未验证”显示为绿色已通过。
- 为避免输入中途被阻断：数字编辑可暂存原始字符串、允许用户输入到一半（空、`-`、`0.` 等临时态），在字段已修改/失焦或尝试提交时清晰显示对应提示；不要自动偷偷替换用户输入值为默认值。无效状态始终阻止最终提交，提交时全部字段校验且聚焦第一个错误。
- 选择 Dataset、区域范围、算法、分辨率或训练模式时，应**重新校验相关字段**；运行前最后做一次**后端权威预检**。字段说明在不可用/禁用时也应保留禁用原因。

### 3.5.2 Error / Warning / Info 必须语义分开

| 严重度 | 识别与显示 | 是否允许操作 | 示例 |
|---|---|---|---|
| **Error（错误）** | 错误输入框边框/图标标识；**具体说明优先紧贴该输入框下方**；组级/页级汇总可以重复列出并支持一键定位，不可只用全局弹窗 | **禁止**依赖该字段的 Save / Build / Run / Evaluation；后端必须拒绝 | Dropout=1.5；L=0；Train+Val+Test≠100%；Transformer `d_model` 不能被 `n_heads` 整除 |
| **Warning（警告）** | 黄色/琥珀标记，提示潜在风险、影响及调整建议；**不得渲染成红色非法错误** | 合法时原则上允许继续，可对高资源消耗提供用户确认；是否阻止要由具体安全/资源规则决定 | Epochs 非常大耗时长；选定模型在小数据集上易过拟合；All Models × All Regions 任务量大 |
| **Info / Help（说明）** | `ⓘ` 与工具提示/键盘可打开面板，解释单位、默认、合法范围、典型值、依赖/影响 | 不影响提交 | Input Length 以重采样后的点数计，H 由 Module 3 继承 |

- 颜色以外必须同时使用文字、图标和可访问状态（例如 `aria-invalid`、`aria-describedby`、关联的错误信息 ID）；屏幕阅读器可感知，键盘可聚焦帮助信息。
- 错误消息要明确**字段名称、当前值、错误原因、合法范围/修复办法**；警告包含**风险及建议**。禁止仅写 `Invalid parameter`、`Some errors` 或把 Warning 当作 Error。
- 用户修复数据后必须立即清除已不成立的错误；异步校验响应必须防止旧请求覆盖新值（请求版本/取消旧请求）。服务器返回的领域级错误必须映射到具体字段；无法映射时在相关参数组/页面展示原因和 request ID。

### 3.5.3 前端与后端一致性（后端是最后裁判）

1. 在 **统一的 Parameter / Model Registry + Backend Pydantic Schema/领域校验器**中维护参数 `key`、类型、最小/最大（含边界）、枚举、默认值、单位、中文说明、联动条件、版本/模型能力约束，以及错误码/级别；通过 API 暴露可机器读取的约束，前端根据它动态渲染和预校验，**不得复制两份彼此漂移的规则**。
2. 页面端即时校验提升体验，但**所有影响持久化或计算的后端请求**（包括 Dataset Build、Clustering Run、Experiment Run、All Models Batch、Evaluation Run、历史对象变更中含配置的请求）都必须再次由后端验证；不得信任前端的 `isValid` 或跳过按钮状态。
3. 无效数据从浏览器或 Postman/curl **直接提交到后端也必须被拒绝**；返回机器可读错误列表（`field/path`, `code`, `severity`, `message`, `suggestion`, `received_value`, `request_id`），常规字段格式错误返回 HTTP 422，跨资源冲突可用 409，鉴权/资源问题采用相应语义码，不应返回看似成功的 `200`。
4. **失败必须没有副作用**：不开始 Worker，不创建成功状态的 Dataset/Experiment/Batch/Evaluation，不改变既有已保存模型/数据集，也不清除用户草稿；原子性由事务保证。已有运行中的任务若产生新的外部资源异常，要转成实际失败/不可用状态并保留原因。
5. 约束如会受到数据、算法、库版本或 checkpoint 能力影响，由后端动态检测；例如 `batch_size > train_samples` 不一律视为非法，依据 `drop_last`、实际框架实现与数据量决定是 Error 还是 Warning。不能用臆测的“推荐样本数”当成普适硬规则。
6. 对 **All Models**，逐模型独立返回错误/警告与可运行性，提供可跳转字段；默认不因单个模型的 Warning 禁止所有任务。特定模型 Error 必须要求修复，或在用户明确确认“跳过不可运行项”后将其记录为 Skipped/Unavailable，**不能当作 12 个模型全部完成**。批次级 Blocking Error 必须禁止提交整个批次。

### 3.5.4 最低测试样例（必须覆盖自动化与浏览器交互）

- `Dropout=1.5`、`L=0`、`S=0`、输入非数字、负值/空值/小数非法整型：在对应输入框下方看到原因，按钮禁用；直接调用 API 同样被拒绝且无副作用。
- Transformer `d_model=130, n_heads=8`：跨字段显示具体不可整除的 Error；修改为 `d_model=128` 后立刻清除错误并允许继续。
- Train/Val/Test 的百分比之和不等于 100、已选 L/H/S 造成任一 split 无有效窗口、选错源区域：禁 Build；纠正后预览、状态及后端校验一致。
- `Epochs=10000`、All Models + All Regions 资源开销：合理的 Warning，不误当作取值非法；资源硬不足/许可不允许时按后端事实标 Error 或 Unavailable。
- 同一错误在 Basic/Advanced 切换、切换算法后恢复、浏览器刷新或异步检查期间不得漏检；禁用字段需告知原因。
- 通过抓包/curl 修改请求体绕过前端、修改枚举/范围或伪造 `isValid=true`：后端按相同规则拒绝，返回结构化字段错误，DB 与磁盘均没有新增半成品。


---

# 4. Module 1：Exploratory Traffic Analysis

## 4.1 模块目标与结构

M1 从零实现为三栏页面和三个指定的右侧 Tab；**中央 GIS 地图常驻**，右侧切换 Tab 不使地图消失。

| 区域 | 固定功能 |
|---|---|
| 左 Configuration | 单一地点、区域（允许地图选取、可选多区域比较且数量限制合理）、原生/聚合粒度、sum/mean、真实时间范围、分析分辨率、重置 |
| 中央 GIS | GeoJSON 多边形、分级色带、悬浮区域与真实值、No Data、区域点选、时间选择，地图与右侧同步 |
| 右 Tab 1 `Temporal Analysis` | 单区/多区动态时序曲线、均值/峰谷/P95/CV、日内小时画像、周内、工作日/周末、峰值时间、实际支持的 ACF/趋势 |
| 右 Tab 2 `Spatial Analysis` | 当前时间截面的空间强度、区域排名、区域差异、局部/全局空间汇总（实际算法支持才显示） |
| 右 Tab 3 `Multi-City Comparison` | 三个来源的周期模式、相对变化、归一化曲线，并明确数据覆盖时段不重叠、单位未知 |

## 4.2 必须遵守

- 选地图区域 → 同步更新曲线与统计；修改时间片 → 重新计算地图实际值。
- 仅在对应合法时间范围内启用图表；没有数据点须显示 No Data 而非 0。
- 处理 ZTE 的 14 个 No Data；不把 4G 下行流量描述为道路车辆流量。
- 多地点比较不能伪造同时间重叠，同图中使用归一化形状时说明归一化规则。
- 导航结构独立于分析内容，M1 三个指定的右侧 Tab 与 GIS 常驻能力均必须落实。

---

# 5. Module 2：Functional Zone Clustering

## 5.1 三栏页面

| 区域 | 必须提供 |
|---|---|
| 左 Configuration | 地点、时间区间、流量聚合、聚类特征选择、标准化、算法选择、Basic/Advanced 参数、Run Clustering / Reset |
| 中央 GIS | 每区按簇着色，区域点选；DBSCAN 噪声独立，ZTE 无时序区域标为 No Data |
| 右 Tab 1 `Cluster Overview` | 实际簇数、每簇区域数与统计摘要、典型簇特征 |
| 右 Tab 2 `Typical Patterns` | 各簇平均日内模式、工作日与周末差异、峰谷；图例标真实统计 |
| 右 Tab 3 `Quality Evaluation` | Silhouette、Davies-Bouldin、Calinski-Harabasz 等在合法条件下计算，否则 N/A 和原因 |
| 右 Tab 4 `Region List` | 区域 ID/名称/cluster_id、主要特征、搜索排序、定位 GIS |

## 5.2 算法和参数

| 算法 | 必须可调整参数 | 强制验证 |
|---|---|---|
| K-Means | `n_clusters`, `n_init`, `random_state` | K 范围及非空输入，Silhouette 至少 2 个有效簇 |
| DBSCAN | `eps`, `min_samples`, `metric` | eps>0；噪声 label -1，少于 2 有效簇时部分指标 N/A |
| Hierarchical | `n_clusters`, `linkage`, `metric` | Ward 仅欧氏距离；数据规模与合法簇数 |
| GMM | `n_components`, `covariance_type`, `reg_covar`, `random_state` | 协方差有效与收敛状态 |

**聚类全部可编辑参数和特征选择必须使用 3.5 节统一实时校验；错误字段下方提示并由 `/api/clusters/validate` 与真正 Run 的后端重复检查。**

特征从真实时间序列提取（平均、标准差、CV、日内峰谷、时段均值、工作日/周末、日/周季节性等），特征尺度处理显式可调。**“住宅区/商业区/办公区”只能作为基于流量模式的推测标签，不能声称是 GIS 土地使用真值**。聚类结果与参数保存可重现；不得把无时序区域填充为 0 来参加聚类。

---

# 6. Module 3：Forecasting Dataset Construction

## 6.1 左侧参数及行为

按顺序提供：

1. **Dataset/Location**：Milano、Trentino、ZTE，一次只选一个。
2. **Prediction Scope**：`Single Region`（必须选唯一一个有效区域）或 `All Regions`（该地点的全部有效时序区域）。**没有 Multiple Regions**。
3. **Temporal Resolution**：原生/30min/1h/1day，必要时显式 `sum/mean`。
4. **Sliding Window**：`Input Length L`、`Output Length H`、`Sliding Step S`；均按重采样后的“点数”计，帮助栏同时换算时间跨度。L≥1、H≥1、S≥1。
5. **Split**：Train/Validation/Test 时间序划分，默认 `70/15/15`；百分比加总=100，分配后每个集合须有合法窗口。
6. **Data Preparation**：自动质量检查；Advanced `Missing Handling: Automatic / Causal-safe Interpolation / Drop Invalid Windows`，`Scaling: StandardScaler (default) / MinMax / None`。ZTE 零保留；Scaler 仅在 Train 拟合，Test 输出逆变换评价。
7. **操作**：`Save & Build Dataset`、`Reset Configuration`。编辑引起实时预览变化，但不覆盖已保存 Dataset 版本。**L/H/S、粒度、比例、范围、缺测及标准化选项必须按 3.5 节实时校验：每个非法字段下方显示 Error，并阻止保存；周期窗口不足或预处理风险给出与错误区分开的真实 Warning，后端再次校验。**

## 6.2 滑窗、跨边界与时序泄漏

定义（对每个区域单独构造）：

```text
X_i = [v[t], ..., v[t+L-1]]       length L
Y_i = [v[t+L], ..., v[t+L+H-1]]   length H
next input start = t + S
```

- 所有 Y 的目标时间必须完全落在分配的 Train 或 Val 或 Test 段；可以使用规范中已观测的历史数据作为 Val/Test 的 X，但不能让 Y 跨越不同 split 的边界。
- 按时间先分段再创建目标合法的窗口索引，不要随机划分已重叠的滑窗造成目标泄漏。
- 预处理基于**预测起点之前已经观测到**的数据；不能用未来 Test 的目标值来插补 Test 的历史输入。用线性插值时，两个插值端点都必须在预测起点及以前并处于允许范围；否则改为因果填充或丢弃窗口。
- 标准化参数只拟合 Train 历史/目标可见范围，并保存在 Dataset 产物；训练中的 validation/test 复用。
- 固定 split 的实际日期边界、Test 预测首末有效窗口、所有窗口时间索引、region ID、数据 fingerprint，支持复现。
- **All Regions** 生成区域独立的 X/Y、窗口索引和质量信息，不把区域拼成一个复杂联合模型；不同区域有效窗口数量可不同，记录实际覆盖。

## 6.3 中央必须三个垂直堆叠的实时区

1. `Sliding Window Preview`：真实 X 历史与 Y 目标、各端点 timestamp、L/H/S 影响、滑窗移动。
2. `Chronological Split Preview`：真实的 Train/Val/Test 时间轴、各阶段目标日期范围、各阶段窗口数与边界。
3. `Forecast Time Preview`：Test 可预测覆盖时间、首个真实可用 X/Y、最后一个真实可用 X/Y、测试有效窗口数（All 显示区域摘要/可选查看区域）。

## 6.4 右侧 Tab 与管理

实现以下三个核心 Tab：`Dataset Overview`（参数、Dataset ID、Scope、窗口数）、`Window Preview`（Train/Val/Test、index、region 的真实 X/Y 样本）、`Data Quality`（文件/时间/区域/缺失/零/泄漏检查）。另增加第四个 `Dataset Management` Tab：记录表、Open、Archive、Delete、状态及创建时间；Reset 放操作区，不影响前三个 Tab。

### 原子构建规则

- Build 先全量校验并在临时目录计算 → 工件文件与数据库元数据事务一致 → 成功才生成 `Dataset ID` 并置 `Built`。
- Build 失败：保留上一个成功版本、保留草稿与错误原因、清理临时工件；不生成可选用的半成品 ID。
- 恢复历史 Dataset 时冻结其旧参数；修改须另存新的 Dataset ID。

---
# 7. Module 4：Model Training（含新增 All Models）

## 7.1 目的和不变量

- Module 4 读取 M3 已成功保存的 **Dataset ID**，其地点、区域、L/H/S、分割、预处理全部只读。
- 算法名单固定 **12 个**，可选单个算法或在列表顶部选择 **`All Models`**。
- 用户可以修改**当前算法的核心超参数**；All Models 则为每个算法保留**各自独立的可折叠参数组**，默认值和当前手动修改值清楚可见。不同算法禁止共享不兼容参数。
- 输出始终能接入 M5 统一 test inference 协议；`H` 继承 Dataset，不允许在训练面板单独改变。
- 提交运行时保存不可变 `dataset_snapshot + algorithm_params + model_versions + environment + seed`；修改已运行实验要通过 Duplicate 创建新草稿并重新运行。

## 7.2 左侧：配置和操作区

页面顺序固定：

1. **Dataset Selection**：只列 Built/Used 且有效的 Dataset ID，展示地点、Scope、区域、分辨率、L/H/S、Train/Val/Test 范围、预处理、测试窗口数，全部只读；不可将数据集切换后仍显示旧参数。
2. **Prediction Algorithm**：列表顶部一个独立的 **`All Models (12)`**；下方分类折叠：Statistical（ARIMA, Prophet）、Machine Learning（Random Forest, XGBoost, LightGBM）、Deep Learning（MLP, RNN, LSTM, GRU, Transformer）、Foundation（TimesFM, Chronos）。
3. **Model Parameters**：单模型展示 Basic/Advanced；All Models 展示 12 个独立配置折叠组、修改标记、恢复本算法默认值和 **Reset All Model Parameters**（需明确提示）；保持 `ⓘ` 说明。
4. **Execution Mode**：统计模型 Fit、ML/DL Train from Scratch；Foundation 预设 `Zero-shot`，只有所选 checkpoint/环境提供真实能力时才允许 `Fine-tuning`；不允许 Foundation 未证实支持的 Train from Scratch。
5. **Preflight Summary**：数据有效性、适配性、预计区域×模型任务数、磁盘、RAM/GPU、checkpoint 缓存、许可证、不可运行项/缺依赖项；需有 `Check Compatibility` 或运行前自动校验。
6. **Actions**：`Run Training`（在 All Models 可命名 `Run All Models`）、`Stop Training/Stop Batch`、`Reset Parameters`、`Save Model`、`Evaluate Model`。Save/Go Evaluate 只作用于可用的已完成模型/实验；运行过程记录由系统自动落库，Save Model 表示确认/导出已完成权重而非第一次才创建 Experiment ID。

**默认行为：** 选择 `All Models` 只是选编排，不立即启动任务；必须用户主动点击 Run。选择单个模型时不能把其它算法的参数错误算入当前模型验证。

## 7.3 `All Models` 的精确定义（核心需求）

`All Models` 是批量运行 **12 个算法**的功能，非新增算法，非模型融合，非自动挑选冠军，非把不同地点混在一起。

| Prediction Scope（来自 M3） | 模型选择 | Run 后结构 | 实际运行任务 |
|---|---|---|---|
| Single Region | 单一算法 | 1 个 Experiment ID | 当前单区的 1 个模型任务 |
| **Single Region** | **All Models** | **1 个 Batch ID + 12 个 Experiment ID** | 当前单区的 **12 个算法任务** |
| All Regions | 单一算法 | 1 个 Experiment ID（含 Experiment Group 语义）+ N 个区域子模型记录 | 所选一个来源内 N 个有效区域分别运行该算法 |
| **All Regions** | **All Models** | **1 个 Batch ID + 12 个 Experiment ID（每个是全区域 Experiment Group）+ 各算法的逐区域子模型** | **N×12** 区域-算法任务，默认顺序且可受控并发 |

N 随地点而定：Milano=88、Trentino=223、ZTE=148；因此 All Regions + All Models 的理论最大任务数分别为 **1,056 / 2,676 / 1,776**，实际任务数可因兼容性校验、数据质量或用户确认跳过策略而减少，界面分别显示 planned/eligible/skipped/completed/failed。

**ID 创建规则：**

- `Batch ID`：在用户确认批量 Run 后创建，记录 Dataset ID、Scope、12 个算法的配置快照、任务次序与资源政策；仅批量操作产生，不代表一个新算法。
- `Experiment ID`：一个算法一次启动一次创建；All Models 下由 Batch ID 关联**12 个各自独立的 Experiment ID**（若某项兼容性失败或用户拒绝，记录 `Skipped`/`Unavailable`，不可标 Completed）。
- `Region Model Record/ID`：All Regions 下，每个 `(experiment_id, region_id)` 有子任务状态与实际工件；模型预测必须始终使用这个区域对应的子模型或区域单独 Zero-shot 上下文。
- `Evaluation ID`：由 Module 5 创建，用于引用一组 Experiment ID；可直接从 Batch ID 一键填入其中所有已成功且可公平比较的实验，不改变历史。
- `Batch ID`、`Experiment ID`、`Dataset ID` 和 `Evaluation ID` 使用 UUID/ULID 或具备唯一性约束的可读 ID，不可凭列表位置生成或复用。

**举例（只是结构，不是已经存在的记录）：**

```text
DS-MILANO-ALL-... (M3)
       │
       ▼
BATCH-...  (M4 All Regions + All Models)
  ├── EXP-ARIMA-...        ├── Region-001 model/status
  │                        └── ... 88 regions
  ├── EXP-PROPHET-...      └── per-region records
  ├── EXP-RF-...
  ├── EXP-XGBOOST-...
  ├── EXP-LIGHTGBM-...
  ├── EXP-MLP-...
  ├── EXP-RNN-...
  ├── EXP-LSTM-...
  ├── EXP-GRU-...
  ├── EXP-TRANSFORMER-...
  ├── EXP-TIMESFM-...     ← Pretrained Zero-shot by default
  └── EXP-CHRONOS-...     ← Pretrained Zero-shot by default
       │
       ▼
M5: choose Batch ID → eligible experiment selection → EVAL-...
```

## 7.4 All Models 参数面板和批量执行策略

- 默认使用 **12 个独立 registry preset**，每种算法都有 `Basic / Advanced`；模型卡片显示算法名、类别、运行模式、使用默认值或自定义、参数预检状态。
- 提供 `Reset this model` 和 `Reset All`；恢复默认只影响当前草稿，永远不修改已保存 Experiment。
- `All Models` 的 **TimesFM、Chronos 默认 Zero-shot**；对于其它 10 个模型使用真实 Fit/Train。Foundation Fine-tuning 若可用可被用户**逐模型单独**切换，需再次估算资源。
- 默认**顺序执行**算法和区域任务；可以在高级设置里使用受限并发（CPU 任务可多进程，GPU 同时加载数限制为 1 或由资源配额决定）；严禁一次性建立几千个超大模型进程。
- 用户点击 Run 前弹出**批量确认对话框**：当前地点、Scope、12 模型清单、N 区域、任务数、检测到的可用资源、Checkpoint 状态、不可运行模型、潜在长耗时/大量磁盘占用及如何取消。**估计耗时**无可靠 benchmark 时明确“无法可靠估计”，不要编造分钟数。
- 预检错误分为 **Blocking**（如 Dataset 不可用、所有模型无有效输入）与 **Per-model Skippable**（如特定预训练权重不存在、单算法参数非法/环境依赖缺失）。默认要求用户修复或确认按可运行子集执行；每个跳过项保留原因。为了满足完整 12 模型验收，不允许把跳过模型当作通过。
- 一旦运行，Batch 生成可持久查询队列；批次显示 `Total/Eligible/Waiting/Running/Completed/Partial/Failed/Skipped/Stopped`。单个区域失败**不阻塞**其它区域（除非系统资源故障）；单算法失败在用户选择 `continue_on_error` 时继续剩余算法。
- Stop Batch 要及时设置取消标志：对尚未开始的任务置 `Cancelled/Skipped`，当前任务转 `Stopping`，后端 ack 后转 `Stopped`；已完成实验与工件保留。浏览器关闭、刷新和重新打开后状态可恢复；不允许仅前端停止计时器而后台还在运行。
- Batch 支持重新打开详情、筛选算法、查看单算法 Experiment 和单区域任务，支持从失败项创建**新批次/新实验**重试；历史批次快照不可原位修改。

## 7.5 中央 Training Monitor：单模型与 All Models 两种视图

**单模型：** 真实任务状态/运行耗时、当前算法阶段、进度、验证指标，DL 才显示真实 epoch Train/Validation Loss；Boosting 若有 eval_set 展示真实迭代指标；ARIMA/Prophet/Random Forest 只显示 fit 阶段/已完成/日志，不虚构 epoch。  
**All Models：** 顶部汇总任务计数、已完成模型数、总任务数、当前正在运行的算法；下方固定可排序的 12 模型状态表（Name, Mode, Progress, Completed Regions, Failed Regions, Status）；点某模型钻取其真实曲线/日志/区域状态。  
**All Regions：** 当前模型的区域状态列表、区域进度、成功覆盖范围；若部分区域失败 Experiment 标 `Partial`。  
**Zero-shot：** 显示 `Checkpoint Validation → Loading → Optional validation inference → Ready` 的真实阶段与耗时；**没有 Epoch 和训练 Loss**。选择 Zero-shot 时，M4 的成功意味着预训练模型已实测可推理、配置与检查点可复用；M5 再使用 Test 做正式评价。若资源允许可在 Validation 上给出真实验证指标，但 **M4 不展示 Validation Actual vs Predicted 曲线**。

## 7.6 右侧固定实现三个 Tab

| Tab | 具体要求 |
|---|---|
| `Training Overview` | 当前 Dataset/Experiment/Batch ID、真实状态、Scope、算法模式、不可变快照、区域覆盖、验证结果、开始/结束时间和耗时 |
| `Training Logs` | 后端实时日志（时间戳、级别、算法、region_id、错误码），支持过滤、复制/下载、批次/实验/区域三级筛选 |
| `Experiment History` | 历史 Batch/Experiment 列表、关联 Dataset、状态、创建时间、Model/Mode/Scope、Open/View、**Duplicate**、Archive、Delete（权限/依赖保护） |

管理功能应**放入 Experiment History 现有 Tab**，不要替换这三个 Tab，也不要新增一个把信息重复显示的第四 Tab。左侧 Run/Stop/Reset 与右侧历史管理互不冲突。

## 7.7 参数不合法时的交互

**本节为 3.5 节全局强制规则在 Module 4 的补充，不能理解为“仅点击 Run 时才校验”**：字段变更当下实时检查、每个 Error 紧贴对应输入框下方显示、Warning 另外显示，前后端必须使用同一 registry/schema 并在真正提交任务时执行后端权威校验。

在模型切换、Dataset 切换、All Models 参数变更以及点击 Run 前都进行实际检查：

- JSON 参数类型、范围、`d_model % n_heads == 0`、K/Fourier 参数及实际库可接受参数；
- `L/H` 与模型的输入维度/最大上下文、Samples vs minimum-window conditions、训练样本有效数量；
- 模型所需 CPU/RAM/GPU、框架版本、checkpoint 与许可；
- 对 `All Models` 分别呈现各算法的错误列表和可执行状态，**不能仅显示“Some errors”**；提供跳转至对应模型参数组。

参数警告与错误分开：例如 `Batch Size > number of samples` 并非对所有训练实现一定非法，需根据实际框架的 drop_last 与批处理策略决定；不能用未经证明的通用拦截规则。

---

# 8. 十二种算法及模型参数字典

## 8.1 不得修改的算法清单

| # | 分类 | 算法 | 主要用途 | 默认执行模式 |
|---:|---|---|---|---|
| 1 | Statistical | **ARIMA** | 单序列统计基线 | Fit |
| 2 | Statistical | **Prophet** | 趋势、日/周周期 | Fit |
| 3 | Machine Learning | **Random Forest** | 多输出树集成基线 | Train |
| 4 | Machine Learning | **XGBoost** | Boosting 多步预测 | Train |
| 5 | Machine Learning | **LightGBM** | 高效 Boosting | Train |
| 6 | Deep Learning | **MLP** | 神经网络基线 | From Scratch |
| 7 | Deep Learning | **RNN** | 循环序列学习 | From Scratch |
| 8 | Deep Learning | **LSTM** | 长期依赖 | From Scratch |
| 9 | Deep Learning | **GRU** | 轻量门控循环 | From Scratch |
| 10 | Deep Learning | **Transformer** | 自注意力时序预测 | From Scratch |
| 11 | Foundation Model | **TimesFM** ★ | 预训练时间序列大模型 | Zero-shot |
| 12 | Foundation Model | **Chronos** ★ | 预训练时间序列大模型 | Zero-shot |

**不添加 Informer、不替换 Prophet、不将 SARIMA 代替 ARIMA，也不能把 `All Models` 算为第 13 种算法。** 如果后续开发想增加额外候选模型，必须另外经过用户确认并更新 spec；本项目固定要求以上 12 个。

## 8.2 模型 Basic/Advanced 参数（全部需要 GUI 可调）

> 具体范围/default 由锁定版本的 model registry 配置并通过测试校验。以下是需要实现的**参数字段**和**建议初始预设**，不是适用于任何数据集的强制最佳超参数。

| 模型 | Basic（初始建议值） | Advanced 与关键约束 |
|---|---|---|
| ARIMA | `p=3`, `d=1`, `q=2` | `trend`, `enforce_stationarity`, `maxiter`；**普通 ARIMA 无 `seasonal_period`，季节 ARIMA 属于 SARIMA** |
| Prophet | `growth=linear`, `seasonality_mode=additive`, `daily_seasonality=auto`, `weekly_seasonality=auto` | `changepoint_prior_scale`, `seasonality_prior_scale`, `n_changepoints`；logistic 模式需 cap/floor，日周周期需足够时间跨度 |
| Random Forest | `n_estimators=200`, `max_depth=10`, `min_samples_split=2` | `max_features`, `min_samples_leaf`, `bootstrap`, `random_state`, `n_jobs`; 支持多输出策略 |
| XGBoost | `n_estimators=300`, `max_depth=6`, `learning_rate=0.05` | `subsample=0.8`, `colsample_bytree=0.8`, `reg_lambda`, `tree_method`, early stopping（取决于选定 API） |
| LightGBM | `n_estimators=300`, `num_leaves=31`, `learning_rate=0.05` | `max_depth`, `feature_fraction`, `bagging_fraction`, `min_child_samples`, early stopping；不同版本的采样参数要检查依赖 |
| MLP | `hidden_layers=2`, `hidden_units=128`, `dropout=0.2`, `learning_rate=0.001` | `activation`, `epochs=100`, `batch_size=64`, `optimizer`, `weight_decay`, `early_stopping` |
| RNN | `hidden_size=64`, `num_layers=2`, `dropout=0.2`, `learning_rate=0.001` | `nonlinearity`, `epochs=100`, `batch_size=64`, `gradient_clip`; 单层时 recurrent dropout 语义检查 |
| LSTM | `hidden_size=128`, `num_layers=2`, `dropout=0.2`, `learning_rate=0.001` | `bidirectional=false`, `epochs=100`, `batch_size=64`, `weight_decay`, `gradient_clip`, `early_stopping` |
| GRU | `hidden_size=128`, `num_layers=2`, `dropout=0.2`, `learning_rate=0.001` | `epochs=100`, `batch_size=64`, `weight_decay`, `gradient_clip`, `early_stopping` |
| Transformer | `d_model=128`, `n_heads=8`, `encoder_layers=3`, `dropout=0.1` | `dim_feedforward=256`, `learning_rate=0.0001`, `epochs=100`, `batch_size=64`, `positional_encoding`, `warmup`; 必须 `d_model % n_heads == 0` |
| TimesFM | `checkpoint_id`, `mode=zero_shot`, `effective_context_length=min(L, supported_max)` | `device`, `dtype`, `inference_batch_size`，checkpoint 特有选项；Fine-tuning 参数仅在对应**具体版本确证支持**后显示 |
| Chronos | `checkpoint_id`, `mode=zero_shot`, `effective_context_length=min(L, supported_max)` | `device`, `dtype`, `inference_batch_size`, 输出统计量/分位数、采样参数（仅适用模型变体）；Fine-tuning 同样需真实支持 |

**共通训练参数**：随机种子、后台并发/设备、早停监控时机、保存策略。深度学习才显示 epochs/批大小；模型特有参数必须清楚标注支持范围与单位。`Forecast Horizon/Prediction Length` 只能展示 **Dataset H（只读）**，不允许额外改动。

## 8.3 输入输出合同（实现时统一）

```text
Fit/Train inputs by one region:
  X_train : [N_train, L]   (or [N_train, L, 1] for DL)
  Y_train : [N_train, H]
  X_val   : [N_val,   L]
  Y_val   : [N_val,   H]

Prediction output by one region:
  y_hat   : [N_test, H]    # finite point forecast
  target timestamps: [N_test, H]
```

所有模型的最终输出要映射为 `float64/float32` 有限值数组并保存目标时间锚点；非有限结果按失败/无效预测处理，不可用 0 偷换。多输出方法：Random Forest 可原生多输出，XGBoost/LightGBM 可采用经实测的 MultiOutputRegressor 或 direct-horizon 多模型法；方法写入 Experiment Snapshot。ARIMA/Prophet 可以按窗口/测试锚点滚动拟合/更新，**预测起点前必须已经观测到的数据**才能用于更新，禁止“fit 全时段后再说是 Test 预测”。这样造成的模型每起点拟合时间应明确计入推理成本并提供性能防护。

### 预处理适配

- 训练型模型根据 M3 数据集配置使用训练集 fit 的 scaler；逆变换成真实源单位后评估。
- Foundation adapter 应根据具体预训练 API 处理输入缩放：如果 checkpoint 内部带 per-context scaling，需传正确的观测量尺度或做受控转换，**不能无论版本一律再套一次 M3 scaler**；输出必须回到同一来源单位。
- 任何模型的补零/padding、窗口截断、异常值裁剪都必须在快照中记录，且不得读取未来目标。

## 8.4 Foundation Models：两个大模型的强制实现规则

- **TimesFM** 和 **Chronos** 必须是实际可调用的**预训练模型推理**，而非 Transformer 自己起名或无效网络占位。
- 以官方实现为首选参考：TimesFM `https://github.com/google-research/timesfm`；Chronos `https://github.com/amazon-science/chronos-forecasting`。锁定可安装、在目标机器上能推理的确切 SDK、checkpoint、许可证与模型权重 hash/revision。
- TimesFM 3.0 官方代码与**权重许可证不同**：3.0 的自托管预训练权重有非商业/非生产限制；2.5 及规范中权重许可证按官方当前说明分别检查。不要默认拿 3.0 模型权重作为生产公网在线服务。**课程非商业用途、公开部署、重分发是不同许可场景**，务必确认后采用兼容 checkpoint；必要时选择有许可余地的早期模型或合法官方云服务，但必须真实推理。
- Chronos 是模型家族，有原始 Chronos / Chronos-Bolt / Chronos-2 等变体；本项目 UI 的 **Chronos 算法计数仍为 1**，checkpoint/变体作为模型参数，不能将不同变体偷偷计入额外算法。采样 `temperature` 仅在具体 checkpoint 的 API 确实支持时显示，不当作所有 Chronos 版本共有参数。
- `context_length` 显示**真实传入的 L 中可用历史点数**，若 L 小于所需上下文，不得凭空读取更早或未来数据；合法 padding 要明示。不同 checkpoint 的最小/最大上下文、H、dtype、设备要求预检。
- 真实 Zero-shot 默认必做；Fine-tuning 为可选增强，只有实现、版本与资源确实支持才能从 Disabled 升级 Enabled。Zero-shot 模式绝不显示 Train Epoch/Train Loss。
- 权重首次下载可能需要联网/用户许可确认；离线找不到权重显示 `Unavailable: weights missing`，链接或操作说明清楚，缓存目录可配置，不要把多 GB 权重直接提交到 Git。
- 验收中对 TimesFM/Chronos 要单独提供真实推理 smoke test（固定短输入→长度 H 的有限输出）、版本/设备/耗时日志与安装说明。

---
# 9. Module 5：Prediction & Evaluation

## 9.1 基本流程

先选 Dataset/地点 → 选 `Single Region` 或 `All Regions` → 选择一个或多个兼容 Experiment ID（可以由 **Batch ID 一键载入其中的可比较成功实验**）→ 只读 Snapshot → 选 `Full Test`（默认）或显式 `Selected Test Range` → `Run Prediction` → 后端真实推理 → 生成 Evaluation ID → 图形/指标/排行与导出。

任何来自 M4 的算法，无论 ARIMA、XGBoost、LSTM、Transformer 还是 TimesFM/Chronos，评价一律使用同地点、同目标时间锚点、相同 H、可比较的 held-out Test 真实值；**不能因为大模型而采用不同指标或优待排名**。

## 9.2 左侧 Evaluation Setup

- **Location / Dataset Source**：一次一个地点。
- **Evaluation Scope**：`Single Region` 选一个区域，候选包含历史单区 Experiment 或 All Regions Experiment 中该区域已完成的子模型；`All Regions` **只允许全区域实验组**（来自同一所选地点），不会将各不相关的 Single Region 实验临时拼成“全区域实验”。
- **Experiment IDs**：多选，显示模型、模式、Checkpoint 版本、Dataset ID、覆盖区域数、Test 日期、兼容状态与参数摘要。
- **Batch ID 快捷入口**：按 Batch ID 一键载入该批次成功的 Experiment，不允许自动吞掉失败原因；不兼容者要列出，提醒改选 Dataset/目标窗口。
- **Read-only Snapshot**：来源、Scope、区域、L/H/S、时间粒度、preprocess、Train/Val/Test 边界、模型超参数、Foundation checkpoint 与设备。
- **Test Range**：`Full Test` 正式分数；`Selected Test Range` 是指定可视化/子集结果，若计算得分必须标注其子集来源，不能以此替代 Full Test 评分。
- **Actions**：Run Prediction、Stop、Export Results、Reset Selection，删除和历史在右侧。

## 9.3 中央四个 Tab（不改变三栏整体布局）

| 中央视图 | Single Region | All Regions |
|---|---|---|
| `Prediction Comparison` | 同一目标时间的 Actual 与多个 Model Predicted 曲线，提供特定 horizon step / 单窗口切换 | 默认区域平均曲线/模型比较，支持单区域钻取；禁止直接绘制几百条重叠线 |
| `Error Analysis` | 残差时间序列、分布、模型误差对比 | 按区域或整体宏/微误差，单区失败原因可查 |
| `Forecast Horizon Analysis` | step=1…H 的 MAE/RMSE 等曲线，不更改 H | 按预测步长汇总全区域 macro 及有效样本数 |
| `Spatial Evaluation` | 无效/隐藏或解释仅 All 可用 | GeoJSON 图层按真实 `Actual / Predicted / Absolute Error / Relative Error` 切换，时间锚点清晰，No Data/Failed 单独图例 |

**重叠预测处理：** 一个目标时间可能由多个滑动窗口/不同 horizon step 产生预测。图表默认使用固定 horizon step 绘制连续趋势；也可以在单窗口视图展示 H 点。指标计算默认按 `(region_id, window_start, horizon_step)` 每个样本计一次，若提供去重/聚合规则必须重新计算并明示，不得一张图使用一种协议、模型排行榜用另一种却不告知。

## 9.4 右侧三个功能 Tab＋历史管理

右侧上方设计以下三个 Tab：

1. **`Metrics Overview`**：MAE、RMSE、sMAPE、R²，支持多个模型并排，给出逆变换前后标识、实际样本数、Full Test/Selected Range 标识、评价协议说明。
2. **`Model Ranking`**：默认按 RMSE 升序；可以按 MAE、sMAPE、R² 切换；显示算法名、Fit/Zero-shot/Fine-tuned、兼容共同区域/共同目标时间覆盖、失败/跳过原因。
3. **`Regional Performance`**：Single 查看当前区域详细评分；All 查看每区域模型名、最优模型、各区域指标、最好/最差区域、Coverage 与缺失情况。按实际指标排名，不让无数据区域填 0 混入。

右侧**三个功能 Tab 下面放置可折叠 `Evaluation History / Management`**（不要替换 Tab）：历史 Evaluation ID、对应 Batch/Experiment、状态、创建时间、View、Export、Delete；底部 `Reset Selection`。删除 Evaluation 只删自己的 prediction/metrics/cache 和元数据，不删上游 Experiment 或 Dataset。涉及删除弹确认窗，并且操作后刷新历史列表。

## 9.5 指标定义与特殊情况

采用逆标准化的真实来源量纲：

```text
MAE  = mean(abs(y - yhat))
RMSE = sqrt(mean((y - yhat)^2))
sMAPE = 100% × mean(2 × abs(y - yhat) / (abs(y) + abs(yhat)))
R²   = 1 - sum((y-yhat)^2) / sum((y-mean(y))^2)
```

- sMAPE 对 `abs(y)+abs(yhat)=0` 的项统一定义为 0 贡献，其他接近 0 的项需按固定 epsilon 规则保护并在评价快照记录；**ZTE 的真零不得删除**。
- 当真实值全为常量而 R² 分母为 0 时显示 `N/A` 并解释，不能随意给 0 或 1。
- All Regions 的默认整体排名指标是 **每个成功区域等权宏平均 (Macro)**，另可查看逐预测点合并的 **Pooled/Micro**；两者需分别命名，显示覆盖区域数量及统计量。
- 不同 Dataset 归一化方式、测试目标时间不相同不得混做模型冠军排行；按相交测试锚点计算的“共同 Test 子集”需与 Full Test 分开说明。
- 图表和地图的所有示例结果必须由真实后端返回；空历史显示 Empty，不允许使用示意虚假分数或伪造评价日志。

---

# 10. 对象 ID、状态生命周期与管理

## 10.1 实体关系

```text
Data Source (one of Milano / Trentino / ZTE)
   └── Dataset ID              # snapshot: source + region scope + L/H/S + splits + preprocessing
         ├── Experiment ID    # single selected algorithm run (1 dataset, 1 algorithm)
         │      └── Region Model Artifact (for All Regions)
         └── Batch ID         # optional, only when All Models selected
                ├── Experiment ID (ARIMA)
                ├── ...
                └── Experiment ID (Chronos)
                       └── Region Model Artifact(s)

Evaluation ID (M5): references 1..N Experiment IDs; optionally from Batch ID
```

- 1 Dataset ID → 任意数量 Experiment ID；1 Batch ID → 12 个算法实验计划/状态；1 实验可参加多个 Evaluation ID；一个 Evaluation 可引用多实验。
- Batch 只管理执行分组，不改变模型物理结构与真实含义。
- ID 唯一，所有快照不可变，创建时间统一持久化（后端 UTC 存储、前端按用户本地时间显示）。

## 10.2 状态字典（后端为真相）

| 对象 | 核心状态 | 其它字段 |
|---|---|---|
| Dataset | `Built / Archived` | Draft 仅前端、`is_referenced`、创建时间、fingerprint |
| Batch | `Created → Running → Stopping → Completed/Partial/Failed/Stopped` | 总数/各状态数/取消标记/continue_on_error |
| Experiment | `Queued → Running → Stopping → Completed/Partial/Failed/Stopped/Skipped/Unavailable/Archived` | algorithm/mode、区域覆盖、错误、模型 artifact |
| Region Model | `Queued/Running/Completed/Failed/Stopped/Skipped` | region_id、checkpoint/weight、验证信息 |
| Evaluation | `Queued/Running/Stopping/Completed/Failed/Stopped` | `exported_at` 为属性而不是独立完成状态 |

**Completed** 不得包含失败的目标区域并宣称完全完成；部分成功须 `Partial`，完整汇总覆盖数明示。Stop 请求发送后必须后端确认后才能显示 Stopped。重启后根据持久任务恢复/转失败，不能一直假 Running。

## 10.3 Reset、Duplicate、Delete、Archive 规则

| 模块 | Reset | Duplicate | Delete / Archive |
|---|---|---|---|
| M3 | 当前草稿重置为打开的已保存配置或默认值 | 如实现 Duplicate Dataset，只创建待保存草稿 | 未被引用的 Dataset 可硬删；被任何 Experiment 引用仅 Archive |
| M4 | 只重置当前可编辑算法参数，All Models 可全部重置 | 复制 Dataset 引用、模型与参数到新草稿；**运行时才创建新 Experiment ID** | Running 要先 Stop；被 Evaluation 引用的 Experiment/Batch 内实验不能硬删，只 Archive；否则清理其实际工件 |
| M5 | 清除当前选项、临时筛选与未保存视图，不删历史 | 可重复运行生成新 Evaluation ID | 删除 Evaluation ID 与自己的预测/指标/缓存，不影响 Dataset、Experiment 或模型权重 |

删除展示影响范围、依赖检查与二次确认。数据库维护外键；删除物理文件使用白名单与路径验证，只允许删除已注册的 artifacts，严禁路径穿越。`Archive` 仅从主要选择器隐藏，不解除历史引用；可在历史界面查看或恢复其可查看状态。

---

# 11. 核心计算协议、泄漏防护与公平性

## 11.1 数据构建与预测起点

- 全链路记录源时间戳，无未经声明的时区转换；每个 `X/Y` 有 `input_start_at/input_end_at/target_start_at/target_end_at/forecast_origin_at`。
- `Val/Test` 预测可以使用预测起点之前已观察到的真实历史输入；若采用**滚动起点 (rolling origin)**，每个起点之后的目标在该次推理前不可见，已到达起点前的数据是否可用于统计模型更新必须在 Evaluation Protocol 中固定，不能各模型各做一套不透明规则。
- 训练/早停只使用 Train/Validation；Test 一旦用于模型超参数挑选，就不能仍称为未经污染的最终测试；重调后需公开说明或重新留出测试集。
- 所有缺失值处理、标准化、模型加载、预测结果转换均不能在当前预测起点读取未来 Y；统计模型滚动重拟合也受此约束。

## 11.2 兼容性和排名

多模型正式比较须检查以下字段一致：`source_fingerprint`, `scope`, `region_set`, `native/target_resolution`, `L/H/S`（至少 H 与预测协议一致），`target timestamps`, `test selection`, `metrics protocol`, `unit_label`。如果 L 不同但其他相同，允许在**明确提示输入历史不同**的专门实验对照中查看预测曲线，但不自动视为完全等条件的排行榜；默认使用同 Dataset ID 进行严格比较。

**All Models 初始最佳实践：** 12 个算法全部来自同一个 Dataset ID 和一致的 Test Protocol，并绑定同一个 Batch ID，M5 能够比较成功实验。无法推理/没有产物的项只进入“未评价列表”，不进入排名；不可为了凑满 12 行填补随机成绩。

## 11.3 可重现性

每个实验保存：源文件指纹、数据集指纹、区域映射、所有参数、聚合与填充、split、scaler、random seed、Python/library/OS/GPU 信息、算法/adapter 版本、大模型 checkpoint、配置 hash、日志、测试预测输出 hash。零样本 foundation 输出如果存在概率采样，固定 seed 并保存采样方式；优先使用确定性点预测作为 M5 主评分。

---

# 12. 推荐技术架构、数据库与文件结构

## 12.1 技术选型

推荐：**React + TypeScript + Vite**（前端），**Ant Design**（表单与布局）、**ECharts**（图表）、**Leaflet + GeoJSON**（GIS）、**FastAPI**（Python API）、**pandas/numpy/scipy**（计算）、**scikit-learn、statsmodels、Prophet、XGBoost、LightGBM、PyTorch**（训练）、官方兼容 **TimesFM 与 Chronos** 推理适配层；**SQLite（本地元数据）/ PostgreSQL（云部署可选）**、SQLite 单机开发时注意锁与 Worker 并发；数据库迁移可用 Alembic。长任务后台 Worker 独立进程，允许中断/重试/心跳；SSE/WebSocket/轮询更新进度。机器学习模型与结果工件存文件系统/对象存储，不存大二进制 blob 到数据库。

**技术版本约束：** Python/Node/依赖和模型权重均需 lock/pin；针对 Windows 和部署 Linux 分别做 smoke test，不可假设 TimesFM/Chronos 相同依赖栈一定兼容。若大型框架冲突，采用独立 Python 环境或隔离 worker，仍用统一后端接口提供结果。

## 12.2 推荐目录

```text
TN-Traffic-Intelligence/
├── PROJECT_SPEC.md                  # 本文件 v3.1
├── README.md
├── frontend/
│   ├── public/brand/                # tn-logo.svg, logo.png, favicon.ico；没有头像
│   └── src/
│       ├── app/                     # routes, app shell, two-row top navigation
│       ├── pages/                   # Home + Module1..Module5
│       ├── components/              # ThreePaneLayout, Map, Chart, Tooltip, Status, History
│       ├── services/                # typed API client + events
│       └── styles/                  # unified design tokens
├── backend/
│   ├── app/api/                     # data, analysis, clustering, datasets, models, batches, evaluations
│   ├── app/services/                # ingest, stats, features, windows, validation, metrics
│   ├── app/forecast/                # model registry and exactly 12 algorithm adapters
│   ├── app/workers/                 # durable tasks, queue, cancel, checkpoints
│   ├── app/db/                      # schemas, SQL migrations
│   └── tests/                       # unit, integration, model smoke, e2e fixtures
├── data/
│   ├── raw/                         # six inputs (or external DATA_DIR)
│   ├── processed/                   # validated time series, per-region windows
│   └── artifacts/                   # datasets, scalers, models, checkpoints, predictions
├── scripts/                          # start_windows.bat/ps1, check_env, smoke_test, backup
├── docs/
│   ├── USER_GUIDE.md
│   ├── ARCHITECTURE.md
│   ├── API.md
│   ├── MODEL_REGISTRY.md
│   ├── DEPLOYMENT.md
│   ├── TEST_REPORT.md
│   └── UI_REFERENCE.md
├── .env.example                      # no secrets
├── pyproject.toml / requirements lock
├── package-lock.json / pnpm-lock.yaml
└── docker-compose.yml                # optional production setup
```

## 12.3 最低数据库实体（可按规范化拆表）

| 表 | 核心字段及外键 |
|---|---|
| `data_sources` | id/key, file paths, units, native_resolution, fingerprint, imported_at |
| `regions` | source_id, region_id, display_name, geometry_key, has_timeseries, validation |
| `dataset_versions` | dataset_id, source_id, scope, region_ids, frequency, aggregation, L/H/S, split_ranges, preprocess_snapshot, scaler_ref, status, hash |
| `dataset_windows` | dataset_id, region_id, split, sample_index, input/target start/end, window_artifact_ref |
| `batches` | batch_id, dataset_id, all_models=true, params_snapshot, status, task_summary, cancel_requested |
| `experiments` | experiment_id, dataset_id, nullable batch_id, algorithm_key, model_version, mode, params_json, status, error, created/started/ended |
| `experiment_region_models` | experiment_id, region_id, model_artifact_ref, checkpoint_ref, validation_metrics, status, logs_ref |
| `evaluations` | evaluation_id, dataset_id, scope, protocol_json, metrics_summary, status, created_at, exported_at |
| `evaluation_experiments` | evaluation_id, experiment_id, coverage, result_artifact_ref, metrics_json |
| `evaluation_predictions` | evaluation_id, experiment_id, region_id, input_origin_at, target_at, horizon_step, y_true, y_pred, is_valid |
| `jobs` | job_id, parent_batch_id, experiment_id/evaluation_id, region_id, state, heartbeat, progress_struct, cancel_requested, error_code |
| `audit_events` | user/session (if enabled), resource, action, timestamp, details |

**约束**：有 foreign keys + uniqueness + indexes（如 dataset_id/experiment_id/batch_id/region_id/target_at）；Batch 成员 12 个算法 key 不重复；任务资源路径安全且具有引用关系；数据库不可因为断网/断电而留下虚假 Completed 的任务状态。

## 12.4 Schema/Model Registry 契约

每个模型应由统一 adapter 对外提供 `validate(dataset, params, mode, environment)`, `fit_or_prepare(train,val)`, `predict(window_inputs, horizon, origin_times)`, `save/load artifact`, `stop/cancel`, `capabilities`。`capabilities` 至少包含 `supports_zero_shot`, `supports_finetune`, `has_epoch_progress`, `requires_checkpoint`, `supports_cpu`, `max_context`（若可知），而不是前端硬编码“所有大模型可微调”。

注册表中共有 `12` 个 algorithm key，例如：

```json
{
  "key": "lstm",
  "label": "LSTM",
  "category": "deep_learning",
  "default_mode": "train",
  "supports_all_regions": true,
  "params": {
    "hidden_size": {"type": "integer", "default": 128, "min": 1},
    "num_layers": {"type": "integer", "default": 2, "min": 1},
    "dropout": {"type": "number", "default": 0.2, "min": 0, "max_exclusive": 1}
  }
}
```

具体默认值和 validation 由 registry 保持 API/前端一致；每个字段须配单位与中文帮助文本。**新增统一字段约束元数据**：`required`, `enum`, `exclusive_min/exclusive_max`（适用时）, `integer`, `visible_when`, `enabled_when`, `depends_on`, `error_code`, `warning_rule`, `help_zh`, `suggestion_zh`，以及数据/环境依赖检查器；后端是最终校验执行者，前端不得自创相矛盾的判断。Foundation 检查点能力是动态查询/锁定数据，不用前端“假开启”按钮。

---
# 13. API、后台任务与前端状态契约

## 13.1 最低 REST API 能力

> URL 样例可根据新项目的清晰命名习惯调整，但请求校验、状态语义及功能不可缩水。所有复杂请求应以 POST JSON/文件接口承载，GET 参数不承载巨大模型配置。

| 方法 / 路径（建议） | 用途 / 最低返回 |
|---|---|
| `GET /api/health` | 运行状态、版本、后台 Worker/DB 可用性，不能把 GPU 缺失当整体 UI 不可运行 |
| `GET /api/data/sources` | 三地点、采样粒度、有效区域、时间范围、单位、指纹 |
| `GET /api/data/regions?source_id=` | region ID/name、has_timeseries、GIS 键/质量信息 |
| `GET /api/data/geometry?source_id=` | GeoJSON（或 GIS tile）和可用区状态 |
| `GET /api/data/series` | region、时间范围、粒度、聚合，真实时间序列 |
| `POST /api/analysis/temporal` | 统计、曲线、日内/周内分析，具体有效样本数 |
| `POST /api/analysis/spatial` | 空间分布、区域排名、GIS 数据 |
| `POST /api/analysis/compare` | 跨地点归一化模式及免责声明 |
| `POST /api/clusters/validate` | 特征/算法参数及可运行性检查 |
| `POST /api/clusters/run` | 真实聚类任务 ID、结果链接或 job 状态 |
| `GET /api/clusters/{id}` | cluster labels、质量、典型模式、GIS 键 |
| `POST /api/datasets/preview` | L/H/S、split、首末窗口、预览质量（不持久 Dataset ID） |
| `POST /api/datasets/validate` | 数据是否可构建、窗口数、错误列表 |
| `POST /api/datasets/build` | 幂等创建 Dataset 构建任务，成功后返回 Dataset ID |
| `GET /api/datasets` / `{id}` | 历史列表/具体不可变快照及质量 |
| `POST /api/datasets/{id}/archive` | archive、依赖检查；未引用时可 DELETE |
| `GET /api/models/registry` | **12 条算法记录**、分组、参数 Schema、help、动态能力 |
| `POST /api/models/preflight` | 单模型或 All Models 的真实兼容性预检报告 |
| `POST /api/experiments/run` | 创建**单模型** Experiment ID 和 job |
| `POST /api/batches/run` | 创建**All Models** Batch ID、12 算法实验计划及后台队列 |
| `GET /api/batches` / `{id}` | 批次及各算法/各区域状态、任务汇总、snapshot |
| `POST /api/batches/{id}/stop` | 后端记录取消请求、真实停止进度 |
| `GET /api/experiments` / `{id}` | experiment snapshot、mode、状态、region models、logs |
| `POST /api/experiments/{id}/stop` | 单实验停止（后端 ack 后显示 Stopped） |
| `POST /api/experiments/{id}/duplicate` | 返回可编辑草稿数据，不创建已完成 Experiment ID |
| `GET /api/jobs/{id}` / `GET /api/jobs/{id}/events` | 真实状态、job progress、SSE 事件或轮询 |
| `POST /api/evaluations/validate` | 共同 Test、region/horizon/时间锚点兼容报告 |
| `POST /api/evaluations/run` | 选择一或多 Experiment/Batch 解组成员创建 Evaluation ID |
| `GET /api/evaluations` / `{id}` | 真实预测、指标、覆盖、状态、关联实验 |
| `GET /api/evaluations/{id}/export` | CSV/JSON 或可视化报告，标协议与来源 |
| `DELETE /api/evaluations/{id}` | 确认删除本评价及其预测工件，不删上游模型 |

**参数校验专项契约（强制 3.5 节）**：所有保存/运行接口都须在后端校验。推荐 `/api/validation/schema` 提供模型/模块参数的统一可读 schema，以及 `POST /api/validation/check` 返回字段级 Error/Warning/Info；已有 `/api/datasets/validate`、`/api/models/preflight`、`/api/evaluations/validate` 继续承担领域校验，聚类使用 `/api/clusters/validate`。前端可以按需 debounce 调用，后端的实际 build/run **必须再调用同一个 validator**，不能只在预检接口验证。结构示例：

```json
{
  "valid": false,
  "issues": [
    {"path": "model.params.dropout", "code": "OUT_OF_RANGE", "severity": "error",
     "message": "Dropout 必须在 [0,1) 内。", "suggestion": "请将 1.5 改为 0 到 1 之间的数值。", "received_value": 1.5},
    {"path": "model.params.epochs", "code": "LONG_TRAINING", "severity": "warning",
     "message": "Epochs 很大，预计运行时间较长。", "suggestion": "可降低 Epochs 并考虑早停。", "received_value": 10000}
  ],
  "request_id": "<server-generated-id>"
}
```

上述 `request_id` 是格式示例、不是固定真实 ID；`severity` 与 `path` 不得丢失。只有 Warning 且没有 Error 时 `valid=true`。**HTTP 请求如包含阻断性 Error，实际提交端点返回 422/409 并且不会创建作业或改变保存对象。**

API 需要 OpenAPI 自动文档、统一错误码和请求追踪 ID；分页/排序/过滤；输入使用 Pydantic 等 Schema 校验。不可把所有训练结果当一个同步 HTTP 请求等待几分钟，长任务必须 job 化。

## 13.2 提交 All Models 的请求/响应示例（契约示意）

```json
POST /api/batches/run
{
  "dataset_id": "DS-EXAMPLE-001",
  "algorithm_choice": "all_models",
  "execution_policy": {
    "sequential": true,
    "continue_on_error": true,
    "skip_unavailable_after_confirmation": true,
    "max_concurrent_gpu_jobs": 1
  },
  "model_configs": {
    "arima": {"mode": "fit", "params": {"p": 3, "d": 1, "q": 2}},
    "lstm": {"mode": "train", "params": {"hidden_size": 128, "epochs": 100}},
    "timesfm": {"mode": "zero_shot", "params": {"checkpoint_id": "SELECT_VERIFIED_CHECKPOINT"}},
    "chronos": {"mode": "zero_shot", "params": {"checkpoint_id": "SELECT_VERIFIED_CHECKPOINT"}}
  },
  "request_idempotency_key": "USER_GENERATED_UNIQUE_KEY"
}
```

**说明**：`model_configs` 可以只列用户改动的模型，其余自动使用 registry 默认参数，并在后端展开为**完整的 12 模型冻结快照**。上例省略 8 个模型仅为了节省版面；运行时 `batch_experiments` 必须为 12 个 algorithm key 各有明确状态（包含 Skipped/Unavailable）。`SELECT_VERIFIED_CHECKPOINT` **只是占位，不能拿它实际调用模型**。

```json
202 Accepted
{
  "batch_id": "BATCH-EXAMPLE-001",
  "dataset_id": "DS-EXAMPLE-001",
  "status": "Queued",
  "algorithm_count": 12,
  "region_count": 88,
  "planned_region_model_tasks": 1056,
  "experiment_ids": ["EXP-EXAMPLE-ARIMA", "EXP-EXAMPLE-PROPHET", "..."],
  "job_id": "JOB-EXAMPLE-001"
}
```

此处 ID 和数量为**文档示例**，页面/日志不能直接使用为运行结果。`region_count` 必须从实际 Dataset Snapshot 读取；不能硬编码 88。对于 Single Region，示例的任务数应为 12。

## 13.3 后台调度与停止

- 后台任务由真正 Worker 执行，持久化创建/开始/结束/错误/心跳/进度，不依赖浏览器会话活着。
- `Run` 采用 idempotency key 防止双击重复提交；若断网重试返回原 job/batch。
- 状态推送可 SSE，掉线降级轮询；前端展示最后后端更新时间，不自行“平滑到 100%”。
- 采用资源锁：数据文件不被任务互相覆盖，模型权重缓存去重，GPU/CPU/磁盘受配额限制；一次性访问大 GeoJSON 和几千任务应分页/增量处理。
- Worker 重启后读取数据库中的未完成任务并按资源策略恢复或按事实标 Failed/Interrupted，禁止自动覆盖已成功 Experiment。
- 单模型/批次 Stop 操作须传播到 per-region job；已完成子区域工件保留。若第三方原生训练库不可安全中断，至少在区域/阶段边界检查取消标记，UI 诚实说明当前操作仍在收尾。

## 13.4 Frontend/Backend 一致性

- **新增不可绕过的实时校验合同**：界面字段每次有效变动触发本地 schema 验证，依赖真实环境/数据的规则请求后端并采用版本号防止响应竞态；错误在该字段下方、警告单独展示。每个 POST Build/Run 必须调用同一后端 validator 进行权威校验，失败有结构化 `path/code/severity/message/suggestion` 并保持事务无副作用。详见 3.5 节。
- 路由建议 `/`, `/exploration`, `/clustering`, `/dataset`, `/training`, `/evaluation`；路由切换期间正确处理未保存草稿。
- 导航顶部两行固定在全局壳；M1/M2/M3/M4/M5 的左中右是内部布局，不加入永久全局侧边栏。
- 每个 Tab 对应单独的视图状态，刷新页面时当前 job/Experiment 可从 URL query 或持久 DB 恢复。
- 时间序列图形优先按视口采样/流式数据传输，导出的完整数据仍保持精度；GIS 缓存 GeoJSON，避免每次点击所有区域重载。

---

# 14. 品牌资源、安装与部署、安全和性能

## 14.1 UI 资源及 Logo 交付规范

- 输出 `frontend/public/brand/tn-logo.svg`, `tn-logo.png`（透明）, `favicon.ico` 等文件；项目名称统一为 `TianNuo Traffic Intelligence`。
- 顶部 Hero 横幅可以使用授权的城市／道路风格插画或 CSS 设计，与 TN Logo 协调，清晰、不过分花哨。
- **明确不使用任何卡通人物或头像**；不把早期带人物的 UI 图片当最终参考。
- 正式 UI 参考：用户最近确认的**无卡通人物、蓝白交通横幅、顶部双行导航、Module 4 三栏**风格。示意图内的假训练曲线/示例 ID/日期不可在真实系统固定写死。
- 首页数据与模型统计必须实时由后端返回，如没有实验就为空态，不出现虚假“Recent Activity”。

## 14.2 Windows 本地运行基础 + 可安装交付路线

- `scripts/check_environment.ps1`：检查 Python/Node/依赖版本、磁盘空间、数据文件路径、模型权重缓存、CPU/GPU 和端口占用；在控制台给出可操作错误。
- `scripts/start_windows.bat` / `.ps1`：在文档规定的环境可一键或少量命令启动前后端，自动打开浏览器（可选），显示真实本地地址。
- 如果正式前端 `vite build` 已编译，优先让 FastAPI/反向代理统一服务静态资源与 API，不强制提交用户安装开发服务器。
- **若选择正式交付路线 A，Windows 安装器是必须的**：创建可信可重复的 `.exe/.msi` 等安装产物，能安装应用、初始化数据/数据库、启动真实前后端，并提供卸载方式；在干净系统验收。若采用 WebView/Electron/Tauri 容器，必须真正在同一安装包或可靠的首次配置中管理 Python/Worker 与依赖；不可只做静态外壳或空浏览器快捷方式。
- 在 **没有 GPU** 的 Windows 设备上至少 M1–M3、普通 10 算法中可支持 CPU 的部分应当能运行；对大模型明确硬件和下载条件，不把网络缺失解释为“已训练成功”。

## 14.3 公网部署（正式交付路线 B）

- Docker Compose 或等效方式，外部端口只提供合适的 Web 入口；API/Worker/DB/数据卷/模型工件隔离、持久化。
- 提供 `.env.example`（不得包含真实密钥）、HTTPS 方案、日志轮转、备份恢复说明、健康检查和依赖锁。
- **若选择正式交付路线 B**，必须由开发者/用户**真实部署并验证 URL 可访问且核心操作可执行**；`example.com` 或本地 `localhost` 不可充当公网交付成果。不可将静态前端公开网页冒充具备真实训练能力的整套系统。
- 若模型权重许可证只允许非商业/非生产使用，不得未经许可把受限模型投入公开生产部署；需选合法版本或采用合规服务、并在报告注明模型限制。

## 14.4 最低安全与稳定性

- 前端与 API 避免暴露原始系统文件路径/堆栈和敏感配置；服务器端数据目录/工件路径要在允许根目录内校验。
- 文件上传采用大小/格式/扩展名校验，避免任意 Python pickle 未经信任加载；模型权重加载以官方可信源和固定 revision 为主。
- 如果部署公开网站必须采取访问限制/认证、速率限制和后台计算队列容量控制，防止匿名用户耗尽 GPU 或磁盘。
- 数据备份数据库和 artifacts 一致，文件权限最小化；日志中不打印秘密。
- 错误提示提供 `Trace ID` 和建议修复步骤，用户可以导出诊断报告。

## 14.5 性能与资源报告

- 统计实际页面加载耗时、地图操作耗时、单区模型训练/推理耗时、全域批量任务耗时和硬件环境，写进 TEST_REPORT；不能猜测绝对时间作为已达性能。
- All Regions+All Models 的 1000+ 作业需要“队列 + 配额 + checkpoint 重用 + 用户中断 + 进度持久化”，不能要求浏览器一次性等待完成或全部并发。

---

# 15. 从零开发计划与完成定义（Definition of Done）

Codex 必须**从空白目录创建完整软件**，按以下阶段持续推进；每一阶段都提交真实代码、可复现运行命令、测试与截图/日志。允许先做最小闭环再逐步扩展，但不得用纯 Demo 冒充正式版本。最终验收是用户能实际运行或访问系统，而非“README 写完”。

| 阶段 | 从零创建的成果 | DoD（完成标准） |
|---|---|---|
| **P0 环境初始化与数据基线** | 从零建立 Git 工程、前后端骨架、依赖锁、配置样例、数据导入/验证器、数据库迁移与测试框架；读取真实六文件 | `README` 安装步骤可复现；三来源 schema、区域映射、时点和 fingerprint 检查通过；初始 API/DB 可运行 |
| **P1 TN 品牌与全局界面** | TN SVG/PNG/favicons、城市/道路横幅、Home、双行顶部六导航、三栏模板、统一响应式设计 Token | 无卡通人物；导航正常；首页真实统计或空历史状态；宽屏与笔记本宽度可用 |
| **P2 M1/M2 真实分析** | 全新实现 CSV→GIS 映射、时序/空间分析、跨地点模式比较；K-Means/DBSCAN/Hierarchical/GMM 聚类与 GIS | 数据、颜色、簇及统计真正由后台计算；三个 M1 Tab、四个 M2 Tab 全可操作 |
| **P3 M3 数据集构建** | L/H/S、原生与聚合时间粒度、按时序 Train/Val/Test、无泄漏预处理、三张叠放预览、Dataset ID + 管理 | 单区与全区真实 Build；边界测试与工件重载通过；失败不覆盖已保存版本 |
| **P4 M4 10 个常规模型** | 从零建 12 项模型注册表及其 schema（大模型先标未准备）；10 个普通算法适配器、训练 worker、实时事件、Experiment ID | 10 算法均在真实数据上可 Fit/Train 与生成 `[N,H]`，监控数据真实且停止可审计 |
| **P5 M4 两个 Foundation** | TimesFM、Chronos 官方适配器、真实预训练 checkpoint、许可/版本/设备检查、Zero-shot 输出 | 两者分别执行真实权重推理 smoke test；无法兼容硬件则如实阻塞，不准假的 Completed |
| **P6 M4 All Models** | All Models 顶置入口、逐模型参数组、Batch ID → 12 Experiment ID、逐区域任务表、顺序队列/停止/失败处理 | 单区整批贯通；All Regions 计划正确、至少真实运行可控的跨区域任务以验证独立性；历史重载通过 |
| **P7 M5 测试集评价** | 实际 Test 推理、多模型相同锚点公平比较、四个中央视图、三个右侧 Tab + 历史管理、Evaluation ID | 真值预测/指标正确且不泄漏；能按 Batch ID 载入、导出完整成绩和地图结果 |
| **P8 完整交付与验收** | 一键开发运行、正式生产构建、**真正安装包或真实可访问 HTTPS 网址**、用户/技术/部署文档、51 项可执行验收报告 | 从干净环境可重现六数据导入→M3→M4 All Models→M5；给出正式安装/访问证据与资源/许可限制 |

**不得提前宣布完成：** P6 的任务规划通过不代表数千个任务都训练过；必须分别报告“设计容量、自动化 smoke 覆盖和实测批次”。模型权重可能较大，要优先做小规模真实端到端测试，再按资源配额跑正式训练。`P8` 必须检查**课程形式要求**，Windows `start.bat` 或 localhost 开发地址只是辅助运行途径，不能替代真实安装交付或公网 URL。

**Codex 自动推进规则：** 完成一个阶段的测试和记录后直接进入下一阶段。只有在缺少实际数据、许可、需付费服务或安装所需特权等实质性外部阻塞时才请求用户决策；不因每个小步骤都等待确认。阶段完成时更新 `docs/IMPLEMENTATION_STATUS.md`，逐项标记 Implemented/Verified/Blocked，不能提前勾选。
---

# 16. 验收测试矩阵（必须可执行、记录结果）

测试分为单元、集成、端到端、界面、真实模型和交付六类。每项测试报告记录运行命令、环境、期望、实测、Pass/Fail、证据路径。**不得在代码未实现时提前打勾**。

| ID | 场景 | 合格判定 |
|---|---|---|
| T01 | 原始文件加载 | 3 组、6 文件均成功；8928/8928/2784 时点；来源指纹与文件真实一致 |
| T02 | 区域映射 | Milano 88/88、Trentino 223/223、ZTE 148/162；ZTE 14 No Data 清楚标出 |
| T03 | 零值与缺失 | ZTE 的 0 保留；不把 0 视为 NaN；缺失处理记录且不越界 |
| T04 | M1 时空联动 | GIS 选择区域/时间，右侧曲线与真实统计随之变化 |
| T05 | M1 跨地点 | 归一化形状比较，时间与单位免责声明明确，禁原始值直接同量纲比较 |
| T06 | M2 四聚类 | KMeans/DBSCAN/Hierarchical/GMM 都真实运行，DBSCAN 噪声/质量 N/A 合理 |
| T07 | M2 功能区解释 | 标签为推测，不冒充真实地类；ZTE No Data 不进入簇 |
| T08 | M3 L/H/S 窗口 | 对已知序列核对 X/Y 边界、时间与步长、首末合法窗口完全正确 |
| T09 | M3 时间切分 | 70/15/15 默认、分割无泄漏、各 split 实际窗口计数一致；非法配置阻止 Save |
| T10 | M3 预处理 | Scaler 仅 fit Train、逆变换正确；插值不偷看预测起点之后的目标 |
| T11 | M3 持久化 | Save 成功产生 Dataset ID；失败无半成品；历史可查、Reset 不改旧版 |
| T12 | 12 模型注册表 | 模型名单恰好 12 且分组正确；All Models 单独位于顶部不计为第 13 算法 |
| T13 | 12 算法真实能力 | 每个 adapter 能对合法输入生成形状 [N,H] 的有限输出；真实依赖或资源失败如实记录 |
| T14 | 统一参数帮助 | 每个模型 Basic/Advanced 可变、合法范围/说明齐全、非法参数阻止运行 |
| T15 | Transformer 验证 | d_model 不能整除 n_heads 时具体报错，修复后能运行 |
| T16 | 大模型真实权重 | TimesFM/Chronos 在真实 checkpoint 上 Zero-shot 成功，记录 checkpoint/设备/许可 |
| T17 | 大模型资源异常 | 缺缓存/网络/设备时 Unavailable/Failed，不冒充 Completed，不显示虚假 epoch |
| T18 | 单模型 Single | 单区单算法：1 Experiment ID、能保存和加载工件 |
| T19 | All Regions 单模型 | 对一个地点的全部有效区域分别建模；N 个 region records，部分失败可审计 |
| **T20** | **All Models Single** | **1 Batch ID + 12 Experiment IDs；12 模型配置独立、按队列执行、各状态可查** |
| **T21** | **All Models + All Regions** | **N×12 计划数正确（Milano 1056 / Trentino 2676 / ZTE 1776），每算法 N 子记录；不跨地点** |
| **T22** | **批次 Preflight 和取消** | 资源/非法模型提示具体；Stop Batch 后端确认，未开始任务停止，已完成保留 |
| **T23** | **批次刷新及失败恢复** | 浏览器刷新后台仍继续；Running/Partial/Failed/Skipped 状态真实持久化 |
| T24 | 训练曲线真实性 | DL epoch 为真实 loss，Boosting 迭代可查，ARIMA/Prophet/Zero-shot 无虚假 epoch |
| T25 | Duplicate Experiment | 复制生成草稿但**不**生成新历史 Experiment ID；真正 Run 才生成 |
| T26 | M5 Batch 快速选择 | Batch ID 可一次载入成功模型，失败/跳过仍列原因；不能评价的模型不进入排名 |
| T27 | 统一 Test 公平性 | 相同 Dataset、H、区域与 Test targets 才可标准排名；不同协议明确阻挡/警告 |
| T28 | 评价指标 | MAE/RMSE/sMAPE/R² 与独立手工样例一致；sMAPE 0/0 正常、R² undefined=N/A |
| T29 | All 地图与指标 | 4 种空间图层及 Macro/Pooled 区分，区域覆盖/No Data/失败标识正确 |
| T30 | 历史依赖保护 | 引用中 Dataset/Experiment 不能硬删；Evaluation 删除只作用本层 |
| T31 | 顶部 UI | 两行顶栏、六导航、TN 标识、**无卡通人物**；下方仅三栏；所有规定 Tab 在 |
| T32 | 首页真实信息 | 三数据/459 有流量区域/12 算法/5 模块数字准确，Recent Activity 初始空态 |
| T33 | Windows 本地运行 | 根据 README 在真实目标系统启动，进入五模块并能完成至少一条真实链路 |
| T34 | 网络部署（如作为交付） | 真正部署 HTTPS/URL 可访问，核心 API/worker/数据库状态可用；许可证合规 |
| T35 | 文档与源码 | README、API、模型参数、资源/许可、部署、测试报告、Logo 源文件完整 |
| T36 | 失败与停止可审计 | 任务失败保留实际 error/log、不覆盖成功 artifact；状态在重启后自洽 |
| **T37** | **Greenfield 起点** | 从空目录初始化的全新源代码结构，依赖锁、DB 迁移、六文件导入与首个可运行页面可复现；没有依赖旧项目 |
| **T38** | **正式课程交付** | 至少**真实 Windows 安装包**或**已实测公网 HTTPS 地址**之一；本地开发命令及 localhost 不替代正式交付 |
| T39 | UI 全部功能状态 | Basic/Advanced/Tooltip/Reset/Delete/Archive/Duplicate、Tab、跳转与空态均可操作，后台状态与视觉一致 |
| T40 | 项目资源与 Logo | TN SVG、透明 PNG、favicon、城市道路横幅；任何 UI 页面均不含卡通人物或头像 |
| T41 | 干净环境复现 | 按 README 从零安装依赖、初始化数据库、导入数据、启动应用；附实机或容器日志 |
| T42 | 完整用户工作流 | Home→M1→M2→M3 Dataset ID→M4 All Models/Batch/Experiment IDs→M5 Evaluation ID，实际可走通且记录重启后存在 |
| T43 | 错误条件 UX | 模型缺依赖/无 checkpoint、非法 L/H/S、作业停止、无测试预测等都显示真实原因和重试动作 |
| T44 | 双行导航与响应式 | 品牌横幅、六模块项（含 Home）、选中状态和窄屏折叠，内容工作区只三栏不引入全局第四侧栏 |
| **T45** | **全参数实时校验覆盖** | M1–M5 的每个可编辑参数（含 Basic/Advanced、All Models 的 12 组）在修改后实时校验；合法修正后提示及时更新；不会漏掉隐藏字段 |
| **T46** | **字段下方错误与独立警告** | 错误直接显示在对应输入框下方，含字段/原因/建议；Warning 与 Error 颜色/图标/文字/交互不同，Warning 合法时不误禁用提交；无纯全局模糊弹窗 |
| **T47** | **前后端规则一致** | 相同输入的客户端校验和后端 Pydantic/Registry 校验在类型、边界、条件与错误码上一致；真实接口复用 validator，避免两份分叉规则 |
| **T48** | **非法请求不能绕过后端** | curl/脚本绕过前端直接传 `dropout=1.5`、`L=0`、不兼容 d_model/heads 等返回 422/409 字段级错误，不能创建 Job/ID/工件，原保存对象不变 |
| **T49** | **联动、异步与输入中间态** | 切换算法/Dataset/region 更新相关校验；中途输入空值或 `0.` 不自动覆盖；异步旧响应不反向覆盖新值；未验证状态不显示为已通过 |
| **T50** | **All Models 逐算法报错与跳过** | 每个算法可定位 Error/Warning；模型级非法项无法暗中执行，仅用户确认跳过后记录 Skipped/Unavailable；批次级 Error 禁止 Run |
| **T51** | **字段帮助与可访问反馈** | 输入框附近 `ⓘ` 显示含义/单位/默认/范围/建议；错误通过文字、图标及 aria-invalid/aria-describedby 暴露，键盘可访问且修复后自动更新 |

需要附加**单区域小样本 smoke 测试**以便自动化 CI 快速验证模型接口，但 smoke 通过**不等于**大规模完整训练都已完成。对 12 模型实测结果、硬件占用和耗时必须写明哪些验证通过、哪些受实际环境限制，不得虚报。

---

# 17. 最终交付清单、交付形式和 Codex 工作指令

## 17.1 完整交付清单（全部从零生成）

- [ ] `PROJECT_SPEC.md v3.1`、`CODEX_START.md`、`ACCEPTANCE_CHECKLIST.md` 已放项目根目录；开发项目是新建的，不依赖任何旧代码。
- [ ] 所有前端页面、后端接口、数据处理器、12 模型适配器、Worker、数据库迁移、自动化测试和可运行配置齐全；依赖有 lockfile。
- [ ] 六个真实数据文件按指定目录保留；Milano/Trentino/ZTE GIS 映射与“有时序 / No Data”区别正确。
- [ ] Home+五大模块真实可交互；蓝白科技风、双行顶部六导航、TN Logo、无任何卡通人物；模块页面仅三栏。
- [ ] M2 四种聚类可运行；M3 单区/全区 L/H/S 和保存数据集；M4 10 普通模型和 TimesFM/Chronos 两个真实 Foundation（许可合规）；All Models 批量任务。
- [ ] M4 每个算法独立参数 Basic/Advanced，模型/区域/批次状态可查；停止、重试、复制草稿、历史删除/归档安全可靠。
- [ ] M5 真正使用 held-out Test，预测、真实值、GIS、MAE/RMSE/sMAPE/R²、模型排名和评价管理均正确。
- [ ] 至少一种**正式课程交付形式**验收通过：① Windows 可安装软件包；或 ② 经实际验证的公网 HTTPS 网址（需要真实部署权限）。提交真实文件/地址与安装/访问证明。
- [ ] 完整源代码、README、USER_GUIDE、ARCHITECTURE、API、MODEL_REGISTRY、DEPLOYMENT、TEST_REPORT、LICENSE_NOTICES、品牌 Logo 可交付。
- [ ] 自动化测试报告、前后端联调记录、模型 smoke logs、浏览器截图、受限模型及资源说明均来自真实执行，没有伪造。

## 17.2 Codex 的完整任务指令（根目录与 CODEX_START.md 同步）

> 这是一个**完全未开发的新项目**。请在一个空白项目目录从零初始化 TN Traffic Intelligence Web 应用，先读取 `PROJECT_SPEC.md v3.1` 和六个原始 CSV/GeoJSON 文件。不要扫描或保护不存在的旧业务代码，不需要提交旧项目差距分析。按照文档中的 P0–P8 连续实现完整前端、后端、数据库、真实分析与聚类、12 种预测算法（其中 TimesFM/Chronos 必须是真实可验证的预训练模型）、All Models/Batch ID、测试集评价、TN 品牌双行导航和所有历史管理交互。
>
> 每阶段必须实际运行/测试，发现问题立即修复再继续。不得只创建静态 UI、假的预测图表、模拟实验完成状态或以 TODO 代替算法。自始至终保留单数据源 Single Region / All Regions（独立区域建模），M3 L/H/S 与数据集划分、M4 12 算法独立参数、Batch ID → 12 Experiment IDs、M5 相同 held-out Test 的公平排名。最后交付完整源码、文档与**真正可安装的 Windows 软件或经外部网络验证的访问网址**，并附测试证据。
>
> 除模型权重许可、缺少硬件/数据、公网部署授权等实际外部阻塞外，请自主推进，不要停留在计划阶段。任何未实现/未验收项必须如实报告，不能擅自删减范围或声称全部完成。

## 17.3 必须询问用户的真实外部阻塞

- 六个原始文件在输入位置不可用、损坏或实际 schema 与预期不一致，不能在当前资料包恢复；
- TimesFM/Chronos 合规 checkpoint 无法在指定机器可用，或必要依赖缺失且不能安全安装；
- 正式安装包需要的 Windows 打包系统、签名/管理员权限不可取得，或公网部署需要域名、服务器、账号/计费许可；
- 想把 All Regions 改为联合模型/只挑少数区域、想删除某指定算法、想用模拟结果代替真实模型；这类实质性改需求必须先获得用户明确同意。

未遇到外部阻塞时，直接开发、测试和记录阶段结果，不要反复要求用户确认已经明确的 UI、算法或模块规则。
---

# 18. 技术参考与实测未定事项

## 18.1 大模型权威实现参考

- TimesFM 官方仓库：<https://github.com/google-research/timesfm>。官方 README 含版本、推理 API、模型权重许可证说明；检查所用**特定权重的许可证**而不仅是源码仓库许可证。
- Chronos 官方仓库：<https://github.com/amazon-science/chronos-forecasting>。Chronos 家族包含多个变体，不同 checkpoint 的上下文、预测和采样参数不同。
- 选择具体版本需要运行环境和验收机器实测；本说明书不强制使用当前最新但可能受许可/硬件限制的 checkpoint，也不声称所有版本都支持 Fine-tuning。

## 18.2 由 Codex 落实和在报告中留痕的开放事项

1. 确认原始数据文件是否可在项目工作区访问；校验 CSV schema、数据指纹、零值与地图 join，出示自动检测报告。
2. 确定 Python/Node/前端/模型 SDK 版本组合，并锁定 Windows 与目标 Linux 可用性。
3. 选择可合法使用的 TimesFM/Chronos checkpoints、首次获取方法、模型精度模式、是否支持 CPU、是否真正支持 Fine-tuning。
4. 原单位不明时，保留警示文案；若后来获得数据字典需以证据更新单位说明。
5. 性能/耗时/评价准确率只能通过实测报告，不设伪保证数值。
6. 真实公网部署需要用户提供或授权服务器/域名/账号；不能由 Codex 在没有凭据时声称已经发布网址。
7. 各阶段全部完成前在 README 用真实状态区分 `Implemented / Verified / Blocked`，不可出现“已完成”但只有示例截图的情况。

---

**最终决定：本 v3.1 是完整新项目的唯一需求基准。新增所有可编辑参数的实时校验、输入框下方错误提示、Error/Warning 分级、前后端统一校验和不可绕过的后端阻断；该要求和原有五模块、12 算法、All Models、正式部署交付同属必须实现的 P0 功能。Codex 从零开发五模块、12 种算法、All Models + Batch ID、双行顶部蓝白导航、TN 品牌（无人物）及正式可安装/可访问交付。**

**文档结束。**
