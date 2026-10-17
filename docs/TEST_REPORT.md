# 测试报告（TEST_REPORT）

测试环境（所有结果均来自该真实环境，无模拟）：

| 项目 | 值 |
|---|---|
| 操作系统 | Windows 11 (10.0.22631) |
| CPU | 11th Gen Intel Core i5-1135G7 @ 2.40GHz（4 核 / 8 线程） |
| 内存 | 15.8 GB |
| GPU | 无（`torch.cuda.is_available() == False`） |
| Python | 3.12.10（项目内 `.venv`） |
| Node | v24.21.0 |
| 关键库 | numpy 2.5.4 / pandas 3.0.6 / scikit-learn 1.9.1 / statsmodels 0.15.0 / xgboost 3.4.1 / lightgbm 4.7.0 / torch 2.14.1+cpu / prophet 1.5.0 / chronos-forecasting 2.3.2 / timesfm 3.0.2 |
| 测试日期 | 2026-10-16 |

## 1. 单元与集成测试（pytest）

```powershell
cd backend
..\.venv\Scripts\python.exe -m pytest tests -q
# 101 passed, 2 warnings in 58.44s
```

| 测试文件 | 覆盖内容 | 结果 |
|---|---|---|
| `test_metrics.py` | MAE / RMSE / sMAPE / R² 的手工样例、sMAPE 0/0、常量真值 R²=N/A、非有限值不当作 0、Macro 等权平均 | 7 passed |
| `test_windows.py` | 窗口定义、目标不跨 split、切分吸收余数、因果插值的“不得偷看未来”规则、目标从不插值、scaler 仅拟合训练段且可逆、前向填充只用过去值 | 7 passed |
| `test_validation.py` | 恰好 12 算法、dropout 越界、dropout 边界 0/1、L=0/S=0、比例之和、Transformer 整除、Epochs 大是 Warning、batch_size 大于样本是 Warning、ARIMA trend 与 d 兼容、非数字/非整数、Ward+非欧氏、DBSCAN eps>0、至少两个特征、M1 区域上限与未知区域、M5 Scope 冲突、All Models 逐算法报告 | 15 passed |
| `test_adapters.py` | 10 个常规适配器在真实 pytorch/statsmodels/sklearn 上产出有限 `[N,H]`；两个 Foundation 在真实权重上 Zero-shot 且 `no_epochs=true`；未知 checkpoint 必须报错而不偷偷换权重 | 10 passed + 2 passed（Foundation 真实权重） |
| `test_api.py` | 健康检查、数据基线断言、注册表 12 条、GIS 162 多边形与 14 No Data、L=0 返回字段级错误、比例非法阻止 Build 且不产生 Dataset、**绕过前端的 dropout=1.5 被 422 拒绝且不创建 Experiment**、Transformer 整除 422、未知 Dataset 404、批次逐算法预检、评价缺实验校验、被引用数据集删除 409、schema 可机读 | 14 passed |
| `test_m1_time_range.py` | 10/15 分钟日期→点数（7 天 1008 vs 672）、重采样点数、索引→日期、开始晚于结束、越界拒绝、边界截断警告、空范围拒绝、非法日期、短范围警告、昼夜小时校验 | 11 passed |
| `test_m1_insights.py` | 小时均值与样本数、缺失小时 No Data、单峰/多峰/平稳/并列最高、昼夜与零分母、工作日/周末（含只有工作日、只有周末）、最大差异、高峰间隔、正弦周期检出、白噪声不误报、Max Lag 不足、跨度不足、Lag 时长换算、趋势单位、低 R² 不下结论 | 26 passed |
| `test_m1_api.py` | 日期范围驱动全部统计、Insights 与统计数值一致、只有工作日时周末无假曲线、日期顺序/越界 422、Max Lag 截断警告、Max Lag 改变结果、Spatial 同时给出截面值与范围均值 | 7 passed |

## 2. 端到端真实链路（HTTP + Worker）

```powershell
.\.venv\Scripts\python.exe backend\tests\e2e_smoke.py
# 输出：data\logs\e2e_smoke.out.log
```

