import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Segmented, Select, Tabs, Tag, Tooltip, message } from 'antd'
import { ENDPOINTS, ApiError, api, type Issue } from '../api/client'
import { ModuleHeader, PaneHead, ThreePane, EmptyState } from '../components/Panes'
import ParamField from '../components/ParamField'
import MapView, { BLUE_PALETTE, colorScale, type MapEntry } from '../components/MapView'
import { BarChart, LineChart } from '../components/Charts'
import { useGroupValidation } from '../validation/useValidation'
import { fieldDisabledReason, visibleFields, type FieldSpec } from '../validation/engine'

interface SourcesPayload {
  sources: Array<{ key: string; source_id: string; display_name: string; unit_label: string; native_frequency: string; series_region_count: number; gis_region_count: number }>
  totals: { sources: number; series_regions: number; gis_regions: number; no_data_regions: number }
}

const FREQUENCIES = [
  { value: 'native', label: '原生频率' },
  { value: '30min', label: '30 分钟' },
  { value: '60min', label: '1 小时' },
  { value: '1day', label: '1 天' },
]

export default function Exploration() {
  const [sources, setSources] = useState<SourcesPayload['sources']>([])
  const [config, setConfig] = useState<Record<string, unknown>>({
    source_key: 'milano',
    region_ids: [],
    frequency: 'native',
    aggregation: 'mean',
    max_regions: 6,
    start_index: 0,
    window_points: 288,
  })
  const [regions, setRegions] = useState<Array<{ region_id: string; display_name: string; has_timeseries: boolean }>>([])
  const [geojson, setGeojson] = useState<any>(null)
  const [spatialIndex, setSpatialIndex] = useState<number>(0)
  const [temporal, setTemporal] = useState<any>(null)
  const [spatial, setSpatial] = useState<any>(null)
  const [compare, setCompare] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [serverIssues, setServerIssues] = useState<Issue[]>([])
  const [tab, setTab] = useState('temporal')
  const [messageApi, contextHolder] = message.useMessage()

  const schema: FieldSpec[] = useMemo(
    () => [
      { key: 'source_key', label_zh: '数据源', type: 'enum', enum: ['milano', 'trentino', 'zte'], help_zh: '选择要分析的一个地点数据集。', suggestion_zh: '三个来源单位不同，不能直接比较绝对值。', default: 'milano' },
      { key: 'region_ids', label_zh: '区域（可多选对比）', type: 'array', enum: regions.map((r) => r.region_id), enum_labels: regions.map((r) => `${r.region_id}${r.has_timeseries ? '' : ' (No Data)'}`), default: [], required: false, help_zh: '在地图上点选区域；No Data 区域没有时序数据。', suggestion_zh: '最多可选 6 个区域用于对比。' },
      { key: 'frequency', label_zh: '时间分辨率', type: 'enum', enum: ['native', '30min', '60min', '1day'], enum_labels: FREQUENCIES.map((f) => f.label), default: 'native', help_zh: '必须是原生频率的整数倍。', suggestion_zh: '探索分析建议先用原生频率。' },
      { key: 'aggregation', label_zh: '聚合方式', type: 'enum', enum: ['mean', 'sum'], enum_labels: ['均值 mean', '求和 sum'], default: 'mean', help_zh: 'sum 为桶内求和，mean 为桶内平均；源单位未确认，不代表物理总量。', suggestion_zh: '原生频率下该参数无影响。' },
      { key: 'start_index', label_zh: '起始时间点', type: 'integer', min: 0, default: 0, help_zh: '分析窗口起点（按重采样后的点数计）。', suggestion_zh: '0 表示从最早时间点开始。' },
      { key: 'window_points', label_zh: '窗口点数', type: 'integer', min: 8, max: 100000, default: 288, help_zh: '分析窗口包含的时间点数。', suggestion_zh: '10 分钟频率下 144 点约为一天。' },
      { key: 'max_regions', label_zh: '最多对比区域数', type: 'integer', min: 1, max: 12, default: 6, level: 'advanced', help_zh: '多区域对比上限，避免图表过载。', suggestion_zh: '默认 6。' },
    ],
    [regions],
  )

  const { fieldIssues, errors, warnings, valid } = useGroupValidation({
    specs: schema,
    values: config,
    pathPrefix: 'm1',
    remote: { kind: 'm1', values: config, context: { available_regions: regions.map((r) => r.region_id) } },
  })

  const loadSources = useCallback(() => {
    api
      .get<SourcesPayload>(ENDPOINTS.sources)
      .then((data) => setSources(data.sources))
      .catch((err) => messageApi.error(`数据源读取失败：${err.message}`))
  }, [messageApi])

  useEffect(loadSources, [loadSources])

  useEffect(() => {
    const key = config.source_key as string
    if (!key) return
    api
      .get<any>(ENDPOINTS.regions(key))
      .then((data) => {
        setRegions(data.regions)
        setGeojson(null)
        api.get<any>(ENDPOINTS.geometry(key)).then(setGeojson)
        setConfig((prev) => (prev.region_ids as string[]).length ? prev : { ...prev, region_ids: [data.valid_region_ids?.[0] ?? data.regions[0]?.region_id] })
        setSpatialIndex(0)
      })
      .catch(() => undefined)
  }, [config.source_key])

  useEffect(() => {
    if (!spatial?.regions?.length) return
    setConfig((prev) => ({ ...prev, start_index: spatial.time_index }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spatial?.time_index])

  const runAnalysis = async () => {
    if (!valid) {
      messageApi.error('存在未修正的参数错误，请先查看输入框下方的提示。')
      return
    }
    setLoading(true)
    setServerIssues([])
    try {
      const [temporalResult, spatialResult] = await Promise.all([
        api.post<any>(ENDPOINTS.temporal, config),
        api.post<any>(ENDPOINTS.spatial, { ...config, time_index: spatialIndex }),
      ])
      setTemporal(temporalResult)
      setSpatial(spatialResult)
      api
        .post<any>(ENDPOINTS.compare, { source_keys: ['milano', 'trentino', 'zte'], frequency: '60min', aggregation: 'mean' })
        .then(setCompare)
        .catch(() => setCompare(null))
    } catch (err) {
      if (err instanceof ApiError) {
        setServerIssues(err.issues)
        messageApi.error(`请求被后端拒绝：${err.message}`)
      } else {
        messageApi.error(String(err))
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (config.source_key && config.region_ids) runAnalysis()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.source_key, config.frequency, config.aggregation, config.window_points, spatialIndex])

  const selected = (config.region_ids as string[]) ?? []
  const toggleRegion = (regionId: string) => {
    const region = regions.find((r) => r.region_id === regionId)
    if (region && !region.has_timeseries) {
      messageApi.warning(`区域 ${regionId} 没有时序数据（No Data），无法用于分析。`)
      return
    }
    setConfig((prev) => {
      const current = (prev.region_ids as string[]) ?? []
      const max = Number(prev.max_regions ?? 6)
      if (current.includes(regionId)) return { ...prev, region_ids: current.filter((r) => r !== regionId) }
      if (current.length >= max) {
        messageApi.warning(`最多对比 ${max} 个区域（可在 Advanced 中调整上限）。`)
        return prev
      }
      return { ...prev, region_ids: [...current, regionId] }
    })
  }

  const spatialValues: MapEntry[] = useMemo(() => {
    if (!spatial) return []
    return spatial.regions.map((item: any) => ({
      region_id: item.region_id,
      value: item.value,
      has_timeseries: true,
    }))
  }, [spatial])

  const bounds = useMemo(() => {
    const values = spatialValues.map((v) => v.value).filter((v): v is number => v !== null)
    if (!values.length) return { min: 0, max: 1 }
    return { min: Math.min(...values), max: Math.max(...values) }
  }, [spatialValues])

  const source = sources.find((s) => s.key === config.source_key)
  const notes = temporal?.notes ?? []

  return (
    <div>
      {contextHolder}
      <ModuleHeader
        module="Module 1"
        title="Exploratory Traffic Analysis"
        description="GIS 区域、时序、空间与跨地点模式分析（真实数据，无模拟统计）"
        datasetInfo={source ? `${source.display_name} · ${source.unit_label} · ${source.native_frequency}` : ''}
      />
      {errors.length > 0 ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 10 }}
          message={`${errors.length} 个参数错误（已标注在对应输入框下方）`}
          description={errors.slice(0, 3).map((e) => `${e.path}: ${e.message}`).join('；')}
        />
      ) : null}
      {serverIssues.length > 0 ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 10 }}
          message="后端拒绝了本次请求（结构化字段错误）"
          description={serverIssues.map((i) => `${i.path}: ${i.message}`).join('；')}
        />
      ) : null}
      <ThreePane
        config={
          <>
            <PaneHead
              title="Configuration"
              extra={
                <Button
                  size="small"
                  onClick={() => {
                    setConfig({
                      source_key: 'milano',
                      region_ids: [],
                      frequency: 'native',
                      aggregation: 'mean',
                      max_regions: 6,
                      start_index: 0,
                      window_points: 288,
                    })
                    setSpatialIndex(0)
                  }}
                >
                  Reset 配置
                </Button>
              }
            />
            {visibleFields(schema, config).map((spec) => (
              <ParamField
                key={spec.key}
                spec={spec}
                value={config[spec.key]}
                issues={fieldIssues(spec.key)}
                path={`m1.${spec.key}`}
                onChange={(key, value) => setConfig((prev) => ({ ...prev, [key]: value }))}
                disabledReason={fieldDisabledReason(spec, config)}
                compact
              />
            ))}
            <div className="tn-muted">
              当前已选 {selected.length} 个区域；在地图上点击区域可加入 / 取消对比。
            </div>
            <Button type="primary" block onClick={runAnalysis} loading={loading} style={{ marginTop: 10 }} disabled={!valid}>
              运行分析
            </Button>
            <Button block onClick={() => setConfig((prev) => ({ ...prev, region_ids: [] }))} style={{ marginTop: 6 }}>
              清空区域选择
            </Button>
            {warnings.map((w) => (
              <div className="tn-warning-text" key={w.path + w.code}>
                ⚠ {w.message}
              </div>
            ))}
          </>
        }
        visual={
          <>
            <PaneHead
              title="GIS & Temporal Visualization"
              extra={
                <span className="tn-muted">
                  {spatial?.time_at ? `空间截面：${spatial.time_at}` : '加载中'}
                </span>
              }
            />
            <MapView
              geojson={geojson}
              entries={spatialValues}
              selected={selected}
              onToggle={toggleRegion}
              colorFor={(entry) => colorScale(entry?.value ?? null, bounds.min, bounds.max, BLUE_PALETTE)}
              formatTooltip={(entry, regionId) =>
                `${entry?.label ?? regionId}: ${entry?.value === null || entry?.value === undefined ? 'No Data' : entry.value.toFixed(2)}${source ? ` (${source.unit_label})` : ''}`
              }
              legend={
                <>
                  <span>低</span>
                  {BLUE_PALETTE.map((color) => (
                    <span key={color} className="tn-legend-swatch" style={{ background: color }} />
                  ))}
                  <span>高</span>
                  <span className="tn-legend-swatch" style={{ background: '#c9d3e2' }} />
                  <span>No Data</span>
                  <span>· 点击区域加入对比；点击地图空白处取消高亮</span>
                </>
              }
            />
            <div className="tn-inline" style={{ marginTop: 8 }}>
              <span className="tn-muted">时间截面位置</span>
              <input
                type="range"
                min={0}
                max={Math.max(0, (spatial?.regions ? (temporal?.window?.stop_index ?? 1) - 1 : 1))}
                value={spatialIndex}
                onChange={(event) => setSpatialIndex(Number(event.target.value))}
                style={{ flex: 1 }}
                aria-label="时间截面位置"
              />
              <span className="tn-muted">
                index {spatialIndex} / {(temporal?.window?.stop_index ?? 1) - 1}
              </span>
            </div>
            <Card size="small" title="多区域时序曲线（真实观测）" style={{ marginTop: 10 }}>
              <LineChart
                loading={loading && !temporal}
                empty={!temporal}
                height={240}
                yName={source?.unit_label}
                x={temporal?.series?.[0]?.timestamps ?? []}
                series={(temporal?.series ?? []).map((item: any, index: number) => ({
                  name: item.region_id,
                  data: item.values,
                  color: BLUE_PALETTE[index % BLUE_PALETTE.length],
                }))}
              />
            </Card>
          </>
        }
        info={
          <Tabs
            className="tn-tabs-tight"
            activeKey={tab}
            onChange={setTab}
            items={[
              {
                key: 'temporal',
                label: 'Temporal Analysis',
                children: (
                  <div className="tn-stack">
                    <Card size="small" title="统计摘要（真实计算）">
                      {temporal?.statistics?.length ? (
                        <table style={{ width: '100%', fontSize: 11.5 }}>
                          <thead>
                            <tr style={{ color: '#5b7095', textAlign: 'left' }}>
                              <th>区域</th>
                              <th>均值</th>
                              <th>峰值</th>
                              <th>P95</th>
                              <th>CV</th>
                              <th>零值</th>
                            </tr>
                          </thead>
                          <tbody>
                            {temporal.statistics.map((row: any) => (
                              <tr key={row.region_id} style={{ borderTop: '1px dashed #e3ebf6' }}>
                                <td>{row.region_id}</td>
                                <td>{row.mean?.toFixed(2) ?? '—'}</td>
                                <td>{row.max?.toFixed(2) ?? '—'}</td>
                                <td>{row.p95?.toFixed(2) ?? '—'}</td>
                                <td>{row.cv?.toFixed(3) ?? '—'}</td>
                                <td>{row.zero_points}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <EmptyState text="选择一个区域后显示真实统计量。" />
                      )}
                    </Card>
                    <Card size="small" title="日内小时画像">
                      <LineChart
                        height={200}
                        x={Array.from({ length: 24 }, (_, i) => `${i}:00`)}
                        series={(temporal?.intraday_profiles ?? []).map((profile: any, index: number) => ({
                          name: profile.region_id,
                          data: profile.hourly_mean,
                          color: BLUE_PALETTE[index % BLUE_PALETTE.length],
                        }))}
                        empty={!temporal?.intraday_profiles?.length}
                      />
                    </Card>
                    <Card size="small" title="周内模式与工作日/周末">
                      {(temporal?.weekly_profiles ?? []).map((profile: any) => (
                        <div key={profile.region_id} className="tn-muted">
                          {profile.region_id}：工作日均值 {profile.weekday_mean?.toFixed(2) ?? '—'}，周末均值{' '}
                          {profile.weekend_mean?.toFixed(2) ?? '—'}，比值 {profile.weekday_weekend_ratio?.toFixed(3) ?? '—'}
                        </div>
                      ))}
                      <LineChart
                        height={190}
                        x={['周一', '周二', '周三', '周四', '周五', '周六', '周日']}
                        series={(temporal?.weekly_profiles ?? []).map((profile: any, index: number) => ({
                          name: profile.region_id,
                          data: profile.weekly_mean,
                          color: BLUE_PALETTE[index % BLUE_PALETTE.length],
                        }))}
                        empty={!temporal?.weekly_profiles?.length}
                      />
                    </Card>
                    <Card size="small" title="自相关 ACF 与趋势（实际算法支持）">
                      <LineChart
                        height={180}
                        x={(temporal?.acf?.lags ?? []).map((lag: number) => String(lag))}
                        series={[{ name: 'ACF', data: temporal?.acf?.values ?? [] }]}
                        empty={!temporal?.acf?.lags?.length}
                      />
                      <div className="tn-muted">
                        {temporal?.acf?.note ?? `线性趋势斜率 ${temporal?.trend?.slope?.toFixed(4) ?? '—'}（每点变化量）`}
                      </div>
                    </Card>
                    {notes.map((line: string) => (
                      <div className="tn-muted" key={line}>
                        · {line}
                      </div>
                    ))}
                  </div>
                ),
              },
              {
                key: 'spatial',
                label: 'Spatial Analysis',
                children: (
                  <div className="tn-stack">
                    <Card size="small" title={`当前时间截面空间强度（${spatial?.time_at ?? '—'}）`}>
                      <div className="tn-muted">
                        有效区域 {spatial?.summary?.regions_with_value ?? 0} · 缺失{' '}
                        {spatial?.summary?.regions_missing ?? 0} · 均值 {spatial?.summary?.mean?.toFixed(2) ?? '—'} · 标准差{' '}
                        {spatial?.summary?.std?.toFixed(2) ?? '—'}
                      </div>
                      <BarChart
                        horizontal
                        height={300}
                        categories={(spatial?.ranking ?? []).slice(0, 12).map((item: any) => item.region_id)}
                        values={(spatial?.ranking ?? []).slice(0, 12).map((item: any) => item.value)}
                      />
                    </Card>
                    <Card size="small" title="区域差异分布">
                      <BarChart
                        height={200}
                        categories={(spatial?.summary?.distribution ?? []).map(
                          (bin: any) => `${bin.bin_start.toFixed(0)}~${bin.bin_end.toFixed(0)}`,
                        )}
                        values={(spatial?.summary?.distribution ?? []).map((bin: any) => bin.count)}
                        color="#12A67A"
                      />
                    </Card>
                    <Card size="small" title="最低区域（同截面）">
                      {(spatial?.bottom ?? []).slice(0, 6).map((item: any) => (
                        <div key={item.region_id} className="tn-muted">
                          {item.region_id}: {item.value?.toFixed(2)}
                        </div>
                      ))}
                    </Card>
                  </div>
                ),
              },
              {
                key: 'multi',
                label: 'Multi-City Comparison',
                children: (
                  <div className="tn-stack">
                    {(compare?.disclaimers ?? []).map((line: string) => (
                      <Alert key={line} type="warning" showIcon message={line} />
                    ))}
                    <Card size="small" title="归一化形状比较（z-score，禁用原始值同量纲比较）">
                      <LineChart
                        height={220}
                        x={Array.from({ length: 24 }, (_, i) => `${i}:00`)}
                        series={(compare?.sources ?? []).map((item: any) => ({
                          name: item.display_name,
                          data: item.hourly_shape,
                        }))}
                        empty={!compare?.sources?.length}
                      />
                      <div className="tn-muted">
                        归一化方式：{compare?.normalisation ?? 'z-score'}
                      </div>
                    </Card>
                    {(compare?.sources ?? []).map((item: any) => (
                      <Card size="small" key={item.source_key} title={item.display_name}>
                        <div className="tn-muted">
                          单位：{item.unit_label}
                          <br />
                          观测时段：{item.time_start} → {item.time_end}（{item.points} 点 @ {item.native_frequency_minutes} 分钟）
                          <br />
                          变异系数 CV：{item.cv?.toFixed(3) ?? '—'}
                        </div>
                        <Tooltip title="不同来源的时间范围不重叠，只能比较归一化形状">
                          <Tag color="orange">时间与单位免责声明</Tag>
                        </Tooltip>
                      </Card>
                    ))}
                  </div>
                ),
              },
            ]}
          />
        }
      />
    </div>
  )
}
