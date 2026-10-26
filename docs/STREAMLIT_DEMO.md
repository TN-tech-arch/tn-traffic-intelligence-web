# Streamlit Community Cloud 最大功能版

## 公开地址

https://tn-tech-arch-tn-traffic-intelligence-web-streamlit-app-esjj9m.streamlit.app/

GitHub 仓库：

https://github.com/TN-tech-arch/tn-traffic-intelligence-web

## 已实现功能

### 模块一：探索性分析

- Milano、Trentino、ZTE 4G 三个真实数据源
- 完整有效时间范围默认值与日期范围选择
- 区域原生采样时序
- 有效点、均值、标准差、最大值、P95、零值比例
- 日内小时画像
- 工作日与周末对比
- ACF 自相关
- GIS 区域地图与均值分级着色
- 最多五个区域进行时序对比

### 模块二：功能区聚类

- K-Means
- 层次聚类
- Gaussian Mixture
- Spectral Clustering
- 均值、标准差、CV、最大值、P95、零值比例、波动性等特征
- 区域 GIS 聚类地图
- 各簇典型日内模式
- 轮廓系数、Calinski-Harabasz、Davies-Bouldin
- `CLUS-*` 会话历史

### 模块三：数据集构建

- 单区域构建
- 数据源真实原生采样频率
- 完整时间范围默认值与主动缩小
- L/H/S 窗口参数
- 时间顺序训练、验证、测试切分
- 窗口总数和 X/Y 预览
- 数据质量检查
- `DS-*` 会话历史

### 模块四：模型训练

已实现十种真实本地算法：

1. ARIMA
2. Prophet
3. Random Forest
4. XGBoost
5. LightGBM
6. MLP
7. RNN
8. LSTM
9. GRU
10. Transformer

支持单模型或顺序训练全部十种模型。每个完成的结果会立即写入当前匿名会话。

### 模块五：预测评估

- 测试集 MAE、RMSE、WAPE、sMAPE、R²
- WAPE 排名
- 多模型预测曲线
- 逐预测时域指标
- 单模型逐时域详情
- `EVAL-*` 会话历史

## 会话机制

- 不需要登录。
- 新浏览器会话从空历史开始。
- URL 中的随机会话令牌用于在刷新后恢复当前会话。
- 数据集、聚类、实验和评估编号从 `0001` 开始。
- 会话文件在两小时未使用后自动清理。
- 请勿公开分享包含个人匿名会话令牌的 URL。

## 免费实例限制

- 不包含 TimesFM 和 Chronos。
- 不包含独立后台 Worker，训练在 Streamlit 脚本会话中同步执行。
- 浏览器断开可能中止正在运行的大批量训练，但已完成的模型结果会保留。
- 免费实例休眠或重新部署后，临时会话历史和训练结果会清空。
- 为保证稳定性，已限制统计模型、深度模型和树模型的训练/测试窗口数量。
- 深度学习模型使用较小的默认网络和 Epoch，不保存模型文件，只保存预测和指标。

## 依赖

生产依赖定义在根目录 `requirements.txt`，入口文件为 `streamlit_app.py`。
