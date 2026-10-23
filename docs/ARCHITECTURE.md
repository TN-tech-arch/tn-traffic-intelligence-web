# 系统架构（ARCHITECTURE）

## 1. 总体结构

```text
浏览器 (React 18 + TS + Vite, Ant Design / ECharts / Leaflet)
        │  REST (fetch, 结构化错误)
        ▼
FastAPI (app.main)                     Worker 进程 (app.workers.runner)
  ├── api/*       路由与契约校验          ├── 领取 jobs 表任务（顺序队列）
  ├── services/*  数据/窗口/指标/聚类      ├── 执行训练 / 批次 / 评价 / 聚类
  ├── forecast/*  12 算法注册表与适配器    ├── 心跳 + 取消标志 + 真实日志
  └── db/*        SQLite + SQL 迁移       └── 单区域失败不阻塞其余区域
        │                                        │
        ├── data/raw        （六个原始文件，只读）
        ├── data/processed  （npz 序列缓存 + 质量报告）
        ├── data/artifacts  （datasets / experiments 工件、日志）
        └── models_cache/hf （官方预训练权重缓存）
```

单机部署为「一个 API 进程 + 一个 Worker 进程 + SQLite(WAL)」，无需消息队列；
任务状态、心跳与取消标志全部落库，浏览器刷新或进程重启都不会产生“假运行”。

## 2. 数据层

### 2.1 导入与校验（`services/ingest.py`）

* 读取六个文件，计算 SHA-256，写入 `data_sources` 与 `regions`。
* 断言项（spec 2.1）：时点数 8928 / 8928 / 2784；时序区域 88 / 223 / 148；GIS 多边形 88 / 223 / 162；
  ZTE 零值 735；采样间隔 600 / 600 / 900 秒；时间戳单调且无重复；无 NaN / Inf。
* 结果缓存为 `data/processed/<source>_series.npz`（float32 矩阵 + int64 时间轴）与 `<source>_quality.json`。
* **只报告不修数据**：若检测值与预期不符，会在质量报告中显示差异，而不是改数据迎合预期。

### 2.2 重采样（`services/series.py`）

原生 / 30 分钟 / 1 小时 / 1 天，必须是原生频率整数倍；`sum` 或 `mean`；
不完整时间桶一律记为缺失（不悄悄产出看似完整的值）。

### 2.3 数据库（`db/migrations/001_init.sql`）

`data_sources / regions / dataset_versions / clusters / batches / experiments /
experiment_region_models / evaluations / evaluation_experiments / evaluation_predictions /
jobs / audit_events / app_settings`，含外键、唯一约束与索引；SQLite 采用 WAL + busy timeout。

## 3. 计算层

### 3.1 滑窗与切分（`services/windows.py`）

```text
X_i = [v[t] … v[t+L-1]]      Y_i = [v[t+L] … v[t+L+H-1]]      next start = t + S
```

* 先按时间切分 Train/Validation/Test（默认 70/15/15），再为每个 split 生成 **目标完全落在该 split 内** 的起点；
  测试/验证窗口可以使用起点之前已观测的历史作为 X。
* 缺失处理三种模式：`automatic`（仅前向填充）、`causal_interpolation`（在已观测端点间插值，
  但窗口预测起点必须 ≥ 插值区间右端点，否则该窗口作废）、`drop_invalid`（直接丢弃）。
* **目标从不插值**：只要某个 Y 目标不是真实观测，该窗口无效。
* 窗口索引以「候选区间 + 有效性位图」持久化，工件小且可完全复现。

### 3.1b Module 1 时间范围与自动分析（`services/time_range.py`、`services/insights.py`）

* `resolve_range()` 把日期时间与重采样后的索引统一解析为**一个闭区间**（`searchsorted` 左右边界），
  返回实际起点、最后一个观测、点数、跨度、采样间隔与边界截断信息；日期与索引两种输入共享同一套校验。
* `services/stats.py:temporal_analysis()` 只切片一次，统计、时序、Hourly、Weekday、ACF、Trend 与
  Insights 全部从该切片计算，保证图表与文字一致。
* `services/insights.py` 是无副作用的纯函数集合（峰值检测、昼夜对比、工作日/周末、ACF、去趋势周期检测、
  线性趋势），每条结论都返回 `metrics` 供前端展开详情，并可被单元测试用构造序列直接验证。
* 中央地图的 `time_index` 独立于分析范围，只触发 Spatial 快照刷新。
* 布局：`ThreePane` 提供 `variant="m1"`，Module 1 使用 25/40/35（其它模块保持 25/45/30）；
  中央为「GIS → 多区域时序 → 多区域统计摘要 + Insights」，右侧为三个一级 Tab，
  且 Analysis Target 位于 Temporal 内部顶部，其下依次纵向排列 Hourly / Weekday / ACF（无二级 Tab），
  图表右上角 `放大查看` 通过 Modal 渲染同源数据的 480px 高图表与同一份 Insights。
  断点：≤1500px 微调比例，≤1250px 两栏（右侧整行），≤900px 单栏。
