import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, Button, Card, Collapse, Input, Popconfirm, Select, Switch, Table, Tabs, Tag, Tooltip, message,
} from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { ENDPOINTS, ApiError, api, type Issue } from '../api/client'
import { EmptyState, ModuleHeader, PaneHead, ThreePane } from '../components/Panes'
import ParamField from '../components/ParamField'
import MapView, {
  CLUSTER_NO_DATA_COLOR, clusterColor,
} from '../components/MapView'
import { LineChart, ScatterChart } from '../components/Charts'
import InsightCard from '../components/InsightCard'
import StatusTag from '../components/StatusTag'
import BiLabel from '../components/BiLabel'
import DateTimeField from '../components/DateTimeField'
import { useGroupValidation } from '../validation/useValidation'
import { fieldDisabledReason, visibleFields, type FieldSpec } from '../validation/engine'
import {
  ACTION_LABELS, MODULE_META, bilingual, featureLabel, regionDisplayLabel, statusLabel,
} from '../i18n/terms'

const DEFAULT_FEATURES = [
  'mean',
  'std',
  'cv',
  'intraday_peak_ratio',
  'day_night_ratio',
  'weekday_weekend_ratio',
  'daily_seasonality',
]

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

function normalizeWeeklyProfile(profile: Array<number | null>) {
  const finite = profile.filter((value): value is number => value !== null && Number.isFinite(value))
  const mean = finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null
  const normalized = profile.map((value) =>
    value !== null && Number.isFinite(value) && mean !== null && Math.abs(mean) > 1e-12
      ? value / mean
      : null,
  )
  return { mean, normalized }
}

const DEFAULT_CONFIG: Record<string, unknown> = {
  source_key: 'milano',
  frequency: 'native',
  aggregation: 'mean',
  time_start: null,
  time_end: null,
  start_index: 0,
  window_points: 1008,
  features: DEFAULT_FEATURES,
  standardize: true,
  algorithm: 'kmeans',
  n_clusters: 4,
  n_init: 10,
  hierarchical_n_clusters: 4,
  linkage: 'ward',
  metric: 'euclidean',
  spectral_n_clusters: 4,
  spectral_affinity: 'nearest_neighbors',
  spectral_n_neighbors: 10,
  spectral_gamma: 1,
  gmm_n_components: 4,
  covariance_type: 'full',
  reg_covar: 0.000001,
  random_state: 42,
}

function configSignature(values: Record<string, unknown>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(values)
        .filter(([key]) => !['random_state'].includes(key) || values.algorithm !== 'hierarchical')
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  )
}

