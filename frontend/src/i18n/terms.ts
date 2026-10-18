/**
 * Shared user-facing terminology for the TN Traffic Intelligence UI.
 *
 * Only display text lives here. API keys, enum values and persisted IDs stay
 * unchanged in the pages and services.
 */

export interface ModuleMeta {
  index: string
  titleZh: string
  titleEn: string
  navZh: string
  navSub: string
  route: string
}

export const MODULE_META = {
  m1: {
    index: '模块一',
    titleZh: '探索性流量分析',
    titleEn: 'Exploratory Traffic Analysis',
    navZh: '探索性分析',
    navSub: 'M1 · Exploration',
    route: '/exploration',
  },
  m2: {
    index: '模块二',
    titleZh: '功能区聚类',
    titleEn: 'Functional Zone Clustering',
    navZh: '功能区聚类',
    navSub: 'M2 · Clustering',
    route: '/clustering',
  },
  m3: {
    index: '模块三',
    titleZh: '预测数据集构建',
    titleEn: 'Forecasting Dataset Construction',
    navZh: '数据集构建',
    navSub: 'M3 · Dataset',
    route: '/dataset',
  },
  m4: {
    index: '模块四',
    titleZh: '预测模型训练',
    titleEn: 'Forecast Model Training',
    navZh: '模型训练',
    navSub: 'M4 · Training',
    route: '/training',
  },
  m5: {
    index: '模块五',
    titleZh: '预测结果评估',
    titleEn: 'Prediction & Evaluation',
    navZh: '预测评估',
    navSub: 'M5 · Evaluation',
    route: '/evaluation',
  },
} as const satisfies Record<string, ModuleMeta>

export const NAV_ITEMS = [
  { key: '/', label: '首页', sub: 'Home', icon: '⌂' },
  { key: MODULE_META.m1.route, label: MODULE_META.m1.navZh, sub: MODULE_META.m1.navSub, icon: '◔' },
  { key: MODULE_META.m2.route, label: MODULE_META.m2.navZh, sub: MODULE_META.m2.navSub, icon: '◍' },
  { key: MODULE_META.m3.route, label: MODULE_META.m3.navZh, sub: MODULE_META.m3.navSub, icon: '▤' },
  { key: MODULE_META.m4.route, label: MODULE_META.m4.navZh, sub: MODULE_META.m4.navSub, icon: '◈' },
  { key: MODULE_META.m5.route, label: MODULE_META.m5.navZh, sub: MODULE_META.m5.navSub, icon: '◎' },
]

export const STATUS_LABELS: Record<string, string> = {
  Queued: '等待中',
  Created: '已创建',
  Running: '运行中',
  Stopping: '停止中',
  Stopped: '已停止',
  Cancelled: '已取消',
  Completed: '已完成',
  Partial: '部分完成',
  Failed: '已失败',
  Skipped: '已跳过',
  Unavailable: '不可用',
  Archived: '已归档',
  Built: '已构建',
  Interrupted: '已中断',
  Missing: '缺失',
  Draft: '草稿',
}

export const MODE_LABELS: Record<string, string> = {
  fit: '拟合',
  train: '训练',
  zero_shot: '零样本预测',
  finetune: '微调',
}

export const FREQUENCY_LABELS: Record<string, string> = {
  native: '原生频率',
  '30min': '30 分钟',
  '60min': '1 小时',
  '1day': '1 天',
}

export const AGGREGATION_LABELS: Record<string, string> = {
  mean: '均值',
  sum: '求和',
}

export const SCOPE_LABELS: Record<string, string> = {
  single: '单区域',
  all: '全部区域',
}

export const MISSING_MODE_LABELS: Record<string, string> = {
  automatic: '自动（前向填充）',
  causal_interpolation: '因果安全插值（Causal-safe Interpolation）',
  drop_invalid: '丢弃无效窗口（Drop Invalid Windows）',
}

export const SCALING_LABELS: Record<string, string> = {
  standard: '标准化（StandardScaler）',
  minmax: '最小-最大缩放（MinMaxScaler）',
  none: '无归一化',
}

export const SPLIT_LABELS: Record<string, string> = {
  train: '训练集',
  validation: '验证集',
  test: '测试集',
}

export const ACTIVITY_KIND_LABELS: Record<string, string> = {
  Dataset: '数据集',
  Experiment: '实验',
  Batch: '批量任务',
  Evaluation: '评价',
  Cluster: '聚类',
}

