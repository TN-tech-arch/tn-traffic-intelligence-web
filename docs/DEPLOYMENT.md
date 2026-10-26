# 部署与安装（DEPLOYMENT）

## 1. Windows 安装包（正式交付路线 A）— 已完成并实测

### 构建

```powershell
# 依赖：Inno Setup 7（packaging/ 内已含下载与静默安装步骤）
#       packaging/runtime/python-embed.zip（官方便携 Python 3.12.10）
powershell -NoProfile -ExecutionPolicy Bypass -File packaging\build_package.ps1
# 产物：packaging\dist\TN-Traffic-Intelligence-Setup-3.2.0.exe
```

构建脚本会：

1. 解压官方便携 Python 3.12.10 到 `dist-stage/python`，并修正 `python312._pth`
   （加入 `Lib\site-packages` 与 `..\backend`，因为 `._pth` 存在时 Python 会忽略 `PYTHONPATH`）。
2. 复制当前虚拟环境已安装的全部依赖（约 1.4 GB，torch/xgboost/prophet/timesfm/chronos 等）。
3. 复制后端源码、前端生产构建、脚本、文档、六个原始数据文件。
4. 默认不打包 TimesFM / Chronos 权重；用 Inno Setup 编译为单一 `.exe`（LZMA2 压缩，约 255 MB）。

完全离线交付时，可额外传入 `-IncludeModelCache` 将本地 `models_cache` 一并封装；常规交付保持精简安装包，模型权重由安装向导或应用内预取。

### 安装包行为

| 阶段 | 行为 |
|---|---|
| 安装 | 复制运行时与程序到 `%LOCALAPPDATA%\Programs\TN Traffic Intelligence`（`PrivilegesRequired=lowest`，无需管理员） |
| 安装后 | 运行 `first_run.ps1`：建库、执行 SQL 迁移、导入并校验六个数据文件（实测 8928/8928/2784 时点、88/88、223/223、148/162 区域） |
| 可选组件 | 勾选后下载 TimesFM / Chronos 官方权重（Apache-2.0）到 `models_cache\hf` |
| 快捷方式 | 启动 / 停止服务 / README / 卸载（含桌面快捷方式） |
| 卸载 | Inno Setup 卸载器，同时删除 `python`、`backend`、`frontend`、`scripts`、`docs`、`models_cache`、`data\processed`、`data\artifacts`、`data\logs`、`tn_traffic.db*` |

### 验证（实机执行，日志见 `data/logs/install_test.log`、`data/logs/install.log`）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File packaging\test_install.ps1
```

该脚本静默安装到测试目录 → 用安装版运行时启动 Worker 与 API → 校验 `/api/health`、`/api/data/sources`（459 区域 / 473 多边形 / 14 No data）、首页 HTTP 200 → 停止服务 → 静默卸载 → 断言目录已被清空。

## 2. 源码运行（开发与排错）

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-core.txt -r requirements-ml.txt -r requirements-models.txt
cd frontend; npm install; npm run build; cd ..
powershell -File scripts\import_data.ps1
powershell -File scripts\start_all.ps1        # Worker + API + 打开浏览器
```

单独启动：`scripts\start_api.ps1`、`scripts\start_worker.ps1`；重启：`scripts\restart_dev.ps1`；环境自检：`scripts\check_environment.ps1`。

## 3. 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `TN_HOST` / `TN_PORT` | `127.0.0.1` / `8077` | API 监听地址与端口 |
| `TN_DATA_DIR` | `<root>\data` | 数据、工件、日志根目录（`raw/` 内为六个原始文件） |
| `TN_DB_PATH` | `<root>\data\tn_traffic.db` | SQLite 路径 |
| `TN_MODEL_CACHE` | `<root>\models_cache` | 预训练权重缓存根目录 |
| `HF_ENDPOINT` | `https://hf-mirror.com` | 权重下载地址；官方 `huggingface.co` 在部分网络被墙，可用镜像或自建代理 |
| `HF_HOME` | `<TN_MODEL_CACHE>\hf` | HuggingFace 缓存目录 |
| `TN_WORKER_POLL` / `TN_WORKER_STALE` | `0.75` / `120` | Worker 轮询间隔与心跳过期秒数 |

`.env.example` 列出了全部可配置项，不含任何密钥。

## 4. 公网部署（路线 B）— 未完成，需要授权

`docker-compose.yml` 提供了 API + Worker + 数据卷的最小拓扑，但**本项目没有在真实服务器上部署**，
原因与需要用户提供的内容：

1. 需要一台可公网访问的主机（域名 + HTTPS 证书 + 备案/合规要求）。
2. 需要目标环境的 SSH 凭据与端口开放（当前环境无法创建或购买云资源）。
3. 需要确认权重许可是否允许公网生产部署（本项目仅使用 Apache-2.0 的
   `amazon/chronos-bolt-tiny` 与 `google/timesfm-2.5-200m-pytorch`；TimesFM 3.0 系列受限权重未被使用）。
4. 公网服务必须加上访问控制、速率限制与队列配额，避免匿名用户耗尽 CPU/磁盘。

在获得上述授权前，不会声称“已完成公网交付”。已完成的正式交付形式是**路线 A（Windows 安装包）**。

## 5. 备份与恢复

* 元数据：`data\tn_traffic.db`（含 WAL/SHM 文件，建议停服后整体复制）。
* 工件：`data\artifacts\datasets`（数据集 npz + meta）、`data\artifacts\experiments`（逐区域模型工件）。
* 权重缓存：`models_cache\hf`（可直接复制到另一台机器复用）。
* 服务停止：`scripts\` 结束后台进程，或安装版的 **停止服务** 快捷方式；停止后即可安全备份。

## 6. 资源要求（实测值）

| 项目 | 实测 |
|---|---|
| 安装后磁盘占用 | ≈ 1.7 GB（不含预训练权重）；TimesFM 权重另需 ≈ 800 MB |
| 内存 | 16 GB 机器上同时跑 API + Worker + TimesFM 推理峰值约 3–4 GB |
| GPU | 非必需。本机无 CUDA，全部 12 种算法均可运行（大模型为 CPU 推理，较慢） |
| 安装包大小 | 255 MB（LZMA2 压缩，含全部依赖） |
