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
# 55 passed, 2 warnings in 23.90s
```

| 测试文件 | 覆盖内容 | 结果 |
|---|---|---|
| `test_metrics.py` | MAE / RMSE / sMAPE / R² 的手工样例、sMAPE 0/0、常量真值 R²=N/A、非有限值不当作 0、Macro 等权平均 | 7 passed |
| `test_windows.py` | 窗口定义、目标不跨 split、切分吸收余数、因果插值的“不得偷看未来”规则、目标从不插值、scaler 仅拟合训练段且可逆、前向填充只用过去值 | 7 passed |
| `test_validation.py` | 恰好 12 算法、dropout 越界、dropout 边界 0/1、L=0/S=0、比例之和、Transformer 整除、Epochs 大是 Warning、batch_size 大于样本是 Warning、ARIMA trend 与 d 兼容、非数字/非整数、Ward+非欧氏、DBSCAN eps>0、至少两个特征、M1 区域上限与未知区域、M5 Scope 冲突、All Models 逐算法报告 | 15 passed |
| `test_adapters.py` | 10 个常规适配器在真实 pytorch/statsmodels/sklearn 上产出有限 `[N,H]`；两个 Foundation 在真实权重上 Zero-shot 且 `no_epochs=true`；未知 checkpoint 必须报错而不偷偷换权重 | 10 passed + 2 passed（Foundation 真实权重） |
| `test_api.py` | 健康检查、数据基线断言、注册表 12 条、GIS 162 多边形与 14 No Data、L=0 返回字段级错误、比例非法阻止 Build 且不产生 Dataset、**绕过前端的 dropout=1.5 被 422 拒绝且不创建 Experiment**、Transformer 整除 422、未知 Dataset 404、批次逐算法预检、评价缺实验校验、被引用数据集删除 409、schema 可机读 | 14 passed |

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