export const ALGORITHM_CATEGORY_LABELS: Record<string, string> = {
  statistical: '统计模型',
  machine_learning: '机器学习',
  deep_learning: '深度学习',
  foundation: '基础大模型',
}

const SOURCE_DISPLAY_NAMES: Record<string, string> = {
  milano: 'Milano',
  trentino: 'Trentino',
  zte: 'ZTE 4G 下行流量',
}

export const ACTION_LABELS = {
  runAnalysis: '运行分析',
  startClustering: '开始聚类',
  buildDataset: '构建数据集',
  preview: '实时预览',
  saveConfig: '保存配置',
  startTraining: '开始训练',
  stopTraining: '停止训练',
  stopBatch: '停止批次',
  startEvaluation: '开始评估',
  stopEvaluation: '停止评估',
  reset: '重置配置',
  clearRegions: '清空区域选择',
  enlarge: '放大查看',
  expandDetails: '展开详情',
  deleteRecord: '删除记录',
  exportResults: '导出结果',
  open: '打开',
  archive: '归档',
  unarchive: '取消归档',
  duplicate: '复制为草稿',
}

export const FEATURE_LABELS: Record<string, string> = {
  mean: '平均值（Mean）',
  std: '标准差（Std）',
  cv: '变异系数（CV）',
  intraday_peak_ratio: '日内峰值比',
  day_night_ratio: '昼夜比',
  weekday_weekend_ratio: '工作日与周末比',
  daily_seasonality: '日周期强度',
}

export interface ParameterTerm {
  zh: string
  en: string
  impact?: string
}

