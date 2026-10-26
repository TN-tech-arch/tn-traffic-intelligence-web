# Hugging Face Spaces 部署

## 运行方式

- React 前端在 Docker 构建阶段生成生产文件。
- FastAPI 在 `0.0.0.0:$PORT` 上提供 API 和静态页面。
- 每个浏览器会话使用独立 SQLite 数据库、训练产物和日志。
- API 与 Worker 位于同一个容器；Worker 为每个匿名会话运行独立线程，并由全局模型任务信号量限制并发。
- 原始数据和基础模型缓存由所有会话共享。
- 会话 Cookie 不设置持久过期时间；浏览器关闭、Cookie 清除或服务器会话过期后，再进入会得到全新工作区。
- 新会话的数据库由共享模板复制，业务历史为空，编号从 `0001` 开始。

## 环境变量

| 变量 | 默认值 | 作用 |
|---|---|---|
| `TN_SESSION_TTL_SECONDS` | `7200` | 空闲会话保留时间 |
| `TN_MAX_SESSIONS` | `8` | 同时保留的匿名工作区上限 |
| `TN_REQUESTS_PER_MINUTE` | `300` | 单会话请求频率上限 |
| `TN_MAX_MODEL_JOBS` | `2` | 全局同时训练任务上限 |
| `TN_PRELOAD_FOUNDATION` | `1` | 启动后后台预取 TimesFM/Chronos |
| `TN_COOKIE_SECURE` | `1` | HTTPS Cookie 安全标志 |

## Hugging Face 部署

1. 创建 Docker SDK 类型的 Space。
2. 将本仓库推送到该 Space 的 Git 仓库。
3. Space 会按根目录 `Dockerfile` 构建，并监听 `7860`。
4. 构建完成后访问 `https://<用户名>-<空间名>.hf.space`。

`/tmp` 中的会话、训练产物和模型缓存不属于持久存储。Space 重启后会全部清空，并由下一次访问重新建立。
