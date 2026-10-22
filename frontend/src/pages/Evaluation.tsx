import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Checkbox, Popconfirm, Select, Table, Tag, message } from 'antd'
import { useSearchParams } from 'react-router-dom'
import dayjs from 'dayjs'
import { ENDPOINTS, ApiError, api, type Issue } from '../api/client'
import { EmptyState, ModuleHeader, PaneHead, ThreePane } from '../components/Panes'
import DateTimeField from '../components/DateTimeField'
import StatusTag from '../components/StatusTag'
import { BarChart, LineChart } from '../components/Charts'
import { BLUE_PALETTE } from '../components/MapView'
import { useGroupValidation } from '../validation/useValidation'
import { formatShanghaiDateTime } from '../utils/shanghaiDateTime'
import {
  ACTION_LABELS,
  MODULE_META,
  frequencyLabel,
  modeLabel,
  sourceDisplayName,
  statusLabel,
  unitDisplayLabel,
} from '../i18n/terms'

type MetricKey = 'mae' | 'rmse' | 'smape' | 'r2'
type HorizonMetricKey = 'mae' | 'rmse'

const METRIC_LABELS: Record<MetricKey, string> = {
  mae: 'MAE',
  rmse: 'RMSE',
  smape: 'sMAPE',
  r2: 'R²',
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function formatMetric(value: unknown, digits = 2): string {
  return isNumber(value) ? value.toFixed(digits) : '不适用'
}

function formatParams(params: Record<string, unknown> | undefined): string {
  const entries = Object.entries(params ?? {})
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .slice(0, 4)
  return entries.length ? entries.map(([key, value]) => `${key}=${String(value)}`).join(' · ') : '使用默认参数'
}

function experimentRegionIds(experiment: any): string[] {
  return (
    experiment?.snapshot?.region_ids ??
    experiment?.region_ids ??
    []
  )
}

function rowByTarget(rows: any[]): Map<string, any> {
  const result = new Map<string, any>()
  for (const row of [...rows].sort((left, right) => Number(left.window_index) - Number(right.window_index))) {
    if (!result.has(String(row.target_at))) result.set(String(row.target_at), row)
  }
  return result
}

function fallbackHorizonMetrics(rows: any[], horizon: number): any {
  const subset = rows.filter((row) => Number(row.horizon_step) === horizon && isNumber(row.y_true) && isNumber(row.y_pred))
  if (!subset.length) return { horizon_step: horizon, mae: null, rmse: null, smape: null, r2: null, n_samples: 0 }
  const truth = subset.map((row) => Number(row.y_true))
  const prediction = subset.map((row) => Number(row.y_pred))
  const errors = prediction.map((value, index) => value - truth[index])
  const meanTruth = truth.reduce((sum, value) => sum + value, 0) / truth.length
  const variance = truth.reduce((sum, value) => sum + (value - meanTruth) ** 2, 0)
  const denominator = truth.map((value, index) => Math.abs(value) + Math.abs(prediction[index]))
  const smapeValues = errors.map((_, index) =>
    denominator[index] <= 1e-9 ? 0 : (2 * Math.abs(errors[index])) / denominator[index],
  )
  return {
    horizon_step: horizon,
    mae: errors.reduce((sum, value) => sum + Math.abs(value), 0) / errors.length,
    rmse: Math.sqrt(errors.reduce((sum, value) => sum + value ** 2, 0) / errors.length),
    smape: (100 * smapeValues.reduce((sum, value) => sum + value, 0)) / smapeValues.length,
    r2: variance <= 0 ? null : 1 - errors.reduce((sum, value) => sum + value ** 2, 0) / variance,
    n_samples: subset.length,
  }
}

function histogram(values: number[]): { labels: string[]; counts: number[] } {
  if (!values.length) return { labels: [], counts: [] }
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  if (minimum === maximum) {
    return { labels: [minimum.toFixed(2)], counts: [values.length] }
  }
  const binCount = Math.min(10, Math.max(6, Math.ceil(Math.sqrt(values.length))))
  const width = (maximum - minimum) / binCount
  const counts = Array.from({ length: binCount }, () => 0)
  values.forEach((value) => {
    const index = Math.min(binCount - 1, Math.floor((value - minimum) / width))
    counts[index] += 1
  })
  return {
    labels: counts.map((_, index) => {
      const start = minimum +(width * index)
      const end = start + width
      return `${start.toFixed(1)}–${end.toFixed(1)}`
    }),
    counts,
  }
}

export default function Evaluation() {
  const [messageApi, contextHolder] = message.useMessage()
  const [searchParams] = useSearchParams()
  const [datasets, setDatasets] = useState<any[]>([])
  const [datasetId, setDatasetId] = useState(searchParams.get('dataset') ?? '')
  const [dataset, setDataset] = useState<any>(null)
  const [experiments, setExperiments] = useState<any[]>([])
  const [selectedExperiments, setSelectedExperiments] = useState<string[]>(
    searchParams.get('experiment') ? [searchParams.get('experiment') as string] : [],
  )
  const [regionId, setRegionId] = useState('')
  const [testSelection, setTestSelection] = useState<'full' | 'range'>('full')
  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd, setRangeEnd] = useState('')
  const [compatibility, setCompatibility] = useState<any>(null)
  const [evaluation, setEvaluation] = useState<any>(null)
  const [evaluations, setEvaluations] = useState<any[]>([])
  const [seriesByExperiment, setSeriesByExperiment] = useState<Record<string, any[]>>({})
  const [horizonStep, setHorizonStep] = useState(1)
  const [horizonMetric, setHorizonMetric] = useState<HorizonMetricKey>('mae')
  const [rankingMetric, setRankingMetric] = useState<MetricKey>('rmse')
  const [viewingHistory, setViewingHistory] = useState(false)
  const [busy, setBusy] = useState(false)
  const [serverIssues, setServerIssues] = useState<Issue[]>([])

  const values = useMemo(
    () => ({
      dataset_id: datasetId,
      scope: 'single' as const,
      region_id: regionId,
      experiment_ids: selectedExperiments,
      test_selection: testSelection,
      range_start_at: rangeStart || null,
      range_end_at: rangeEnd || null,
    }),
    [datasetId, regionId, selectedExperiments, testSelection, rangeStart, rangeEnd],
  )

  const schema = useMemo(
    () => [
      {
        key: 'experiment_ids',
        label_zh: '实验',
        type: 'array' as const,
        enum: experiments.map((item) => item.experiment_id),
        enum_labels: experiments.map((item) => item.display_id ?? item.experiment_id),
        default: [],
        help_zh: '手动选择一个或多个训练实验。',
        suggestion_zh: '同一模型的不同 EXP 会作为独立实验展示。',
      },
    ],
    [experiments],
  )

  const { fieldIssues, errors, warnings, valid } = useGroupValidation({
    specs: schema,
    values,
    pathPrefix: 'm5',
    remote: datasetId && selectedExperiments.length
      ? {
          kind: 'm5',
          values,
          context: {
            dataset: dataset ?? null,
            experiments: experiments.filter((item) => selectedExperiments.includes(item.experiment_id)),
          },
        }
      : null,
  })

  const loadDatasets = useCallback(() => {
    api.get<any>(ENDPOINTS.datasetList).then((data) => {
      const built = (data.datasets ?? []).filter(
        (item: any) => item.status !== 'Archived' && item.scope === 'single' && item.region_count === 1,
      )
      setDatasets(built)
      setDatasetId((previous) =>
        previous && built.some((item: any) => item.dataset_id === previous)
          ? previous
          : built[0]?.dataset_id ?? '',
      )
    })
  }, [])

  const loadHistory = useCallback(() => {
    api.get<any>(ENDPOINTS.evaluationList)
      .then((data) => setEvaluations((data.evaluations ?? []).filter((item: any) => item.scope === 'single')))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    loadDatasets()
    loadHistory()
  }, [loadDatasets, loadHistory])

  useEffect(() => {
    if (!datasetId) {
      setDataset(null)
      setExperiments([])
      return
    }
    api.get<any>(ENDPOINTS.datasetGet(datasetId))
      .then((data) => {
        setDataset(data)
        setRegionId((previous) => previous && data.region_ids?.includes(previous) ? previous : data.region_ids?.[0] ?? '')
      })
      .catch(() => setDataset(null))
    api.get<any>(`${ENDPOINTS.experimentList}?dataset_id=${encodeURIComponent(datasetId)}&limit=500`)
      .then((data) => setExperiments((data.experiments ?? []).filter((item: any) => item.scope === 'single')))
      .catch(() => setExperiments([]))
  }, [datasetId])

  useEffect(() => {
    if (!datasetId || !selectedExperiments.length) {
      setCompatibility(null)
      return
    }
    api.post<any>(ENDPOINTS.evaluationValidate, values)
      .then(setCompatibility)
      .catch(() => setCompatibility(null))
  }, [datasetId, selectedExperiments.join(','), testSelection, rangeStart, rangeEnd, values])

  useEffect(() => {
    setHorizonStep((previous) => {
      const max = Number(dataset?.H ?? 1)
      return previous >= 1 && previous <= max ? previous : 1
    })
  }, [dataset?.H])

  useEffect(() => {
    if (!evaluation || !['Queued', 'Running', 'Stopping'].includes(evaluation.status)) return
    const timer = window.setInterval(async () => {
      try {
        const data = await api.get<any>(ENDPOINTS.evaluationGet(evaluation.evaluation_id))
        setEvaluation(data)
        if (!['Queued', 'Running', 'Stopping'].includes(data.status)) {
          loadHistory()
          messageApi.success(`评价 ${data.evaluation_id} 状态：${statusLabel(data.status)}`)
        }
      } catch {
        // Keep the last confirmed backend state.
      }
    }, 2500)
    return () => window.clearInterval(timer)
  }, [evaluation, loadHistory, messageApi])

  const loadSeries = useCallback(async (evaluationId: string, experimentIds: string[], region?: string) => {
    const entries = await Promise.all(
      experimentIds.map(async (experimentId) => {
        try {
          const data = await api.get<any>(ENDPOINTS.evaluationSeries(evaluationId, experimentId, region))
          return [experimentId, data.rows ?? []] as const
        } catch {
          return [experimentId, []] as const
        }
      }),
    )
    setSeriesByExperiment(Object.fromEntries(entries))
  }, [])

  useEffect(() => {
    if (!evaluation || evaluation.status !== 'Completed') {
      setSeriesByExperiment({})
      return
    }
    const ids = (evaluation.experiments ?? [])
      .filter((item: any) => item.coverage_regions > 0)
      .map((item: any) => item.experiment_id)
    loadSeries(evaluation.evaluation_id, ids, evaluation.region_id)
  }, [evaluation?.evaluation_id, evaluation?.status, evaluation?.region_id, loadSeries])

  const clearResult = () => {
    setEvaluation(null)
    setSeriesByExperiment({})
    setViewingHistory(false)
  }

  const selectDataset = (value: string) => {
    setDatasetId(value)
    setSelectedExperiments([])
    setCompatibility(null)
    setTestSelection('full')
    setRangeStart('')
    setRangeEnd('')
    setHorizonStep(1)
    clearResult()
  }

  const toggleExperiment = (experimentId: string, checked: boolean) => {
    clearResult()
    setSelectedExperiments((previous) =>
      checked ? [...new Set([...previous, experimentId])] : previous.filter((item) => item !== experimentId),
    )
  }

  const runEvaluation = async () => {
    if (!valid) {
      messageApi.error('评估配置未通过校验。')
      return
    }
    setBusy(true)
    setServerIssues([])
    try {
      const created = await api.post<any>(ENDPOINTS.evaluationRun, { ...values, horizon_step: horizonStep })
      const data = await api.get<any>(ENDPOINTS.evaluationGet(created.evaluation_id))
      setEvaluation(data)
      setViewingHistory(false)
      setHorizonStep(1)
      loadHistory()
      messageApi.success(`评价 ${created.evaluation_id} 已创建。`)
    } catch (error) {
      if (error instanceof ApiError) {
        setServerIssues(error.issues)
        messageApi.error(`运行评估失败：${error.message}`)
      } else {
        messageApi.error(String(error))
      }
    } finally {
      setBusy(false)
    }
  }

  const openEvaluation = async (evaluationId: string) => {
    try {
      const data = await api.get<any>(ENDPOINTS.evaluationGet(evaluationId))
      const protocol = data.protocol ?? {}
      const testRange = data.test_range ?? {}
      setEvaluation(data)
      setViewingHistory(true)
      setDatasetId(data.dataset_id)
      setRegionId(data.region_id ?? '')
      setSelectedExperiments((data.experiments ?? []).map((item: any) => item.experiment_id))
      setTestSelection(protocol.test_selection ?? protocol.display_selection ?? testRange.selection ?? 'full')
      setRangeStart(protocol.range_start_at ?? testRange.requested_start_at ?? '')
      setRangeEnd(protocol.range_end_at ?? testRange.requested_end_at ?? '')
      setHorizonStep(Math.max(1, Number(protocol.display_horizon_step ?? protocol.horizon_step ?? 1)))
      messageApi.success(`已打开历史评价 ${evaluationId}`)
    } catch (error) {
      messageApi.error(String(error))
    }
  }

  const resetConfiguration = () => {
    setSelectedExperiments([])
    setCompatibility(null)
    setTestSelection('full')
    setRangeStart('')
    setRangeEnd('')
    setHorizonStep(1)
    clearResult()
  }

  const eligibleExperiments = useMemo(
    () =>
      experiments.filter(
        (item) =>
          ['Completed', 'Partial'].includes(item.status) &&
          item.scope === 'single' &&
          (!regionId || !experimentRegionIds(item).length || experimentRegionIds(item).includes(regionId)),
      ),
    [experiments, regionId],
  )
  const excludedExperiments = useMemo(
    () => experiments.filter((item) => !eligibleExperiments.some((candidate) => candidate.experiment_id === item.experiment_id)),
    [experiments, eligibleExperiments],
  )

  const experimentLookup = useMemo(
    () => new Map(experiments.map((item) => [item.experiment_id, item])),
    [experiments],
  )

  const evaluationMembers = evaluation?.experiments ?? []
  const memberLookup = useMemo(
    () => new Map(evaluationMembers.map((item: any) => [item.experiment_id, item])),
    [evaluationMembers],
  )

  const selectedDetails = useMemo(
    () =>
      selectedExperiments.map((experimentId) => {
        const member: any = memberLookup.get(experimentId)
        const experiment: any = experimentLookup.get(experimentId)
        return {
          experiment_id: experimentId,
          display_id: member?.display_id ?? experiment?.display_id ?? experimentId,
          algorithm_label:
            member?.algorithm_label_archive ??
            experiment?.algorithm_label ??
            member?.algorithm_key ??
            '未知模型',
          mode: member?.mode ?? experiment?.mode,
          params: member?.params ?? experiment?.params ?? {},
          status: member?.training_status ?? experiment?.status ?? member?.status,
          training_completed_at: member?.training_completed_at ?? experiment?.ended_at,
        }
      }),
    [selectedExperiments, memberLookup, experimentLookup],
  )

  const experimentReports = useMemo(() => {
    const reports = evaluation?.metrics_summary?.experiments
    if (Array.isArray(reports) && reports.length) return reports
    return evaluationMembers.map((member: any) => ({
      experiment_id: member.experiment_id,
      algorithm_key: member.algorithm_key,
      algorithm_label: member.algorithm_label_archive ?? member.algorithm_key,
      display_id: member.display_id,
      status: member.status,
      macro: member.metrics?.macro ?? {},
      pooled: member.metrics?.pooled ?? {},
      per_horizon: member.metrics?.per_horizon ?? [],
      errors: member.metrics?.errors ?? [],
    }))
  }, [evaluation, evaluationMembers])

  const reportLookup = useMemo(
    () => new Map(experimentReports.map((item: any) => [item.experiment_id, item])),
    [experimentReports],
  )

  const comparisonData = useMemo(() => {
    const groups = selectedExperiments.map((experimentId) => {
      const rows = (seriesByExperiment[experimentId] ?? []).filter(
        (row) => Number(row.horizon_step) === horizonStep,
      )
      return { experimentId, rows, byTarget: rowByTarget(rows) }
    })
    const timestamps = [...new Set(groups.flatMap((group) => [...group.byTarget.keys()]))].sort()
    const truthRow = groups.flatMap((group) => [...group.byTarget.values()]).find((row) => isNumber(row.y_true))
    const truthMap = rowByTarget(
      groups.flatMap((group) => [...group.byTarget.values()]).filter((row) => isNumber(row.y_true)),
    )
    return {
      x: timestamps,
      series: timestamps.length
        ? [
            {
              name: '真实值',
              data: timestamps.map((timestamp) => {
                const row = truthMap.get(timestamp) ?? (truthRow?.target_at === timestamp ? truthRow : null)
                return isNumber(row?.y_true) ? Number(row.y_true) : null
              }),
              color: '#142B52',
            },
            ...groups.map((group, index) => {
              const report: any = reportLookup.get(group.experimentId)
              const detail = selectedDetails.find((item) => item.experiment_id === group.experimentId)
              return {
                name: `${report?.algorithm_label ?? detail?.algorithm_label ?? '模型'} · ${report?.display_id ?? detail?.display_id ?? group.experimentId}`,
                data: timestamps.map((timestamp) => {
                  const value = group.byTarget.get(timestamp)?.y_pred
                  return isNumber(value) ? Number(value) : null
                }),
                color: BLUE_PALETTE[index % BLUE_PALETTE.length],
              }
            }),
          ]
        : [],
      groups,
    }
  }, [selectedExperiments, seriesByExperiment, horizonStep, reportLookup, selectedDetails])

  const errorData = useMemo(() => {
    const timestamps = comparisonData.x
    return {
      x: timestamps,
      series: comparisonData.groups.map((group, index) => {
        const report: any = reportLookup.get(group.experimentId)
        const detail = selectedDetails.find((item) => item.experiment_id === group.experimentId)
        return {
          name: `${report?.algorithm_label ?? detail?.algorithm_label ?? '模型'} · ${report?.display_id ?? group.experimentId}`,
          data: timestamps.map((timestamp) => {
            const row = group.byTarget.get(timestamp)
            return isNumber(row?.y_pred) && isNumber(row?.y_true) ? Number(row.y_pred) - Number(row.y_true) : null
          }),
          color: BLUE_PALETTE[index % BLUE_PALETTE.length],
        }
      }),
    }
  }, [comparisonData, reportLookup, selectedDetails])

  const errorComparison = useMemo(
    () =>
      comparisonData.groups.map((group) => {
        const values = [...group.byTarget.values()]
          .filter((row) => isNumber(row.y_true) && isNumber(row.y_pred))
          .map((row) => Math.abs(Number(row.y_pred) - Number(row.y_true)))
        const detail = selectedDetails.find((item) => item.experiment_id === group.experimentId)
        const report: any = reportLookup.get(group.experimentId)
        return {
          name: `${report?.algorithm_label ?? detail?.algorithm_label ?? '模型'} · ${report?.display_id ?? group.experimentId}`,
          mae: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
        }
      }),
    [comparisonData, selectedDetails, reportLookup],
  )

  const errorHistogram = useMemo(
    () =>
      histogram(
        errorData.series.flatMap((item: any) => item.data.filter((value: any) => isNumber(value))),
      ),
    [errorData],
  )

  const horizonSteps = Array.from({ length: Number(dataset?.H ?? 0) }, (_, index) => index + 1)
  const horizonSeries = useMemo(
    () =>
      experimentReports.map((report: any, index: number) => {
        const rows = seriesByExperiment[report.experiment_id] ?? []
        const metrics = horizonSteps.map((step) => {
          const saved = (report.per_horizon ?? []).find((item: any) => Number(item.horizon_step) === step)
          return saved ?? fallbackHorizonMetrics(rows, step)
        })
        return {
          name: `${report.algorithm_label} · ${report.display_id ?? report.experiment_id}`,
          data: metrics.map((item: any) => (isNumber(item?.[horizonMetric]) ? item[horizonMetric] : null)),
          color: BLUE_PALETTE[index % BLUE_PALETTE.length],
        }
      }),
    [experimentReports, seriesByExperiment, horizonMetric, horizonSteps.join(',')],
  )

  const ranking = useMemo(
    () =>
      experimentReports
        .filter((report: any) => isNumber(report.macro?.[rankingMetric]))
        .slice()
        .sort((left: any, right: any) =>
          rankingMetric === 'r2'
            ? Number(right.macro[rankingMetric]) - Number(left.macro[rankingMetric])
            : Number(left.macro[rankingMetric]) - Number(right.macro[rankingMetric]),
        ),
    [experimentReports, rankingMetric],
  )

  const testBoundary = dataset?.split_boundaries?.[2]
  const actualTestRange = evaluation?.test_range ?? evaluation?.metrics_summary?.test_range ?? {}
  const displayTestStart =
    actualTestRange.actual_start_at ?? testBoundary?.start_at ?? evaluation?.protocol?.range_start_at ?? '—'
  const displayTestEnd =
    actualTestRange.actual_end_at ?? testBoundary?.end_at ?? evaluation?.protocol?.range_end_at ?? '—'
  const displayTestWindows =
    actualTestRange.window_count ?? dataset?.window_counts?.test ?? 0
  const displayTestSamples =
    actualTestRange.valid_prediction_count ?? experimentReports.reduce((sum: number, report: any) => sum + Number(report.macro?.n_samples ?? 0), 0)

  const disabledTestDate = (current: any) => {
    if (!current || !testBoundary) return false
    const start = dayjs(testBoundary.start_at)
    const end = dayjs(testBoundary.end_at)
    return current.isBefore(start, 'day') || current.isAfter(end, 'day')
  }

  return (
    <div>
      {contextHolder}
      <ModuleHeader
        module={MODULE_META.m5.index}
        titleZh={MODULE_META.m5.titleZh}
        titleEn={MODULE_META.m5.titleEn}
        description="手动选择单区域数据集与训练实验，使用真实测试集统一口径比较模型"
        datasetInfo={evaluation ? `${evaluation.evaluation_id} · ${statusLabel(evaluation.status)}` : '尚未运行评价'}
      />
      {errors.length > 0 ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 10 }}
          message={`${errors.length} 个配置错误`}
          description={errors.slice(0, 5).map((item) => `${item.path}: ${item.message}`).join('；')}
        />
      ) : null}
      {serverIssues.length > 0 ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 10 }}
          message="后端拒绝本次评估"
          description={serverIssues.map((item) => `${item.path}: ${item.message}`).join('；')}
        />
      ) : null}
      <ThreePane
        variant="two"
        config={
          <div className="tn-stack">
            <Card
              size="small"
              title="评估配置（Evaluation Setup）"
              extra={<Button size="small" onClick={resetConfiguration}>清空选择</Button>}
            >
              <div className="tn-field" data-field="m5.dataset_id">
                <label className="tn-field-label">数据集（Dataset）</label>
                <Select
                  size="small"
                  style={{ width: '100%' }}
                  value={datasetId || undefined}
                  placeholder="选择单区域数据集"
                  options={datasets.map((item) => ({
                    value: item.dataset_id,
                    label: `${item.display_id ?? item.dataset_id} · ${item.region_ids?.[0] ?? '—'}`,
                  }))}
                  onChange={selectDataset}
                />
                {dataset ? (
                  <div className="tn-m5-dataset-mini">
                    <span>数据集：{dataset.display_id ?? dataset.dataset_id}</span>
                    <span>数据源：{sourceDisplayName(dataset.source_key, dataset.source_display_name)}</span>
                    <span>区域：{dataset.region_ids?.[0] ?? '—'}</span>
                    <span>频率：{frequencyLabel(dataset.frequency)}</span>
                    <span>L/H/S：{dataset.L}/{dataset.H}/{dataset.S}</span>
                  </div>
                ) : null}
              </div>

              <div className="tn-field" data-field="m5.experiment_ids">
                <label className="tn-field-label">训练实验（手动选择）</label>
                <div className="tn-muted">
                  已选 {selectedExperiments.length} 个实验。同一模型的多个训练记录会按 EXP ID 分别展示。
                </div>
                <div className="tn-m5-experiment-list">
                  {eligibleExperiments.length ? eligibleExperiments.map((item) => (
                    <label className="tn-m5-experiment-item" key={item.experiment_id}>
                      <Checkbox
                        data-testid={`m5-experiment-${item.experiment_id}`}
                        checked={selectedExperiments.includes(item.experiment_id)}
                        onChange={(event) => toggleExperiment(item.experiment_id, event.target.checked)}
                      />
                      <span className="tn-m5-experiment-main">
                        <strong>{item.algorithm_label} · {item.display_id ?? item.experiment_id}</strong>
                        <span>{formatParams(item.params)}</span>
                        <span className="tn-muted">
                          完成：{formatShanghaiDateTime(item.ended_at ?? item.created_at)} · {modeLabel(item.mode)}
                        </span>
                      </span>
                      <StatusTag status={item.status} error={item.error} />
                    </label>
                  )) : <EmptyState text="当前数据集没有可评估的已完成实验。" />}
                </div>
                {excludedExperiments.length ? (
                  <div className="tn-m5-excluded">
                    {excludedExperiments.map((item) => (
                      <div key={item.experiment_id}>
                        {item.display_id ?? item.experiment_id} · {statusLabel(item.status)}
                        {item.error ? `：${item.error}` : '：不满足完成状态或区域条件'}
                      </div>
                    ))}
                  </div>
                ) : null}
                {fieldIssues('experiment_ids').map((item) => (
                  <div className="tn-error-text" key={item.code}>{item.message}</div>
                ))}
              </div>

              <div className="tn-field">
                <label className="tn-field-label">测试范围（Test Range）</label>
                <Select
                  size="small"
                  style={{ width: '100%' }}
                  value={testSelection}
                  options={[
                    { value: 'full', label: '完整测试集（Full Test）' },
                    { value: 'range', label: '自定义测试区间' },
                  ]}
                  onChange={(value) => {
                    clearResult()
                    setTestSelection(value)
                    if (value === 'full') {
                      setRangeStart('')
                      setRangeEnd('')
                    }
                  }}
                />
              </div>
              {testSelection === 'range' ? (
                <>
                  <DateTimeField
                    id="m5.range_start_at"
                    label="测试开始时间"
                    value={rangeStart}
                    issues={fieldIssues('range_start_at')}
                    onChange={(value) => { clearResult(); setRangeStart(value ?? '') }}
                    disabledDate={disabledTestDate}
                    help="自定义测试范围必须位于已保存数据集的测试集内。"
                  />
                  <DateTimeField
                    id="m5.range_end_at"
                    label="测试结束时间"
                    value={rangeEnd}
                    issues={fieldIssues('range_end_at')}
                    onChange={(value) => { clearResult(); setRangeEnd(value ?? '') }}
                    disabledDate={disabledTestDate}
                    help="自定义测试范围必须位于已保存数据集的测试集内。"
                  />
                </>
              ) : null}

              <div className="tn-muted tn-m5-test-bounds">
                <div>有效测试范围：{testBoundary?.start_at ?? '—'} 至 {testBoundary?.end_at ?? '—'}</div>
                <div>候选测试窗口：{dataset?.window_counts?.test ?? 0}</div>
              </div>

              {selectedDetails.length ? (
                <div className="tn-m5-selected-summary">
                  <strong>本次评估实验清单</strong>
                  {selectedDetails.map((item) => (
                    <div key={item.experiment_id}>{item.algorithm_label} · {item.display_id}</div>
                  ))}
                </div>
              ) : null}
              {compatibility ? (
                <div className="tn-m5-compatibility">
                  <div>可比较实验：{compatibility.compatibility?.eligible_experiments?.length ?? 0}</div>
                  <div>数据集版本一致：{compatibility.compatibility?.same_dataset_hash ? '是' : '否'}</div>
                  <div>H 一致：{compatibility.compatibility?.same_horizon ? '是' : '否'}</div>
                  <div>允许标准排名：{compatibility.compatibility?.standard_ranking_allowed ? '是' : '否'}</div>
                  {(compatibility.compatibility?.non_eligible ?? []).map((item: any) => (
                    <div className="tn-warning-text" key={item.experiment_id}>
                      {item.display_id ?? item.experiment_id}：{item.reason ?? item.status}
                    </div>
                  ))}
                </div>
              ) : null}
              {warnings.map((item) => (
                <div className="tn-warning-text" key={item.path + item.code}>{item.message}</div>
              ))}
              <div className="tn-inline tn-m5-actions">
                <Button
                  data-testid="m5-run-evaluation"
                  type="primary"
                  onClick={runEvaluation}
                  loading={busy}
                  disabled={!valid || !selectedExperiments.length}
                >
                  {ACTION_LABELS.startEvaluation}
                </Button>
                <Button
                  danger
                  disabled={!evaluation || !['Queued', 'Running', 'Stopping'].includes(evaluation.status)}
                  onClick={async () => {
                    if (!evaluation) return
                    try {
                      await api.post(ENDPOINTS.evaluationStop(evaluation.evaluation_id))
                      messageApi.success('评价停止请求已提交')
                    } catch (error) {
                      messageApi.error(error instanceof ApiError ? error.message : String(error))
                    }
                  }}
                >
                  {ACTION_LABELS.stopEvaluation}
                </Button>
              </div>
            </Card>

            <Card
              size="small"
              title={`评价历史（Evaluation History） · ${evaluations.length}`}
              data-testid="m5-history"
            >
              {evaluations.length ? evaluations.map((item) => (
                <div
                  className="tn-history-row tn-m5-history-row"
                  key={item.evaluation_id}
                  data-evaluation-id={item.evaluation_id}
                >
                  <div>
                    <div className="tn-code">{item.evaluation_id}</div>
                    <div className="tn-muted">
                      {item.dataset_display_id ?? item.dataset_id} · {item.region_id ?? '—'} · {item.experiments?.length ?? 0} 个模型
                    </div>
                    <div className="tn-muted">{formatShanghaiDateTime(item.created_at)}</div>
                  </div>
                  <div className="tn-inline">
                    <StatusTag status={item.status} error={item.error} />
                    <Button size="small" onClick={() => openEvaluation(item.evaluation_id)}>
                      查看
                    </Button>
                    <Popconfirm
                      title="删除这条评价记录？"
                      description="仅删除该评价的预测、指标和任务记录，不删除数据集、训练实验或模型文件。"
                      onConfirm={async () => {
                        try {
                          await api.del(ENDPOINTS.evaluationDelete(item.evaluation_id))
                          messageApi.success('评价记录已删除')
                          loadHistory()
                          if (evaluation?.evaluation_id === item.evaluation_id) clearResult()
                        } catch (error) {
                          messageApi.error(error instanceof ApiError ? error.message : String(error))
                        }
                      }}
                    >
                      <Button size="small" danger>{ACTION_LABELS.deleteRecord}</Button>
                    </Popconfirm>
                  </div>
                </div>
              )) : <EmptyState text="暂无评价历史。" />}
            </Card>
          </div>
        }
        visual={
          <div className="tn-stack tn-m5-workspace">
            {evaluation && ['Queued', 'Running', 'Stopping'].includes(evaluation.status) ? (
              <Alert
                type="info"
                showIcon
                message={`评价状态：${statusLabel(evaluation.status)} · ${Number(evaluation.progress?.percent ?? 0).toFixed(0)}%`}
                description={evaluation.progress?.message ?? '等待后端 worker 处理'}
              />
            ) : null}
            {evaluation?.error ? <Alert type="error" showIcon message="评价失败" description={evaluation.error} /> : null}
            {experimentReports.filter((item: any) => item.status === 'Failed' || item.status === 'Partial').map((item: any) => (
              <Alert
                key={item.experiment_id}
                type={item.status === 'Failed' ? 'error' : 'warning'}
                showIcon
                message={`${item.algorithm_label} · ${item.display_id ?? item.experiment_id} · ${statusLabel(item.status)}`}
                description={(item.errors ?? []).map((error: any) => error.error).join('；') || '该实验没有完整有效预测结果'}
              />
            ))}

            <Card
              size="small"
              title="1 · 预测详情（Forecast Details）"
              data-testid="m5-forecast-details"
            >
              <div className="tn-inline tn-m5-detail-banner">
                <Tag color={viewingHistory ? 'gold' : 'blue'}>
                  {viewingHistory ? '正在查看历史评价' : '当前配置'}
                </Tag>
                <span className="tn-muted">所有信息只读，实验仅由左侧手动选择</span>
              </div>
              {dataset && selectedDetails.length ? (
                <>
                  <div className="tn-m5-detail-grid">
                    <div><span>数据集 ID</span><strong>{dataset.display_id ?? dataset.dataset_id}</strong></div>
                    <div><span>数据源</span><strong>{sourceDisplayName(dataset.source_key, dataset.source_display_name)}</strong></div>
                    <div><span>区域</span><strong>{dataset.region_ids?.[0] ?? '—'}</strong></div>
                    <div><span>原生采样频率</span><strong>{frequencyLabel(dataset.frequency)}</strong></div>
                    <div><span>输入长度 L</span><strong>{dataset.L}</strong></div>
                    <div><span>输出长度 H</span><strong>{dataset.H}</strong></div>
                    <div><span>滑动步长 S</span><strong>{dataset.S}</strong></div>
                    <div><span>有效测试窗口</span><strong>{displayTestWindows}</strong></div>
                    <div className="tn-m5-detail-wide"><span>测试时间范围</span><strong>{displayTestStart} 至 {displayTestEnd}</strong></div>
                    <div><span>有效预测样本</span><strong>{displayTestSamples}</strong></div>
                  </div>
                  <div className="tn-m5-selected-cards">
                    {selectedDetails.map((item) => (
                      <div className="tn-m5-selected-card" key={item.experiment_id}>
                        <div className="tn-inline">
                          <strong>{item.algorithm_label}</strong>
                          <StatusTag status={item.status} />
                        </div>
                        <div className="tn-code">{item.display_id}</div>
                        <div className="tn-muted">{formatParams(item.params)}</div>
                        <div className="tn-muted">训练完成：{formatShanghaiDateTime(item.training_completed_at)}</div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <EmptyState text="请选择数据集并手动勾选至少一个已完成实验。" />
              )}
            </Card>

            <Card
              size="small"
              title="2 · 预测对比（Prediction Comparison）"
              data-testid="m5-prediction-comparison"
              extra={
                <div className="tn-inline">
                  <span className="tn-muted">预测步长</span>
                  <Select
                    data-testid="m5-horizon-selector"
                    size="small"
                    style={{ width: 84 }}
                    value={horizonStep}
                    options={horizonSteps.map((step) => ({ value: step, label: `h=${step}` }))}
                    onChange={setHorizonStep}
                  />
                </div>
              }
            >
              <div
                data-testid="m5-prediction-chart"
                data-point-count={comparisonData.x.length}
                data-series-count={comparisonData.series.length}
              >
                <LineChart
                  height={320}
                  x={comparisonData.x}
                  series={comparisonData.series}
                  xName="目标时间"
                  yName={dataset?.unit_label ? `流量（${unitDisplayLabel(dataset.unit_label)}）` : '流量'}
                  empty={!comparisonData.series.length}
                />
              </div>
              <div className="tn-muted">
                当前显示 h={horizonStep}。预测值按目标时间戳对齐；同一实验、同一 h 的重复目标时间保留最早预测窗口，缺失值保持为空。
              </div>
            </Card>

            <Card
              size="small"
              title="3 · 预测时域分析（Forecast Horizon Analysis）"
              data-testid="m5-horizon-analysis"
              extra={
                <Select
                  size="small"
                  value={horizonMetric}
                  options={[{ value: 'mae', label: 'MAE' }, { value: 'rmse', label: 'RMSE' }]}
                  onChange={setHorizonMetric}
                />
              }
            >
              <div
                data-testid="m5-horizon-chart"
                data-horizon-count={horizonSteps.length}
                data-series-count={horizonSeries.length}
              >
                <LineChart
                  height={280}
                  x={horizonSteps.map((step) => `h=${step}`)}
                  series={horizonSeries}
                  xName="预测步长"
                  yName={horizonMetric.toUpperCase()}
                  empty={!horizonSeries.length}
                />
              </div>
              <div className="tn-muted">本区域始终展示完整 h=1 至 h=H，不受上方预测对比当前 h 的影响。</div>
            </Card>

            <Card
              size="small"
              title="4 · 误差分析（Error Analysis）"
              data-testid="m5-error-analysis"
            >
              <div className="tn-muted">当前分析步长：h={horizonStep} · 误差定义：预测值 − 真实值</div>
              <div
                data-testid="m5-error-chart"
                data-point-count={errorData.x.length}
                data-series-count={errorData.series.length}
              >
                <LineChart
                  height={270}
                  x={errorData.x}
                  series={errorData.series}
                  xName="目标时间"
                  yName={`误差（h=${horizonStep}）`}
                  empty={!errorData.series.length}
                />
              </div>
              <div className="tn-m5-error-grid">
                <Card size="small" title={`当前 h=${horizonStep} 平均绝对误差`}>
                  <BarChart
                    height={230}
                    categories={errorComparison.map((item) => item.name)}
                    values={errorComparison.map((item) => item.mae)}
                    color="#12A67A"
                    xName="实验"
                    yName="MAE"
                  />
                </Card>
                <Card size="small" title="误差分布">
                  <BarChart
                    height={230}
                    categories={errorHistogram.labels}
                    values={errorHistogram.counts}
                    color="#2467E8"
                    xName="预测值 − 真实值"
                    yName="频数"
                  />
                </Card>
              </div>
            </Card>

            <Card
              size="small"
              title="5 · 评估概览（Evaluation Overview）"
              data-testid="m5-evaluation-overview"
              extra={
                <Select
                  size="small"
                  value={rankingMetric}
                  options={(Object.keys(METRIC_LABELS) as MetricKey[]).map((key) => ({
                    value: key,
                    label: `排序：${METRIC_LABELS[key]}`,
                  }))}
                  onChange={setRankingMetric}
                />
              }
            >
              <div className="tn-muted">
                下表为完整 H 步任务的整体指标（包含 h=1 至 h=H 的全部有效预测），不是仅 h={horizonStep} 的分步指标。
              </div>
              <Table
                size="small"
                rowKey="experiment_id"
                pagination={false}
                dataSource={ranking}
                columns={[
                  { title: '排名', render: (_: unknown, __: any, index: number) => index + 1, width: 58 },
                  { title: '模型', dataIndex: 'algorithm_label' },
                  { title: 'EXP ID', render: (_: unknown, row: any) => row.display_id ?? row.experiment_id },
                  { title: 'MAE', render: (_: unknown, row: any) => formatMetric(row.macro?.mae) },
                  { title: 'RMSE', render: (_: unknown, row: any) => formatMetric(row.macro?.rmse) },
                  { title: 'sMAPE', render: (_: unknown, row: any) => isNumber(row.macro?.smape) ? `${row.macro.smape.toFixed(2)}%` : '不适用' },
                  { title: 'R²', render: (_: unknown, row: any) => formatMetric(row.macro?.r2, 4) },
                  { title: '有效样本', render: (_: unknown, row: any) => row.macro?.n_samples ?? 0 },
                ]}
              />
              {experimentReports.length !== ranking.length ? (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginTop: 8 }}
                  message="部分实验没有有效整体指标，未进入排名"
                  description={experimentReports
                    .filter((item: any) => !isNumber(item.macro?.[rankingMetric]))
                    .map((item: any) => `${item.display_id ?? item.experiment_id}：无有效 ${METRIC_LABELS[rankingMetric]}`)
                    .join('；')}
                />
              ) : null}
            </Card>
          </div>
        }
      />
    </div>
  )
}
