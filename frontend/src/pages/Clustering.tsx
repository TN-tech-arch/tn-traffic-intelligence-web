import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Collapse, Popconfirm, Switch, Table, Tabs, Tag, Tooltip, message } from 'antd'
import { ENDPOINTS, ApiError, api, type Issue } from '../api/client'
import { EmptyState, ModuleHeader, PaneHead, ThreePane } from '../components/Panes'
import ParamField from '../components/ParamField'
import MapView, {
  CLUSTER_NOISE_COLOR, CLUSTER_NO_DATA_COLOR, clusterColor,
} from '../components/MapView'
import { LineChart, ScatterChart } from '../components/Charts'
import InsightCard from '../components/InsightCard'
import StatusTag from '../components/StatusTag'
import BiLabel from '../components/BiLabel'
import { useGroupValidation } from '../validation/useValidation'
import { fieldDisabledReason, visibleFields, type FieldSpec } from '../validation/engine'
import {
  ACTION_LABELS, MODULE_META, bilingual, featureLabel, statusLabel,
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

export default function Clustering() {
  const [messageApi, contextHolder] = message.useMessage()
  const [catalog, setCatalog] = useState<{ features: Array<{ key: string; label_zh: string; help_zh: string }>; algorithms: Array<{ key: string; label: string }> }>({ features: [], algorithms: [] })
  const [config, setConfig] = useState<Record<string, unknown>>({
    source_key: 'milano',
    frequency: 'native',
    aggregation: 'mean',
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
    eps: 1.2,
    min_samples: 3,
    gmm_n_components: 4,
    covariance_type: 'full',
    reg_covar: 0.000001,
    random_state: 42,
  })
  const [geojson, setGeojson] = useState<any>(null)
  const [regions, setRegions] = useState<any[]>([])
  const [result, setResult] = useState<any>(null)
  const [runs, setRuns] = useState<any[]>([])
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null)
  const [focusRegion, setFocusRegion] = useState<string | null>(null)
  const [normalizedPatterns, setNormalizedPatterns] = useState(false)
  const [tab, setTab] = useState('overview')
  const [busy, setBusy] = useState(false)
  const [serverIssues, setServerIssues] = useState<Issue[]>([])

  const schema: FieldSpec[] = useMemo(
    () => [
      { key: 'source_key', label_zh: '数据源', type: 'enum', enum: ['milano', 'trentino', 'zte'], enum_labels: ['Milano', 'Trentino', 'ZTE 4G Downlink'], default: 'milano', help_zh: '聚类使用的数据源。', suggestion_zh: 'ZTE 的无数据区域不会参与聚类。' },
      { key: 'frequency', label_zh: '时间分辨率', type: 'enum', enum: ['native', '30min', '60min', '1day'], enum_labels: ['原生', '30 分钟', '1 小时', '1 天'], default: 'native', help_zh: '特征提取所用的频率。', suggestion_zh: '日内模式建议原生或 30 分钟。' },
      { key: 'aggregation', label_zh: '聚合方式', type: 'enum', enum: ['mean', 'sum'], enum_labels: ['均值', '求和'], default: 'mean', help_zh: '聚合方式，会影响特征量级。', suggestion_zh: '均值更利于形状比较。' },
      { key: 'start_index', label_zh: '起始时间点', type: 'integer', min: 0, default: 0, help_zh: '特征提取窗口起点（重采样后的点数）。', suggestion_zh: '默认 0。' },
      { key: 'window_points', label_zh: '窗口点数', type: 'integer', min: 24, max: 100000, default: 1008, help_zh: '参与特征提取的连续点数，至少覆盖一个完整日周期。', suggestion_zh: '10 分钟频率下 1008 点 ≈ 7 天。' },
      { key: 'features', label_zh: '聚类特征', type: 'array', enum: catalog.features.map((f) => f.key), enum_labels: catalog.features.map((f) => featureLabel(f.key, f.label_zh)), default: DEFAULT_FEATURES, help_zh: '从真实时间序列提取的特征集合。', suggestion_zh: '至少选择 2 个特征。' },
      { key: 'standardize', label_zh: '特征标准化', type: 'boolean', default: true, help_zh: '聚类前对特征做 z-score 标准化。', suggestion_zh: '建议开启。' },
      { key: 'algorithm', label_zh: '聚类算法', type: 'enum', enum: ['kmeans', 'dbscan', 'hierarchical', 'gmm'], enum_labels: ['K-Means', 'DBSCAN', '层次聚类（Hierarchical）', '高斯混合（GMM）'], default: 'kmeans', help_zh: '四选一的真实聚类算法。', suggestion_zh: '先用 K-Means，再对比其它三种。' },
      { key: 'n_clusters', label_zh: '簇数量 K', type: 'integer', min: 2, max: 30, default: 4, visible_when: { algorithm: 'kmeans' }, enabled_when: { algorithm: 'kmeans' }, help_zh: 'K-Means 的簇数量。', suggestion_zh: '3-8 之间便于解释。' },
      { key: 'n_init', label_zh: '初始化次数', type: 'integer', min: 1, max: 100, default: 10, level: 'advanced', visible_when: { algorithm: 'kmeans' }, enabled_when: { algorithm: 'kmeans' }, help_zh: 'K-Means 重复初始化次数，取最优惯性。', suggestion_zh: '10 是稳健默认值。' },
      { key: 'hierarchical_n_clusters', label_zh: '簇数量 K', type: 'integer', min: 2, max: 30, default: 4, visible_when: { algorithm: 'hierarchical' }, enabled_when: { algorithm: 'hierarchical' }, help_zh: '层次聚类的簇数量。', suggestion_zh: '与 K-Means 比较时使用相同 K。' },
      { key: 'linkage', label_zh: '连接方式', type: 'enum', enum: ['ward', 'complete', 'average', 'single'], enum_labels: ['沃德（ward）', '完全连接（complete）', '平均连接（average）', '单连接（single）'], default: 'ward', level: 'advanced', visible_when: { algorithm: 'hierarchical' }, enabled_when: { algorithm: 'hierarchical' }, help_zh: '层次聚类连接准则；沃德法只能配合欧氏距离。', suggestion_zh: '默认使用沃德法。' },
      { key: 'metric', label_zh: '距离度量', type: 'enum', enum: ['euclidean', 'manhattan', 'cosine'], enum_labels: ['欧氏距离（euclidean）', '曼哈顿距离（manhattan）', '余弦距离（cosine）'], default: 'euclidean', level: 'advanced', visible_when: { algorithm: 'hierarchical' }, enabled_when: { algorithm: 'hierarchical' }, help_zh: '距离度量；沃德法仅支持欧氏距离。', suggestion_zh: '默认使用欧氏距离。' },
      { key: 'eps', label_zh: '邻域半径', type: 'number', min: 0, exclusive_min: true, default: 1.2, visible_when: { algorithm: 'dbscan' }, enabled_when: { algorithm: 'dbscan' }, help_zh: 'DBSCAN 邻域半径（标准化特征空间），必须大于 0。', suggestion_zh: '标准化后 0.3-2.0 较常见。' },
      { key: 'min_samples', label_zh: '最小样本数', type: 'integer', min: 1, max: 200, default: 3, visible_when: { algorithm: 'dbscan' }, enabled_when: { algorithm: 'dbscan' }, help_zh: 'DBSCAN 核心点最小邻居数。', suggestion_zh: '3-10。' },
      { key: 'gmm_n_components', label_zh: '高斯分量数', type: 'integer', min: 1, max: 30, default: 4, visible_when: { algorithm: 'gmm' }, enabled_when: { algorithm: 'gmm' }, help_zh: 'GMM 高斯分量个数。', suggestion_zh: '3-8。' },
      { key: 'covariance_type', label_zh: '协方差类型', type: 'enum', enum: ['full', 'tied', 'diag', 'spherical'], enum_labels: ['完全协方差（full）', '共享协方差（tied）', '对角协方差（diag）', '球形协方差（spherical）'], default: 'full', level: 'advanced', visible_when: { algorithm: 'gmm' }, enabled_when: { algorithm: 'gmm' }, help_zh: '高斯混合模型的协方差结构；样本少时完全协方差可能不可靠。', suggestion_zh: '样本充足时使用完全协方差。' },
      { key: 'reg_covar', label_zh: '协方差正则项', type: 'number', min: 0, exclusive_min: true, default: 0.000001, level: 'advanced', visible_when: { algorithm: 'gmm' }, enabled_when: { algorithm: 'gmm' }, help_zh: 'GMM 协方差对角线正则项，必须大于 0 以保证数值稳定。', suggestion_zh: '1e-6 起。' },
      { key: 'random_state', label_zh: '随机种子', type: 'integer', min: 0, max: 2147483647, default: 42, level: 'advanced', help_zh: '固定随机性以便复现。', suggestion_zh: '默认 42。' },
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
    api.get<any>(ENDPOINTS.regions(key)).then((data) => setRegions(data.regions)).catch(() => undefined)
    api.get<any>(ENDPOINTS.geometry(key)).then(setGeojson).catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.source_key])

  const runClustering = async () => {
    if (!valid) {
      messageApi.error('存在参数错误，请查看输入框下方提示。')
      return
    }
    setBusy(true)
    setServerIssues([])
    try {
      const created = await api.post<any>(ENDPOINTS.clusterRun, { values: config })
      messageApi.success(`聚类任务已提交：${created.cluster_run_id}`)
      const started = Date.now()
      while (Date.now() - started < 600000) {
        await new Promise((resolve) => setTimeout(resolve, 2500))
        const state = await api.get<any>(ENDPOINTS.clusterGet(created.cluster_run_id))
        if (!['Queued', 'Running'].includes(state.status)) {
          if (state.status === 'Completed') {
            setResult({ ...state.result, cluster_run_id: state.cluster_run_id, params: state.params, metrics: state.metrics })
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
      setResult({ ...state.result, cluster_run_id: runId, params: state.params, metrics: state.metrics })
      setConfig((prev) => ({ ...prev, ...(state.params ?? {}) }))
      messageApi.success(`已载入历史聚类 ${runId}`)
    } catch (err) {
      messageApi.error(String(err))
    }
  }

  const regionEntries = useMemo(() => {
    if (!result) return []
    return result.regions.map((item: any) => ({
      region_id: item.region_id,
      value: item.features?.mean ?? null,
      group: item.cluster_id,
      label: `${item.region_id} · ${item.cluster_id === -1 ? '噪声' : `簇 ${item.cluster_id}`}`,
    }))
  }, [result])

  const scatter = useMemo(() => {
    if (!result?.feature_matrix?.length || !result?.labels) return []
    const [first, second] = result.feature_names
    return result.labels.map((label: number, index: number) => ({
      x: result.feature_matrix[index][0],
      y: second ? result.feature_matrix[index][1] : result.feature_matrix[index][0],
      group: label,
      name: result.regions[index]?.region_id,
      regionId: result.regions[index]?.region_id,
      extra: second
        ? `${featureLabel(first)} ${Number(result.feature_matrix[index][0]).toFixed(3)} · ${featureLabel(second)} ${Number(result.feature_matrix[index][1]).toFixed(3)}`
        : `${featureLabel(first)} ${Number(result.feature_matrix[index][0]).toFixed(3)}`,
    }))
  }, [result])

  const clusterOf = (regionId: string | null) =>
    regionId ? result?.regions?.find((r: any) => r.region_id === regionId)?.cluster_id : undefined

  const normalClusters = (result?.clusters ?? []).filter((cluster: any) => cluster.cluster_id >= 0)
  const noiseCluster = (result?.clusters ?? []).find((cluster: any) => cluster.cluster_id < 0)
  const clusterById: Map<number, any> = new Map(
    (result?.clusters ?? []).map((cluster: any) => [Number(cluster.cluster_id), cluster]),
  )
  const featureAxes = result?.feature_names?.length
    ? [
        { key: result.feature_names[0], label: featureLabel(result.feature_names[0]) },
        { key: result.feature_names[1], label: featureLabel(result.feature_names[1]) },
      ]
    : []
  const clusterColorMap = Object.fromEntries(
    normalClusters.map((cluster: any) => [String(cluster.cluster_id), clusterColor(cluster.cluster_id)]),
  )

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
          簇 {cluster.cluster_id} · {cluster.region_count} 区
        </span>
      ))}
      {noiseCluster ? (
        <span className="tn-inline" style={{ gap: 4 }}>
          <span className="tn-legend-swatch" style={{ background: CLUSTER_NOISE_COLOR }} />
          噪声 · {noiseCluster.region_count} 区
        </span>
      ) : null}
      <span className="tn-inline" style={{ gap: 4 }}>
        <span className="tn-legend-swatch" style={{ background: CLUSTER_NO_DATA_COLOR }} />
        无数据
      </span>
    </div>
  )

  return (
    <div>
      {contextHolder}
      <ModuleHeader
        module={MODULE_META.m2.index}
        titleZh={MODULE_META.m2.titleZh}
        titleEn={MODULE_META.m2.titleEn}
        description="K-Means / DBSCAN / Hierarchical / GMM 真实聚类、GIS 簇着色与质量评估"
        datasetInfo={result ? `最近运行 ${result.cluster_run_id} · ${result.algorithm_label} · ${result.clusters.length} 个簇` : '尚未运行聚类'}
      />
      {errors.length > 0 ? (
        <Alert type="error" showIcon style={{ marginBottom: 10 }} message={`${errors.length} 个参数错误（见字段下方提示）`} description={errors.slice(0, 2).map((e) => e.message).join('；')} />
      ) : null}
      {serverIssues.length > 0 ? (
        <Alert type="error" showIcon style={{ marginBottom: 10 }} message="后端拒绝了本次请求" description={serverIssues.map((i) => `${i.path}: ${i.message}`).join('；')} />
      ) : null}
      <ThreePane
        config={
          <>
            <PaneHead
              title={bilingual('配置', 'Configuration')}
              extra={
                <Button size="small" onClick={() => setConfig((prev) => ({ ...prev, algorithm: 'kmeans', n_clusters: 4, features: DEFAULT_FEATURES, standardize: true, eps: 1.2, min_samples: 3, gmm_n_components: 4, linkage: 'ward', metric: 'euclidean' }))}>
                  {ACTION_LABELS.reset}
                </Button>
              }
            />
            {visibleFields(schema, config)
              .filter((spec) => (
                spec.key !== 'random_state' || ['kmeans', 'gmm'].includes(String(config.algorithm))
              ))
              .map((spec) => (
              <ParamField
                key={spec.key}
                spec={spec}
                value={config[spec.key]}
                issues={fieldIssues(spec.key)}
                path={`m2.${spec.key}`}
                onChange={(key, value) => setConfig((prev) => ({ ...prev, [key]: value }))}
                disabledReason={fieldDisabledReason(spec, config)}
                compact
              />
              ))}
            {config.algorithm === 'hierarchical' ? (
              <div className="tn-muted" style={{ marginTop: -4, marginBottom: 8 }}>
                实际算法：Ward 层次聚类 + 欧氏距离；该算法不使用随机种子。
              </div>
            ) : null}
            <Button type="primary" block onClick={runClustering} loading={busy} disabled={!valid} style={{ marginTop: 8 }}>
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
                    <div className="tn-muted">{run.cluster_run_id}</div>
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
            <PaneHead title={bilingual('GIS 簇分布', 'GIS Cluster Map')} extra={<span className="tn-muted">{selectedRegion ? `已选 ${selectedRegion}（簇 ${clusterOf(selectedRegion)}）` : '点击地图查看区域'}</span>} />
            <MapView
              geojson={geojson}
              entries={regionEntries}
              selected={selectedRegion ? [selectedRegion] : []}
              onToggle={(regionId) => setSelectedRegion(regionId === selectedRegion ? null : regionId)}
              height={400}
              focus={focusRegion}
              colorFor={(entry) => (
                entry?.group === undefined || entry?.group === null
                  ? CLUSTER_NO_DATA_COLOR
                  : clusterColor(entry.group)
              )}
              formatTooltip={(entry, regionId) =>
                `${regionId}: ${entry?.group === undefined ? '无数据 / 未参与聚类' : entry.group === -1 ? '噪声（DBSCAN）' : `簇 ${entry.group}`}`
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
                      簇 {cluster.cluster_id}
                    </span>
                  ))}
                  {noiseCluster ? (
                    <span>
                      <span className="tn-legend-swatch" style={{ background: CLUSTER_NOISE_COLOR }} />
                      噪声（-1）
                    </span>
                  ) : null}
                  <span>
                    <span className="tn-legend-swatch" style={{ background: CLUSTER_NO_DATA_COLOR }} />无数据
                  </span>
                </>
              }
            />
            <Card size="small" title={bilingual('特征空间', 'Feature Space')} style={{ marginTop: 10 }}>
              {scatter.length ? (
                <>
                  <ScatterChart
                    points={scatter}
                    xName={featureAxes[0]?.label}
                    yName={featureAxes[1]?.label}
                    colorFor={(groupId) => clusterColor(groupId)}
                    onSelect={(regionId) => setFocusRegion(regionId)}
                  />
                  <div className="tn-muted">
                    二维展示仅使用 {featureAxes[0]?.label ?? '—'} 与 {featureAxes[1]?.label ?? '—'} 两个维度；
                    实际聚类使用 {result?.feature_names?.length ?? 0} 个标准化特征。
                    二维距离接近不等于必须属于同一簇。点击散点可在 GIS 地图中定位。
                  </div>
                </>
              ) : (
                <EmptyState text="运行聚类后显示特征散点。" />
              )}
            </Card>
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
                            {cluster.label_zh} · {cluster.region_count} 个区域
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
                    {noiseCluster ? (
                      <Alert
                        type="info"
                        showIcon
                        message={`噪声点：${noiseCluster.region_count} 个区域`}
                        description="DBSCAN 噪声点不构成功能区模式，使用独立灰色显示。"
                      />
                    ) : null}
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
                      <div data-testid="cluster-pattern-chart" data-cluster-colors={JSON.stringify(clusterColorMap)}>
                        <LineChart
                          height={250}
                          x={Array.from({ length: 24 }, (_, i) => `${i}:00`)}
                          xName="小时"
                          xLabelInterval={2}
                          yName={normalizedPatterns ? '相对水平（各簇均值＝1）' : '流量值'}
                          series={normalClusters.map((cluster: any) => ({
                            name: `${cluster.label_zh} · ${cluster.region_count} 区`,
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
                    <Card size="small" title={bilingual('周内差异', 'Weekly Pattern')}>
                      <LineChart
                        height={200}
                        x={['周一', '周二', '周三', '周四', '周五', '周六', '周日']}
                        xName="星期"
                        yName="流量值"
                        series={normalClusters.map((cluster: any) => ({
                          name: `${cluster.label_zh} · ${cluster.region_count} 区`,
                          data: cluster.weekly_profile,
                          color: clusterColor(cluster.cluster_id),
                        }))}
                      />
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
                        <div>噪声点：{result.metrics?.noise_points ?? 0}</div>
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
              {
                key: 'regions',
                label: <BiLabel zh="区域列表" en="Region List" />,
                children: result ? (
                  <Table
                    size="small"
                    tableLayout="fixed"
                    rowKey="region_id"
                    pagination={{ pageSize: 12, size: 'small' }}
                    dataSource={result.regions}
                    onRow={(record: any) => ({
                      onClick: () => {
                        setSelectedRegion(record.region_id)
                        setFocusRegion(record.region_id)
                      },
                    })}
                    columns={[
                      { title: '区域', dataIndex: 'region_id', width: '22%', ellipsis: true, sorter: (a: any, b: any) => String(a.region_id).localeCompare(String(b.region_id)) },
                      {
                        title: '簇',
                        dataIndex: 'cluster_id',
                        width: '14%',
                        sorter: (a: any, b: any) => a.cluster_id - b.cluster_id,
                        render: (value: number) => (
                          <Tag color={clusterColor(value)}>{value === -1 ? '噪声（-1）' : `簇 ${value}`}</Tag>
                        ),
                      },
                      {
                        title: '模式类型',
                        width: '21%',
                        ellipsis: true,
                        render: (_: unknown, record: any) =>
                          clusterById.get(record.cluster_id)?.pattern_type?.label ?? '—',
                      },
                      {
                        title: '平均值',
                        width: '18%',
                        render: (_: unknown, record: any) => Number(record.features[result.feature_names[0]]).toFixed(1),
                        sorter: (a: any, b: any) => a.features[result.feature_names[0]] - b.features[result.feature_names[0]],
                      },
                      {
                        title: 'CV',
                        width: '13%',
                        render: (_: unknown, record: any) =>
                          result.feature_names.includes('cv') ? Number(record.features.cv).toFixed(3) : '—',
                      },
                      {
                        title: '定位',
                        width: '12%',
                        render: (_: unknown, record: any) => (
                          <Tooltip title="在地图上高亮">
                            <Button
                              size="small"
                              onClick={() => {
                                setSelectedRegion(record.region_id)
                                setFocusRegion(record.region_id)
                              }}
                            >
                              定位
                            </Button>
                          </Tooltip>
                        ),
                      },
                    ]}
                  />
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
