# 用户操作指南（USER_GUIDE）

## 0. 启动

安装版：开始菜单 → **启动 TN Traffic Intelligence**（后台自动启动 Worker 与 API 并打开浏览器）。
源码版：`powershell -File scripts\start_all.ps1`，然后访问 <http://127.0.0.1:8077/>。

页面顶部为两行导航：第一行是 TN 品牌横幅与运行状态（API / Worker / 帮助 / 设置），
第二行是 `Home / Exploration / Clustering / Dataset / Training / Evaluation`。
每个模块内部只有三栏：左 Configuration、中 Visualization、右 Information（含历史管理）。

## 1. Home

展示真实统计：3 个数据源、459 个有时序区域（473 个 GIS 多边形中 14 个 No Data）、12 种算法、5 个模块，
以及来自数据库的 Recent Activity（首次启动是空态，不会出现假记录）。点击任意模块卡片可跳转。

## 2. Module 1 · Exploration

### 2.1 选择数据与时间范围

1. **数据源**：Milano（88 区 / 10 分钟）、Trentino（223 区 / 10 分钟）、ZTE 4G 下行（148 个有时序区域 / 15 分钟）。
2. **区域**：可在地图上点选，或用下拉框搜索；默认最多同时对比 6 个区域。
3. **Analysis Time Range**：直接选 `Start Date & Time` 与 `End Date & Time`（含边界）。
   下方摘要实时显示：数据可用范围、实际起点、最后一个观测、时间跨度、采样间隔、
   选中时间点（重采样后）、有效观测数，以及边界约定（闭区间 `[start_at, end_at]`，按时间桶起始时间）。
4. **Advanced Settings**：`Start Index` / `Window Points` 与日期时间**双向同步**；
   还可设置白天/夜间小时划分与最多对比区域数。
5. **时间分辨率 / 聚合方式**：重采样把原始观测合并成更粗的时间桶（mean 平均 / sum 求和）；
   它与“日内小时画像的跨日期平均”是两件不同的事，界面已分别解释。

日期时间与索引都不能超出该数据源的真实边界；非法范围会在字段下方报错并阻止运行。

### 2.2 地图与时间截面

* 地图按当前时间截面着色，颜色越深表示该时刻取值越大；No Data 区域为灰蓝色。
* 可开关「在地图上显示区域名称」。
* 拖动「时间截面位置」滑块只切换地图显示的瞬间，**不会改变右侧统计与自动结论的时间范围**。

### 2.3 Temporal Analysis（右侧）

从上到下依次是：

1. **统计摘要**：均值 / 最大 / 最小 / 标准差 / P95 / CV / 零值 / 有效点数，全部来自当前分析范围。
2. **流量时间序列**：当前范围的真实曲线，并为「分析对象」叠加橙色虚线趋势拟合。
3. **日内小时画像 + Hourly Pattern Insights**：
   高峰小时、低谷小时（并列时如实列出）；单峰 / 多峰 / 整体平稳（基于平滑后的局部峰值、突出度与覆盖率，
   不是“最大值即高峰”）；昼夜差异（默认白天 06:00–18:00，可在高级设置调整）；数据可靠性。
4. **工作日 vs 周末 + Weekday vs Weekend Insights**：
   两条逐小时曲线，分别显示有效日期数与观测数；范围内没有周末（或工作日）时对应曲线为 No Data，
   并明确说明无法完整比较，绝不借用范围外数据；结论包含整体差异、两组高峰时间与间隔、差异最大的小时。
5. **ACF 与趋势 + ACF & Trend Insights**：
   上方显示计算范围、有效样本、采样间隔与 Max Lag；`Max Lag` 可调（0 = 自动）；
   图中含 ACF=0 参考线与 ±95% 白噪声置信带；结论包含短期相关性、相关性衰减、负相关、
   潜在周期（1 小时 / 24 小时 / 7 天）、线性趋势与建议。周期不足以判断时会说明具体原因。
6. 每张图下方都是「图表 → 自动分析结论 → 展开详细说明」；展开后可看到有效样本、覆盖率、阈值与方法。

修改日期、区域、分辨率或 Max Lag 会自动重算；计算期间旧结果变暗并提示“正在按当前参数重新计算”，
完成后图表与结论整体替换，不会出现图表已更新而文字仍是旧值。

### 2.4 其他 Tab

* `Spatial Analysis`：当前截面的 Top-12 区域、取值分布直方图、最低 6 个区域；同时提供逐区域的范围均值。
* `Multi-City Comparison`：三个来源的归一化（z-score）小时形状与时间/单位免责声明。

完整的计算方法与判定阈值见 `docs/M1_ANALYSIS.md`。

## 3. Module 2 · Clustering

1. 选择地点、时间区间、聚合方式、聚类特征（至少 2 个）与是否标准化。
2. 选择算法：K-Means / DBSCAN / Hierarchical / GMM；只显示该算法相关的参数，非法值会在对应输入框下方给出原因。
3. 点击 `Run Clustering`，任务进入后台队列；完成后 GIS 按簇着色（DBSCAN 噪声为灰色 -1，ZTE 无时序区域为 No Data）。
4. 右侧四个 Tab：`Cluster Overview`、`Typical Patterns`、`Quality Evaluation`（Silhouette / DB / CH，条件不满足时显示 N/A 与原因）、`Region List`。
5. 左侧下方是聚类历史：`Open` 复现历史结果，`Delete` 删除本次结果（运行中会拒绝）。
6. 簇的类型标签（如「推测：日间通勤/办公型」）明确标注为**推测**，不代表真实土地使用数据。

## 4. Module 3 · Dataset

1. 左侧依次选择：`Dataset/Location` → `Prediction Scope`（Single Region / All Regions）→ 分辨率与聚合 → `L / H / S` → Train/Val/Test 比例（默认 70/15/15）→ 缺失处理与标准化。
2. 点击 `实时预览`：中央从上到下显示三个真实预览区——滑窗样例、时间切分、可预测覆盖范围。
3. 点击 `Save & Build Dataset`：全量校验通过后原子构建，成功后返回 `Dataset ID`（状态 `Built`）；失败不会产生半成品 ID。
4. 右侧四个 Tab：`Dataset Overview`、`Window Preview`、`Data Quality`、`Dataset Management`（Open / Archive / Delete，被引用时只能归档）。

## 5. Module 4 · Training

1. 顶部选择 `Dataset Selection`（只读快照）。
2. 选择算法：列表顶部是 `All Models (12)`，下方按 Statistical / Machine Learning / Deep Learning / Foundation 分组。
3. `Model Parameters`：单模型可切换 Basic/Advanced；All Models 为 12 个独立折叠参数组，支持单独恢复默认与 Reset All。
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