| 步骤 | 实测结果 |
|---|---|
| 健康检查 | `status=ok`，数据库连接正常 |
| 数据源 | 3 个来源 / 459 有时序区域 / 473 GIS 多边形 / 14 No Data |
| 构建数据集 | `DS-ZTE-SINGLE-…`，`train 229 / validation 50 / test 50` 窗口，状态 `Built` |
| 负向 API 测试 | `dropout=1.5` → HTTP 422，`path=model_configs.mlp.params.dropout`，`code=OUT_OF_RANGE`，无新增 Experiment |
| 单模型实验 | ARIMA 完成，验证集 macro：MAE 3,424,873 / RMSE 4,324,033 / sMAPE 32.44% / R² 0.5012 |
| All Models | 1 个 Batch ID + 12 个 Experiment ID，**12/12 Completed** |
| 评价 | `EVAL-…` 完成，3600 条预测样本，12 个模型在同一 held-out Test 上排名 |

### 统一 Test 排名（ZTE 370102001，1 小时，L=24/H=6/S=2，Full Test）

| 排名 | 模型 | RMSE | MAE | sMAPE | R² |
|---:|---|---:|---:|---:|---:|
| 1 | Transformer | 1.603e6 | 1.229e6 | 12.30% | 0.9285 |
| 2 | MLP | 1.768e6 | 1.329e6 | 11.45% | 0.9131 |
| 3 | XGBoost | 1.812e6 | 1.405e6 | 13.24% | 0.9087 |
| 4 | LSTM | 1.821e6 | 1.403e6 | 11.92% | 0.9078 |
| 5 | Random Forest | 1.879e6 | 1.492e6 | 14.99% | 0.9018 |
| 6 | RNN | 1.923e6 | 1.529e6 | 13.24% | 0.8972 |
| 7 | GRU | 1.954e6 | 1.526e6 | 13.19% | 0.8939 |
| 8 | LightGBM | 1.987e6 | 1.571e6 | 14.17% | 0.8903 |
| 9 | Chronos（Bolt-tiny，Zero-shot） | 2.723e6 | 2.203e6 | 21.87% | 0.7939 |
| 10 | Prophet | 2.876e6 | 2.134e6 | 24.72% | 0.7701 |
| 11 | ARIMA | 2.999e6 | 2.351e6 | 23.70% | 0.7500 |
| 12 | TimesFM（2.5-200M，Zero-shot） | 3.323e6 | 2.374e6 | 24.11% | 0.6930 |

> 说明：单位未证实（ZTE 为 4G 下行流量），上表为源单位下的真实误差；两个大模型与其它 10 个算法使用完全相同的 Test 目标时间与评价协议，未获得任何优待。

## 3. 全域建模与批次计划（真实执行）

```powershell
.\.venv\Scripts\python.exe backend\tests\verify_all_regions.py
# 输出：data\logs\verify_all_regions.log
```

| 检查 | 实测结果 |
|---|---|
| Milano All Regions 数据集 | 88 个有效区域，窗口 train 3784 / validation 880 / test 880 |
| 单算法全域建模（LightGBM） | 88 个 `experiment_region_models` 记录，**88/88 Completed**，0 失败 |
| All Models × All Regions 计划 | Milano **1056**、Trentino **2676**、ZTE **1776**（= 区域数 × 12） |
| 批次创建 | `planned_region_model_tasks=1056`，12 个 Experiment，顺序队列 |
| 批次停止 | 后端确认 `queued_experiments_stopped=11`，最终状态 `Stopped`（12 个实验全部 Stopped，无残留 Running） |

## 4. 浏览器交互测试（Playwright + Chromium）

```powershell
cd frontend; node tests\ui_check.mjs
# 35/35 UI checks passed (screenshots in data\screenshots)
```

覆盖要点（全部通过，含截图）：

* 两行导航 6 个模块、TN 标识、**页面无卡通人物/头像资源**。
* 首页真实数字 3 / 459 / 12 / 5 与真实 Recent Activity。
* 模块工作区恰好三栏；窄屏（900px）折叠为单列。
* M1 三个右侧 Tab、GIS 常驻且切换 Tab 不消失、88 个真实多边形渲染。
* M2 四个右侧 Tab、`eps=0` 在输入框下方报错并可在修正后立即消失、切换算法联动隐藏 K-Means 专属参数、每个字段都有 ⓘ 帮助。
* M3 三个核心 Tab + Dataset Management、比例不足/超出报错、`L=0` 报错、中央三个真实预览区。
* M4 三个右侧 Tab、All Models 置顶、`d_model=130 & n_heads=8` 整除错误、`dropout=1.5` 报错、`Epochs=10000` 只给 Warning 且不误禁用按钮、修正后 Run 恢复可用、All Models 12 个独立参数组与可运行状态标签。
* M5 三个右侧 Tab + 历史管理、中央四个视图。
* 浏览器控制台无未捕获错误。

