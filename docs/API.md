# API 参考（API）

基地址：`http://127.0.0.1:8077`；OpenAPI 文档：`/docs`。所有复杂请求使用 POST JSON。

## 1. 健康与环境

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 版本、数据库状态与计数、Worker 待处理任务与最近心跳、环境（CPU/RAM/磁盘/torch/CUDA） |
| GET | `/api/environment` | 纯环境报告 |
| GET | `/api/dashboard` | 首页统计（数据源、有效区域、算法数、模块数、真实历史计数、工作流、免责声明） |

## 2. 数据

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/data/sources` | 三地点、频率、有效区域、时间范围、单位、指纹、零值/缺失计数 |
| POST | `/api/data/import` | 重新导入并校验六个原始文件（幂等） |
| GET | `/api/data/quality?source_key=` | 完整质量报告（含逐区域统计） |
| GET | `/api/data/regions?source_key=&has_timeseries=` | 区域列表与 `has_timeseries`、No Data 原因 |
| GET | `/api/data/geometry?source_key=` | GeoJSON FeatureCollection + `no_data_regions` |
| GET | `/api/data/series?source_key=&region_id=&frequency=&aggregation=` | 真实时间序列（缺失点返回 `null`） |

## 3. Module 1 分析

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/analysis/temporal` | 序列、统计（均值/峰谷/P95/CV）、日内、周内、ACF、趋势 |
| POST | `/api/analysis/spatial` | 指定时间截面的空间强度、排名、分布直方图 |
| POST | `/api/analysis/compare` | 跨来源归一化（z-score）形状比较 + 免责声明 |

## 4. Module 2 聚类

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/clusters/features` | 可选特征目录与四种算法 |
| POST | `/api/clusters/validate` | 特征/参数可运行性校验（含 `region_count` 语境） |
| POST | `/api/clusters/run` | 创建聚类任务，返回 `cluster_run_id` 与 `job_id` |
| GET | `/api/clusters` / `/api/clusters/{id}` | 历史列表 / 结果（簇摘要、区域列表、质量指标、算法细节） |
| DELETE | `/api/clusters/{id}` | 删除该次聚类结果（运行中拒绝） |

## 5. Module 3 数据集

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/datasets/validate` | 字段级校验 + 预计算（空 split、窗口数等） |
| POST | `/api/datasets/preview` | 完整预览（不落库）：划分统计、候选/有效/排除窗口数及首个真实窗口 |
| POST | `/api/datasets/preview-window` | 按划分和窗口序号读取一个真实有效窗口（不落库） |
| POST | `/api/datasets/build` | 原子构建，成功才返回 `dataset_id`（`status=Built`） |
| GET | `/api/datasets` / `/{id}` | 历史与不可变快照 |
| GET | `/api/datasets/{id}/windows?split=&region_id=&offset=&limit=` | 真实窗口索引与 X/Y |
| DELETE | `/api/datasets/{id}` | 未被引用时可删除；被引用返回 409 `DATASET_REFERENCED` |

## 6. Module 4 模型与批次

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/models/registry` | 恰好 12 条算法记录（分组、参数 schema、帮助、动态能力）+ `all_models` 定义 |
| GET | `/api/models/foundation` | TimesFM / Chronos 的依赖、checkpoint 列表、许可、缓存与设备状态 |
| POST | `/api/models/preflight` | 单模型或 All Models 的真实兼容性预检（逐算法 Error/Warning） |
| POST | `/api/models/foundation/{key}/download` | 后台下载官方 checkpoint（job 化） |
| POST | `/api/experiments/run` | 单模型实验：1 Experiment ID + job |
| GET | `/api/experiments` / `/{id}` / `/{id}/logs` | 快照、区域子模型、真实日志（可按级别/区域过滤） |
| POST | `/api/experiments/{id}/stop` / `/duplicate` / `/archive` | 停止（后端确认）、复制为草稿（不产生新 ID）、归档 |
| DELETE | `/api/experiments/{id}` | 被 Evaluation 引用时返回 409，只能归档 |
| POST | `/api/batches/run` | All Models：1 Batch ID + 12 Experiment ID + 顺序队列 |
| GET | `/api/batches` / `/{id}` | 批次状态、任务汇总、逐实验与逐区域状态 |
| POST | `/api/batches/{id}/stop` | 后端确认停止；未开始任务立刻置为 Stopped |

## 7. Module 5 评价

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/evaluations/validate` | 共同 Test / Dataset / H / Region 兼容报告 |
| POST | `/api/evaluations/run` | 创建 Evaluation ID 与推理 job |
| GET | `/api/evaluations` / `/{id}` | 历史 / 结果（逐实验 macro+pooled+逐区域指标、排名、预测样本） |
| GET | `/api/evaluations/{id}/series?experiment_id=&region_id=&horizon_step=` | 预测/真实序列（供图表） |
| POST | `/api/evaluations/{id}/stop` / DELETE | 停止 / 删除本层结果（不影响上游） |

## 8. 统一校验

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/validation/schema` | M1/M2/M3/M5 与 12 个模型的全部字段约束 |
| POST | `/api/validation/check` | `{kind: m1|m2|m3|m5|model|all_models, values, context}` → 字段级 issues |

### 错误响应示例（HTTP 422）

```json
{
  "valid": false,
  "message": "MLP 参数校验未通过",
  "issues": [
    {"path": "model_configs.mlp.params.dropout", "code": "OUT_OF_RANGE", "severity": "error",
     "message": "丢弃率 必须小于 1，收到 1.5。", "suggestion": "0、0.1、0.2、0.5 为常用值；1.5 之类的值非法。",
     "received_value": 1.5}
  ],
  "error_count": 1,
  "warning_count": 0,
  "request_id": "6c2f…"
}
```

被拒绝的请求不会创建任何 Job / ID / 工件，也不会修改已保存对象。
