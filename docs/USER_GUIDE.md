# 用户操作指南（USER_GUIDE）

## 0. 启动

安装版：开始菜单 → **启动 TN Traffic Intelligence**（后台自动启动 Worker 与 API 并打开浏览器）。
源码版：`powershell -File scripts\start_all.ps1`，然后访问 <http://127.0.0.1:8077/>。

页面顶部为两行导航：第一行是 TN 品牌横幅与运行状态（API / Worker / 帮助 / 设置），
第二行是 `Home / Exploration / Clustering / Dataset / Training / Evaluation`。
每个模块内部只有三栏：左 Configuration、中 Visualization、右 Information（含历史管理）。

## 1. Home

展示真实统计：3 个数据源、459 个有时序区域（473 个 GIS 多边形中 14 个 No Data）、12 种算法、5 个模块，
以及数据源概览、五模块工作流和 12 种算法说明。首页不再展示 Recent Activity 面板，历史记录仍在各模块中管理。

## 2. Module 1 · Exploration

### 2.1 选择数据与时间范围

1. **数据源**：Milano（88 区 / 10 分钟）、Trentino（223 区 / 10 分钟）、ZTE 4G 下行（148 个有时序区域 / 15 分钟）。
2. **区域**：可在地图上点选，或用下拉框搜索；最多可同时选择 12 个区域（内部上限，界面不再暴露该参数）。
3. **分析时间范围（Analysis Time Range）**：默认自动填入当前数据源完整有效范围，可直接选开始日期时间与结束日期时间（含边界）。
   下方摘要实时显示：数据可用范围、实际起点、最后一个观测、时间跨度、采样间隔、
   选中时间点、有效观测数，以及边界约定（闭区间 `[start_at, end_at]`，按原生采样时间点）。
4. **原生频率**：系统自动读取数据源实际原生间隔（Milano/Trentino 10 分钟、ZTE 15 分钟），使用原始观测值，不做用户重采样。
   日内小时画像、工作日/周末比较只是按时钟分组的统计，不改变原始数据频率。

左侧已**不再提供 Advanced Settings**；时间索引与窗口长度只在系统内部用于定位真实观测，
用户无需手工计算。日期时间不能超出该数据源的真实边界；非法范围会在字段下方报错并阻止运行。

### 2.2 地图与时间截面

* 地图按当前时间截面着色，颜色越深表示该时刻取值越大；No Data 区域为灰蓝色。
* 可开关「在地图上显示区域名称」。
* `时间截面（Time Slice）` 位于左侧 Configuration 的分析时间范围下方，不在地图面板内重复显示。
  支持滑块、日期时间选择和“上一时刻 / 下一时刻”按钮；非采样时刻会自动吸附到最近的原生采样点，越界输入会夹紧到范围内。
  当前时间和时间点序号会同步显示，并实时更新中央地图及右侧空间分析三张图。
  它只切换空间分析使用的瞬间，**不会改变整个 Analysis Time Range 内的统计计算范围**。

### 2.3 中央：多区域时序 + 多区域统计摘要

中央从上到下固定为三部分：

1. **GIS 地图**（含图例、区域名称开关；时间截面滑块在左侧 Configuration）。
2. **多区域时序曲线**：当前已选区域的全部真实曲线；当前 Analysis Target 用更粗的线突出，其余区域保持可见。
   图中不再绘制橙色趋势拟合线（趋势仍由右侧 ACF & Trend 计算）。
3. **多区域统计摘要（Multi-Region Statistical Summary）+ Statistical Summary Insights**：
   标题下方先给出范围与样本说明（数据源、参与区域、时间范围、每点分钟、有效样本、单位），
   随后是每个区域独立一行的统计表（均值/最大/最小/标准差/P95/CV/零值/有效点），
   再下面是多区域 Insights（均值最高/最低、波动最大、P95 差异、覆盖可靠性）。
   切换右侧 Analysis Target 不会改变这里的任何数值或行数。

### 2.4 右侧：Analysis Target 与三个二级 Tab

布局：Module 1 的三栏比例为 **Configuration 25% / GIS+时序 40% / Analysis 35%**。
右侧是三个一级 Tab（Temporal / Spatial / Multi-City）。
**分析对象（Analysis Target）位于 Temporal Analysis 最上方、日内小时画像之前**（单选，选项仅来自左侧已选区域，
默认第一个，带 ⓘ）；Spatial Analysis 与 Multi-City Comparison 不显示该控件。
Temporal 内部**不再有二级 Tab**，而是按顺序纵向排列：

