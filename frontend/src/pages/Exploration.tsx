import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, Button, Card, Collapse, DatePicker, Modal, Select, Switch, Table, Tabs, Tag, message,
} from 'antd'
import dayjs, { Dayjs } from 'dayjs'
import { ENDPOINTS, ApiError, api, type Issue } from '../api/client'
import { EmptyState, ModuleHeader, PaneHead, ThreePane } from '../components/Panes'
import ParamField from '../components/ParamField'
import MapView, { BLUE_PALETTE, colorScale, type MapEntry } from '../components/MapView'
import {
  AcfChart, HistogramChart, HorizontalRankChart, HourlyChart, LineChart, MultiCityZChart, WeekdayChart,
} from '../components/Charts'
import InsightCard, { type InsightPayload } from '../components/InsightCard'
import HelpTip from '../components/HelpTip'
import BiLabel from '../components/BiLabel'
import { useGroupValidation } from '../validation/useValidation'
import { fieldDisabledReason, visibleFields, type FieldSpec } from '../validation/engine'
import {
  ACTION_LABELS, MODULE_META, bilingual, localizeSourceNames, regionDisplayLabel,
  sourceDisplayName, unitDisplayLabel,
} from '../i18n/terms'

interface SourceRow {
  key: string
  source_id: string
  display_name: string
  unit_label: string
  native_frequency: string
  native_frequency_minutes: number
  series_region_count: number
  gis_region_count: number
  time_start?: string
  time_end?: string
}

interface RegionRow {
  region_id: string
  display_name: string
  has_timeseries: boolean
}

interface M1Config {
  source_key: string
  region_ids: string[]
  frequency: string
  aggregation: 'mean' | 'sum'
  time_start: string | null
  time_end: string | null
  start_index: number
  window_points: number
  acf_max_lag: number
  day_start_hour: number
  day_end_hour: number
  max_regions: number
  insight_region_id: string | null
}

const DEFAULT_CONFIG: M1Config = {
  source_key: 'milano',
  region_ids: [],
  frequency: 'native',
  aggregation: 'mean',
  time_start: null,
  time_end: null,
  start_index: 0,
  window_points: 1008,
  acf_max_lag: 0,
  day_start_hour: 6,
  day_end_hour: 18,
  max_regions: 12,
  insight_region_id: null,
}

function DateField({
  id,
  label,
  value,
  issues,
  onChange,
  disabledDate,
  help,
}: {
  id: string
  label: string
  value: string | null
  issues: Issue[]
  onChange: (value: string | null) => void
  disabledDate: (current: Dayjs) => boolean
  help: string
}) {
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')
  const inputId = `field-${id}`
  return (
    <div className={`tn-field${errors.length ? ' has-error' : ''}${!errors.length && warnings.length ? ' has-warning' : ''}`} data-field={id}>
      <label className="tn-field-label" htmlFor={inputId}>
        {label}
        <HelpTip title={help} detail="格式 YYYY-MM-DD HH:mm:ss · 含边界" label={label} />
      </label>
      <DatePicker
        id={inputId}
        showTime={{ format: 'HH:mm' }}
        format="YYYY-MM-DD HH:mm"
        style={{ width: '100%' }}
        size="small"
        value={value ? dayjs(value) : null}
        disabledDate={disabledDate}
        status={errors.length ? 'error' : warnings.length ? 'warning' : undefined}
        aria-invalid={errors.length > 0}
        aria-describedby={errors.length ? `${inputId}-error` : undefined}
        onChange={(next: Dayjs | null) => onChange(next ? next.format('YYYY-MM-DD HH:mm:ss') : null)}
      />
      {errors.map((item) => (
        <div className="tn-error-text" id={`${inputId}-error`} key={item.code + item.path} role="alert">
          <span aria-hidden="true">✕</span>
          <span>
            {item.message}
            {item.suggestion ? <div>{item.suggestion}</div> : null}
          </span>
        </div>
      ))}
      {warnings.map((item) => (
        <div className="tn-warning-text" key={item.code + item.path}>
          <span aria-hidden="true">⚠</span>
          <span>{item.message}</span>
        </div>
      ))}
    </div>
  )
}

function formatSpan(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '—'
  const minutes = seconds / 60
  if (minutes < 90) return `${minutes.toFixed(0)} 分钟`
  const hours = minutes / 60
  if (hours < 36) return `${hours.toFixed(1)} 小时`
  return `${(hours / 24).toFixed(1)} 天`
}

function ChartMeta({ range, validPoints }: { range: any; validPoints: number | null | undefined }) {
  if (!range) return null
  return (
    <div className="tn-muted" style={{ marginBottom: 4 }}>
      范围 {range.start_at} → {range.end_at} · {range.points} 个时间点 · 有效样本 {validPoints ?? '—'} · 间隔{' '}
      {range.interval_minutes} 分钟
    </div>
  )
}

