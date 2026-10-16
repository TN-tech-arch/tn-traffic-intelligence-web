# 依赖与模型许可说明（LICENSE NOTICES）

本项目为课程用途的非商业项目。所有第三方依赖均通过 PyPI 官方发布的 wheel 安装，
版本由 `requirements.lock.txt` 锁定。下面列出关键依赖与其许可。

| 组件 | 版本（实测） | 许可 | 说明 |
|---|---|---|---|
| FastAPI / Starlette / Uvicorn | 0.1xx / 0.4x / 0.3x | MIT / BSD-3 | 后端 Web 框架 |
| Pydantic | 2.x | MIT | 请求与配置校验 |
| NumPy / pandas / SciPy | 2.5.4 / 3.0.6 / 1.18.1 | BSD-3 | 数值与表处理 |
| scikit-learn | 1.9.1 | BSD-3 | 聚类与随机森林 |
| statsmodels | 0.15.0 | BSD-3 | ARIMA |
| Prophet | 1.5.0 | MIT（含 cmdstanpy，BSD-3） | 趋势/周期模型；首次运行会下载 CmdStan |
| XGBoost | 3.4.1 | Apache-2.0 | 梯度提升 |
| LightGBM | 4.7.0 | MIT | 高效梯度提升 |
| PyTorch | 2.14.1+cpu | BSD-3 | 深度学习与基础模型推理 |
| transformers / tokenizers / accelerate / safetensors | 5.20.0 / 0.23.3 / 1.15.0 / 0.8.0 | Apache-2.0 | Chronos 依赖栈 |
| chronos-forecasting | 2.3.2 | Apache-2.0 | Chronos 官方实现 |
| timesfm（官方包） | 3.0.2 | Apache-2.0 | TimesFM 官方推理代码 |
| React / Ant Design / ECharts / Leaflet / Vite | 18.3 / 5.22 / 5.5 / 1.9 / 5.4 | MIT / BSD-3 | 前端栈 |

## 预训练模型权重（必须单独确认许可）

| 模型 | checkpoint | 权重许可 | 备注 |
|---|---|---|---|
| Chronos | `amazon/chronos-bolt-tiny`（默认） | Apache-2.0 | 备选：chronos-bolt-small / base、chronos-t5-*（同为 Apache-2.0） |
| TimesFM | `google/timesfm-2.5-200m-pytorch` | Apache-2.0 | 官方仓库说明的 2.5 自托管权重许可 |

**明确不使用的权重**：TimesFM 3.0 系列自托管权重在官方渠道为受限/需授权（HuggingFace 仓库
需要授权访问，`timesfm-3-*` 返回需要认证），因此本项目不下载、不提供、不宣称使用该权重。
如需用于商业或公网生产部署，必须先确认权重许可；本项目默认仅用于课程非商业用途，
且不在安装包中重分发权重，而是由用户环境按需从官方渠道（或官方镜像）下载。

## 数据

六个原始数据文件（Milano / Trentino / ZTE）由课程提供，仅用于本项目分析；
平台不重分发任何来源不明的数据，也不会用相似网络数据替代。
文件 SHA-256 见 `DATA_MANIFEST_SHA256.txt`，导入时会重新校验并记录指纹。

## 基础模型 Zero-shot 与 Fine-tuning

TimesFM 与 Chronos 在本项目中**只使用官方预训练权重做 Zero-shot 推理**（`no_epochs: true`，
不显示训练曲线）。Fine-tuning 需要对应版本确证的训练脚本与资源，本项目未实现，
UI 中保持 `supports_finetune = false`，不会显示虚假的 epoch 或训练损失。