## 5. 安装包验证（正式交付路线 A）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File packaging\test_install.ps1
# 输出：data\logs\install_test.log
```

| 步骤 | 实测结果 |
|---|---|
| 静默安装 | 成功（Inno Setup 7，日志 `data/logs/install.log`） |
| 安装后自举 | 使用安装版便携 Python 执行 `first_run.ps1`：迁移 + 导入六文件，`checks=True` |
| 启动安装版 | Worker + API 启动成功，`/api/health` 返回 `version 3.1.0, db_ok=true` |
| 安装版数据基线 | `sources=3 series_regions=459 gis_regions=473 no_data=14` |
| 安装版 UI | `GET /` HTTP 200 |
| 卸载 | 静默卸载后目标目录清空（早期版本残留的 `bootstrap_data.py` 已修复为写入 `%TEMP%` 并在 `[UninstallDelete]` 中兜底） |

最终交付的安装包由冻结源码重新构建，并在 `packaging/install-test` 目标目录完成一遍完整的
安装 → 启动 → 数据基线校验 → 卸载验证（`data/logs/install_test.log` 最后一行：
`INSTALL / RUN / UNINSTALL VERIFICATION PASSED`）。

## 6. 性能实测（CPU，无 GPU）

| 操作 | 实测 |
|---|---|
| 六文件导入 + 校验 + 缓存 | 约 3 秒 |
| 数据集构建（Milano All Regions，1h） | 约 2 秒（88 区域，窗口索引 + 工件） |
| 单区域 ARIMA（229 训练窗口，50 测试窗口滚动预测） | 约 20 秒 |
| 单区域 LightGBM（30 棵树 × 6 horizon） | < 5 秒 |
| 单区域 DL（3 epoch，小网络） | 5–20 秒；默认 100 epoch 会明显更久 |
| Chronos Bolt-tiny 推理 | 8 窗口 ≈ 0.014 秒（权重加载 ≈ 13 秒） |
| TimesFM 2.5-200M 推理 | 12 窗口 ≈ 5.6 秒（权重加载 ≈ 7 秒，已缓存） |
| Milano All Regions 单算法（88 区域 LightGBM） | 约 1 分钟 |
| 前端生产构建 | 约 12 秒（bundle ≈ 2.36 MB，gzip ≈ 757 KB） |

> 上述耗时仅代表本机环境，不构成任何性能承诺；All Models × All Regions 的全量 1000+ 任务需要数小时 CPU 时间，本报告不声明已完成。

## 7. 未验证/受限项

| 项目 | 状态 | 原因 |
|---|---|---|
| TimesFM / Chronos Fine-tuning | 未验证（Disabled） | 未确证所选版本支持 + 未实现，UI 保持关闭，不显示伪造训练曲线 |
| 公网 HTTPS 部署 | 未验证（Blocked） | 需要服务器、域名、凭据与许可确认，见 `DEPLOYMENT.md` |
| GPU 训练性能 | 未验证（Blocked） | 本机无 CUDA 设备 |
| Milano/Trentino All Regions × All Models 全量训练 | 未验证 | 计划数与队列机制已实测；全量执行需要数小时，按 spec 要求分别报告“设计容量/自动化覆盖/实测批次” |

## 8. 界面可读性改进（用户反馈轮）

收到 8 条针对 Module 1 / Home 的界面反馈后完成的改动，并重新实测：

| 反馈 | 改动 | 验证 |
|---|---|---|
| Recent Activity 看不懂 | 卡片顶部新增说明块：记录类型（Dataset/Experiment/Batch/Evaluation）、状态含义、ID 与时间的用途 | `data/screenshots/01-home.png` |
| 地图没有区域名称 | 地图新增「显示区域名称」开关（默认开启），所有多边形按区域 ID 标注；底图切换为标准 OSM（去掉 CARTO 的 “API KEY REQUIRED” 水印） | `visual_check_m1.mjs` 输出 `map labels: 88`、`carto watermark present: false` |
| 「时间截面位置」不明 | 滑块右侧直接显示该截面的真实时间；下方新增说明：从整条时间轴选一个时刻，看该时刻所有区域的取值快照 | `data/screenshots/10-m1-map-labels-and-explain.png` |
| 统计摘要各列含义不明 | 标题旁新增「各列含义 ⓘ」（均值/峰值/P95/CV/零值逐项解释）+ 统计范围说明 | `data/screenshots/11-m1-explanations.png` |
| 周内图只有周五、周六有线段（实为 bug） | 周内模式改为基于**完整序列**计算（原先受 2 天显示窗口限制，只有两个星期几有数据）；默认分析窗口改为 1008 点（10 分钟频率约 7 天），并注明计算依据 | API 实测 `weekly non-null days: 7`，`weekly_note` 已显示 |
| ACF 与趋势图不明 | 新增读图说明：ACF 衡量与滞后 k 步的相关性、接近 1 / 0 / 负值的含义、斜率含义 | `data/screenshots/11-m1-explanations.png` |
| Spatial Analysis 三个图不明 | 顶部新增整页说明，三张图分别加「图 1/2/3」的解释（Top-12 排名、取值分布直方图、最低 6 个区域） | 同上 |
| 跨城图蓝绿线为何在 0 以上（实为 bug） | 前端原先错误地绘制了**原始小时均值**（与 z-score 标签不符），已改为绘制 `hourly_shape_z`；并解释 0 线 = 该来源自身平均小时水平 | API/浏览器实测：Milano z 范围 −1.72..1.10，原始最大值 9.17e3；ZTE 原始 1.69e7，三者现在同图可比形状 |

重新执行回归：`pytest 55 passed`、`ui_check.mjs 35/35 passed`、`e2e_smoke.py ALL E2E STEPS PASSED`。

## 9. Module 1 时间范围与自动分析（增量改造）

### 9.1 自动化测试

```powershell
cd backend
..\.venv\Scripts\python.exe -m pytest tests -q      # 101 passed