1. **Hourly Profile**：日内小时画像（显示左侧已选的全部区域）+ Hourly Pattern Insights（结论针对分析对象，卡片内已注明）。
   高峰小时、低谷小时（并列时如实列出）；单峰 / 多峰 / 整体平稳（基于平滑后的局部峰值、突出度与覆盖率，
   不是“最大值即高峰”）；昼夜差异（固定按 06:00–18:00 为白天，其余为夜间）；数据可靠性。
2. **Weekday vs Weekend**：两条逐小时曲线 + Weekday vs Weekend Insights。
   两条逐小时曲线，分别显示有效日期数与观测数；范围内没有周末（或工作日）时对应曲线为 No Data，
   并明确说明无法完整比较，绝不借用范围外数据；结论包含整体差异、两组高峰时间与间隔、差异最大的小时。
3. **ACF & Trend**：ACF 与趋势图 + ACF & Trend Insights。
   图表上方以纯文本显示计算范围、有效样本、采样间隔与 Max Lag（与其它图的说明格式一致）；
   Auto/手动 Max Lag 控件与"实际生效 Max Lag"合并为一个蓝底控制块，开关与文字放大显示；
   图中含 ACF=0 参考线与 ±95% 白噪声置信带；结论包含短期相关性、相关性衰减、负相关、
   潜在周期（1 小时 / 24 小时 / 7 天）、线性趋势与建议。周期不足以判断时会说明具体原因。
4. 每张图下方紧跟对应的 Insights（图表 → 自动结论 → 展开详细说明）；右上角 `放大查看` 打开大尺寸图表与同一份结论。
5. 一级 Tab 使用「中文（English）」标签；ACF 的计算信息块为白底，与图表说明样式一致。
5. 右侧三张图只使用当前 Analysis Target 的单区域数据；中央统计仍覆盖全部已选区域。
6. 右侧不再有 Statistical Summary 或重复的 Traffic Time Series；它们分别位于中央与仅中央。

修改日期、区域、分辨率或 Max Lag 会自动重算；计算期间旧结果变暗并提示“正在按当前参数重新计算”，
完成后图表与结论整体替换，不会出现图表已更新而文字仍是旧值。

参数帮助统一为「参数名 + ⓘ」：**鼠标悬停**（约 200ms 延迟）即显示深色 Tooltip，
移开自动消失；键盘聚焦 ⓘ 也会显示。Tooltip 为深色底、白色正文、浅灰次要信息，
同一时间只显示一个，不会遮挡正在输入的控件（优先出现在 ⓘ 右侧，空间不足自动调整）；
错误与警告仍直接显示在对应控件附近。

响应式：宽屏为 25/40/35 三栏；≤1250px 折叠为「左 + 中」两栏、右侧 Analysis 整行显示在下方；
≤900px 变为单栏。各断点均无横向溢出，地图图例/滑块/区域名称与中央时序图保持可用。

### 2.5 Spatial Analysis（空间分析）

空间分析**不受左侧 Regions 多选限制**：它始终使用当前数据源在当前 GIS 时间截面下的**全部有效区域**
（Milano 最多 88、Trentino 223、ZTE 148；No Data 不计入）。页面顶部显示当前截面、有效区域数与 No Data 数。

从上到下依次为三个部分，每张图下方紧跟对应 Insights：

1. **Top 12 Regions**：横向排名（高→低），点击条形可在中央地图定位该区域（不改变左侧多选）；
2. **Bottom 6 Regions**：横向排名（低→高），Tooltip 同时显示当前截面值与所选日期范围的均值；
3. **Regional Value Distribution**：直方图（区间 / 区域数 / 占比），并显示均值与中位数。

三个部分均支持 `放大查看`；图表与结论使用同一份时间截面结果，移动时间滑块会同步更新。
注意：**当前截面值**是某一个时刻的观测，**Range Mean** 是所选日期的平均值，两者口径不同。
每张图的标题右侧都有 ⓘ：悬停即显示该图的数据范围、排序/分箱规则与使用提示（黑底 Tooltip，与其它参数帮助一致）。

### 2.4 其他 Tab

* `Spatial Analysis`：当前截面的 Top-12 区域、取值分布直方图、最低 6 个区域；同时提供逐区域的范围均值。
* `Multi-City Comparison`：三个来源的归一化（z-score）小时形状与时间/单位免责声明。

完整的计算方法与判定阈值见 `docs/M1_ANALYSIS.md`。

## 3. Module 2 · Clustering