* 数据隔离：一次 `temporal_analysis` 返回**所有已选区域**的 `statistics`（供中央表格与
  `insights.summary`），以及**一个 Analysis Target** 的 hourly/weekday/acf（`insight_region_id`）。
  切换 target 只改变后者，中央统计不变。
* 空间分析：`POST /api/analysis/spatial` 以 `time_index` 取一个截面，对**该数据源全部有时序区域**
  计算 `top`（12）、`bottom`（6）与等宽直方图 `distribution`（左闭右开，最后区间含右端点），
  并返回 `insights.high/low/distribution`；`range_mean` 单独按所选日期范围计算，与截面值严格区分。

### 3.2 缩放（`windows.fit_scaler / apply_scaler / inverse_scaler`）

按区域、仅用训练段已观测样本拟合；评价阶段逆变换回源单位后再算指标。

### 3.3 算法适配（`forecast/`）

统一契约（`forecast/base.py`）：

```python
fit(region, train_batch, validation_batch) -> FitResult(state, history, notes)
predict(region, state, batch) -> y_hat [N, H]
```

| 算法 | 实现要点 | 输出空间 |
|---|---|---|
| ARIMA | statsmodels；参数仅用训练段估计，测试阶段用已观测值 `append(refit=False)` 更新状态 | 源单位 |
| Prophet | 训练段拟合；预测时用最近已观测残差校准，`refit_interval>0` 时按预测起点滚动重拟合 | 源单位 |
| Random Forest | sklearn，多输出或逐 horizon 直接回归 | 标准化空间（评价前逆变换） |
| XGBoost / LightGBM | 逐 horizon 直接回归（H 个子模型），记录真实迭代指标 | 标准化空间 |
| MLP / RNN / LSTM / GRU / Transformer | PyTorch 真实训练循环、真实 epoch 损失、早停、梯度裁剪、权重保存 | 标准化空间 |
| TimesFM | 官方 `timesfm` 包 + `google/timesfm-2.5-200m-pytorch`（Apache-2.0）真实 Zero-shot，`compile(ForecastConfig)` 后推理 | 源单位 |
| Chronos | 官方 `chronos-forecasting` + `amazon/chronos-bolt-tiny`（Apache-2.0）真实 Zero-shot，取 0.5 分位 | 源单位 |

Foundation 能力（是否安装、有哪些 checkpoint、是否已缓存、设备）通过 `GET /api/models/foundation`
动态返回，前端不硬编码“所有大模型都能微调”。

## 4. 任务层

* `jobs` 表是唯一的任务真相：`Queued → Running → Completed/Failed/Stopped/Skipped`，
  记录 `worker_id`、`heartbeat_at`、`progress_json`、`cancel_requested`。
* Worker 启动时把心跳过期的 `Running` 任务改判为 `Interrupted/Failed`，绝不留“假 Running”。
* `All Models` 批次：1 个 `batches` 行 + 同一区域 12 个 `experiments` 行 + 12 个顺序 job；
  每个单区域 experiment 对应 1 个 `experiment_region_models` 记录。
* Stop：后端先落库 `cancel_requested`，未开始的任务立即置 `Skipped/Stopped`，
  正在运行的任务在安全检查点结束并把状态改为 `Stopped`，已完成工件保留。

## 5. 接口与错误契约

* `GET /api/validation/schema` 输出全部字段约束（类型/范围/枚举/默认值/帮助/联动/告警阈值）。
* 前端用同一份 schema 做即时校验；涉及数据或环境的规则再调用 `POST /api/validation/check`。
* 任何写操作接口都会用同一套 validator **再校验一次**，失败返回：

```json
{"valid": false,
 "issues": [{"path":"model_configs.mlp.params.dropout","code":"OUT_OF_RANGE","severity":"error",
             "message":"丢弃率 必须小于 1，收到 1.5。","suggestion":"…","received_value":1.5}],
 "request_id":"…"}
```

* 常规字段错误 422；跨资源冲突（已引用数据集硬删除、实验 Scope 不匹配等）409；失败必定无副作用（事务 + 临时目录 + 原子改名）。

## 6. 前端

* 两行顶部导航（品牌横幅 + 六模块），模块工作区固定三栏 25% / 45% / 30%，窄屏折叠为单列。
* `components/ParamField.tsx`：字段标签 + ⓘ 帮助 + 错误（红色、输入框下方、`role="alert"`）
  + 警告（琥珀色、独立文案）+ `aria-invalid` / `aria-describedby`；数字输入保留中间态（`""`、`-`、`0.`）。
* `validation/useValidation.ts`：本地即时校验 + 防抖后的权威校验，并用请求序号丢弃过期响应，避免旧结果覆盖新输入。
* 历史管理位于各模块既定的右侧 Tab 内（M4 的 Experiment History、M5 的 Evaluation History 折叠区、M3 的 Dataset Management），不新增第四栏。
