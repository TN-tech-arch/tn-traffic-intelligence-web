import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Popconfirm, Table, Tabs, Tag, Tooltip, message } from 'antd'
import { ENDPOINTS, ApiError, api, type Issue } from '../api/client'
import { EmptyState, ModuleHeader, PaneHead, ThreePane } from '../components/Panes'
import ParamField from '../components/ParamField'
import MapView, { CLUSTER_PALETTE } from '../components/MapView'
import { LineChart, ScatterChart } from '../components/Charts'
import StatusTag from '../components/StatusTag'
import { useGroupValidation } from '../validation/useValidation'
import { fieldDisabledReason, visibleFields, type FieldSpec } from '../validation/engine'

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
  const [tab, setTab] = useState('overview')
  const [busy, setBusy] = useState(false)
  const [serverIssues, setServerIssues] = useState<Issue[]>([])

  const schema: FieldSpec[] = useMemo(
    () => [
      { key: 'source_key', label_zh: '地点', type: 'enum', enum: ['milano', 'trentino', 'zte'], enum_labels: ['Milano', 'Trentino', 'ZTE 4G Downlink'], default: 'milano', help_zh: '聚类使用的数据源。', suggestion_zh: 'ZTE 的 No Data 区域不会参与聚类。' },
      { key: 'frequency', label_zh: '时间分辨率', type: 'enum', enum: ['native', '30min', '60min', '1day'], enum_labels: ['原生', '30 分钟', '1 小时', '1 天'], default: 'native', help_zh: '特征提取所用的频率。', suggestion_zh: '日内模式建议原生或 30 分钟。' },
      { key: 'aggregation', label_zh: '聚合方式', type: 'enum', enum: ['mean', 'sum'], enum_labels: ['均值 mean', '求和 sum'], default: 'mean', help_zh: '聚合方式，会影响特征量级。', suggestion_zh: 'mean 更利于形状比较。' },
      { key: 'start_index', label_zh: '起始时间点', type: 'integer', min: 0, default: 0, help_zh: '特征提取窗口起点（重采样后的点数）。', suggestion_zh: '默认 0。' },
      { key: 'window_points', label_zh: '窗口点数', type: 'integer', min: 24, max: 100000, default: 1008, help_zh: '参与特征提取的连续点数，至少覆盖一个完整日周期。', suggestion_zh: '10 分钟频率下 1008 点 ≈ 7 天。' },
      { key: 'features', label_zh: '聚类特征', type: 'array', enum: catalog.features.map((f) => f.key), enum_labels: catalog.features.map((f) => f.label_zh), default: DEFAULT_FEATURES, help_zh: '从真实时间序列提取的特征集合。', suggestion_zh: '至少选择 2 个特征。' },
      { key: 'standardize', label_zh: '特征标准化', type: 'boolean', default: true, help_zh: '聚类前对特征做 z-score 标准化。', suggestion_zh: '建议开启。' },
      { key: 'algorithm', label_zh: '聚类算法', type: 'enum', enum: ['kmeans', 'dbscan', 'hierarchical', 'gmm'], enum_labels: ['K-Means', 'DBSCAN', 'Hierarchical', 'GMM'], default: 'kmeans', help_zh: '四选一的真实聚类算法。', suggestion_zh: '先用 K-Means，再对比其它三种。' },
      { key: 'n_clusters', label_zh: '簇数量 K', type: 'integer', min: 2, max: 30, default: 4, visible_when: { algorithm: 'kmeans' }, enabled_when: { algorithm: 'kmeans' }, help_zh: 'K-Means 的簇数量。', suggestion_zh: '3-8 之间便于解释。' },
      { key: 'n_init', label_zh: '初始化次数 n_init', type: 'integer', min: 1, max: 100, default: 10, level: 'advanced', visible_when: { algorithm: 'kmeans' }, enabled_when: { algorithm: 'kmeans' }, help_zh: 'K-Means 重复初始化次数，取最优惯性。', suggestion_zh: '10 是稳健默认值。' },
      { key: 'hierarchical_n_clusters', label_zh: '簇数量 K', type: 'integer', min: 2, max: 30, default: 4, visible_when: { algorithm: 'hierarchical' }, enabled_when: { algorithm: 'hierarchical' }, help_zh: '层次聚类的簇数量。', suggestion_zh: '与 K-Means 比较时使用相同 K。' },
      { key: 'linkage', label_zh: '连接方式 linkage', type: 'enum', enum: ['ward', 'complete', 'average', 'single'], default: 'ward', level: 'advanced', visible_when: { algorithm: 'hierarchical' }, enabled_when: { algorithm: 'hierarchical' }, help_zh: '层次聚类连接准则；ward 只能配合欧氏距离。', suggestion_zh: '默认 ward。' },
      { key: 'metric', label_zh: '距离度量 metric', type: 'enum', enum: ['euclidean', 'manhattan', 'cosine'], default: 'euclidean', level: 'advanced', enabled_when: { algorithm: 'hierarchical' }, help_zh: '距离度量；ward 仅支持 euclidean。', suggestion_zh: '默认 euclidean。' },
      { key: 'eps', label_zh: '邻域半径 eps', type: 'number', min: 0, exclusive_min: true, default: 1.2, visible_when: { algorithm: 'dbscan' }, enabled_when: { algorithm: 'dbscan' }, help_zh: 'DBSCAN 邻域半径（标准化特征空间），必须大于 0。', suggestion_zh: '标准化后 0.3-2.0 较常见。' },
      { key: 'min_samples', label_zh: '最小样本数 min_samples', type: 'integer', min: 1, max: 200, default: 3, visible_when: { algorithm: 'dbscan' }, enabled_when: { algorithm: 'dbscan' }, help_zh: 'DBSCAN 核心点最小邻居数。', suggestion_zh: '3-10。' },
      { key: 'gmm_n_components', label_zh: '高斯分量数', type: 'integer', min: 1, max: 30, default: 4, visible_when: { algorithm: 'gmm' }, enabled_when: { algorithm: 'gmm' }, help_zh: 'GMM 高斯分量个数。', suggestion_zh: '3-8。' },
      { key: 'covariance_type', label_zh: '协方差类型', type: 'enum', enum: ['full', 'tied', 'diag', 'spherical'], default: 'full', level: 'advanced', visible_when: { algorithm: 'gmm' }, enabled_when: { algorithm: 'gmm' }, help_zh: 'GMM 协方差结构；样本少时 full 可能不可靠。', suggestion_zh: '样本充足时用 full。' },
      { key: 'reg_covar', label_zh: '协方差正则 reg_covar', type: 'number', min: 0, exclusive_min: true, default: 0.000001, level: 'advanced', visible_when: { algorithm: 'gmm' }, enabled_when: { algorithm: 'gmm' }, help_zh: 'GMM 协方差对角线正则项，必须大于 0 以保证数值稳定。', suggestion_zh: '1e-6 起。' },
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
            messageApi.error(`聚类失败：${state.error ?? state.status}`)
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
        messageApi.warning(`该运行状态为 ${state.status}，没有可用结果。`)
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
      name: result.region_ids?.[index] ?? result.regions[index]?.region_id,
      xName: first,
      yName: second,
    }))
  }, [result])

  const clusterOf = (regionId: string | null) =>
    regionId ? result?.regions?.find((r: any) => r.region_id === regionId)?.cluster_id : undefined

  return (
    <div>
      {contextHolder}
      <ModuleHeader
        module="Module 2"
        title="Functional Zone Clustering"
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
              title="Configuration"
              extra={
                <Button size="small" onClick={() => setConfig((prev) => ({ ...prev, algorithm: 'kmeans', n_clusters: 4, features: DEFAULT_FEATURES, standardize: true, eps: 1.2, min_samples: 3, gmm_n_components: 4, linkage: 'ward', metric: 'euclidean' }))}>
                  Reset 参数
                </Button>
              }
            />
            {visibleFields(schema, config).map((spec) => (
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
            <Button type="primary" block onClick={runClustering} loading={busy} disabled={!valid} style={{ marginTop: 8 }}>
              Run Clustering
            </Button>
            {warnings.map((w) => (
              <div className="tn-warning-text" key={w.path + w.code}>
                ⚠ {w.message}
              </div>
            ))}
            <div className="tn-section-title">聚类历史（Management）</div>
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
                    <Button size="small" onClick={() => openRun(run.cluster_run_id)}>Open</Button>
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
                      <Button size="small" danger>Delete</Button>
                    </Popconfirm>
                  </div>
                </div>
              ))
            )}
          </>
        }
        visual={
          <>
            <PaneHead title="GIS 簇分布" extra={<span className="tn-muted">{selectedRegion ? `已选 ${selectedRegion}（簇 ${clusterOf(selectedRegion)}）` : '点击地图查看区域'}</span>} />
            <MapView
              geojson={geojson}
              entries={regionEntries}
              selected={selectedRegion ? [selectedRegion] : []}
              onToggle={(regionId) => setSelectedRegion(regionId === selectedRegion ? null : regionId)}
              height={400}
              colorFor={(entry) => {
                if (!entry) return '#c9d3e2'
                if (entry.group === undefined || entry.group === null) return '#e2e8f2'
                if (entry.group === -1) return '#8b8b8b'
                return CLUSTER_PALETTE[Math.abs(entry.group) % CLUSTER_PALETTE.length]
              }}
              formatTooltip={(entry, regionId) =>
                `${regionId}: ${entry?.group === undefined ? 'No Data / 未参与聚类' : entry.group === -1 ? '噪声 (DBSCAN)' : `簇 ${entry.group}`}`
              }
              legend={
                <>
                  {CLUSTER_PALETTE.slice(0, 6).map((color, index) => (
                    <span key={color}>
                      <span className="tn-legend-swatch" style={{ background: color }} />簇 {index}
                    </span>
                  ))}
                  <span>
                    <span className="tn-legend-swatch" style={{ background: '#8b8b8b' }} />噪声 -1
                  </span>
                  <span>
                    <span className="tn-legend-swatch" style={{ background: '#c9d3e2' }} />No Data
                  </span>
                </>
              }
            />
            <Card size="small" title="特征空间（真实特征矩阵）" style={{ marginTop: 10 }}>
              {scatter.length ? (
                <ScatterChart points={scatter} xName={result?.feature_names?.[0]} yName={result?.feature_names?.[1]} />
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
                label: 'Cluster Overview',
                children: result ? (
                  <div className="tn-stack">
                    <div className="tn-muted">
                      实际簇数 {result.clusters.filter((c: any) => c.cluster_id >= 0).length} · 参与区域 {result.regions.length} · 丢弃区域{' '}
                      {result.dropped_regions?.length ?? 0} · No Data {result.no_data_regions?.length ?? 0}
                    </div>
                    {result.clusters.map((cluster: any) => (
                      <Card size="small" key={cluster.cluster_id} title={`${cluster.label_zh} · ${cluster.region_count} 区域`}>
                        <div className="tn-muted">
                          {cluster.inferred_zone_type?.label ? (
                            <Tag color="purple">{cluster.inferred_zone_type.label}</Tag>
                          ) : null}
                          {Object.entries(cluster.feature_means as Record<string, number>).map(([key, value]) => (
                            <div key={key}>
                              {key}: {Number(value).toFixed(4)}
                            </div>
                          ))}
                        </div>
                        <div className="tn-muted" style={{ marginTop: 6 }}>
                          区域：{cluster.regions.slice(0, 8).join(', ')}
                          {cluster.regions.length > 8 ? ` …（共 ${cluster.regions.length}）` : ''}
                        </div>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <EmptyState text="尚无聚类结果。" />
                ),
              },
              {
                key: 'patterns',
                label: 'Typical Patterns',
                children: result ? (
                  <div className="tn-stack">
                    <Card size="small" title="各簇平均日内模式（真实均值）">
                      <LineChart
                        height={230}
                        x={Array.from({ length: 24 }, (_, i) => `${i}:00`)}
                        series={result.clusters.map((cluster: any, index: number) => ({
                          name: cluster.label_zh,
                          data: cluster.intraday_profile,
                          color: CLUSTER_PALETTE[index % CLUSTER_PALETTE.length],
                        }))}
                      />
                    </Card>
                    <Card size="small" title="周内差异">
                      <LineChart
                        height={200}
                        x={['周一', '周二', '周三', '周四', '周五', '周六', '周日']}
                        series={result.clusters.map((cluster: any, index: number) => ({
                          name: cluster.label_zh,
                          data: cluster.weekly_profile,
                          color: CLUSTER_PALETTE[index % CLUSTER_PALETTE.length],
                        }))}
                      />
                    </Card>
                    <div className="tn-muted">
                      峰值时段与谷值由真实日内均值计算；图例使用真实簇编号与区域数，不使用示意数据。
                    </div>
                  </div>
                ) : (
                  <EmptyState text="尚无聚类结果。" />
                ),
              },
              {
                key: 'quality',
                label: 'Quality Evaluation',
                children: result ? (
                  <div className="tn-stack">
                    <Card size="small" title="质量指标（合法条件下计算，否则 N/A）">
                      <div className="tn-muted">
                        <div>Silhouette：{result.metrics?.silhouette === null || result.metrics?.silhouette === undefined ? 'N/A' : Number(result.metrics.silhouette).toFixed(4)}</div>
                        <div>Davies-Bouldin：{result.metrics?.davies_bouldin === null || result.metrics?.davies_bouldin === undefined ? 'N/A' : Number(result.metrics.davies_bouldin).toFixed(4)}</div>
                        <div>Calinski-Harabasz：{result.metrics?.calinski_harabasz === null || result.metrics?.calinski_harabasz === undefined ? 'N/A' : Number(result.metrics.calinski_harabasz).toFixed(2)}</div>
                        <div>噪声点：{result.metrics?.noise_points ?? 0}</div>
                      </div>
                      {(result.metrics?.notes ?? []).map((note: string) => (
                        <div className="tn-muted" key={note}>
                          · {note}
                        </div>
                      ))}
                    </Card>
                    <Card size="small" title="算法细节（真实运行参数）">
                      <pre className="tn-code">{JSON.stringify(result.algorithm_detail, null, 2)}</pre>
                    </Card>
                  </div>
                ) : (
                  <EmptyState text="尚无聚类结果。" />
                ),
              },
              {
                key: 'regions',
                label: 'Region List',
                children: result ? (
                  <Table
                    size="small"
                    rowKey="region_id"
                    pagination={{ pageSize: 12, size: 'small' }}
                    dataSource={result.regions}
                    onRow={(record: any) => ({ onClick: () => setSelectedRegion(record.region_id) })}
                    columns={[
                      { title: 'Region', dataIndex: 'region_id', sorter: (a: any, b: any) => String(a.region_id).localeCompare(String(b.region_id)) },
                      {
                        title: 'Cluster',
                        dataIndex: 'cluster_id',
                        sorter: (a: any, b: any) => a.cluster_id - b.cluster_id,
                        render: (value: number) => (value === -1 ? <Tag>噪声</Tag> : <Tag color="blue">{value}</Tag>),
                      },
                      {
                        title: result.feature_names[0],
                        render: (_: unknown, record: any) => Number(record.features[result.feature_names[0]]).toFixed(3),
                        sorter: (a: any, b: any) => a.features[result.feature_names[0]] - b.features[result.feature_names[0]],
                      },
                      {
                        title: result.feature_names[1] ?? '—',
                        render: (_: unknown, record: any) =>
                          result.feature_names[1] ? Number(record.features[result.feature_names[1]]).toFixed(3) : '—',
                      },
                      {
                        title: '定位',
                        render: (_: unknown, record: any) => (
                          <Tooltip title="在地图上高亮">
                            <Button size="small" onClick={() => setSelectedRegion(record.region_id)}>Locate</Button>
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