const GLOBAL_PARAMETER_TERMS: Record<string, ParameterTerm> = {
  source_key: { zh: '数据源', en: 'Data Source', impact: '决定本次分析、聚类或建模使用哪一组真实区域序列。' },
  region_ids: { zh: '对比区域', en: 'Regions', impact: '决定参与图表、统计和对比的区域集合。' },
  region_id: { zh: '区域', en: 'Region', impact: '决定该样本或结果对应的具体区域。' },
  frequency: { zh: '时间分辨率', en: 'Temporal Resolution', impact: '改变重采样后的时间点数量和每个点代表的时间跨度。' },
  aggregation: { zh: '聚合方式', en: 'Aggregation', impact: '决定多个原生观测合并为一个时间桶时取均值还是求和。' },
  start_index: { zh: '起始时间索引', en: 'Start Index', impact: '决定从重采样时间轴的哪个位置开始截取数据。' },
  window_points: { zh: '窗口点数', en: 'Window Points', impact: '决定参与特征提取或分析的连续时间点数量。' },
  acf_max_lag: { zh: '最大滞后步数', en: 'Max Lag', impact: '限制自相关计算覆盖的时间范围。' },
  day_start_hour: { zh: '白天起始小时', en: 'Day Start Hour', impact: '改变昼夜差异统计中“白天”的边界。' },
  day_end_hour: { zh: '白天结束小时', en: 'Day End Hour', impact: '改变昼夜差异统计中“白天”的边界。' },
  features: { zh: '聚类特征', en: 'Features', impact: '决定每个区域用于聚类比较的特征向量。' },
  standardize: { zh: '特征标准化', en: 'Standardize Features', impact: '决定聚类前是否消除不同特征量纲的影响。' },
  algorithm: { zh: '聚类算法', en: 'Clustering Algorithm', impact: '决定实际执行的聚类方法与可用参数。' },
  n_clusters: { zh: '簇数量（K）', en: 'Number of Clusters (K)', impact: '决定 K-Means 或层次聚类输出的簇数量。' },
  hierarchical_n_clusters: { zh: '簇数量（K）', en: 'Number of Clusters (K)', impact: '决定层次聚类截断得到的簇数量。' },
  n_init: { zh: '初始化次数', en: 'Number of Initializations (n_init)', impact: '决定 K-Means 重复初始化并取最优结果的次数。' },
  linkage: { zh: '连接方式', en: 'Linkage', impact: '决定层次聚类合并簇时使用的距离准则。' },
  metric: { zh: '距离度量', en: 'Distance Metric', impact: '决定层次聚类中样本或簇之间距离的计算方式。' },
  eps: { zh: '邻域半径', en: 'Epsilon (eps)', impact: '决定 DBSCAN 判定邻域时使用的半径。' },
  min_samples: { zh: '最小样本数', en: 'Minimum Samples', impact: '决定 DBSCAN 核心点所需的最小邻居数量。' },
  gmm_n_components: { zh: '高斯分量数', en: 'Number of GMM Components', impact: '决定 GMM 拟合的高斯分布数量。' },
  covariance_type: { zh: '协方差类型', en: 'Covariance Type', impact: '决定 GMM 各分量协方差矩阵的结构约束。' },
  reg_covar: { zh: '协方差正则项', en: 'Covariance Regularization', impact: '提高 GMM 协方差估计的数值稳定性。' },
  random_state: { zh: '随机种子', en: 'Random State', impact: '固定算法随机性，便于复现实验结果。' },
  random_seed: { zh: '随机种子', en: 'Random Seed', impact: '固定训练随机性，便于复现实验结果。' },
  input_length: { zh: '输入长度（L）', en: 'Input Length (L)', impact: '决定每个训练样本可使用的历史观测点数。' },
  output_length: { zh: '输出长度（H）', en: 'Output Length (H)', impact: '决定每个样本需要预测的目标点数，并影响 Module 4/5。' },
  step: { zh: '滑动步长（S）', en: 'Sliding Step (S)', impact: '决定相邻滑窗起点之间的间隔和窗口总数。' },
  train_ratio: { zh: '训练集比例', en: 'Train Ratio', impact: '决定时间顺序切分中训练段所占比例。' },
  val_ratio: { zh: '验证集比例', en: 'Validation Ratio', impact: '决定时间顺序切分中验证段所占比例。' },
  test_ratio: { zh: '测试集比例', en: 'Test Ratio', impact: '决定最终留出测试段所占比例。' },
  missing_mode: { zh: '缺失值处理', en: 'Missing Handling', impact: '决定缺失观测如何被因果处理，以及是否保留对应窗口。' },
  scaling: { zh: '标准化', en: 'Scaling', impact: '决定训练段特征缩放方式；评估时会逆变换回源单位。' },
  label: { zh: '数据集名称', en: 'Dataset Label', impact: '只影响历史记录中的可读名称，不改变数据内容。' },
  experiment_ids: { zh: '实验（可多选）', en: 'Experiment IDs', impact: '决定参与同口径比较和排名的实验集合。' },
  test_selection: { zh: '测试范围', en: 'Test Selection', impact: '决定使用完整测试集还是指定时间子集进行展示与评分。' },
  range_start_at: { zh: '子集开始时间', en: 'Range Start', impact: '限制评价可视化子集的起点。' },
  range_end_at: { zh: '子集结束时间', en: 'Range End', impact: '限制评价可视化子集的终点。' },
  horizon_step: { zh: '显示预测步长', en: 'Horizon Step', impact: '决定图表展示哪一个预测步长，不改变数据集中的 H。' },
  epochs: { zh: '训练轮数', en: 'Epochs', impact: '决定完整遍历训练集的次数和训练时长。' },
  batch_size: { zh: '批次大小', en: 'Batch Size', impact: '决定一次前向与反向传播使用的样本数量。' },
  early_stopping: { zh: '早停', en: 'Early Stopping', impact: '决定验证损失不再改善时是否提前终止训练。' },
  patience: { zh: '早停耐心值', en: 'Patience', impact: '决定连续多少轮无改善后才触发早停。' },
  weight_decay: { zh: '权重衰减', en: 'Weight Decay', impact: '控制 L2 正则化强度，影响过拟合程度。' },
  learning_rate: { zh: '学习率', en: 'Learning Rate', impact: '决定优化器每步更新的幅度。' },
  dropout: { zh: '随机失活率（Dropout）', en: 'Dropout Rate', impact: '控制训练时随机丢弃神经元的比例。' },
  p: { zh: '自回归阶数（p）', en: 'AR Order (p)', impact: '决定 ARIMA 使用过去多少个观测。' },
  d: { zh: '差分阶数（d）', en: 'Differencing (d)', impact: '决定 ARIMA 去除趋势所需的差分次数。' },
  q: { zh: '移动平均阶数（q）', en: 'MA Order (q)', impact: '决定 ARIMA 使用过去多少个误差项。' },
}