1. 选择地点、时间区间、聚类特征（至少 2 个）与是否标准化；频率与聚合固定为原生观测。
2. 选择算法：K-Means / Spectral Clustering / Hierarchical / GMM；只显示该算法相关的参数，非法值会在对应输入框下方给出原因。
3. 点击 `Run Clustering`，任务进入后台队列；完成后 GIS 按“簇 N（描述性分类名称）”着色，ZTE 无时序区域显示为 No Data。
4. 右侧四个 Tab：`Cluster Overview`、`Typical Patterns`、`Quality Evaluation`（Silhouette / DB / CH，条件不满足时显示 N/A 与原因）、`Region List`。
5. 左侧下方是聚类历史：`Open` 复现历史结果，`Delete` 删除本次结果（运行中会拒绝）。
6. 簇的类型标签（如「推测：日间通勤/办公型」）明确标注为**推测**，不代表真实土地使用数据。

## 4. Module 3 · Dataset

1. 左侧选择：`数据源` → `预测范围`（单区域 / 全部区域）→ `区域` → `L / H / S` → Train/Val/Test 比例。
   构建范围固定采用数据源完整有效时间范围；不显示开始/结束日期控件、频率或聚合控件。
2. 中央从上到下为：数据集概览 → 时间顺序划分预览 → 滑动窗口预览 → 数据质量摘要。
3. 点击 `构建数据集`：全量校验通过后原子构建，成功后由后端生成可读 `DS-{DATASET}-{REGION|REGIONS}-{序号}`（状态 `Built`）；失败不会产生半成品 ID。
4. 左侧数据集管理保留打开和删除；界面不再要求填写数据集名称，DS ID 是统一主标识。删除前需确认，被实验或评价引用的数据集受依赖保护。
5. 点击历史数据集“打开”只加载中央概览、划分、窗口预览和质量摘要，不回填或修改左侧当前未保存配置；窗口可按训练/验证/测试和序号切换。

## 5. Module 4 · Training

1. 顶部选择 `Dataset Selection`（只读快照）。
2. 选择算法：列表顶部是 `All Models (12)`，下方按 Statistical / Machine Learning / Deep Learning / Foundation 分组。
3. `Model Parameters`：仅显示核心参数；高级参数由后端统一默认值和校验管理。All Models 为 12 个独立折叠参数组，支持单独恢复默认与 Reset All。
4. `Check Compatibility` 做真实预检（数据、样本数、checkpoint、依赖、资源），逐算法列出问题。
5. `Run Training` / `Run All Models`；All Models 会先弹出确认对话框（地点、Scope、12 个模型、区域数、任务数、不可运行项）。
6. 中央监控显示真实阶段与进度（DL 为真实 epoch 损失，Boosting 为真实迭代指标，ARIMA/Prophet/Zero-shot 明确没有 epoch）。
7. 右侧：`Training Overview`、`Training Logs`、`Experiment History`（Open / Duplicate / Archive / Delete / Stop）。

## 6. Module 5 · Evaluation

1. 选择数据集与 Scope；可用 `Batch ID` 一键载入该批次成功实验（失败/跳过项会列原因）。
2. 勾选 Experiment，查看只读快照与兼容性检查。
3. `Test Range` 默认 `Full Test`；`Selected Test Range` 只用于可视化子集。
4. `Run Prediction` 生成 `Evaluation ID`。
5. 中央四视图：`Prediction Comparison`、`Error Analysis`、`Forecast Horizon Analysis`、`Spatial Evaluation`。
6. 右侧：`Metrics Overview`、`Model Ranking`、`Regional Performance`，底部 `Evaluation History / Management`。

## 7. 常见错误与处理

| 现象 | 原因与处理 |
|---|---|
| 输入框下方红色错误 | 字段值非法（如 Dropout=1.5、L=0、d_model 不能被 n_heads 整除、日期顺序反了）。按提示修正即可。 |
| 琥珀色 Warning | 合法但有风险（如时间范围不足 1 天、Max Lag 不足以看日周期、Epochs 很大）。可继续提交。 |
| 所选时间范围内没有任何观测点 | 该范围内没有落在一个时间桶内的观测；请扩大范围或对齐采样边界。 |
| 周末曲线是 No Data | 当前时间范围没有周末；这是正确行为，请扩大范围到包含周末。 |
| TimesFM / Chronos 显示 Unavailable | 依赖未安装或权重未下载；在 `Check Compatibility` 中按提示下载（默认镜像 `hf-mirror.com`）。 |
| Batch 里有 Skipped | 该算法被判为不可运行且你确认了跳过；原因会保留，不计入 12 个完成模型。 |
| 任务一直 Running | Worker 未启动：运行 `scripts\start_worker.ps1`；重启后遗留任务会改判为 Interrupted/Failed。 |
| 端口 8077 被占用 | 修改 `TN_PORT` 后重启，或先运行 `stop_tn.bat`。 |
