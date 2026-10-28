# Render Free 网页部署

## 地址

https://tn-traffic-intelligence.onrender.com

## 专用文件

- `Dockerfile.render`：React 多阶段构建和 FastAPI 运行镜像
- `render.yaml`：Render Blueprint 与免费实例环境变量
- `requirements-render.txt`：十种本地算法的精简依赖
- `backend/app/web_sessions.py`：匿名会话隔离、过期清理和容量回收
- `backend/app/memory_runtime.py`：模型任务结束后的内存释放

## 模型范围

Render 配置设置 `TN_LOCAL_MODELS_ONLY=1`，注册表只提供十种本地模型：

ARIMA、Prophet、Random Forest、XGBoost、LightGBM、MLP、RNN、LSTM、GRU 和 Transformer。

TimesFM 和 Chronos 不包含在 Render 免费配置中。

## 中间训练参数

仅 Render 的 `TN_LOCAL_MODELS_ONLY=1` 配置使用以下默认值，桌面版行为不变：

- 所有深度模型 Epoch 上限：40
- Early Stopping：开启
- Patience：8
- MLP：64 个隐藏单元，1 层
- RNN/LSTM/GRU：64 维，1 层
- Transformer：`d_model=64`、4 个注意力头、1 个编码层、前馈维度 128
- 训练窗口上限：1200，均匀覆盖整个训练时间范围
- 测试窗口：不缩减
- 全局同时训练任务：1

## 内存管理

每个训练任务完成或失败后都会：

1. 回收 Python 对象；
2. 清理 PyTorch 缓存；
3. 在 Linux 上调用 `malloc_trim` 将空闲内存归还系统。

“全部模型（All Models，10 种）”保持可用，并按顺序执行。Render 免费实例内存较低，连续运行全部深度模型仍有资源风险；失败时会显示真实错误，不生成模拟结果。

## 会话

- `TN_MAX_SESSIONS`：Render 环境变量目标值为 20
- `TN_SESSION_TTL_SECONDS`：1800 秒
- 容量满时自动回收最旧的无任务会话
- 新浏览器会话从空历史开始，编号从 0001 开始
