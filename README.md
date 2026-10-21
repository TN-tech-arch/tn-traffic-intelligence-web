# TianNuo Traffic Intelligence ｜ 智能流量分析与预测平台

**PROJECT_SPEC v3.1 的完整实现**：真实数据、真实算法、真实评价，带 Windows 安装包。

作者：田诺（TianNuo）· 版本 3.2.0 · 平台：Windows 10/11 x64（已在 Python 3.12.10 / Node 24 / 16 GB RAM / 无独显 CPU 环境实测）

---

## 1. 这是什么

一个可以真正运行的 Web 全栈系统，使用三组真实的区域流量数据完成闭环：

**探索性时空分析 → 功能区聚类 → 预测数据集构建 → 12 种算法训练（含 All Models 批处理） → held-out Test 公平评价**

* 三组真实数据：Milano（88 区 / 10 分钟）、Trentino（223 区 / 10 分钟）、ZTE 4G 下行（148 个有时序区域 + 162 个 GIS 多边形 / 15 分钟，其中 14 个区域无数据、735 个真实零值）。
* 12 种真实算法：ARIMA、Prophet、Random Forest、XGBoost、LightGBM、MLP、RNN、LSTM、GRU、Transformer、**TimesFM**、**Chronos**（后两者为官方预训练权重的真实 Zero-shot 推理）。
* `All Models` 是批量编排（1 个 Batch ID → 12 个 Experiment ID），不是第 13 种算法。
* Dataset ID → Experiment ID / Batch ID → Evaluation ID 全链路真实持久化。
* 所有可编辑参数实时校验，错误显示在输入框下方，Warning 与 Error 分离，后端不可绕过。
* Module 1 支持**日期时间范围**（默认完整有效范围）、统一原生时间口径，并为
  日内小时画像、工作日/周末、ACF 与趋势三张图**自动生成可解释结论**（真实统计规则，非固定文案；
  详见 `docs/M1_ANALYSIS.md`）。
* 3.2.0 起取消时间分辨率、聚合方式、高级设置和手动数据集名称；DS / CLUS / EXP / BATCH 使用持久化可读序号，删除历史后序号不复用。

## 2. 交付物

| 交付物 | 位置 |
|---|---|
| Windows 安装包（正式交付路线 A） | `packaging/dist/TN-Traffic-Intelligence-Setup-3.2.0.exe`（约 255 MB，含便携 Python 运行时与全部依赖，可离线安装） |
| 完整源代码 | `backend/`（FastAPI + 真实算法）、`frontend/`（React + TS + Vite）、`scripts/`、`packaging/` |
| 文档 | `docs/`（USER_GUIDE、ARCHITECTURE、API、MODEL_REGISTRY、DEPLOYMENT、TEST_REPORT、IMPLEMENTATION_STATUS、ACCEPTANCE_REPORT、LICENSE_NOTICES） |
| 测试证据 | `docs/TEST_REPORT.md`、`docs/ACCEPTANCE_REPORT.md`、`data/screenshots/`、`data/logs/` |
| 数据指纹 | `DATA_MANIFEST_SHA256.txt`（导入时重新计算并比对） |

## 3. 三种运行方式

### 方式 A：安装包（推荐给课程验收）

1. 双击 `packaging/dist/TN-Traffic-Intelligence-Setup-3.2.0.exe`。
2. 安装向导会：安装便携 Python 运行时与依赖 → 初始化数据库 → 导入并校验六个数据文件 → 创建开始菜单 / 桌面快捷方式。
3. 开始菜单 → **启动 TN Traffic Intelligence**：后台启动 Worker 与 API，并自动打开 <http://127.0.0.1:8077/>。
4. 停止服务用 **停止服务** 快捷方式；卸载用 **卸载 TN Traffic Intelligence**（同时清理运行时与数据目录）。

可选：安装时可勾选“立即下载预训练大模型权重”（Chronos ≈ 35 MB + TimesFM ≈ 800 MB）。
未勾选时，可在应用内 **Training → Check Compatibility** 处按需下载；默认使用官方镜像 `HF_ENDPOINT=https://hf-mirror.com`。

### 方式 B：从源码运行（开发）

```powershell
# 1) 一次性准备（需要 Python 3.10-3.12）
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-core.txt -r requirements-ml.txt -r requirements-models.txt
cd frontend; npm install; npm run build; cd ..

# 2) 导入真实数据并初始化数据库
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\import_data.ps1

# 3) 一键启动（Worker + API + 打开浏览器）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start_all.ps1
# 访问 http://127.0.0.1:8077
```