export default function Exploration() {
  const [messageApi, contextHolder] = message.useMessage()
  const [sources, setSources] = useState<SourceRow[]>([])
  const [regions, setRegions] = useState<RegionRow[]>([])
  const [sourceMeta, setSourceMeta] = useState<any>(null)
  const [geojson, setGeojson] = useState<any>(null)
  const [config, setConfig] = useState<M1Config>({ ...DEFAULT_CONFIG })
  const [lastEdit, setLastEdit] = useState<'date' | 'index'>('date')
  const [result, setResult] = useState<any>(null)
  const [spatial, setSpatial] = useState<any>(null)
  const [sliceIndex, setSliceIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [autoLag, setAutoLag] = useState(true)
  const [errorIssues, setErrorIssues] = useState<Issue[]>([])
  const [computedKey, setComputedKey] = useState<string | null>(null)
  const [tab, setTab] = useState('temporal')
  const [expanded, setExpanded] = useState<null | 'hourly' | 'weekday' | 'acf'>(null)
  const [expandedSpatial, setExpandedSpatial] = useState<null | 'top' | 'bottom' | 'dist'>(null)
  const [focusRegion, setFocusRegion] = useState<string | null>(null)
  const [showLabels, setShowLabels] = useState(true)
  const requestSeq = useRef(0)

  const schema: FieldSpec[] = useMemo(
    () => [
      {
        key: 'source_key', label_zh: '数据源', type: 'enum', enum: ['milano', 'trentino', 'zte'],
        enum_labels: sources.map((s) => `${sourceDisplayName(s.key, s.display_name)}（${s.native_frequency}）`),
        default: 'milano', help_zh: '选择要分析的一个数据源。',
        suggestion_zh: '三个来源单位不同，不能直接比较绝对数值。',
      },
      {
        key: 'region_ids', label_zh: '区域（可多选对比）', type: 'array',
        enum: regions.map((r) => r.region_id),
        enum_labels: regions.map((r) =>
          `${regionDisplayLabel(r.region_id, r.display_name)}${r.has_timeseries ? '' : '（无数据）'}`,
        ),
        default: [], required: false,
        help_zh: '在地图上点选区域，或用下拉框搜索；最多可同时选择 12 个区域。',
        suggestion_zh: '无数据区域没有时序数据，不能用于分析。',
      },
      {
        key: 'start_index', label_zh: '起始索引（高级）', type: 'integer', min: 0, default: 0,
        help_zh: '按重采样后的时间点数计算的起点，与上方日期时间双向同步。',
        suggestion_zh: '普通使用直接选日期时间即可。',
      },
      {
        key: 'window_points', label_zh: '窗口点数（高级）', type: 'integer', min: 2, max: 200000,
        default: 1008,
        help_zh: '从起始索引开始的连续点数。10 分钟频率下 1008 点＝7 天；15 分钟频率下 1008 点＝10.5 天。',
        suggestion_zh: '通常直接用日期时间范围更方便。',
      },
      {
        key: 'acf_max_lag', label_zh: '最大滞后步数', type: 'integer', min: 0, max: 5000,
        default: 0,
        help_zh: '自相关最多算到第几个滞后步；0 表示自动。滞后步数是同一序列内部“向后错几步”，' +
                 '不是只使用这么多时间点。10 分钟频率：Lag 6=1 小时、Lag 144=24 小时、Lag 1008=7 天；' +
                 '15 分钟频率：Lag 4=1 小时、Lag 96=24 小时、Lag 672=7 天。',
        suggestion_zh: '看日周期至少覆盖 24 小时；看周周期需要覆盖 7 天且至少两周观测。',
      },
      {
        key: 'day_start_hour', label_zh: '白天起始小时', type: 'integer', min: 0, max: 23, default: 6,
        help_zh: '昼夜对比中“白天”的起始小时。', suggestion_zh: '默认 06:00。',
      },
      {
        key: 'day_end_hour', label_zh: '白天结束小时', type: 'integer', min: 1, max: 24, default: 18,
        help_zh: '昼夜对比中“白天”的结束小时（不含该小时）。', suggestion_zh: '默认到 18:00 结束。',
      },
    ],
    [sources, regions],
  )

  const validationValues = useMemo(
    () => ({
      ...config,
      // In index mode the dates are cleared so the server resolves from indices;
      // in date mode both are present and the dates take precedence. Keeping the
      // index fields populated avoids phantom "required" errors while the
      // Advanced section is collapsed.
      time_start: lastEdit === 'date' ? config.time_start : null,
      time_end: lastEdit === 'date' ? config.time_end : null,
    }),
    [config, lastEdit],
  )

  const { fieldIssues, errors, warnings, valid } = useGroupValidation({
    specs: schema,
    values: validationValues as any,
    pathPrefix: 'm1',
    remote: {
      kind: 'm1',
      values: validationValues,
      context: { available_regions: regions.map((r) => r.region_id) },
    },
  })

  const requestPayload = useMemo(() => {
    const base = {
      source_key: config.source_key,
      region_ids: config.region_ids,
      frequency: config.frequency,
      aggregation: config.aggregation,
      acf_max_lag: config.acf_max_lag,
      day_start_hour: config.day_start_hour,
      day_end_hour: config.day_end_hour,
      max_regions: config.max_regions,
      insight_region_id: config.insight_region_id,
    }
    return lastEdit === 'date'
      ? { ...base, time_start: config.time_start, time_end: config.time_end }
      : { ...base, start_index: config.start_index, window_points: config.window_points }
  }, [config, lastEdit])

  const requestKey = useMemo(() => JSON.stringify(requestPayload), [requestPayload])
  const stale = computedKey !== null && computedKey !== requestKey

  const loadSources = useCallback(() => {
    api
      .get<any>(ENDPOINTS.sources)
      .then((data) => setSources(data.sources))
      .catch((err) => messageApi.error(`数据源读取失败：${err.message}`))
  }, [messageApi])

  useEffect(loadSources, [loadSources])

  useEffect(() => {
    const key = config.source_key
    if (!key) return
    api
      .get<any>(ENDPOINTS.regions(key))
      .then((data) => {
        setRegions(data.regions)
        setSourceMeta(data.source)
        const firstValid = data.valid_region_ids?.[0] ?? data.regions.find((r: RegionRow) => r.has_timeseries)?.region_id
        setConfig((prev) => {
          const keep = prev.region_ids.filter((id) => data.regions.some((r: RegionRow) => r.region_id === id))
          const regionIds = keep.length ? keep : firstValid ? [firstValid] : []
          const start = data.source?.time_start ? dayjs(data.source.time_start) : null
          const end = data.source?.time_end ? dayjs(data.source.time_end) : null
          return {
            ...prev,
            frequency: 'native',
            aggregation: 'mean',
            region_ids: regionIds,
            insight_region_id: regionIds[0] ?? null,
            // The default analysis range is the source's complete valid range.
            time_start: start ? start.format('YYYY-MM-DD HH:mm:ss') : null,
            time_end: end ? end.format('YYYY-MM-DD HH:mm:ss') : null,
          }
        })
        setGeojson(null)
        api.get<any>(ENDPOINTS.geometry(key)).then(setGeojson).catch(() => undefined)
      })
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.source_key])

  const runAnalysis = useCallback(
    async (force = false) => {
      if (!config.region_ids.length) return
      if (!valid) {
        messageApi.error('存在参数错误，请先修正字段下方提示的问题。')
        return
      }
      const payload = requestPayload
      const key = JSON.stringify(payload)
      const seq = ++requestSeq.current
      setLoading(true)
      setErrorIssues([])
      try {
        // Resolve the range first, then clamp the map slice into it so the map
        // can never show an instant outside the Analysis Time Range.
        const temporal = await api.post<any>(ENDPOINTS.temporal, payload)
        if (seq !== requestSeq.current) return // ignore stale responses
        const clampedSlice = Math.min(
          Math.max(sliceIndex, temporal.range.start_index),
          Math.max(temporal.range.start_index, temporal.range.end_index - 1),
        )
        const spatialData = await api.post<any>(ENDPOINTS.spatial, {
          ...payload,
          time_index: clampedSlice,
        })
        if (seq !== requestSeq.current) return
        setResult(temporal)
        setSpatial(spatialData)
        setSliceIndex(clampedSlice)
        setComputedKey(key)
        const range = temporal.range
        if (lastEdit === 'date') {
          setConfig((prev) => ({
            ...prev,
            start_index: range.start_index,
            window_points: range.points,
          }))
        } else {
          setConfig((prev) => ({
            ...prev,
            time_start: range.start_at,
            time_end: range.end_at,
          }))
        }
      } catch (err) {
        if (seq !== requestSeq.current) return
        if (err instanceof ApiError) {
          setErrorIssues(err.issues)
          messageApi.error(`分析被拒绝：${err.message}`)
        } else {
          messageApi.error(String(err))
        }
      } finally {
        if (seq === requestSeq.current) setLoading(false)
      }
    },
    [config.region_ids.length, messageApi, requestPayload, sliceIndex, lastEdit, valid],
  )

  useEffect(() => {
    if (!config.region_ids.length) return
    // Wait for validation to settle. A transient stale remote error must not
    // swallow the automatic recompute permanently (valid is a dependency).
    if (!valid) return
    if (computedKey === requestKey && !loading) return
    const timer = window.setTimeout(() => {
      runAnalysis()
    }, 600)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, config.region_ids.length, valid])

  useEffect(() => {
    if (config.region_ids.length) return
    // No valid target left: never keep showing a previous region's analysis.
    setResult(null)
    setSpatial(null)
    setComputedKey(null)
    setErrorIssues([])
    setSliceIndex(0)
  }, [config.region_ids.length])

  const sliceMin = result?.range?.start_index ?? 0
  const sliceMax = Math.max(sliceMin, (result?.range?.end_index ?? 1) - 1)
  const sliceValue = Math.min(Math.max(sliceIndex, sliceMin), sliceMax)

  useEffect(() => {
    if (!result?.range) return
    setSliceIndex((prev) => Math.min(Math.max(prev, sliceMin), sliceMax))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computedKey, sliceMin, sliceMax])

  // The map slice is deliberately independent from the analysis range: moving it
  // only refetches the spatial snapshot, never the temporal statistics/insights.
  const spatialSeq = useRef(0)
  useEffect(() => {
    if (!computedKey || !config.region_ids.length) return
    const seq = ++spatialSeq.current
    const timer = window.setTimeout(async () => {
      try {
        const payload = { ...JSON.parse(computedKey), time_index: sliceValue }
        const data = await api.post<any>(ENDPOINTS.spatial, payload)
        if (seq === spatialSeq.current) setSpatial(data)
      } catch {
        /* keep the previous snapshot; the analysis itself is unaffected */
      }
    }, 180)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliceValue, computedKey])

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

  const updateConfig = (patch: Partial<M1Config>, edit?: 'date' | 'index') => {
    setConfig((prev) => ({ ...prev, ...patch }))
    if (edit) setLastEdit(edit)
  }

  const toggleRegion = (regionId: string) => {
    const region = regions.find((r) => r.region_id === regionId)
    if (region && !region.has_timeseries) {
      messageApi.warning(`区域 ${regionId} 没有时序数据（无数据），无法用于分析。`)
      return
    }
    setConfig((prev) => {
      const current = prev.region_ids
      if (current.includes(regionId)) {
        const next = current.filter((r) => r !== regionId)
        const keep =
          prev.insight_region_id && next.includes(prev.insight_region_id)
            ? prev.insight_region_id
            : next[0] ?? null
        return { ...prev, region_ids: next, insight_region_id: keep }
      }
        if (current.length >= prev.max_regions) {
        messageApi.warning(`最多同时对比 ${prev.max_regions} 个区域。`)
        return prev
      }
      const next = [...current, regionId]
      return { ...prev, region_ids: next, insight_region_id: prev.insight_region_id ?? regionId }
    })
  }

  const selected = config.region_ids
  const source = sources.find((s) => s.key === config.source_key)
  const range = result?.range
  const primaryId = result?.primary_region_id ?? config.insight_region_id
  const primaryStats = result?.statistics?.find((s: any) => s.region_id === primaryId)
  const primaryHourly = result?.hourly?.find((h: any) => h.region_id === primaryId)
  const primaryWeekday = result?.weekday?.find((w: any) => w.region_id === primaryId)
  const insights = result?.insights

  const spatialValues: MapEntry[] = useMemo(() => {
    if (!spatial) return []
    return spatial.regions.map((item: any) => ({
      region_id: item.region_id,
      value: item.value,
      label: item.region_id,
      has_timeseries: true,
    }))
  }, [spatial])

  const colorBounds = useMemo(() => {
    const values = spatialValues.map((v) => v.value).filter((v): v is number => v !== null)
    if (!values.length) return { min: 0, max: 1 }
    return { min: Math.min(...values), max: Math.max(...values) }
  }, [spatialValues])

  const seriesChart = useMemo(() => {
    if (!result?.series?.length) return { x: [], series: [] as any[] }
    const chartSeries = result.series.map((item: any, index: number) => ({
      name: item.region_id,
      data: item.values,
      color: BLUE_PALETTE[index % BLUE_PALETTE.length],
      width: item.region_id === primaryId ? 2.4 : 1.1,
      opacity: item.region_id === primaryId ? 1 : 0.55,
    }))
    return { x: result.series[0].timestamps, series: chartSeries }
  }, [result, primaryId])

  const hourlyInsight: InsightPayload | null = insights?.hourly ?? null
  const weekdayInsight: InsightPayload | null = insights?.weekday ?? null
  const acfInsight: InsightPayload | null = insights?.acf_trend ?? null
  const summaryInsight: InsightPayload | null = insights?.summary ?? null

  const regionOptions = regions
    .filter((r) => config.region_ids.includes(r.region_id))
    .map((r) => ({ value: r.region_id, label: regionDisplayLabel(r.region_id, r.display_name) }))

  const maxLagSpec = schema.find((s) => s.key === 'acf_max_lag')!
  const acfInfo = result?.acf

  return (
    <div>
      {contextHolder}
      <ModuleHeader
        module={MODULE_META.m1.index}
        titleZh={MODULE_META.m1.titleZh}
        titleEn={MODULE_META.m1.titleEn}
        description="GIS 区域、时序、空间与跨地点模式分析（真实数据，无模拟统计）"
        datasetInfo={
          source
            ? `${sourceDisplayName(source.key, source.display_name)} · ${unitDisplayLabel(source.unit_label)} · 原生 ${source.native_frequency}`
            : ''
        }
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
      {errorIssues.length > 0 ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 10 }}
          message="后端拒绝了本次分析请求（结构化字段错误，未生成任何结果）"
          description={errorIssues.map((i) => `${i.path}: ${i.message}`).join('；')}
        />
      ) : null}
      {stale || loading ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 10 }}
          message={loading ? '正在按当前参数重新计算…' : '参数已修改，等待重新计算'}
          description="为保证图表与自动结论一致，旧结果会先变暗显示；计算完成后会整体替换（不会出现图表已更新而文字仍是旧数据的情况）。"
        />
      ) : null}
      <ThreePane
        variant="m1"
        config={
          <>
            <PaneHead
              title={bilingual('配置', 'Configuration')}
              extra={
                <Button
                  size="small"
                  onClick={() => {
                    const start = bounds.start
                    const end = bounds.end
                    setConfig({
                      ...DEFAULT_CONFIG,
                      source_key: config.source_key,
                      region_ids: selected.length ? selected : config.region_ids,
                      insight_region_id: config.insight_region_id,
                      time_start: start ? start.format('YYYY-MM-DD HH:mm:ss') : null,
                      time_end: end ? end.format('YYYY-MM-DD HH:mm:ss') : null,
                    })
                    setLastEdit('date')
                    setResult(null)
                    setComputedKey(null)
                    setAutoLag(true)
                  }}
                >
                  {ACTION_LABELS.reset}
                </Button>
              }
            />
            {visibleFields(schema, validationValues as any)
              .filter((spec) => ['source_key', 'region_ids'].includes(spec.key))
              .map((spec) => (
                <ParamField
                  key={spec.key}
                  spec={spec}
                  value={(config as any)[spec.key]}
                  issues={fieldIssues(spec.key)}
                  path={`m1.${spec.key}`}
                  onChange={(key, value) => {
                    if (key === 'region_ids') {
                      const next = (value as string[]) ?? []
                      const keep =
                        config.insight_region_id && next.includes(config.insight_region_id)
                          ? config.insight_region_id
                          : next[0] ?? null
                      updateConfig({ region_ids: next, insight_region_id: keep })
                    } else {
                      updateConfig({ [key]: value } as Partial<M1Config>)
                    }
                  }}
                  disabledReason={fieldDisabledReason(spec, config as any)}
                  compact
                />
              ))}
            <div className="tn-muted" style={{ marginTop: 6 }}>
              原生频率：{sourceMeta?.native_frequency_minutes ?? '—'} 分钟 · 使用原始观测值，不做重采样；
              日内小时画像与工作日/周末比较仅按时钟分组统计。
            </div>

            <div className="tn-section-title" style={{ marginTop: 10 }}>
              分析时间范围（Analysis Time Range）
            </div>
            <DateField
              id="m1.time_start"
              label="开始日期时间（含边界）"
              value={config.time_start}
              issues={fieldIssues('time_start')}
              disabledDate={disabledDate}
              help="所有统计、图表与自动结论的起点。与结束时间共同决定使用的真实观测；边界按重采样后的时间桶起点、闭区间处理。"
              onChange={(value) => updateConfig({ time_start: value }, 'date')}
            />
            <DateField
              id="m1.time_end"
              label="结束日期时间（含边界）"
              value={config.time_end}
              issues={fieldIssues('time_end')}
              disabledDate={disabledDate}
              help="分析范围的终点（含该时刻的时间桶）。不能超过数据源的真实结束时间。"
              onChange={(value) => updateConfig({ time_end: value }, 'date')}
            />
            <div className="tn-range-summary">
              <div>
                <strong>数据可用范围：</strong>
                {bounds.start?.format('YYYY-MM-DD HH:mm') ?? '—'} ～ {bounds.end?.format('YYYY-MM-DD HH:mm') ?? '—'}
              </div>
              {range ? (
                <>
                  <div>
                    <strong>实际起点：</strong>
                    {range.start_at ?? '—'}
                  </div>
                  <div>
                    <strong>最后一个观测：</strong>
                    {range.end_at ?? '—'}
                  </div>
                  <div>
                    <strong>时间跨度：</strong>
                    {range.span_label} · <strong>采样间隔：</strong>
                    {range.interval_minutes} 分钟
                  </div>
                  <div>
                    <strong>选中时间点：</strong>
                    {range.points} 个（重采样后） · <strong>有效观测：</strong>
                    {range.valid_points?.[primaryId] ?? 0} 个
                  </div>
                  <div className="tn-muted">
                    边界：{range.boundary}；原始采样间隔 {range.native_interval_minutes} 分钟
                    {range.interval_minutes !== range.native_interval_minutes
                      ? `，重采样后每点代表 ${range.interval_minutes} 分钟`
                      : ''}
                  </div>
                </>
              ) : (
                <div className="tn-muted">选择日期时间后显示实际解析结果。</div>
              )}
            </div>

            <div className="tn-inline" style={{ marginTop: 10 }}>
              <Button type="primary" block onClick={() => runAnalysis(true)} loading={loading} disabled={!valid}>
                {ACTION_LABELS.runAnalysis}
              </Button>
            </div>
            <div className="tn-inline" style={{ marginTop: 6 }}>
              <Button block onClick={() => updateConfig({ region_ids: [], insight_region_id: null })}>
                {ACTION_LABELS.clearRegions}
              </Button>
            </div>
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
              title={bilingual('GIS 与时间可视化', 'GIS & Temporal Visualization')}
              extra={<span className="tn-muted">{spatial?.time_at ? `空间截面：${spatial.time_at}` : '加载中'}</span>}
            />
            <MapView
              geojson={geojson}
              entries={spatialValues}
              selected={selected}
              onToggle={toggleRegion}
              showLabels={showLabels}
              labelFor={(entry, regionId) => entry?.label ?? regionId}
              focus={focusRegion}
              colorFor={(entry) => colorScale(entry?.value ?? null, colorBounds.min, colorBounds.max, BLUE_PALETTE)}
              formatTooltip={(entry, regionId) =>
                `${entry?.label ?? regionId}: ${entry?.value === null || entry?.value === undefined ? '无数据' : entry.value.toFixed(2)}${
                  source ? `（${unitDisplayLabel(source.unit_label)}）` : ''
                }`
              }
              legend={
                <>
                  <span>低</span>
                  {BLUE_PALETTE.map((color) => (
                    <span key={color} className="tn-legend-swatch" style={{ background: color }} />
                  ))}
                  <span>高</span>
                  <span className="tn-legend-swatch" style={{ background: '#c9d3e2' }} />
                  <span>无数据</span>
                  <span>· 点击区域加入对比</span>
                </>
              }
            />
            <div className="tn-inline" style={{ marginTop: 8, justifyContent: 'space-between' }}>
              <span className="tn-inline">
                <Switch size="small" checked={showLabels} onChange={setShowLabels} />
                <span className="tn-muted">在地图上显示区域名称</span>
              </span>
              <span className="tn-muted">地图颜色 = 当前时间截面该区域的真实观测值（越深越大）</span>
            </div>
            <div className="tn-inline" style={{ marginTop: 8 }}>
              <span className="tn-field-label" style={{ marginBottom: 0 }}>
                时间截面（Time Slice）
                <HelpTip
                  title="Time Slice 仅决定 GIS 地图当前展示哪个时间截面的流量，不改变整个 Analysis Time Range 内的统计计算范围。"
                  detail="滑块被限制在当前分析范围内；修改日期范围后若原截面越界，会自动回到范围内的第一个有效时刻。"
                  label="时间截面"
                />
              </span>
              <input
                type="range"
                min={sliceMin}
                max={sliceMax}
                value={sliceValue}
                onChange={(event) => setSliceIndex(Number(event.target.value))}
                style={{ flex: 1 }}
                aria-label="时间截面位置"
              />
              <span className="tn-muted">{spatial?.time_at ?? `时间索引 ${sliceValue}`}</span>
            </div>
            <Card size="small" title="多区域时序曲线（Multi-Region Time Series）" style={{ marginTop: 10 }}>
              <div className={stale ? 'tn-stale' : undefined}>
                <LineChart
                  loading={loading && !result}
                  empty={!result}
                  height={240}
                  yName={source?.unit_label ? `流量（${unitDisplayLabel(source.unit_label)}）` : '流量值'}
                  x={seriesChart.x}
                  series={seriesChart.series}
                />
              </div>
              <div className="tn-muted" style={{ marginTop: 4 }}>
                当前分析对象（{primaryId ?? '—'}）以更粗的曲线显示；其余已选区域保持可见。
              </div>
            </Card>

            <Card size="small" title="多区域统计摘要（Multi-Region Statistical Summary）" style={{ marginTop: 10 }}>
              <div className={stale ? 'tn-stale' : undefined}>
                {result?.statistics?.length ? (
                  <>
                    <div className="tn-muted" style={{ marginBottom: 6 }}>
                      数据源 {sourceDisplayName(source?.key, source?.display_name)} · 参与区域 {result.statistics.length} · 范围 {range?.start_at} →{' '}
                      {range?.end_at} · 每点 {range?.interval_minutes ?? '—'} 分钟 · 有效样本{' '}
                      {Math.min(...result.statistics.map((s: any) => s.valid_points ?? 0))}–
                      {Math.max(...result.statistics.map((s: any) => s.valid_points ?? 0))} · 单位{' '}
                      {unitDisplayLabel(source?.unit_label)}
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', minWidth: 520, fontSize: 11 }}>
                        <thead>
                          <tr style={{ color: '#5b7095', textAlign: 'left' }}>
                            <th style={{ whiteSpace: 'nowrap' }}>区域</th>
                            <th style={{ whiteSpace: 'nowrap' }}>均值</th>
                            <th style={{ whiteSpace: 'nowrap' }}>最大</th>
                            <th style={{ whiteSpace: 'nowrap' }}>最小</th>
                            <th style={{ whiteSpace: 'nowrap' }}>标准差</th>
                            <th style={{ whiteSpace: 'nowrap' }}>
                              <span className="tn-inline">
                                P95
                                <HelpTip label="P95" title="第 95 百分位数（P95）" detail="把有效观测从小到大排序后，95% 的观测不超过该值。" />
                              </span>
                            </th>
                            <th style={{ whiteSpace: 'nowrap' }}>
                              <span className="tn-inline">
                                CV
                                <HelpTip label="CV" title="变异系数（Coefficient of Variation, CV）" detail="标准差除以均值的绝对值，用于比较相对波动程度。" />
                              </span>
                            </th>
                            <th style={{ whiteSpace: 'nowrap' }}>零值</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.statistics.map((row: any) => {
                            const noData = !(row.valid_points > 0)
                            const display = regions.find((r) => r.region_id === row.region_id)?.display_name
                            const cell = (value: any, digits = 2) =>
                              noData ? '无数据' : value === null || value === undefined ? '不适用' : Number(value).toFixed(digits)
                            return (
                              <tr
                                key={row.region_id}
                                style={{
                                  borderTop: '1px dashed #e3ebf6',
                                  background: row.region_id === primaryId ? '#eef5ff' : undefined,
                                }}
                              >
                                <td style={{ whiteSpace: 'nowrap' }}>
                                  <strong>{row.region_id}</strong>
                                  {display && display !== row.region_id ? (
                                    <div className="tn-muted">{display}</div>
                                  ) : null}
                                  <div className="tn-muted">有效点 {row.valid_points}</div>
                                </td>
                                <td>{cell(row.mean)}</td>
                                <td>{cell(row.max)}</td>
                                <td>{cell(row.min)}</td>
                                <td>{cell(row.std)}</td>
                                <td>{cell(row.p95)}</td>
                                <td>{cell(row.cv, 3)}</td>
                                <td>{noData ? '无数据' : row.zero_points}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    <InsightCard title="多区域统计分析（Statistical Summary Insights）" insights={summaryInsight} loading={loading} />
                  </>
                ) : (
                  <EmptyState text="选择区域后显示多区域真实统计量。" />
                )}
              </div>
            </Card>
          </>
        }
        info={
          config.region_ids.length === 0 ? (
            <EmptyState text="请先在左侧选择至少一个有效区域；右侧将显示所选分析对象的时间规律。" />
          ) : (
          <>
            <Tabs
            className="tn-tabs-tight"
            activeKey={tab}
            onChange={setTab}
            items={[
              {
                key: 'temporal',
                label: <BiLabel zh="时间分析" en="Temporal Analysis" />,
                children: (
                  <div className={stale ? 'tn-stale' : undefined}>
                    <div className="tn-analysis-target">
                      <label className="tn-field-label" htmlFor="analysis-target">
                        分析对象
                        <HelpTip
                          title="工作日与周末对比、自相关与趋势的图表和自动结论只针对这一个区域；日内小时画像同时显示左侧已选的全部区域。"
                          detail="切换不会改变左侧选择，也不会改变中央的多区域统计。"
                          label="分析对象"
                        />
                      </label>
                      <Select
                        id="analysis-target"
                        size="small"
                        style={{ width: '100%' }}
                        value={primaryId ?? undefined}
                        options={regionOptions}
                        placeholder="请先在左侧选择区域"
                        disabled={!regionOptions.length}
                        onChange={(value) => updateConfig({ insight_region_id: value })}
                      />
                      <div className="tn-muted" style={{ marginTop: 4 }}>
                        {primaryId
                          ? `${primaryId} · ${sourceDisplayName(source?.key, source?.display_name)} · ${range?.start_at ?? '—'} → ${range?.end_at ?? '—'}`
                          : '当前没有有效区域，请先在左侧选择。'}
                      </div>
                    </div>
                    <div className="tn-stack" style={{ marginTop: 8 }}>{[
                        {
                          key: 'hourly',
                          label: 'Hourly Profile',
                          children: (
                            <div>
                              <Card
                                size="small"
                                title={
                                  <span className="tn-inline" style={{ justifyContent: 'space-between', width: '100%' }}>
                                    日内小时画像（Hourly Profile）
                                    <span className="tn-inline" style={{ gap: 6 }}>
                                      <HelpTip
                                        title="把当前时间范围内所有观测按「一天中的第几小时」分组求平均，得到典型日内模式；这不是某一天的原始曲线。"
                                        detail="某个小时没有有效观测时显示为断点（无数据），不会补 0。"
                                        label="Hourly Profile 方法说明"
                                      />
                                      <Button size="small" type="link" onClick={() => setExpanded('hourly')}>
                                        放大查看
                                      </Button>
                                    </span>
                                  </span>
                                }
                              >
                                <ChartMeta range={range} validPoints={primaryStats?.valid_points} />
                                <HourlyChart
                                  yName={source?.unit_label ? `流量（${unitDisplayLabel(source.unit_label)}）` : '流量值'}
                                  regions={(result?.hourly ?? []).map((h: any) => ({
                                    region_id: h.region_id,
                                    hours: h.hours,
                                  }))}
                                />
                              </Card>
                              <InsightCard
                                title="日内流量规律分析（Hourly Pattern Insights）"
                                insights={hourlyInsight}
                                loading={loading}
                                subtitle={`上方曲线显示全部已选区域；以下结论针对分析对象 ${primaryId ?? '—'}`}
                              />
                            </div>
                          ),
                        },
                        {
                          key: 'weekday',
                          label: 'Weekday vs Weekend',
                          children: (
                            <div>
                              <Card
                                size="small"
                                title={
                                  <span className="tn-inline" style={{ justifyContent: 'space-between', width: '100%' }}>
                                    工作日与周末对比（Weekday vs Weekend）
                                    <span className="tn-inline" style={{ gap: 6 }}>
                                      <HelpTip
                                        title="只使用当前时间范围内的数据：周一至周五为工作日，周六/周日为周末，分别按 0–23 小时求平均。"
                                        detail="范围内没有周末（或工作日）时对应曲线显示为无数据，不会借用范围外的数据。"
                                        label="Weekday vs Weekend 方法说明"
                                      />
                                      <Button size="small" type="link" onClick={() => setExpanded('weekday')}>
                                        放大查看
                                      </Button>
                                    </span>
                                  </span>
                                }
                              >
                                <ChartMeta
                                  range={range}
                                  validPoints={primaryWeekday ? primaryWeekday.weekday.samples + primaryWeekday.weekend.samples : null}
                                />
                                {primaryWeekday ? (
                                  <>
                                    <WeekdayChart
                                      weekday={primaryWeekday.weekday.profile}
                                      weekend={primaryWeekday.weekend.profile}
                                      yName={source?.unit_label ? `流量（${unitDisplayLabel(source.unit_label)}）` : '流量值'}
                                    />
                                    <div className="tn-muted">
                                      工作日：{primaryWeekday.weekday.valid_dates} 个有效日期 / {primaryWeekday.weekday.samples} 个观测；
                                      周末：{primaryWeekday.weekend.valid_dates} 个有效日期 / {primaryWeekday.weekend.samples} 个观测。
                                    </div>
                                  </>
                                ) : (
                                  <EmptyState text="暂无数据。" />
                                )}
                              </Card>
                              <InsightCard title="工作日与周末差异分析（Weekday vs Weekend Insights）" insights={weekdayInsight} loading={loading} />
                            </div>
                          ),
                        },
                        {
                          key: 'acf',
                          label: 'ACF & Trend',
                          children: (
                            <div>
                              <Card
                                size="small"
                                title={
                                  <span className="tn-inline" style={{ justifyContent: 'space-between', width: '100%' }}>
                                    自相关与趋势（ACF & Trend）
                                    <span className="tn-inline" style={{ gap: 6 }}>
                                      <HelpTip
                                        title="ACF（自相关）衡量序列与自身滞后 k 步的相关程度；Lag 是“向后错几步”，不是只用 k 个点。"
                                        detail="灰色虚线为 ±95% 白噪声置信带，用于判断相关是否明显偏离 0。"
                                        label="ACF 方法说明"
                                      />
                                      <Button size="small" type="link" onClick={() => setExpanded('acf')}>
                                        放大查看
                                      </Button>
                                    </span>
                                  </span>
                                }
                              >
                                <div className="tn-muted" style={{ marginBottom: 6 }}>
                                  计算范围 {acfInfo?.start_at ?? range?.start_at ?? '—'} →{' '}
                                  {acfInfo?.end_at ?? range?.end_at ?? '—'} · 有效样本{' '}
                                  {acfInfo?.valid_points ?? 0} · 间隔{' '}
                                  {acfInfo?.interval_minutes ?? range?.interval_minutes ?? '—'} 分钟 · 最大滞后步数{' '}
                                  {acfInfo?.max_lag ?? '—'}
                                </div>
                                <div className="tn-acf-control">
                                  <div className="tn-inline" style={{ marginBottom: 6 }}>
                                    <Switch
                                      checked={autoLag}
                                      onChange={(checked) => {
                                        setAutoLag(checked)
                                        if (checked) {
                                          updateConfig({ acf_max_lag: 0 })
                                        } else {
                                          const current = acfInfo?.max_lag ?? acfInfo?.auto_max_lag ?? 2
                                          updateConfig({ acf_max_lag: Math.max(2, Number(current)) })
                                        }
                                      }}
                                    />
                                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                                      {autoLag ? '自动（按数据长度选择）' : '手动指定最大滞后步数'}
                                    </span>
                                  </div>
                                  {autoLag ? (
                                    <div className="tn-muted">
                                      实际生效最大滞后步数：{acfInfo ? `${acfInfo.max_lag} 步（约 ${acfInfo.max_lag_label}）` : '计算后显示'}
                                      （自动值由时间点数与采样间隔决定）
                                    </div>
                                  ) : (
                                    <ParamField
                                      spec={{ ...maxLagSpec, label_zh: '手动最大滞后步数（≥2）' }}
                                      value={config.acf_max_lag}
                                      issues={fieldIssues('acf_max_lag')}
                                      path="m1.acf_max_lag"
                                      onChange={(_key, value) => updateConfig({ acf_max_lag: Number(value) || 0 })}
                                      compact
                                    />
                                  )}
                                  {!autoLag && acfInfo ? (
                                    <div className="tn-muted" style={{ marginTop: 4 }}>
                                      实际生效：{acfInfo.max_lag} 步（约 {acfInfo.max_lag_label}） · 可支持上限{' '}
                                      {Math.max(2, (range?.points ?? 0) - 2)} 步
                                    </div>
                                  ) : null}
                                </div>
                                <AcfChart
                                  lags={result?.acf?.lags ?? []}
                                  values={result?.acf?.values ?? []}
                                  ci={result?.acf?.ci ?? []}
                                  intervalMinutes={result?.acf?.interval_minutes ?? 10}
                                />
                                <div className="tn-muted">
                                  {result?.trend?.available
                                    ? `线性趋势：${result.trend.direction_label}；斜率 ${result.trend.slope_per_hour?.toFixed(4)} / 小时` +
                                      (result.trend.r2 !== null && result.trend.r2 !== undefined ? `；R²=${result.trend.r2.toFixed(3)}` : '')
                                    : '有效样本不足，无法估计趋势。'}
                                </div>
                              </Card>
                              <InsightCard title="自相关与趋势分析（ACF & Trend Insights）" insights={acfInsight} loading={loading} />
                            </div>
                          ),
                        },
                      ].map((section) => (
                        <section key={section.key} aria-label={section.label}>
                          {section.children}
                        </section>
                      ))}
                    </div>

                    {(result?.warnings ?? []).length ? (
                      <div style={{ marginTop: 8 }}>
                        {result.warnings.map((line: string) => (
                          <div className="tn-warning-text" key={line}>
                            <span aria-hidden="true">⚠</span>
                            <span>{line}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {(result?.notes ?? []).map((line: string) => (
                      <div className="tn-muted" key={line} style={{ marginTop: 4 }}>
                        · {line}
                      </div>
                    ))}
                  </div>
                ),
              },
              {
                key: 'spatial',
                label: <BiLabel zh="空间分析" en="Spatial Analysis" />,
                children: (
                  <div className={stale ? 'tn-stale' : undefined}>
                    <div className="tn-muted" style={{ marginBottom: 8 }}>
                      当前截面 {spatial?.time_at ?? '—'} · 有效区域 {spatial?.value_region_count ?? 0} · 无数据{' '}
                      {spatial?.no_data_region_count ?? 0}
                      {spatial?.gis_no_data_count ? `（另有 ${spatial.gis_no_data_count} 个 GIS 区域无时序）` : ''}
                      {focusRegion ? ` · 地图已定位 ${focusRegion}` : ''}
                    </div>
                    <div className="tn-stack">
                      <section aria-label="Top 12 Regions">
                        <Card
                          size="small"
                          title={
                            <span className="tn-inline" style={{ justifyContent: 'space-between', width: '100%' }}>
                              高流量区域排名（Top 12 Regions）
                              <span className="tn-inline" style={{ gap: 6 }}>
                                <HelpTip
                                  title="使用当前数据源全部有时序区域在 GIS 当前时间截面的真实观测值，按数值从高到低取前 12 个；并列时按区域 ID 排序。"
                                  detail="无数据区域不参与排名；点击条形可在中央地图定位（不改变左侧多选与中央统计）。"
                                  label="Top 12 说明"
                                />
                                <Button size="small" type="link" onClick={() => setExpandedSpatial('top')}>
                                  放大查看
                                </Button>
                              </span>
                            </span>
                          }
                        >
                          <div className="tn-muted" style={{ marginBottom: 4 }}>
                            当前数据源全部有效区域 · 按当前截面值从高到低 · 点击条形可在中央地图定位
                          </div>
                          <HorizontalRankChart
                            items={spatial?.top ?? []}
                            height={340}
                            timeAt={spatial?.time_at}
                            unit={unitDisplayLabel(spatial?.source?.unit_label)}
                            onSelect={setFocusRegion}
                          />
                        </Card>
                        <InsightCard
                          title="高流量区域分析（High-Intensity Region Insights）"
                          insights={spatial?.insights?.high}
                          loading={loading || stale}
                        />
                      </section>

                      <section aria-label="Bottom 6 Regions">
                        <Card
                          size="small"
                          title={
                            <span className="tn-inline" style={{ justifyContent: 'space-between', width: '100%' }}>
                              低流量区域排名（Bottom 6 Regions）
                              <span className="tn-inline" style={{ gap: 6 }}>
                                <HelpTip
                                  title="按当前截面的真实值从低到高取 6 个有效区域；真实 0 值正常参与排名，无数据区域不参与。"
                                  detail="提示框中的范围均值是所选日期范围内的平均值，与当前截面值是两个不同口径。"
                                  label="Bottom 6 说明"
                                />
                                <Button size="small" type="link" onClick={() => setExpandedSpatial('bottom')}>
                                  放大查看
                                </Button>
                              </span>
                            </span>
                          }
                        >
                          <div className="tn-muted" style={{ marginBottom: 4 }}>
                            按当前截面值从低到高 · Tooltip 同时显示所选范围内均值（两个口径不同）
                          </div>
                          <HorizontalRankChart
                            items={spatial?.bottom ?? []}
                            height={260}
                            color="#D98F00"
                            timeAt={spatial?.time_at}
                            unit={unitDisplayLabel(spatial?.source?.unit_label)}
                            showRangeMean
                            onSelect={setFocusRegion}
                          />
                        </Card>
                        <InsightCard
                          title="低流量区域分析（Low-Intensity Region Insights）"
                          insights={spatial?.insights?.low}
                          loading={loading || stale}
                        />
                      </section>

                      <section aria-label="Regional Value Distribution">
                        <Card
                          size="small"
                          title={
                            <span className="tn-inline" style={{ justifyContent: 'space-between', width: '100%' }}>
                              区域数值分布（Regional Value Distribution）
                              <span className="tn-inline" style={{ gap: 6 }}>
                                <HelpTip
                                  title="把当前截面全部有效区域按流量值等宽分箱，柱高表示落入该区间的区域数量。"
                                  detail="分箱左闭右开、最后一个区间含右端点；各区间计数之和等于有效区域总数，无数据区域不参与。"
                                  label="区域分布说明"
                                />
                                <Button size="small" type="link" onClick={() => setExpandedSpatial('dist')}>
                                  放大查看
                                </Button>
                              </span>
                            </span>
                          }
                        >
                          <div className="tn-muted" style={{ marginBottom: 4 }}>
                            横轴：流量数值区间 · 纵轴：区域数量 · 均值{' '}
                            {spatial?.stats?.mean?.toFixed(2) ?? '—'} · 中位数{' '}
                            {spatial?.stats?.median?.toFixed(2) ?? '—'}
                          </div>
                          <HistogramChart
                            bins={spatial?.distribution?.bins ?? []}
                            height={260}
                            unit={unitDisplayLabel(spatial?.source?.unit_label)}
                          />
                        </Card>
                        <InsightCard
                          title="空间分布规律分析（Spatial Distribution Insights）"
                          insights={spatial?.insights?.distribution}
                          loading={loading || stale}
                        />
                      </section>
                    </div>
                  </div>
                ),
              },
              {
                key: 'multi',
                label: <BiLabel zh="多城市对比" en="Multi-City Comparison" />,
                children: (
                  <div className="tn-stack">
                    <MultiCityPanel frequency="60min" aggregation="mean" />
                  </div>
                ),
              },
            ]}
            />
          </>
          )
        }
      />

      <Modal
        open={expanded !== null}
        title={
          expanded === 'hourly'
            ? '日内小时画像（Hourly Profile）· 放大查看'
            : expanded === 'weekday'
              ? '工作日与周末对比（Weekday vs Weekend）· 放大查看'
              : '自相关与趋势（ACF & Trend）· 放大查看'
        }
        footer={null}
        width={1080}
        style={{ maxWidth: '94vw', top: 40 }}
        onCancel={() => setExpanded(null)}
        destroyOnClose
      >
        <div className="tn-stack">
          {expanded === 'hourly' ? (
            <>
              <ChartMeta range={range} validPoints={primaryStats?.valid_points} />
              <HourlyChart
                height={480}
                yName={source?.unit_label ? `流量（${unitDisplayLabel(source.unit_label)}）` : '流量值'}
                regions={(result?.hourly ?? []).map((h: any) => ({
                  region_id: h.region_id,
                  hours: h.hours,
                }))}
              />
              <InsightCard
                title="日内流量规律分析（Hourly Pattern Insights）"
                insights={hourlyInsight}
                loading={loading}
                subtitle={`上方曲线显示全部已选区域；以下结论针对分析对象 ${primaryId ?? '—'}`}
              />
            </>
          ) : null}
          {expanded === 'weekday' ? (
            <>
              <ChartMeta
                range={range}
                validPoints={primaryWeekday ? primaryWeekday.weekday.samples + primaryWeekday.weekend.samples : null}
              />
              {primaryWeekday ? (
                <WeekdayChart
                  height={480}
                  weekday={primaryWeekday.weekday.profile}
                  weekend={primaryWeekday.weekend.profile}
                  yName={source?.unit_label ? `流量（${unitDisplayLabel(source.unit_label)}）` : '流量值'}
                />
              ) : (
                <EmptyState text="暂无数据。" />
              )}
              <InsightCard title="工作日与周末差异分析（Weekday vs Weekend Insights）" insights={weekdayInsight} loading={loading} />
            </>
          ) : null}
          {expanded === 'acf' ? (
            <>
              <div className="tn-muted">
                计算范围 {acfInfo?.start_at ?? range?.start_at ?? '—'} →{' '}
                {acfInfo?.end_at ?? range?.end_at ?? '—'} · 有效样本 {acfInfo?.valid_points ?? 0} · 最大滞后步数{' '}
                {acfInfo?.max_lag ?? '—'} 步（约 {acfInfo?.max_lag_label ?? '—'}）
              </div>
              <AcfChart
                height={480}
                lags={result?.acf?.lags ?? []}
                values={result?.acf?.values ?? []}
                ci={result?.acf?.ci ?? []}
                intervalMinutes={result?.acf?.interval_minutes ?? 10}
              />
              <InsightCard title="自相关与趋势分析（ACF & Trend Insights）" insights={acfInsight} loading={loading} />
            </>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={expandedSpatial !== null}
        title={
          expandedSpatial === 'top'
            ? '高流量区域排名（Top 12 Regions）· 放大查看'
            : expandedSpatial === 'bottom'
              ? '低流量区域排名（Bottom 6 Regions）· 放大查看'
              : '区域数值分布（Regional Value Distribution）· 放大查看'
        }
        footer={null}
        width={1080}
        style={{ maxWidth: '94vw', top: 40 }}
        onCancel={() => setExpandedSpatial(null)}
        destroyOnClose
      >
        <div className="tn-stack">
          <div className="tn-muted">
            当前截面 {spatial?.time_at ?? '—'} · 有效区域 {spatial?.value_region_count ?? 0} · 无数据{' '}
            {spatial?.no_data_region_count ?? 0}
            {spatial?.gis_no_data_count ? `（另有 ${spatial.gis_no_data_count} 个 GIS 区域无时序）` : ''}
          </div>
          {expandedSpatial === 'top' ? (
            <>
              <HorizontalRankChart
                items={spatial?.top ?? []}
                height={560}
                timeAt={spatial?.time_at}
                unit={unitDisplayLabel(spatial?.source?.unit_label)}
              />
              <InsightCard title="高流量区域分析（High-Intensity Region Insights）" insights={spatial?.insights?.high} />
            </>
          ) : null}
          {expandedSpatial === 'bottom' ? (
            <>
              <HorizontalRankChart
                items={spatial?.bottom ?? []}
                height={460}
                color="#D98F00"
                timeAt={spatial?.time_at}
                unit={unitDisplayLabel(spatial?.source?.unit_label)}
                showRangeMean
              />
              <InsightCard title="低流量区域分析（Low-Intensity Region Insights）" insights={spatial?.insights?.low} />
            </>
          ) : null}
          {expandedSpatial === 'dist' ? (
            <>
              <HistogramChart
                bins={spatial?.distribution?.bins ?? []}
                height={480}
                unit={unitDisplayLabel(spatial?.source?.unit_label)}
              />
              <InsightCard title="空间分布规律分析（Spatial Distribution Insights）" insights={spatial?.insights?.distribution} />
            </>
          ) : null}
        </div>
      </Modal>
    </div>
  )
}

function MultiCityPanel({ frequency, aggregation }: { frequency: string; aggregation: string }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    api
      .post<any>(ENDPOINTS.compare, { source_keys: ['milano', 'trentino', 'zte'], frequency, aggregation })
      .then((next) => {
        if (active) setData(next)
      })
      .catch((reason) => {
        if (!active) return
        setData(null)
        setError(reason instanceof Error ? reason.message : '无法读取多来源对比数据')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [frequency, aggregation])

  const sources = data?.sources ?? []
  const chartSources = sources.map((item: any) => ({
    ...item,
    display_name: sourceDisplayName(item.source_key, item.display_name),
  }))
  const insights = localizeSourceNames(data?.insights)
  const sourceColumns = [
    {
      title: '数据源 / 单位',
      key: 'source',
      width: '27%',
      render: (_: unknown, item: any) => (
        <div>
          <strong>{sourceDisplayName(item.source_key, item.display_name)}</strong>
          <div className="tn-muted" style={{ fontSize: 10.5, lineHeight: 1.45 }}>{unitDisplayLabel(item.unit_label)}</div>
        </div>
      ),
    },
    {
      title: '观测范围',
      key: 'period',
      width: '29%',
      render: (_: unknown, item: any) => (
        <div style={{ fontSize: 10.5, lineHeight: 1.5 }}>
          <div>{String(item.time_start ?? '—').slice(0, 10)}</div>
          <div className="tn-muted">→ {String(item.time_end ?? '—').slice(0, 10)}</div>
        </div>
      ),
    },
    {
      title: '采样与样本',
      key: 'samples',
      width: '44%',
      render: (_: unknown, item: any) => (
        <div style={{ fontSize: 10.5, lineHeight: 1.55 }}>
          <div>
            原始 {Number(item.raw_time_point_count ?? 0).toLocaleString('zh-CN')} 个时间点 ·{' '}
            间隔 {item.native_frequency_minutes} 分钟
          </div>
          <div>
            小时聚合 {Number(item.hourly_bucket_count ?? 0).toLocaleString('zh-CN')} 个（有效{' '}
            {Number(item.hourly_valid_bucket_count ?? 0).toLocaleString('zh-CN')}）
          </div>
          <div>
            典型曲线 24 个钟点 · 有效原始观测（区域×时间）{' '}
            {Number(item.raw_valid_observation_count ?? 0).toLocaleString('zh-CN')}
          </div>
          <div className="tn-muted">
            CV（24 点典型值）{item.cv_typical === null || item.cv_typical === undefined ? '—' : Number(item.cv_typical).toFixed(3)}
          </div>
        </div>
      ),
    },
  ]
  const methodRows = data?.method
    ? [
        ['小时聚合', data.method.hourly_aggregation],
        ['区域聚合', data.method.spatial_aggregation],
        ['典型日内曲线', data.method.daily_profile],
        ['Z-score', data.method.zscore],
        ['曲线相似性', data.method.similarity],
        ['CV', data.method.cv],
      ]
    : []

  return (
    <>
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 8 }}
        message="仅比较标准化后的日内形状"
        description={localizeSourceNames(data?.warning) ?? '三个来源的观测时期与物理单位不同，原始值不可直接比较；ZTE 为 4G 下行流量，不是道路车辆流量。'}
      />
      {error ? (
        <Alert
          type="error"
          showIcon
          message="多来源对比数据加载失败"
          description={error}
          style={{ marginBottom: 8 }}
        />
      ) : null}
      <Card
        size="small"
        title={(
          <span className="tn-inline">
            标准化日内模式对比（Z-score）
            <HelpTip
              label="多来源标准化日内模式"
              title="三个来源各自计算自身的 24 点典型曲线，再做 Z-score。"
              detail="各区域原始观测先按完整整点小时聚合；同一小时对所有有值区域等权平均，再按 0–23 钟点跨日期平均。缺失小时保留为无数据，不填 0；零方差时不生成归一化曲线。原始流量值从不跨来源比较。"
            />
          </span>
        )}
        extra={(
          <Button size="small" onClick={() => setExpanded(true)} disabled={!sources.length}>
            放大查看
          </Button>
        )}
      >
        {loading && !data ? (
          <div className="tn-empty">正在读取三个来源的真实观测并计算 24 点典型曲线…</div>
        ) : (
          <MultiCityZChart sources={chartSources} height={310} />
        )}
        <div className="tn-muted" style={{ fontSize: 10.5, marginTop: 4 }}>
          曲线：Milano、Trentino、ZTE 4G Downlink。Z=0 表示该来源自身的典型小时平均水平，
          正值高于自身平均，负值低于自身平均。
        </div>
      </Card>
      <InsightCard
                title="多来源模式对比分析（Multi-City Comparison Insights）"
        insights={insights}
        loading={loading}
      />
      <Card
        size="small"
        title={(
          <span className="tn-inline">
            数据源对比摘要（Dataset Comparison Summary）
            <HelpTip
              label="数据源对比摘要"
              title="原始时间点、小时桶和典型曲线点是三个不同口径。"
              detail="原始时间点是 CSV 的时间行数；小时桶是固定整点小时的聚合结果；典型曲线固定为 24 个钟点。有效原始观测按“区域 × 时间”的非空值计数。CV 只基于每个来源自身 24 点典型曲线计算。"
            />
          </span>
        )}
        style={{ marginTop: 8 }}
      >
        <Table
          size="small"
          rowKey="source_key"
          pagination={false}
          columns={sourceColumns}
          dataSource={sources}
          loading={loading}
        />
        <div className="tn-muted" style={{ fontSize: 10.5, marginTop: 6 }}>
          观测范围不同（Milano/Trentino 与 ZTE 并非同一年份）；单位不同，因此表中数值仅作数据质量说明，不用于跨来源规模比较。
        </div>
        <Collapse
          size="small"
          ghost
          style={{ marginTop: 4 }}
          items={[
            {
              key: 'method',
              label: '展开数据处理与统计口径',
              children: (
                <div className="tn-insight-details">
                  {methodRows.map(([label, value]) => (
                    <div key={label}>
                      <span className="tn-insight-detail-label">{label}</span>
                      <span>{value}</span>
                    </div>
                  ))}
                  {sources.map((item: any) => (
                    <div key={`${item.source_key}-counts`}>
                      <span className="tn-insight-detail-label">{sourceDisplayName(item.source_key, item.display_name)}</span>
                      <span>
                        原始时间点 {item.raw_time_point_count}；有效原始观测 {item.raw_valid_observation_count} /{' '}
                        {item.raw_observation_count}（区域 × 时间）；小时桶 {item.hourly_bucket_count}；
                        有效小时桶 {item.hourly_valid_bucket_count}；典型曲线 {item.hourly_profile_points} 点。
                      </span>
                    </div>
                  ))}
                </div>
              ),
            },
          ]}
        />
      </Card>
      <Modal
        open={expanded}
        onCancel={() => setExpanded(false)}
        footer={null}
        width={1120}
        title="标准化日内模式对比（Z-score）"
        destroyOnClose
      >
        <div className="tn-muted" style={{ marginBottom: 6 }}>
          横轴为 0–23 小时；Z=0 表示该来源自身的典型小时平均水平。三个来源仅作形状比较。
        </div>
        <MultiCityZChart sources={chartSources} height={480} />
        <InsightCard
          title="多来源模式对比分析（Multi-City Comparison Insights）"
          insights={insights}
        />
      </Modal>
    </>
  )
}