export default function Clustering() {
  const [messageApi, contextHolder] = message.useMessage()
  const [catalog, setCatalog] = useState<{ features: Array<{ key: string; label_zh: string; help_zh: string }>; algorithms: Array<{ key: string; label: string }> }>({ features: [], algorithms: [] })
  const [config, setConfig] = useState<Record<string, unknown>>(() => ({
    ...DEFAULT_CONFIG,
    features: [...DEFAULT_FEATURES],
  }))
  const [geojson, setGeojson] = useState<any>(null)
  const [regions, setRegions] = useState<any[]>([])
  const [sourceMeta, setSourceMeta] = useState<any>(null)
  const [rangeInfo, setRangeInfo] = useState<any>(null)
  const [rangeLoading, setRangeLoading] = useState(true)
  const [result, setResult] = useState<any>(null)
  const [resultKey, setResultKey] = useState<string | null>(null)
  const [runs, setRuns] = useState<any[]>([])
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null)
  const [focusRegion, setFocusRegion] = useState<string | null>(null)
  const [normalizedPatterns, setNormalizedPatterns] = useState(false)
  const [normalizedWeekly, setNormalizedWeekly] = useState(false)
  const [regionSearch, setRegionSearch] = useState('')
  const [clusterFilter, setClusterFilter] = useState('all')
  const [tab, setTab] = useState('overview')
  const [busy, setBusy] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [serverIssues, setServerIssues] = useState<Issue[]>([])
  const skipSourceDateReset = useRef(false)
  const pendingHistoryResultKey = useRef(false)

  const schema: FieldSpec[] = useMemo(
    () => [
      { key: 'source_key', label_zh: '数据源', type: 'enum', enum: ['milano', 'trentino', 'zte'], enum_labels: ['Milano', 'Trentino', 'ZTE 4G Downlink'], default: 'milano', help_zh: '聚类使用的数据源。', suggestion_zh: 'ZTE 的无数据区域不会参与聚类。' },
      { key: 'time_start', label_zh: '开始日期时间', type: 'string', default: '', required: false, help_zh: '聚类特征使用的起始时间（含边界，按重采样后的时间桶起点计）。', suggestion_zh: '格式 YYYY-MM-DD HH:mm:ss；必须早于结束时间。' },
      { key: 'time_end', label_zh: '结束日期时间', type: 'string', default: '', required: false, help_zh: '聚类特征使用的结束时间（含边界）。', suggestion_zh: '不能超过数据源真实结束时间。' },
      { key: 'start_index', label_zh: '起始时间点', type: 'integer', min: 0, default: 0, help_zh: '特征提取窗口起点（重采样后的点数）。', suggestion_zh: '默认 0。' },
      { key: 'window_points', label_zh: '窗口点数', type: 'integer', min: 24, max: 100000, default: 1008, help_zh: '参与特征提取的连续点数，至少覆盖一个完整日周期。', suggestion_zh: '10 分钟频率下 1008 点 ≈ 7 天。' },
      { key: 'features', label_zh: '聚类特征', type: 'array', enum: catalog.features.map((f) => f.key), enum_labels: catalog.features.map((f) => featureLabel(f.key, f.label_zh)), default: DEFAULT_FEATURES, help_zh: '从真实时间序列提取的特征集合。', suggestion_zh: '至少选择 2 个特征。' },
      { key: 'standardize', label_zh: '特征标准化', type: 'boolean', default: true, help_zh: '聚类前对特征做 z-score 标准化。', suggestion_zh: '建议开启。' },
      { key: 'algorithm', label_zh: '聚类算法', type: 'enum', enum: ['kmeans', 'spectral', 'hierarchical', 'gmm'], enum_labels: ['K-Means', '谱聚类（Spectral Clustering）', '层次聚类（Hierarchical）', '高斯混合（GMM）'], default: 'kmeans', help_zh: '四选一的真实聚类算法；谱聚类依据区域特征的相似关系分组。', suggestion_zh: '先用 K-Means，再用谱聚类对比相似关系。' },
      { key: 'n_clusters', label_zh: '簇数量 K', type: 'integer', min: 2, max: 30, default: 4, visible_when: { algorithm: 'kmeans' }, enabled_when: { algorithm: 'kmeans' }, help_zh: 'K-Means 的簇数量。', suggestion_zh: '3-8 之间便于解释。' },
      { key: 'n_init', label_zh: '初始化次数', type: 'integer', min: 1, max: 100, default: 10, level: 'advanced', visible_when: { algorithm: 'kmeans' }, enabled_when: { algorithm: 'kmeans' }, help_zh: 'K-Means 重复初始化次数，取最优惯性。', suggestion_zh: '10 是稳健默认值。' },
      { key: 'spectral_n_clusters', label_zh: '簇数量 K', type: 'integer', min: 2, max: 30, default: 4, visible_when: { algorithm: 'spectral' }, enabled_when: { algorithm: 'spectral' }, help_zh: '谱聚类最终划分的簇数量。', suggestion_zh: '3-8 之间便于解释。' },
      { key: 'spectral_affinity', label_zh: '相似度构建方式', type: 'enum', enum: ['nearest_neighbors', 'rbf'], enum_labels: ['近邻图（nearest_neighbors）', '径向基核（rbf）'], default: 'nearest_neighbors', visible_when: { algorithm: 'spectral' }, enabled_when: { algorithm: 'spectral' }, help_zh: '谱聚类的相似度构图方式；近邻图强调局部连接，RBF 按距离核建立全局相似度。', suggestion_zh: '区域较多时优先使用近邻图。' },
      { key: 'spectral_n_neighbors', label_zh: '邻居数量', type: 'integer', min: 2, max: 200, default: 10, visible_when: { algorithm: 'spectral', spectral_affinity: 'nearest_neighbors' }, enabled_when: { algorithm: 'spectral', spectral_affinity: 'nearest_neighbors' }, help_zh: '近邻图模式下每个区域连接的邻居数，必须小于有效区域数。', suggestion_zh: '通常设为有效区域数的 5%-15%。' },
      { key: 'spectral_gamma', label_zh: 'RBF 相似度参数', type: 'number', min: 0, exclusive_min: true, default: 1, visible_when: { algorithm: 'spectral', spectral_affinity: 'rbf' }, enabled_when: { algorithm: 'spectral', spectral_affinity: 'rbf' }, help_zh: 'RBF 模式下控制相似度随距离衰减的速度，必须大于 0。', suggestion_zh: '默认 1；增大 gamma 会强化局部相似关系。' },
      { key: 'hierarchical_n_clusters', label_zh: '簇数量 K', type: 'integer', min: 2, max: 30, default: 4, visible_when: { algorithm: 'hierarchical' }, enabled_when: { algorithm: 'hierarchical' }, help_zh: '层次聚类的簇数量。', suggestion_zh: '与 K-Means 比较时使用相同 K。' },
      { key: 'linkage', label_zh: '连接方式', type: 'enum', enum: ['ward', 'complete', 'average', 'single'], enum_labels: ['沃德（ward）', '完全连接（complete）', '平均连接（average）', '单连接（single）'], default: 'ward', level: 'advanced', visible_when: { algorithm: 'hierarchical' }, enabled_when: { algorithm: 'hierarchical' }, help_zh: '层次聚类连接准则；沃德法只能配合欧氏距离。', suggestion_zh: '默认使用沃德法。' },
      { key: 'metric', label_zh: '距离度量', type: 'enum', enum: ['euclidean', 'manhattan', 'cosine'], enum_labels: ['欧氏距离（euclidean）', '曼哈顿距离（manhattan）', '余弦距离（cosine）'], default: 'euclidean', level: 'advanced', visible_when: { algorithm: 'hierarchical' }, enabled_when: { algorithm: 'hierarchical' }, help_zh: '距离度量；沃德法仅支持欧氏距离。', suggestion_zh: '默认使用欧氏距离。' },
      { key: 'gmm_n_components', label_zh: '高斯分量数', type: 'integer', min: 1, max: 30, default: 4, visible_when: { algorithm: 'gmm' }, enabled_when: { algorithm: 'gmm' }, help_zh: 'GMM 高斯分量个数。', suggestion_zh: '3-8。' },
      { key: 'covariance_type', label_zh: '协方差类型', type: 'enum', enum: ['full', 'tied', 'diag', 'spherical'], enum_labels: ['完全协方差（full）', '共享协方差（tied）', '对角协方差（diag）', '球形协方差（spherical）'], default: 'full', level: 'advanced', visible_when: { algorithm: 'gmm' }, enabled_when: { algorithm: 'gmm' }, help_zh: '高斯混合模型的协方差结构；样本少时完全协方差可能不可靠。', suggestion_zh: '样本充足时使用完全协方差。' },
      { key: 'reg_covar', label_zh: '协方差正则项', type: 'number', min: 0, exclusive_min: true, default: 0.000001, level: 'advanced', visible_when: { algorithm: 'gmm' }, enabled_when: { algorithm: 'gmm' }, help_zh: 'GMM 协方差对角线正则项，必须大于 0 以保证数值稳定。', suggestion_zh: '1e-6 起。' },
      { key: 'random_state', label_zh: '随机种子', type: 'integer', min: 0, max: 2147483647, default: 42, level: 'advanced', help_zh: '固定 K-Means、GMM 或谱聚类中的随机过程以便复现。', suggestion_zh: '默认 42。' },
    ],
    [catalog.features],
  )

  const { fieldIssues, errors, warnings, valid } = useGroupValidation({
    specs: schema,
    values: config,
    pathPrefix: 'm2',
    remote: { kind: 'm2', values: config, context: { region_count: regions.filter((r) => r.has_timeseries).length } },
  })

  useEffect(() => {
    api.get<any>(ENDPOINTS.clusterFeatures).then(setCatalog).catch(() => undefined)
  }, [])

  const loadRuns = useCallback(() => {
    api.get<any>(ENDPOINTS.clusterList).then((data) => setRuns(data.runs)).catch(() => undefined)
  }, [])

  useEffect(loadRuns, [loadRuns])

  useEffect(() => {
    const key = config.source_key as string
    if (!key) return
    api
      .get<any>(ENDPOINTS.regions(key))
      .then((data) => {
        setRegions(data.regions)
        setSourceMeta(data.source)
        const start = data.source?.time_start ? dayjs(data.source.time_start) : null
        const end = data.source?.time_end ? dayjs(data.source.time_end) : null
        if (skipSourceDateReset.current) {
          skipSourceDateReset.current = false
        } else {
          setConfig((prev) => ({
            ...prev,
            frequency: 'native',
            aggregation: 'mean',
            time_start: start ? start.format('YYYY-MM-DD HH:mm:ss') : null,
            time_end: end ? end.format('YYYY-MM-DD HH:mm:ss') : null,
          }))
        }
      })
      .catch(() => undefined)
    api.get<any>(ENDPOINTS.geometry(key)).then(setGeojson).catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.source_key])

  useEffect(() => {
    let active = true
    setRangeLoading(true)
    setRangeInfo(null)
    const timer = window.setTimeout(() => {
      api
        .post<any>(ENDPOINTS.clusterRange, { values: config })
        .then((data) => {
          if (active) {
            setRangeInfo(data)
            setRangeLoading(false)
          }
        })
        .catch(() => {
          if (active) {
            setRangeInfo(null)
            setRangeLoading(false)
          }
        })
    }, 300)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [config.source_key, config.frequency, config.aggregation, config.time_start, config.time_end])

  const bounds = useMemo(() => {
    const start = sourceMeta?.time_start ? dayjs(sourceMeta.time_start) : null
    const end = sourceMeta?.time_end ? dayjs(sourceMeta.time_end) : null
    return { start, end }
  }, [sourceMeta])

  const disabledDate = useCallback(
    (current: Dayjs) => {
      if (!current) return false
      if (bounds.start && current.endOf('day').isBefore(bounds.start.startOf('day'))) return true
      if (bounds.end && current.startOf('day').isAfter(bounds.end.endOf('day'))) return true
      return false
    },
    [bounds],
  )

  const stale = Boolean(resultKey && result && configSignature(config) !== resultKey)
  const rangeBlocked = rangeInfo?.valid === false

  const resetConfiguration = async () => {
    const next: Record<string, unknown> = {
      ...DEFAULT_CONFIG,
      features: [...DEFAULT_FEATURES],
    }
    try {
      const data = await api.get<any>(ENDPOINTS.sources)
      const source = data.sources?.find((item: any) => item.key === 'milano')
      if (source?.time_start) {
        const start = dayjs(source.time_start)
        const availableEnd = source.time_end ? dayjs(source.time_end) : null
        next.time_start = start.format('YYYY-MM-DD HH:mm:ss')
        next.time_end = availableEnd ? availableEnd.format('YYYY-MM-DD HH:mm:ss') : null
      }
    } catch {
      // Keep the schema defaults; the source metadata effect will retry the range.
    }
    skipSourceDateReset.current = false
    pendingHistoryResultKey.current = false
    setConfig(next)
    setDrafts({})
    setResult(null)
    setResultKey(null)
    setServerIssues([])
    setSelectedRegion(null)
    setFocusRegion(null)
    setNormalizedPatterns(false)
    setNormalizedWeekly(false)
    setRegionSearch('')
    setClusterFilter('all')
    setTab('overview')
  }

  useEffect(() => {
    if (!pendingHistoryResultKey.current) return
    pendingHistoryResultKey.current = false
    setResultKey(configSignature(config))
  }, [config])

  const runClustering = async () => {
    if (rangeBlocked) {
      messageApi.error('所选时间范围有效观测不足，无法开始聚类。')
      return
    }
    if (!valid) {
      messageApi.error('存在参数错误，请查看输入框下方提示。')
      return
    }
    setBusy(true)
    setServerIssues([])
    try {
      const created = await api.post<any>(ENDPOINTS.clusterRun, { values: config })
      messageApi.success(`聚类任务已提交：${created.display_id ?? created.cluster_run_id}`)
      const started = Date.now()
      while (Date.now() - started < 600000) {
        await new Promise((resolve) => setTimeout(resolve, 2500))
        const state = await api.get<any>(ENDPOINTS.clusterGet(created.cluster_run_id))
        if (!['Queued', 'Running'].includes(state.status)) {
          if (state.status === 'Completed') {
            setResult({
              ...state.result,
              cluster_run_id: state.display_id ?? state.cluster_run_id,
              internal_id: state.cluster_run_id,
              params: state.params,
              metrics: state.metrics,
            })
            setResultKey(configSignature(config))
            messageApi.success('聚类完成（真实计算）')
          } else {
            messageApi.error(`聚类失败：${state.error ?? statusLabel(state.status)}`)
          }
          loadRuns()
          break
        }
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setServerIssues(err.issues)
        messageApi.error(`后端拒绝了聚类请求：${err.message}`)
      } else {
        messageApi.error(String(err))
      }
    } finally {
      setBusy(false)
    }
  }

  const openRun = async (runId: string) => {
    try {
      const state = await api.get<any>(ENDPOINTS.clusterGet(runId))
      if (state.status !== 'Completed') {
        messageApi.warning(`该运行没有可用结果，当前状态：${statusLabel(state.status)}。`)
        return
      }
      const resultStart = state.result?.range?.start_at ?? (
        state.result?.time_start && /^\d+$/.test(String(state.result.time_start))
          ? dayjs.unix(Number(state.result.time_start)).format('YYYY-MM-DD HH:mm:ss')
          : String(state.result?.time_start ?? '')
      )
      const resultEnd = state.result?.range?.end_at ?? (
        state.result?.time_end && /^\d+$/.test(String(state.result.time_end))
          ? dayjs.unix(Number(state.result.time_end)).format('YYYY-MM-DD HH:mm:ss')
          : String(state.result?.time_end ?? '')
      )
      const nextConfig = {
        ...state.params,
        time_start: resultStart || null,
        time_end: resultEnd || null,
      }
      skipSourceDateReset.current = String(state.params?.source_key ?? '') !== String(config.source_key ?? '')
      setResult({
        ...state.result,
        cluster_run_id: state.display_id ?? runId,
        internal_id: state.cluster_run_id ?? runId,
        params: state.params,
        metrics: state.metrics,
      })
      pendingHistoryResultKey.current = true
      setDrafts({})
      setConfig((prev) => ({ ...prev, ...nextConfig }))
      messageApi.success(`已载入历史聚类 ${state.display_id ?? runId}`)
    } catch (err) {
      messageApi.error(String(err))
    }
  }

  const clusterDisplayName = (clusterId: number | null | undefined) => {
    if (clusterId === null || clusterId === undefined) return '无数据'
    const cluster = (result?.clusters ?? []).find(
      (item: any) => Number(item.cluster_id) === Number(clusterId),
    )
    return cluster?.display_name ??
      `簇 ${clusterId}（${cluster?.pattern_type?.label ?? '综合流量特征型'}）`
  }

  const regionEntries = useMemo(() => {
    if (!result) return []
    return result.regions.map((item: any) => ({
      region_id: item.region_id,
      value: item.features?.mean ?? null,
      group: item.cluster_id,
      label: `${item.region_id} · ${clusterDisplayName(item.cluster_id)}`,
    }))
  }, [result, clusterDisplayName])

  const scatter = useMemo(() => {
    if (!result?.feature_matrix?.length || !result?.labels) return []
    const [first, second] = result.feature_names
    const projection = result.pca?.available ? result.pca.projection : null
    return result.labels.map((label: number, index: number) => {
      const row = result.regions[index]
      return {
        x: projection ? Number(projection[index].pc1) : result.feature_matrix[index][0],
        y: projection
          ? Number(projection[index].pc2)
          : (second ? result.feature_matrix[index][1] : result.feature_matrix[index][0]),
        group: label,
        name: row?.region_id,
        regionId: row?.region_id,
        extra: result.feature_names.map((key: string) =>
          `${featureLabel(key)} ${Number(row?.features?.[key]).toFixed(3)}`
        ).join(' · '),
      }
    })
  }, [result])

  const clusterOf = (regionId: string | null) =>
    regionId ? result?.regions?.find((r: any) => r.region_id === regionId)?.cluster_id : undefined

  const normalClusters = [...(result?.clusters ?? [])].sort(
    (left: any, right: any) => Number(left.cluster_id) - Number(right.cluster_id),
  )
  const weeklyPatternData = normalClusters.map((cluster: any) => {
    const rawProfile = WEEKDAY_LABELS.map((_, index) => {
      const value = cluster.weekly_profile?.[index]
      return typeof value === 'number' && Number.isFinite(value) ? value : null
    })
    const normalized = normalizeWeeklyProfile(rawProfile)
    return {
      cluster,
      raw: rawProfile,
      mean: normalized.mean,
      normalized: normalized.normalized,
    }
  })
  const weeklyYAxisTitle = normalizedWeekly
    ? '相对水平（各簇周均值＝1）'
    : '平均流量值'
  const weeklyTooltipFormatter = (params: any[]) => {
    const index = params[0]?.dataIndex ?? 0
    const rows = params.map((entry) => {
      const item = weeklyPatternData[entry.seriesIndex]
      const raw = item?.raw[index]
      const normalized = item?.normalized[index]
      const rawText = raw === null || raw === undefined
        ? '无数据'
        : Number(raw).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
      const normalizedText = normalized === null || normalized === undefined
        ? '不可计算（周均值为 0 或无有效数据）'
        : Number(normalized).toFixed(3)
      const seriesName = item
        ? `${clusterDisplayName(item.cluster.cluster_id)} · ${item.cluster.region_count} 区`
        : entry.seriesName
      return (
        `<div>${entry.marker}${seriesName}: ` +
        `原始平均 ${rawText} · 归一化 ${normalizedText}</div>`
      )
    })
    return (
      `<div style="font-size:12px;line-height:1.75">` +
      `<div><b>${WEEKDAY_LABELS[index] ?? '—'}</b></div>` +
      rows.join('') +
      `<div style="color:#c3cadb;margin-top:3px">归一化＝原始周均值 / 该簇有效周平均；缺失值不补 0</div>` +
      `</div>`
    )
  }
  const typicalTooltipFormatter = (params: any[]) => {
    const index = params[0]?.dataIndex ?? 0
    const rows = params.map((entry) => {
      const cluster = normalClusters[entry.seriesIndex]
      const value = cluster?.intraday_profile?.[index]
      const valueText = value === null || value === undefined
        ? '无数据'
        : Number(value).toFixed(2)
      return (
        `<div>${entry.marker}${clusterDisplayName(cluster?.cluster_id)} · ${cluster?.region_count ?? 0} 区: ` +
        `<b>${valueText}</b></div>`
      )
    })
    return (
      `<div style="font-size:12px;line-height:1.75">` +
      `<div><b>${index}:00</b></div>` +
      rows.join('') +
      `</div>`
    )
  }
  const featureAxes = result?.pca?.available
    ? [
        { key: 'pc1', label: `PC1（${(Number(result.pca.explained_variance_ratio?.[0] ?? 0) * 100).toFixed(1)}%）` },
        { key: 'pc2', label: `PC2（${(Number(result.pca.explained_variance_ratio?.[1] ?? 0) * 100).toFixed(1)}%）` },
      ]
    : result?.feature_names?.length
      ? [
          { key: result.feature_names[0], label: featureLabel(result.feature_names[0]) },
          { key: result.feature_names[1], label: featureLabel(result.feature_names[1]) },
        ]
      : []
  const clusterColorMap = Object.fromEntries(
    normalClusters.map((cluster: any) => [String(cluster.cluster_id), clusterColor(cluster.cluster_id)]),
  )
  const regionRows = useMemo(() => (
    (result?.regions ?? []).map((row: any) => ({
      ...row,
      display_name: regions.find((region) => region.region_id === row.region_id)?.display_name ?? row.region_id,
    }))
  ), [result, regions])
  const filteredRegionRows = useMemo(() => (
    regionRows.filter((row: any) => {
      const query = regionSearch.trim().toUpperCase()
      const queryMatch = !query ||
        String(row.region_id).toUpperCase().includes(query) ||
        String(row.display_name).toUpperCase().includes(query)
      const clusterMatch = clusterFilter === 'all' || String(row.cluster_id) === clusterFilter
      return queryMatch && clusterMatch
    })
  ), [regionRows, regionSearch, clusterFilter])
  const regionColumns = [
    {
      title: '区域',
      dataIndex: 'region_id',
      width: '24%',
      ellipsis: true,
      sorter: (a: any, b: any) => String(a.region_id).localeCompare(String(b.region_id)),
      render: (value: string, row: any) => (
        <Tooltip title={regionDisplayLabel(value, row.display_name)}>
          <span>{regionDisplayLabel(value, row.display_name)}</span>
        </Tooltip>
      ),
    },
    {
      title: '簇',
      dataIndex: 'cluster_id',
      width: '26%',
      sorter: (a: any, b: any) => a.cluster_id - b.cluster_id,
      render: (value: number) => (
        <Tooltip title={clusterDisplayName(value)}>
          <Tag color={clusterColor(value)} style={{ whiteSpace: 'normal' }}>
            {clusterDisplayName(value)}
          </Tag>
        </Tooltip>
      ),
    },
    {
      title: 'Mean',
      width: '16%',
      render: (_: unknown, row: any) => Number(row.features[result.feature_names[0]]).toFixed(1),
      sorter: (a: any, b: any) => a.features[result.feature_names[0]] - b.features[result.feature_names[0]],
    },
    {
      title: 'Std',
      width: '14%',
      render: (_: unknown, row: any) => (
        result.feature_names.includes('std') ? Number(row.features.std).toFixed(1) : '—'
      ),
    },
    {
      title: 'CV',
      width: '10%',
      render: (_: unknown, row: any) => (
        result.feature_names.includes('cv') ? Number(row.features.cv).toFixed(3) : '—'
      ),
    },
    {
      title: '操作',
      width: '10%',
      render: (_: unknown, row: any) => (
        <Button
          size="small"
          onClick={(event) => {
            event.stopPropagation()
            setSelectedRegion(row.region_id)
            setFocusRegion(row.region_id)
          }}
        >
          定位
        </Button>
      ),
    },
  ]

  const clusterLegend = (
    <div className="tn-inline" style={{ gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
      {normalClusters.map((cluster: any) => (
        <span key={cluster.cluster_id} className="tn-inline" style={{ gap: 4 }}>
          <span
            className="tn-legend-swatch"
            data-cluster-id={cluster.cluster_id}
            data-cluster-color={clusterColor(cluster.cluster_id)}
            style={{ background: clusterColor(cluster.cluster_id) }}
          />
          {clusterDisplayName(cluster.cluster_id)} · {cluster.region_count} 区
        </span>
      ))}
      <span className="tn-inline" style={{ gap: 4 }}>
        <span className="tn-legend-swatch" style={{ background: CLUSTER_NO_DATA_COLOR }} />
        无数据
      </span>
    </div>
  )

  const visibleConfigFields = visibleFields(schema, config).filter((spec) => (
    spec.level !== 'advanced' &&
    !['time_start', 'time_end', 'start_index', 'window_points'].includes(spec.key) &&
    (spec.key !== 'random_state' || ['kmeans', 'spectral', 'gmm'].includes(String(config.algorithm)))
  ))
  const fieldsBeforeRange = visibleConfigFields.filter((spec) =>
    spec.key === 'source_key',
  )
  const fieldsAfterRange = visibleConfigFields.filter((spec) =>
    spec.key !== 'source_key',
  )
  const renderParamField = (spec: FieldSpec) => (
    <ParamField
      key={spec.key}
      spec={spec}
      value={config[spec.key]}
      issues={fieldIssues(spec.key)}
      path={`m2.${spec.key}`}
      draft={drafts[spec.key]}
      onDraftChange={(key, text) => setDrafts((prev) => ({ ...prev, [key]: text }))}
      onChange={(key, value) => {
        setConfig((prev) => ({ ...prev, [key]: value }))
        if (key === 'algorithm') setDrafts({})
      }}
      disabledReason={fieldDisabledReason(spec, config)}
      compact
    />
  )

  return (
    <div>
      {contextHolder}
      <ModuleHeader
        module={MODULE_META.m2.index}
        titleZh={MODULE_META.m2.titleZh}
        titleEn={MODULE_META.m2.titleEn}
        description="K-Means / 谱聚类 / Hierarchical / GMM 真实聚类、GIS 簇着色与质量评估"
        datasetInfo={result ? `最近运行 ${result.cluster_run_id} · ${result.algorithm_label} · ${result.clusters.length} 个簇` : '尚未运行聚类'}
      />
      {errors.length > 0 ? (
        <Alert type="error" showIcon style={{ marginBottom: 10 }} message={`${errors.length} 个参数错误（见字段下方提示）`} description={errors.slice(0, 2).map((e) => e.message).join('；')} />
      ) : null}
      {serverIssues.length > 0 ? (
        <Alert type="error" showIcon style={{ marginBottom: 10 }} message="后端拒绝了本次请求" description={serverIssues.map((i) => `${i.path}: ${i.message}`).join('；')} />
      ) : null}
      {stale ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 10 }}
          message="当前配置已修改，下方仍是上一次聚类结果"
          description="请点击“开始聚类”基于新的时间范围、特征或算法参数重新计算。"
        />
      ) : null}
      {rangeBlocked ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 10 }}
          message="所选时间范围没有足够有效观测，无法开始聚类"
          description={(rangeInfo?.issues ?? [])
            .filter((item: Issue) => item.severity === 'error')
            .slice(0, 2)
            .map((item: Issue) => item.message)
            .join('；')}
        />
      ) : null}
      <ThreePane
        variant="m1"
        config={
          <>
            <PaneHead
              title={bilingual('配置', 'Configuration')}
              extra={
                <Button size="small" onClick={resetConfiguration}>
                  {ACTION_LABELS.reset}
                </Button>
              }
            />
            {fieldsBeforeRange.map(renderParamField)}
            <div className="tn-section-title" style={{ marginTop: 4 }}>
              {bilingual('分析时间范围', 'Analysis Time Range')}
            </div>
            <DateTimeField
              id="m2.time_start"
              label="开始日期时间"
              value={config.time_start as string | null}
              issues={fieldIssues('time_start')}
              disabledDate={disabledDate}
              help="聚类特征使用的起始时间（含边界，按当前时间分辨率的时间桶起点计）。"
              detail="日期会转换为后端实际索引；不会继续使用旧的固定窗口。"
              onChange={(value) => setConfig((prev) => ({ ...prev, time_start: value }))}
            />
            <DateTimeField
              id="m2.time_end"
              label="结束日期时间"
              value={config.time_end as string | null}
              issues={fieldIssues('time_end')}
              disabledDate={disabledDate}
              help="聚类特征使用的结束时间（含边界）。"
              detail="不能超过数据源真实结束时间；缺失值不会补 0。"
              onChange={(value) => setConfig((prev) => ({ ...prev, time_end: value }))}
            />
            <div className="tn-range-summary" aria-live="polite">
              {rangeLoading ? (
                <div className="tn-muted">正在解析所选范围的真实时间索引与有效观测…</div>
              ) : rangeInfo?.range ? (
                <>
                  <div>
                    <strong>数据可用范围：</strong>
                    {rangeInfo.range.source_start_at ?? '—'} ～ {rangeInfo.range.source_end_at ?? '—'}
                  </div>
                  <div><strong>实际开始：</strong>{rangeInfo.range.start_at ?? '—'}</div>
                  <div><strong>最后一个有效观测：</strong>{rangeInfo.range.end_at ?? '—'}</div>
                  <div>
                    <strong>时间跨度：</strong>{rangeInfo.range.span_label} ·{' '}
                    <strong>采样间隔：</strong>{rangeInfo.range.interval_minutes} 分钟
                  </div>
                  <div>
                    <strong>选中时间点：</strong>{rangeInfo.range.points} 个 ·{' '}
                    <strong>有效观测：</strong>{rangeInfo.valid_observations} 个（{rangeInfo.valid_time_points} 个时间点）
                  </div>
                  <div className="tn-muted">
                    边界：{rangeInfo.range.boundary}；原始采样间隔由当前数据源实际数据读取。
                  </div>
                </>
              ) : (
                <div className="tn-muted">选择日期时间后显示真实范围与有效样本。</div>
              )}
            </div>
            {fieldsAfterRange.map(renderParamField)}
            {config.algorithm === 'hierarchical' ? (
              <div className="tn-muted" style={{ marginTop: -4, marginBottom: 8 }}>
                实际算法：Ward 层次聚类 + 欧氏距离；该算法不使用随机种子。
              </div>
            ) : null}
            {config.algorithm === 'spectral' ? (
              <div className="tn-muted" style={{ marginTop: -4, marginBottom: 8 }}>
                实际算法：sklearn Spectral Clustering；先按所选 affinity 构建区域相似度图，再进行谱嵌入和簇划分。
              </div>
            ) : null}
            <Button type="primary" block onClick={runClustering} loading={busy} disabled={!valid || rangeBlocked || rangeLoading} style={{ marginTop: 8 }}>
              {ACTION_LABELS.startClustering}
            </Button>
            {warnings.map((w) => (
              <div className="tn-warning-text" key={w.path + w.code}>
                ⚠ {w.message}
              </div>
            ))}
            <div className="tn-section-title">{bilingual('聚类历史', 'Clustering History')}</div>
            {runs.length === 0 ? (
              <EmptyState text="暂无聚类记录（真实空态）" />
            ) : (
              runs.slice(0, 10).map((run) => (
                <div className="tn-history-row" key={run.cluster_run_id}>
                  <div>
                    <div style={{ fontSize: 12 }}>{run.algorithm_label} · {run.cluster_count} 簇</div>
                    <div className="tn-muted">{run.display_id ?? run.cluster_run_id}</div>
                    <div className="tn-muted">{run.created_at}</div>
                  </div>
                  <div className="tn-inline">
                    <StatusTag status={run.status} error={run.error} />
                    <Button size="small" onClick={() => openRun(run.cluster_run_id)}>{ACTION_LABELS.open}</Button>
                    <Popconfirm
                      title="删除该聚类记录？"
                      description="只删除本次聚类结果，不影响原始数据。"
                      onConfirm={async () => {
                        try {
                          await api.del(ENDPOINTS.clusterGet(run.cluster_run_id))
                          messageApi.success('已删除')
                          loadRuns()
                        } catch (err) {
                          messageApi.error(err instanceof ApiError ? err.message : String(err))
                        }
                      }}
                    >
                      <Button size="small" danger>{ACTION_LABELS.deleteRecord}</Button>
                    </Popconfirm>
                  </div>
                </div>
              ))
            )}
          </>
        }
        visual={
          <>
            <PaneHead title={bilingual('GIS 簇分布', 'GIS Cluster Map')} extra={<span className="tn-muted">{selectedRegion ? `已选 ${selectedRegion} · ${clusterDisplayName(clusterOf(selectedRegion))}` : '点击地图查看区域'}</span>} />
            <MapView
              geojson={geojson}
              entries={regionEntries}
              selected={selectedRegion ? [selectedRegion] : []}
              onToggle={(regionId) => {
                setSelectedRegion(regionId === selectedRegion ? null : regionId)
                setFocusRegion(regionId)
                setRegionSearch(regionId)
                setClusterFilter('all')
              }}
              height={400}
              focus={focusRegion}
              colorFor={(entry) => (
                entry?.group === undefined || entry?.group === null
                  ? CLUSTER_NO_DATA_COLOR
                  : clusterColor(entry.group)
              )}
              formatTooltip={(entry, regionId) =>
                `${regionId}: ${entry?.group === undefined ? '无数据 / 未参与聚类' : clusterDisplayName(entry.group)}`
              }
              legend={
                <>
                  {normalClusters.map((cluster: any) => (
                    <span key={cluster.cluster_id}>
                      <span
                        className="tn-legend-swatch"
                        data-cluster-id={cluster.cluster_id}
                        data-cluster-color={clusterColor(cluster.cluster_id)}
                        style={{ background: clusterColor(cluster.cluster_id) }}
                      />
                      {clusterDisplayName(cluster.cluster_id)}
                    </span>
                  ))}
                  <span>
                    <span className="tn-legend-swatch" style={{ background: CLUSTER_NO_DATA_COLOR }} />无数据
                  </span>
                </>
              }
            />
            <Card
              size="small"
              title={bilingual(
                result?.pca?.available ? '特征空间（PCA 二维投影）' : '特征空间',
                'Feature Space',
              )}
              style={{ marginTop: 10 }}
            >
              {scatter.length ? (
                <>
                  <ScatterChart
                    points={scatter}
                    xName={featureAxes[0]?.label}
                    yName={featureAxes[1]?.label}
                    colorFor={(groupId) => clusterColor(groupId)}
                    groupNames={Object.fromEntries(
                      normalClusters.map((cluster: any) => [
                        String(cluster.cluster_id),
                        `簇 ${cluster.cluster_id}`,
                      ]),
                    )}
                    groupTooltipNames={Object.fromEntries(
                      normalClusters.map((cluster: any) => [
                        String(cluster.cluster_id),
                        clusterDisplayName(cluster.cluster_id),
                      ]),
                    )}
                    onSelect={(regionId) => setFocusRegion(regionId)}
                  />
                  <div className="tn-muted">
                    {result?.pca?.available
                      ? `每个点代表一个区域；颜色表示所属簇。横轴 ${featureAxes[0]?.label}、纵轴 ${featureAxes[1]?.label} 来自实际聚类特征矩阵的 PCA 投影。`
                      : `二维展示仅使用 ${featureAxes[0]?.label ?? '—'} 与 ${featureAxes[1]?.label ?? '—'} 两个维度。`}
                    {' '}实际聚类使用 {result?.feature_names?.length ?? 0} 个标准化特征，PCA 仅用于可视化，不参与簇分配。
                    二维距离接近不等于必须属于同一簇。点击散点可在 GIS 地图中定位。
                  </div>
                </>
              ) : (
                <EmptyState text="运行聚类后显示特征散点。" />
              )}
            </Card>
            <section aria-label="Region List">
            <Card size="small" title={bilingual('区域列表', 'Region List')} style={{ marginTop: 10 }}>
              {result ? (
                <>
                  <div className="tn-inline" style={{ marginBottom: 7, flexWrap: 'wrap' }}>
                    <Input
                      allowClear
                      size="small"
                      value={regionSearch}
                      placeholder="搜索区域名称或 ID"
                      onChange={(event) => setRegionSearch(event.target.value)}
                      style={{ width: 190 }}
                      aria-label="搜索区域"
                    />
                    <Select
                      size="small"
                      value={clusterFilter}
                      style={{ width: 230 }}
                      onChange={setClusterFilter}
                      options={[
                        { value: 'all', label: '全部簇' },
                        ...normalClusters.map((cluster: any) => ({
                          value: String(cluster.cluster_id),
                          label: clusterDisplayName(cluster.cluster_id),
                        })),
                      ]}
                      aria-label="按簇筛选"
                    />
                    <span className="tn-muted">
                      {filteredRegionRows.length}/{regionRows.length} 个区域
                    </span>
                  </div>
                  <Table
                    size="small"
                    tableLayout="fixed"
                    rowKey="region_id"
                    dataSource={filteredRegionRows}
                    pagination={{ pageSize: 10, size: 'small', showSizeChanger: false }}
                    onRow={(record: any) => ({
                      onClick: () => {
                        setSelectedRegion(record.region_id)
                        setFocusRegion(record.region_id)
                      },
                    })}
                    columns={regionColumns}
                  />
                </>
              ) : (
                <EmptyState text="运行聚类后显示区域列表。" />
              )}
            </Card>
            </section>
            <Alert style={{ marginTop: 8 }} type="info" showIcon message={result?.disclaimer_zh ?? '簇的功能区标签为基于流量模式的推测，不代表真实土地使用数据。'} />
          </>
        }
        info={
          <Tabs
            className="tn-tabs-tight"
            activeKey={tab}
            onChange={setTab}
            items={[
              {
                key: 'overview',
                label: <BiLabel zh="聚类概览" en="Cluster Overview" />,
                children: result ? (
                  <div className="tn-stack">
                    <div className="tn-muted">
                      实际簇数 {normalClusters.length} · 参与区域 {result.regions.length} · 丢弃区域{' '}
                      {result.dropped_regions?.length ?? 0} · 无数据 {result.no_data_regions?.length ?? 0}
                      {result.assignment ? (
                        <> · 归属检查 {result.assignment.assigned_regions}/{result.assignment.total_regions}
                          {result.assignment.all_regions_assigned_once ? '（全部唯一归属）' : '（存在未归属）'}
                        </>
                      ) : null}
                    </div>
                    {normalClusters.map((cluster: any) => (
                      <Card
                        size="small"
                        key={cluster.cluster_id}
                        title={(
                          <span className="tn-inline">
                            <span
                              className="tn-legend-swatch"
                              data-cluster-id={cluster.cluster_id}
                              data-cluster-color={clusterColor(cluster.cluster_id)}
                              style={{ background: clusterColor(cluster.cluster_id) }}
                            />
                            {clusterDisplayName(cluster.cluster_id)} · {cluster.region_count} 个区域
                          </span>
                        )}
                      >
                        <div className="tn-inline" style={{ marginBottom: 6, flexWrap: 'wrap' }}>
                          <Tag color="purple">
                            {cluster.pattern_type?.label ?? cluster.inferred_zone_type?.label ?? '模式未知'}
                            {cluster.pattern_type?.is_hypothesis ? '（假设）' : ''}
                          </Tag>
                          {(cluster.characterization?.tags ?? []).map((tag: string) => (
                            <Tag key={tag} color="blue">{tag}</Tag>
                          ))}
                        </div>
                        <div style={{ fontSize: 11.5, lineHeight: 1.65 }}>
                          {cluster.characterization?.summary_zh ?? '暂无差异化特征摘要。'}
                        </div>
                        {cluster.pattern_type?.selection_basis_zh ? (
                          <div className="tn-muted" style={{ marginTop: 4 }}>
                            命名依据：{cluster.pattern_type.selection_basis_zh}
                          </div>
                        ) : null}
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                            gap: '2px 10px',
                            marginTop: 7,
                            fontSize: 10.5,
                          }}
                        >
                          {Object.entries(cluster.feature_means as Record<string, number>).map(([key, value]) => (
                            <div key={key}>
                              {featureLabel(key)}：{Number(value).toFixed(3)}
                            </div>
                          ))}
                        </div>
                        {cluster.pattern_type?.hypothesis_zh ? (
                          <div className="tn-muted" style={{ marginTop: 6 }}>
                            假设：{cluster.pattern_type.hypothesis_zh}
                          </div>
                        ) : null}
                        {(cluster.differences ?? []).slice(0, 1).map((difference: any) => (
                          <div key={difference.other_cluster_id} className="tn-muted" style={{ marginTop: 6 }}>
                            主要差异：{difference.summary_zh}
                          </div>
                        ))}
                        <Collapse
                          size="small"
                          ghost
                          style={{ marginTop: 3 }}
                          items={[
                            {
                              key: 'details',
                              label: '展开区域与可靠性说明',
                              children: (
                                <div className="tn-insight-details">
                                  <div>
                                    <span className="tn-insight-detail-label">包含区域</span>
                                    <span>{(cluster.regions ?? []).join('、') || '—'}</span>
                                  </div>
                                  {(cluster.reliability?.notes ?? []).map((note: string) => (
                                    <div key={note}>
                                      <span className="tn-insight-detail-label">可靠性</span>
                                      <span>{note}</span>
                                    </div>
                                  ))}
                                </div>
                              ),
                            },
                          ]}
                        />
                      </Card>
                    ))}
                  </div>
                ) : (
                  <EmptyState text="尚无聚类结果。" />
                ),
              },
              {
                key: 'patterns',
                label: <BiLabel zh="典型模式" en="Typical Patterns" />,
                children: result ? (
                  <div className="tn-stack">
                    {clusterLegend}
                    <Card
                      size="small"
                      title={bilingual(
                        normalizedPatterns ? '各簇归一化日内模式' : '各簇平均日内模式',
                        normalizedPatterns ? 'Normalized Profiles' : 'Cluster Hourly Profiles',
                      )}
                      extra={(
                        <span className="tn-inline" style={{ gap: 5 }}>
                          <Switch size="small" checked={normalizedPatterns} onChange={setNormalizedPatterns} />
                          <span className="tn-muted">归一化形状</span>
                        </span>
                      )}
                    >
                      <div
                        data-testid="cluster-pattern-chart"
                        data-cluster-colors={JSON.stringify(clusterColorMap)}
                        data-legend-labels={JSON.stringify(
                          normalClusters.map((cluster: any) => `簇 ${cluster.cluster_id}`),
                        )}
                      >
                        <LineChart
                          height={250}
                          x={Array.from({ length: 24 }, (_, i) => `${i}:00`)}
                          xName="小时"
                          xLabelInterval={2}
                          yName={normalizedPatterns ? '相对水平（各簇均值＝1）' : '流量值'}
                          tooltipFormatter={typicalTooltipFormatter}
                          series={normalClusters.map((cluster: any) => ({
                            name: `簇 ${cluster.cluster_id}`,
                            data: normalizedPatterns ? cluster.normalized_profile : cluster.intraday_profile,
                            color: clusterColor(cluster.cluster_id),
                          }))}
                        />
                      </div>
                      <div className="tn-muted">
                        {normalizedPatterns
                          ? '归一化曲线将每个簇的 24 小时均值除以自身全天均值，用于比较峰谷形状，不比较原始规模。'
                          : '曲线来自该簇全部成员区域逐小时真实均值的平均；不同簇的原始流量规模可能不同。'}
                      </div>
                    </Card>
                    <Card
                      size="small"
                      title={bilingual('周内差异', 'Weekly Pattern')}
                      extra={(
                        <span className="tn-inline" style={{ gap: 5 }}>
                          <Switch size="small" checked={normalizedWeekly} onChange={setNormalizedWeekly} />
                          <span className="tn-muted">归一化形状</span>
                        </span>
                      )}
                    >
                      <div
                        data-testid="cluster-weekly-pattern-chart"
                        data-normalized={String(normalizedWeekly)}
                        data-y-axis-title={weeklyYAxisTitle}
                        data-displayed-series={JSON.stringify(
                          weeklyPatternData.map((item) => normalizedWeekly ? item.normalized : item.raw),
                        )}
                        data-legend-labels={JSON.stringify(
                          weeklyPatternData.map((item) => `簇 ${item.cluster.cluster_id}`),
                        )}
                        data-weekly-series={JSON.stringify(
                          weeklyPatternData.map((item) => ({
                            cluster_id: item.cluster.cluster_id,
                            mean: item.mean,
                            raw: item.raw,
                            normalized: item.normalized,
                          })),
                        )}
                      >
                        <LineChart
                          height={240}
                          x={WEEKDAY_LABELS}
                          xName="星期"
                          yName={weeklyYAxisTitle}
                          tooltipFormatter={weeklyTooltipFormatter}
                          series={weeklyPatternData.map((item) => ({
                            name: `簇 ${item.cluster.cluster_id}`,
                            data: normalizedWeekly ? item.normalized : item.raw,
                            color: clusterColor(item.cluster.cluster_id),
                          }))}
                        />
                      </div>
                      <div className="tn-muted">
                        {normalizedWeekly
                          ? '周内归一化把每个簇周一至周日的有效平均值除以其自身周平均；缺失值保持缺失，不补 0。'
                          : '显示各簇周一至周日的原始平均流量，保留不同簇的实际流量规模差异。'}
                      </div>
                    </Card>
                    <InsightCard
                      title="聚类模式分析（Cluster Pattern Insights）"
                      insights={result.pattern_insights}
                    />
                  </div>
                ) : (
                  <EmptyState text="尚无聚类结果。" />
                ),
              },
              {
                key: 'quality',
                label: <BiLabel zh="质量评估" en="Quality Evaluation" />,
                children: result ? (
                  <div className="tn-stack">
                    {!result.cluster_count_check?.matches ? (
                      <Alert
                        type="warning"
                        showIcon
                        message={`请求 ${result.cluster_count_check?.requested ?? '—'} 个簇，实际得到 ${result.cluster_count_check?.actual ?? normalClusters.length} 个有效簇`}
                        description="请检查参数或数据退化情况；不会用虚假簇补齐请求数量。"
                      />
                    ) : null}
                    <Card size="small" title={bilingual('质量指标', 'Clustering Metrics')}>
                      <div className="tn-muted">
                        <div>轮廓系数（Silhouette）：{result.metrics?.silhouette === null || result.metrics?.silhouette === undefined ? '不适用' : Number(result.metrics.silhouette).toFixed(4)}</div>
                        <div>戴维斯-布尔丁指数（Davies-Bouldin）：{result.metrics?.davies_bouldin === null || result.metrics?.davies_bouldin === undefined ? '不适用' : Number(result.metrics.davies_bouldin).toFixed(4)}</div>
                        <div>方差比准则（Calinski-Harabasz）：{result.metrics?.calinski_harabasz === null || result.metrics?.calinski_harabasz === undefined ? '不适用' : Number(result.metrics.calinski_harabasz).toFixed(2)}</div>
                        <div>实际有效簇：{result.metrics?.n_clusters ?? normalClusters.length}（请求 {result.cluster_count_check?.requested ?? '—'}）</div>
                        <div>
                          区域归属：{result.assignment?.assigned_regions ?? result.regions.length}/
                          {result.assignment?.total_regions ?? result.regions.length}
                          {result.assignment?.all_regions_assigned_once ? '，全部唯一归属' : '，存在未归属或重复'}
                        </div>
                        <div>特征窗口：约 {Number(result.sample_window_days ?? 0).toFixed(1)} 天</div>
                      </div>
                      {(result.metrics?.interpretation ?? result.metrics?.notes ?? []).map((note: string) => (
                        <div className="tn-muted" key={note}>
                          · {note}
                        </div>
                      ))}
                    </Card>
                    <Card size="small" title={bilingual('簇名称与区域归属', 'Cluster Names & Membership')}>
                      {normalClusters.map((cluster: any) => (
                        <div key={cluster.cluster_id} className="tn-inline" style={{ gap: 6, marginBottom: 4 }}>
                          <span
                            className="tn-legend-swatch"
                            style={{ background: clusterColor(cluster.cluster_id) }}
                          />
                          <strong>{clusterDisplayName(cluster.cluster_id)}</strong>
                          <span className="tn-muted">{cluster.region_count} 个区域</span>
                        </div>
                      ))}
                    </Card>
                    <Card size="small" title={bilingual('标准化与算法配置', 'Standardization & Algorithm')}>
                      <div className="tn-muted">
                        <div>
                          特征标准化：{result.standardization?.applied ? '已启用' : '未启用'}
                          {result.standardization?.applied
                            ? `，${result.feature_names?.length ?? 0} 个特征逐列 Z-score 标准化`
                            : '，聚类距离使用原始特征量级'}
                        </div>
                        <div>
                          算法：{result.algorithm_label ?? result.algorithm}
                          {result.algorithm === 'hierarchical'
                            ? ` · 连接方式 ${result.algorithm_detail?.linkage ?? '—'} · 距离 ${result.algorithm_detail?.metric ?? '—'} · 不使用随机种子`
                            : ''}
                        </div>
                        <div>
                          标准化后各特征均值绝对值最大{' '}
                          {Math.max(
                            0,
                            ...Object.values(result.standardization?.feature_stats ?? {}).map((item: any) =>
                              item.scaled_mean === null || item.scaled_mean === undefined ? 0 : Math.abs(item.scaled_mean),
                            ),
                          ).toFixed(3)}
                          ，非零方差特征标准差接近 1。
                        </div>
                      </div>
                      <Collapse
                        size="small"
                        ghost
                        items={[
                          {
                            key: 'feature-standardization',
                            label: '查看各特征标准化参数',
                            children: (
                              <div className="tn-insight-details">
                                {Object.entries(result.standardization?.feature_stats ?? {}).map(([key, item]: [string, any]) => (
                                  <div key={key}>
                                    <span className="tn-insight-detail-label">{featureLabel(key)}</span>
                                    <span>
                                      原始均值 {Number(item.mean).toFixed(3)}，原始标准差 {Number(item.std).toFixed(3)}
                                      {item.zero_variance ? '，零方差（标准差按 1 处理）' : `，标准化后均值 ${Number(item.scaled_mean).toFixed(3)} / 标准差 ${Number(item.scaled_std).toFixed(3)}`}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ),
                          },
                        ]}
                      />
                    </Card>
                    <Card size="small" title={bilingual('算法细节', 'Algorithm Details')}>
                      <pre className="tn-code">{JSON.stringify(result.algorithm_detail, null, 2)}</pre>
                    </Card>
                  </div>
                ) : (
                  <EmptyState text="尚无聚类结果。" />
                ),
              },
            ]}
          />
        }
      />
    </div>
  )
}