const MODULE_PARAMETER_TERMS: Record<string, Record<string, ParameterTerm>> = {
  m2: {
    source_key: { zh: '数据源', en: 'Data Source', impact: '决定用于聚类特征提取的区域序列来源。' },
  },
  m3: {
    scope: { zh: '预测范围', en: 'Prediction Scope', impact: '决定构建单区域数据集还是全部区域独立数据集。' },
  },
  m5: {
    scope: { zh: '评价范围', en: 'Evaluation Scope', impact: '决定评价单区域结果还是全部区域结果。' },
  },
}

export function paramTerm(path: string, fallback?: { key?: string; label?: string; label_zh?: string }): ParameterTerm | null {
  const prefix = path.split('.')[0]
  const key = fallback?.key
  if (!key) return null
  return (
    MODULE_PARAMETER_TERMS[prefix]?.[key] ??
    GLOBAL_PARAMETER_TERMS[key] ??
    (fallback.label_zh
      ? { zh: fallback.label_zh, en: fallback.label ?? fallback.label_zh }
      : null)
  )
}

export function bilingual(zh: string, en: string): string {
  return `${zh}（${en}）`
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

export function modeLabel(mode: string): string {
  return MODE_LABELS[mode] ?? mode
}

export function frequencyLabel(value: string): string {
  return FREQUENCY_LABELS[value] ?? value
}

export function aggregationLabel(value: string): string {
  return AGGREGATION_LABELS[value] ?? value
}

export function scopeLabel(value: string): string {
  return SCOPE_LABELS[value] ?? value
}

export function missingModeLabel(value: string): string {
  return MISSING_MODE_LABELS[value] ?? value
}

export function scalingLabel(value: string): string {
  return SCALING_LABELS[value] ?? value
}

export function splitLabel(value: string): string {
  return SPLIT_LABELS[value] ?? value
}

/** Localise common server validation phrases while preserving IDs and symbols. */
export function localizeUserText(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .replace(/Train\/Validation\/Test/g, '训练集/验证集/测试集')
    .replace(/\bSingle Region\b/g, '单区域')
    .replace(/\bAll Regions\b/g, '全部区域')
    .replace(/\bAll Models\b/g, '全部模型')
    .replace(/held-out Test/g, '留出测试集')
    .replace(/\bFit 模式\b/g, '拟合模式')
    .replace(/\bEarly Stopping\b/g, '早停')
    .replace(/\bNo Data\b/g, '无数据')
    .replace(/\bN\/A\b/g, '不适用')
    .replace(/\bQueued\b/g, '等待中')
    .replace(/\bRunning\b/g, '运行中')
    .replace(/\bStopping\b/g, '停止中')
    .replace(/\bStopped\b/g, '已停止')
    .replace(/\bCompleted\b/g, '已完成')
    .replace(/\bPartial\b/g, '部分完成')
    .replace(/\bFailed\b/g, '已失败')
    .replace(/\bSkipped\b/g, '已跳过')
    .replace(/\bDataset\b/g, '数据集')
    .replace(/\bExperiment\b/g, '实验')
    .replace(/\bEvaluation\b/g, '评价')
    .replace(/\bBatch\b/g, '批量任务')
    .replace(/\bWorker\b/g, '任务进程')
}

export function activityKindLabel(kind: string): string {
  return ACTIVITY_KIND_LABELS[kind] ?? kind
}

export function algorithmCategoryLabel(key: string): string {
  return ALGORITHM_CATEGORY_LABELS[key] ?? key
}

export function sourceDisplayName(key: string | undefined, fallback?: string): string {
  return (key ? SOURCE_DISPLAY_NAMES[key] : undefined) ?? fallback ?? key ?? '—'
}

export function localizeSourceNames<T>(value: T): T {
  if (typeof value === 'string') {
    return (value as string).split('ZTE 4G Downlink').join('ZTE 4G 下行流量') as T
  }
  if (Array.isArray(value)) {
    return value.map((item) => localizeSourceNames(item)) as T
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, localizeSourceNames(item)]),
    ) as T
  }
  return value
}

export function unitDisplayLabel(value: string | undefined): string {
  if (!value) return '单位未知'
  if (/^Traffic volume/i.test(value)) return '交通流量（源单位未知）'
  if (/^4G downlink traffic/i.test(value)) return '4G 下行流量（单位未说明）'
  return value
}

export function featureLabel(key: string, fallback?: string): string {
  return FEATURE_LABELS[key] ?? fallback ?? key
}