cd ..\frontend
node tests\check_m1_insights.mjs                    # 日期/索引同步 + 三个 Insights
node tests\ui_check.mjs                             # 35/35，其他模块未回归
```

### 9.2 真实数据观测（Milano / ADRIANO，2013-11-01 → 2013-11-08，1008 点）

| 输出 | 实测值 |
|---|---|
| 范围解析 | 起点 2013-11-01 00:00:00，最后观测 2013-11-07 23:50:00，1008 点，跨度 7.0 天，间隔 10 分钟 |
| 统计摘要 | 均值 6,062.99，最大 10,905.07，最小 2,027.67，P95 8,073.60，CV 0.275 |
| Hourly Insights | 高峰 18:00–19:00（7,634.99，+27.8%）；低谷 04:00–05:00（3,323.73，−56.5%）；单峰型；白天比夜间高 15.8% |
| Weekday Insights | 工作日平均 6,181.60、周末 5,461.95，按共同小时口径工作日高 13.2%；两组高峰均 18:00；最大差异 08:00（工作日 6,461.43 vs 周末 3,973.01） |
| ACF Insights | Lag 1–3 平均 ACF 0.959；Lag 74（12.3 小时）ACF −0.525；日周期 Lag 144 ACF 0.899（high） |
| 趋势 | +12.02 / 小时（288.50 / 天），R²=0.129 → 界面明确提示“解释力有限，仅描述区间” |
| 日期改为 14 天 | 点数 2016，所有统计与 Insights 同步变化（高峰值 7,813.95） |
| 索引改为 144 | 开始日期自动同步为 2013-11-02 00:00（双向一致） |
| 只有工作日（11-04 → 11-08） | 周末样本 = 0、曲线全 No Data，并提示“没有有效周末数据，无法完整比较” |
| Max Lag 不足（24） | 日周期候选返回“只覆盖约 4 小时/未覆盖 24 小时”，不生成周期结论 |

### 9.3 截图

* `data/screenshots/12-m1-insights.png`：日期范围、三张图与三个 Insights 卡片（真实数值）。
* `data/screenshots/13-m1-insights-full.png`：整页长截图，包含 ACF 置信带与展开区域。

### 9.4 最后一轮检查与修复（2026-10-17）

| 问题 | 修复 | 验证 |
|---|---|---|
| 分析范围 11-02 起，但 GIS 截面仍显示 11-01 | 滑块定义域改为 `[range.start_index, range.end_index-1]`；范围变化时自动夹紧；时间序列先解析范围再请求截面，保证地图时间落在范围内 | `check_m1_fixes.mjs` 1a–1d：min=144、value=144、末端显示 2013-11-15 |
| Max Lag 输入框显示 0 但实际为 1008 | 新增 Auto 开关：Auto 显示实际生效值与换算时长；切手动时用当前生效值预填；手动超上限前后端返回 `LAG_TOO_LARGE`，1 返回 `LAG_TOO_SMALL` | 2a–2e：自动 1109 步（7.7 天）、手动预填 1109、200 生效、5000 报错、可切回 Auto |
| 14 天窗口把周周期当作已确认 | 区分 candidate / confirmed：确认需 ≥3 个完整重复 + 该滞后配对 ≥2×Lag + 峰值 ≥0.4；并要求真正的局部极值与 Peak 后 10% 余量 | 3a/3b：日周期确认（14 次重复、1872 对）；周周期仅“候选（2 次重复）” |
| 切换 Auto 后不再自动重算 | 自动重算等待校验落定，并把 `valid` 加入依赖；旧远端错误不会永久吞掉重算 | 2e 后实际发出 `acf_max_lag=0` 请求并回到自动值 |

回归：`pytest 110 passed`、`ui_check.mjs 35/35`、`check_m1_fixes.mjs 12/12`。
截图：`data/screenshots/14-m1-final-fixes.png`。

## 10. Module 1 三栏比例与右侧二级 Tab（2026-10-17）

| 检查 | 实测 |
|---|---|
| 三栏比例 | `gridTemplateColumns = 384px 614.4px 537.6px` → **25% / 40% / 35%** |
| 右侧结构 | 顶部固定 `统计摘要`，其后 `Hourly Profile / Weekday vs Weekend / ACF & Trend` 三个二级 Tab |
| 重复图表 | 右侧不再包含 `流量时间序列`；中央保留多区域曲线 |
| Tab 切换 | 每次只显示 1 张图 + 1 组 Insights（三个 Tab 均验证） |
| 放大查看 | Modal 打开后含 480px 高图表与同一份 Insights，可关闭 |
| 响应式 1200px | 两栏（391 / 759），右侧 `grid-column: 1 / -1`，横向溢出 0px |
| 响应式 900px | 单栏（864px），横向溢出 0px |
| 控制台 | 无未预期错误 |

```powershell
cd frontend
node tests\check_m1_layout.mjs     # 13/13
node tests\check_m1_fixes.mjs      # 12/12
node tests\check_m1_insights.mjs   # 三个 Insights 均正常，无错误
node tests\ui_check.mjs            # 35/35（含 M2–M5 回归）
```

截图：`15-m1-layout-modal.png`（放大视图）、`16-m1-layout-1600.png`（25/40/35）、
`17-m1-layout-1200.png`（两栏）、`18-m1-layout-900.png`（单栏）。

## 11. Module 1 最终整合版（2026-10-17 第二轮）

| 检查 | 实测 |
|---|---|
| 左侧 | 无 Advanced Settings / 无可见索引输入；Max Comparison Regions 紧跟 Regions；日期与范围摘要保留 |
| 中央顺序 | 地图 → 多区域时序（无橙色拟合线）→ 多区域统计摘要 → Statistical Summary Insights |
| 中央统计 | 2–3 个区域时逐行展示独立统计；切换 Analysis Target 后表格文本完全一致；多区域 Insights 出现“最高/最低”比较 |
| 右侧 | 顶部 Analysis Target（仅已选区域）+ 三个一级 Tab + 三个二级 Tab；无统计摘要、无重复时序图 |
| 二级 Tab | 每次只显示 1 张图 + 1 组 Insights；切换后 Insights 数值随 target 改变（ADRIANO 7,634.99 → BRERA 43,378.01） |
| 放大查看 | 模态框含 480px 图表与同一份 Insights |
| 响应式 | 1200px 两栏 / 900px 单栏，横向溢出 0px |
| 控制台 | 无未预期错误 |

```powershell
cd backend; ..\.venv\Scripts\python.exe -m pytest tests -q   # 116 passed
cd ..\frontend
node tests\check_m1_layout.mjs    # 26/26
node tests\check_m1_fixes.mjs     # 12/12
node tests\ui_check.mjs           # 35/35
node tests\check_m1_insights.mjs  # 三个 Insights + 日期联动，无错误
```

截图：`23-m1-left-config.png`、`24-m1-center-multi-region.png`、
`25-m1-right-hourly.png`、`26-m1-right-weekday.png`、`27-m1-right-acf.png`、`28-m1-integrated-full.png`。

## 12. Module 1 三项界面重排（2026-10-17 第三轮）

本轮只调整排列，不改计算逻辑：

| 检查 | 实测 |
|---|---|
| 左侧顺序 | 数据源 → 最多对比区域数 → 区域 → 所有参数保持原功能与校验 |
| Analysis Target | 位于 Temporal Analysis 内部顶部；切换到 Spatial Analysis 时该控件消失 |
| 二级 Tab | `.tn-subtabs` 数量为 0；三个段落 `Hourly Profile / Weekday vs Weekend / ACF & Trend` 纵向排列 |
| 图表与结论相邻 | 每个 section 内 1 个图表 + 1 组 Insights（adjacency = true,true,true） |
| Target 切换 | 右侧数值变化（ADRIANO 7,634.99 → BRERA 43,378.01），中央统计表逐字不变 |
| 单区域约束 | 右侧 Hourly 图只绘制 Analysis Target（不再混合其他已选区域） |
| 放大查看 | 模态框含图表与对应 Insights |
| 上限校验 | 调小到 1 且已选 2 个区域：Error + 提示 + 运行禁用，已选区域不被自动删除 |
| 响应式 | 1200px 两栏 / 900px 单栏，横向溢出 0px |

```powershell
cd backend; ..\.venv\Scripts\python.exe -m pytest tests -q   # 116 passed
cd ..\frontend
node tests\check_m1_layout.mjs    # 27/27
node tests\check_m1_fixes.mjs     # 12/12
node tests\ui_check.mjs           # 35/35
node tests\check_m1_insights.mjs  # 三个 Insights + 日期联动，无错误
```

截图：`23-m1-left-config.png`、`24-m1-center-multi-region.png`、`25-m1-right-temporal-stacked.png`、`29-m1-stacked-temporal.png`。

## 13. Module 1 反馈微调（2026-10-17 第四轮）

| 反馈 | 处理 | 验证 |
|---|---|---|
| 删除“最多对比区域数” | 从界面与前端 schema 移除；内部上限固定 12（后端默认同步为 12），不再有该输入框 | `[data-field="m1.max_regions"]` 数量为 0 |
| 标签统一“中文（英文）” | 分析时间范围（Analysis Time Range）、时间截面（Time Slice）、分析对象（Analysis Target）、三个一级 Tab 全部双语 | 浏览器文本断言 |
| ACF 计算框白底 | `.tn-range-summary` 改为白底 + 浅边框，与图表说明一致 | 截图 `25-m1-right-temporal-stacked.png` |
| 分析对象位置 | 移到日内小时画像之后、工作日对比之前 | `分析对象` 索引介于 `日内小时画像` 与 `工作日 vs 周末` 之间 |
| 日内图显示全部区域 | Hourly Profile 恢复多区域曲线；Insights 卡片注明“结论针对分析对象” | 2 个区域时曲线图例含 ADRIANO + BRERA |
| 标签不截断 | 右侧一级 Tab 允许两行显示（11px / max-width 168px） | 三个标签完整可见 |

```powershell
cd backend; ..\.venv\Scripts\python.exe -m pytest tests -q   # 116 passed
cd ..\frontend
node tests\check_m1_layout.mjs    # 27/27
node tests\check_m1_fixes.mjs     # 12/12
node tests\ui_check.mjs           # 35/35
```

## 14. Module 1 说明文字位置与格式（2026-10-17 第五轮）

| 反馈 | 处理 | 验证 |
|---|---|---|
| 多区域统计的范围说明位置 | 从表格与 Insights 之间移到整块最下方（表格 → Insights → 范围/样本脚注） | 截图 `24-m1-center-multi-region.png` |
| ACF 计算信息框格式 | 去掉浅色边框/背景，改为与日内、工作日图下方一致的纯文本行（计算范围 · 有效样本 · 间隔 · Max Lag；实际生效 Max Lag 同行说明） | 截图 `25-m1-right-temporal-stacked.png` |

回归：`pytest 116 passed`、`check_m1_layout 27/27`、`check_m1_fixes 12/12`、`ui_check 35/35`。

### 14.1 追加微调

* 多区域统计摘要的范围说明改为紧跟卡片标题（标题 → 说明 → 表格 → Insights）。
* ACF 的 Auto 开关与"实际生效 Max Lag"合并为蓝底控制块，开关与标题字号放大。
* 回归：`check_m1_layout 27/27`、`check_m1_fixes 12/12`、`ui_check 35/35`。