开发模式（前端热更新）：先运行 `scripts\start_api.ps1` 与 `scripts\start_worker.ps1`，再在 `frontend/` 执行 `npm run dev` 访问 <http://localhost:5173>（Vite 已代理 `/api`）。

环境自检：`powershell -File scripts\check_environment.ps1`。

### 方式 C：Docker / 公网部署（路线 B）

`docker-compose.yml` 与 `docs/DEPLOYMENT.md` 已提供；**尚未在真实公网服务器上部署验证**，因此不宣称“已有可访问网址”。原因与所需授权见 `docs/IMPLEMENTATION_STATUS.md`。

## 4. 目录结构

```text
codex10.16/
├── backend/
│   ├── app/
│   │   ├── api/            # REST 接口（data / analysis / clusters / datasets / models / experiments / batches / evaluations / validation）
│   │   ├── core/           # 配置、ID、结构化错误
│   │   ├── db/             # SQLite 迁移与连接（migrations/001_init.sql）
│   │   ├── forecast/       # 12 个算法注册表与适配器（含 TimesFM / Chronos）
│   │   ├── services/       # 数据导入、重采样、滑窗、校验、指标、聚类、统计、工件
│   │   └── workers/        # 持久化任务 Worker（训练 / 批次 / 评价 / 聚类）
│   └── tests/              # pytest 单元 + 集成 + 真实模型 smoke + 端到端脚本
├── frontend/               # React 18 + TS + Vite + Ant Design + ECharts + Leaflet
├── data/                   # raw（原始数据，只读）/ processed / artifacts / logs / screenshots
├── docs/                   # 全部交付文档与验收报告
├── packaging/              # Windows 安装包构建脚本与 Inno Setup 脚本
├── scripts/                # 环境检查、数据导入、启动/停止/重启服务
└── requirements*.txt       # 依赖清单与锁定版本
```

## 5. 常用命令

| 目的 | 命令 |
|---|---|
| 环境检查 | `powershell -File scripts\check_environment.ps1` |
| 导入/校验数据 | `powershell -File scripts\import_data.ps1` |
| 启动全部服务 | `powershell -File scripts\start_all.ps1` |
| 重启服务 | `powershell -File scripts\restart_dev.ps1` |
| 后端单元/集成测试 | `.\.venv\Scripts\python.exe -m pytest backend\tests -q` |
| 端到端真实链路 | `.\.venv\Scripts\python.exe backend\tests\e2e_smoke.py` |
| 单区域工作流验证 | `.\.venv\Scripts\python.exe backend\tests\verify_single_region_workflow.py` |
| 浏览器交互测试 | `cd frontend; node tests\ui_check.mjs` |
| 构建安装包 | `powershell -File packaging\build_package.ps1` |
| 安装/运行/卸载验证 | `powershell -File packaging\test_install.ps1` |

## 6. 关键设计约定（不可违反）

* **不造假**：没有权重的模型标记 `Unavailable`；失败的训练保留真实错误；初始化阶段没有任何 Recent Activity。
* **无泄漏**：先按时间切分，再构造目标完全落在同一 split 的窗口；插值只在预测起点之前可用（见 `services/windows.py`）。
* **单区域工作流**：模块三至模块五统一使用一个具体区域；“全部模型”表示在同一区域运行 12 种算法，不跨区域训练。
* **单位谨慎**：Milano/Trentino 的物理单位未证实，ZTE 为 4G 下行流量；跨地点比较只使用归一化形状并显示免责声明。
* **真实指标**：MAE / RMSE / sMAPE / R² 全部来自逆标准化后的真实样本；sMAPE 的 0/0 记 0 贡献，常量真值的 R² 显示 N/A。
* **校验不可绕过**：任何 Save / Build / Run / Batch / Evaluation 请求都会在服务端重新校验，失败返回 422/409 与字段级 issue，且不产生任何作业或工件。

## 7. 当前状态

* 已实现并实测：P0–P8 的功能主体（见 `docs/IMPLEMENTATION_STATUS.md`）。
* 51 项验收的逐项结论与证据：`docs/ACCEPTANCE_REPORT.md`。
* 已知未完成项：TimesFM / Chronos 的 Fine-tuning（版本未确证、保持 Disabled）、公网部署（缺授权）、含 GPU 的性能数据（本机无独显）。
