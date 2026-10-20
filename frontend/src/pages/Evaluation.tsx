import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Collapse, Popconfirm, Select, Table, Tabs, Tag, Tooltip, message } from 'antd'
import { useSearchParams } from 'react-router-dom'
import { ENDPOINTS, ApiError, api, downloadUrl, type Issue } from '../api/client'
import { EmptyState, ModuleHeader, PaneHead, ThreePane } from '../components/Panes'
import ParamField from '../components/ParamField'
import StatusTag from '../components/StatusTag'
import BiLabel from '../components/BiLabel'
import { BarChart, LineChart } from '../components/Charts'
import MapView, { BLUE_PALETTE, colorScale, type MapEntry } from '../components/MapView'
import { useGroupValidation } from '../validation/useValidation'
import { fieldDisabledReason, isVisible, visibleFields, type FieldSpec } from '../validation/engine'
import {
  ACTION_LABELS, MODULE_META, bilingual, frequencyLabel, missingModeLabel, modeLabel,
  scalingLabel, scopeLabel, sourceDisplayName, statusLabel, unitDisplayLabel,
} from '../i18n/terms'

export default function Evaluation() {
  const [messageApi, contextHolder] = message.useMessage()
  const [searchParams] = useSearchParams()
  const [datasets, setDatasets] = useState<any[]>([])
  const [datasetId, setDatasetId] = useState<string>(searchParams.get('dataset') ?? '')
  const [dataset, setDataset] = useState<any>(null)
  const [experiments, setExperiments] = useState<any[]>([])
  const [selectedExperiments, setSelectedExperiments] = useState<string[]>(
    searchParams.get('experiment') ? [searchParams.get('experiment') as string] : [],
  )
  const [batches, setBatches] = useState<any[]>([])
  const [batchChoice, setBatchChoice] = useState<string>('')
  const [scope, setScope] = useState<'single' | 'all'>('single')
  const [regionId, setRegionId] = useState<string>('')
  const [testSelection, setTestSelection] = useState<'full' | 'range'>('full')
  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd, setRangeEnd] = useState('')
  const [compatibility, setCompatibility] = useState<any>(null)
  const [evaluation, setEvaluation] = useState<any>(null)
  const [evaluations, setEvaluations] = useState<any[]>([])
  const [predictions, setPredictions] = useState<any[]>([])
  const [seriesByExperiment, setSeriesByExperiment] = useState<Record<string, any[]>>({})
  const [centerTab, setCenterTab] = useState('comparison')
  const [rightTab, setRightTab] = useState('metrics')
  const [busy, setBusy] = useState(false)
  const [serverIssues, setServerIssues] = useState<Issue[]>([])
  const [geojson, setGeojson] = useState<any>(null)
  const [horizonStep, setHorizonStep] = useState(1)
  const [spatialLayer, setSpatialLayer] = useState<'actual' | 'predicted' | 'absolute_error' | 'relative_error'>('actual')

  const schema: FieldSpec[] = useMemo(
    () => [
      { key: 'experiment_ids', label_zh: '实验（可多选）', type: 'array', enum: experiments.filter((e) => ['Completed', 'Partial'].includes(e.status)).map((e) => e.experiment_id), enum_labels: experiments.filter((e) => ['Completed', 'Partial'].includes(e.status)).map((e) => `${e.algorithm_label} · ${modeLabel(e.mode)} · ${e.display_id ?? e.experiment_id}`), default: [], help_zh: '选择 1 到 N 个实验参加同口径比较。', suggestion_zh: '可用批量任务一键载入。' },
      { key: 'scope', label_zh: '评价范围', type: 'enum', enum: ['single', 'all'], enum_labels: ['单区域', '全部区域'], default: 'single', help_zh: '单区域评价一个区域；全部区域只允许来自全区域实验组的模型。', suggestion_zh: '与实验的预测范围保持一致。' },
      { key: 'region_id', label_zh: '区域', type: 'enum', enum: dataset?.region_ids ?? [], default: '', required: false, visible_when: { scope: 'single' }, help_zh: '单区域范围下要评价的区域。', suggestion_zh: '从数据集区域中选择。' },
      { key: 'test_selection', label_zh: '测试范围', type: 'enum', enum: ['full', 'range'], enum_labels: ['完整测试集（正式成绩）', '选定测试范围'], default: 'full', help_zh: '完整测试集用于正式评分；选定范围只是可视化子集，会标注子集来源。', suggestion_zh: '提交成绩请使用完整测试集。' },
      { key: 'horizon_step', label_zh: '显示预测步长', type: 'integer', min: 1, max: 100, default: 1, help_zh: '图表默认展示的预测步长，不改变 H，也不影响指标口径。', suggestion_zh: '默认 1。' },
    ],
    [experiments, dataset],
  )

  const values = useMemo(
    () => ({
      dataset_id: datasetId,
      scope,
      region_id: regionId,
      experiment_ids: selectedExperiments,
      test_selection: testSelection,
      range_start_at: rangeStart || null,
      range_end_at: rangeEnd || null,
      horizon_step: horizonStep,
    }),
    [datasetId, scope, regionId, selectedExperiments, testSelection, rangeStart, rangeEnd, horizonStep],
  )

  const { fieldIssues, errors, warnings, valid } = useGroupValidation({
    specs: schema,
    values,
    pathPrefix: 'm5',
    remote: datasetId ? { kind: 'm5', values, context: { dataset: dataset ? { dataset_id: dataset.dataset_id, H: dataset.H } : null } } : null,
  })

  const loadDatasets = useCallback(() => {
    api.get<any>(ENDPOINTS.datasetList).then((data) => {
      const built = data.datasets.filter((d: any) => d.status !== 'Archived')
      setDatasets(built)
      setDatasetId((prev) => (prev && built.some((d: any) => d.dataset_id === prev) ? prev : built[0]?.dataset_id ?? ''))
    })
  }, [])

  const loadHistory = useCallback(() => {
    api.get<any>(ENDPOINTS.evaluationList).then((data) => setEvaluations(data.evaluations)).catch(() => undefined)
    api.get<any>(ENDPOINTS.batchList).then((data) => setBatches(data.batches)).catch(() => undefined)
  }, [])

  useEffect(() => {
    loadDatasets()
    loadHistory()
  }, [loadDatasets, loadHistory])

  useEffect(() => {
    if (!datasetId) return
    api
      .get<any>(ENDPOINTS.datasetGet(datasetId))
      .then((data) => {
        setDataset(data)
        setScope(data.scope === 'all' ? 'all' : 'single')
        setRegionId((prev) => (prev && data.region_ids.includes(prev) ? prev : data.region_ids[0]))
      })
      .catch(() => undefined)
  }, [datasetId])

  useEffect(() => {
    if (!datasetId) return
    api.get<any>(`${ENDPOINTS.experimentList}?dataset_id=${datasetId}`).then((data) => setExperiments(data.experiments)).catch(() => undefined)
  }, [datasetId])

  useEffect(() => {
    if (!datasetId) return
    api.get<any>(ENDPOINTS.geometry(dataset?.source_key ?? 'milano')).then(setGeojson).catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset?.source_key])

  useEffect(() => {
    if (!datasetId || !selectedExperiments.length) return
    api
      .post<any>(ENDPOINTS.evaluationValidate, values)
      .then(setCompatibility)
      .catch(() => setCompatibility(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, selectedExperiments.join(','), scope])

  // poll a running evaluation
  useEffect(() => {
    if (!evaluation || !['Queued', 'Running', 'Stopping'].includes(evaluation.status)) return
    const timer = window.setInterval(async () => {
      try {
        const data = await api.get<any>(ENDPOINTS.evaluationGet(evaluation.evaluation_id))
        setEvaluation(data)
        setPredictions(data.predictions ?? [])
        if (!['Queued', 'Running', 'Stopping'].includes(data.status)) {
          loadHistory()
          messageApi.success(`评价 ${data.evaluation_id} 状态：${statusLabel(data.status)}`)
        }
      } catch {
        /* keep previous */
      }
    }, 2500)
    return () => window.clearInterval(timer)
  }, [evaluation, loadHistory, messageApi])

  const loadSeries = useCallback(
    async (evaluationId: string, experimentIds: string[], region?: string) => {
      const out: Record<string, any[]> = {}
      for (const experimentId of experimentIds) {
        try {
          const data = await api.get<any>(ENDPOINTS.evaluationSeries(evaluationId, experimentId, region))
          out[experimentId] = data.rows
        } catch {
          out[experimentId] = []
        }
      }
      setSeriesByExperiment(out)
    },
    [],
  )

  useEffect(() => {
    if (!evaluation || evaluation.status !== 'Completed') return
    const ids = (evaluation.experiments ?? []).filter((e: any) => e.coverage_regions > 0).map((e: any) => e.experiment_id)
    loadSeries(evaluation.evaluation_id, ids, scope === 'single' ? regionId : undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evaluation?.evaluation_id, evaluation?.status, regionId, scope])

  const runEvaluation = async () => {
    if (!valid) {
      messageApi.error('存在参数错误，无法运行评价。')
      return
    }
    setBusy(true)
    setServerIssues([])
    try {
      const created = await api.post<any>(ENDPOINTS.evaluationRun, values)
      messageApi.success(`评价 ${created.evaluation_id} 已创建（${created.experiment_count} 个实验，${created.region_count} 个区域）`)
      const data = await api.get<any>(ENDPOINTS.evaluationGet(created.evaluation_id))
      setEvaluation(data)
      setPredictions(data.predictions ?? [])
      loadHistory()
    } catch (err) {
      if (err instanceof ApiError) {
        setServerIssues(err.issues)
        messageApi.error(`后端拒绝：${err.message}`)
      } else messageApi.error(String(err))
    } finally {
      setBusy(false)
    }
  }

  const loadFromBatch = async (batchId: string) => {
    setBatchChoice(batchId)
    try {
      const data = await api.get<any>(ENDPOINTS.batchGet(batchId))
      const eligible = (data.experiments ?? []).filter((e: any) => ['Completed', 'Partial'].includes(e.status))
      const excluded = (data.experiments ?? []).filter((e: any) => !['Completed', 'Partial'].includes(e.status))
      setDatasetId(data.dataset_id)
      setSelectedExperiments(eligible.map((e: any) => e.experiment_id))
      if (excluded.length) {
        messageApi.warning(
          `${excluded.length} 个实验无法评价：` +
            excluded.map((e: any) => `${e.algorithm_label}（${statusLabel(e.status)}）`).join('、'),
        )
      } else {
        messageApi.success(`已载入批量任务 ${data.display_id ?? batchId} 的 ${eligible.length} 个成功实验`)
      }
    } catch (err) {
      messageApi.error(err instanceof ApiError ? err.message : String(err))
    }
  }

  const openEvaluation = async (evaluationId: string) => {
    try {
      const data = await api.get<any>(ENDPOINTS.evaluationGet(evaluationId))
      setEvaluation(data)
      setPredictions(data.predictions ?? [])
      setDatasetId(data.dataset_id)
      setSelectedExperiments((data.experiments ?? []).map((e: any) => e.experiment_id))
      setScope(data.scope)
      if (data.region_id) setRegionId(data.region_id)
      // refresh the compatibility panel for the restored selection instead of
      // leaving stale/undefined values from a previous configuration
      const experimentIds = (data.experiments ?? []).map((e: any) => e.experiment_id)
      const compatibilityPayload = {
        dataset_id: data.dataset_id,
        scope: data.scope,
        region_id: data.region_id ?? undefined,
        experiment_ids: experimentIds,
        test_selection: 'full',
        horizon_step: 1,
      }
      api
        .post<any>(ENDPOINTS.evaluationValidate, compatibilityPayload)
        .then(setCompatibility)
        .catch(() => setCompatibility(null))
      messageApi.success(`已打开 ${evaluationId}`)
    } catch (err) {
      messageApi.error(String(err))
    }
  }

  const ranking = evaluation?.metrics_summary?.ranking ?? []
  const experimentReports = evaluation?.metrics_summary?.experiments ?? []

  const comparisonSeries = useMemo(() => {
    const groups = Object.entries(seriesByExperiment)
    if (!groups.length) return { x: [], series: [] as any[] }
    const filtered = groups.map(([experimentId, rows]) => ({
      experimentId,
      rows: rows.filter((row) => row.horizon_step === horizonStep),
    }))
    const first = filtered[0]?.rows ?? []
    const x = first.map((row) => row.target_at)
    const series = [
      { name: '真实值', data: first.map((row) => row.y_true), color: '#142B52' },
      ...filtered.map((group, index) => ({
        name: experimentReports.find((e: any) => e.experiment_id === group.experimentId)?.algorithm_label ?? group.experimentId.slice(0, 14),
        data: group.rows.map((row) => row.y_pred),
        color: BLUE_PALETTE[index % BLUE_PALETTE.length],
      })),
    ]
    return { x, series }
  }, [seriesByExperiment, horizonStep, experimentReports])

  const errorSeries = useMemo(() => {
    const groups = Object.entries(seriesByExperiment)
    if (!groups.length) return { x: [], series: [] as any[] }
    const first = groups[0][1].filter((row) => row.horizon_step === horizonStep)
    return {
      x: first.map((row) => row.target_at),
      series: groups.map(([experimentId, rows], index) => ({
        name: experimentReports.find((e: any) => e.experiment_id === experimentId)?.algorithm_label ?? experimentId,
        data: rows.filter((row) => row.horizon_step === horizonStep).map((row) => row.y_pred - row.y_true),
        color: BLUE_PALETTE[index % BLUE_PALETTE.length],
      })),
    }
  }, [seriesByExperiment, horizonStep, experimentReports])

  const horizonCurves = useMemo(() => {
    const steps = Array.from({ length: dataset?.H ?? 0 }, (_, i) => i + 1)
    return {
      x: steps.map((step) => `h=${step}`),
      series: experimentReports.map((report: any, index: number) => {
        const rows = seriesByExperiment[report.experiment_id] ?? []
        const data = steps.map((step) => {
          const subset = rows.filter((row) => row.horizon_step === step)
          if (!subset.length) return null
          const mae = subset.reduce((acc, row) => acc + Math.abs(row.y_pred - row.y_true), 0) / subset.length
          return mae
        })
        return {
          name: report.algorithm_label,
          data,
          color: BLUE_PALETTE[index % BLUE_PALETTE.length],
        }
      }),
    }
  }, [seriesByExperiment, experimentReports, dataset])

  const spatialEntries: MapEntry[] = useMemo(() => {
    const report = experimentReports[0]
    if (!report) return []
    const perRegion = report.macro?.n_regions ? report.macro : null
    const regionMetrics: Record<string, any> = {}
    ;(report.per_region ?? []).forEach((row: any) => {
      regionMetrics[row.region_id] = row
    })
    return (dataset?.region_ids ?? []).map((id: string) => {
      const metrics = regionMetrics[id]
      let value: number | null = null
      if (metrics) {
        if (spatialLayer === 'actual') value = null
        if (spatialLayer === 'absolute_error') value = metrics.mae ?? null
        if (spatialLayer === 'relative_error') value = metrics.smape ?? null
        if (spatialLayer === 'predicted') value = null
      }
      return { region_id: id, value, has_timeseries: true }
    })
  }, [experimentReports, dataset, spatialLayer])

  const predictionRegionValues = useMemo(() => {
    if (spatialLayer !== 'actual' && spatialLayer !== 'predicted') return spatialEntries
    const rows = predictions
    const grouped: Record<string, { actual: number[]; predicted: number[] }> = {}
    rows.forEach((row) => {
      grouped[row.region_id] = grouped[row.region_id] ?? { actual: [], predicted: [] }
      if (row.y_true !== null) grouped[row.region_id].actual.push(row.y_true)
      if (row.y_pred !== null) grouped[row.region_id].predicted.push(row.y_pred)
    })
    return (dataset?.region_ids ?? []).map((id: string) => {
      const bucket = grouped[id]
      const value = bucket
        ? spatialLayer === 'actual'
          ? bucket.actual.reduce((a, b) => a + b, 0) / Math.max(1, bucket.actual.length)
          : bucket.predicted.reduce((a, b) => a + b, 0) / Math.max(1, bucket.predicted.length)
        : null
      return { region_id: id, value, has_timeseries: true }
    })
  }, [predictions, dataset, spatialLayer, spatialEntries])

  const colorBounds = useMemo(() => {
    const values = predictionRegionValues
      .map((entry: MapEntry) => entry.value)
      .filter((value: number | null | undefined): value is number => value !== null && value !== undefined)
    if (!values.length) return { min: 0, max: 1 }
    return { min: Math.min(...values), max: Math.max(...values) }
  }, [predictionRegionValues])

  return (
    <div>
      {contextHolder}
      <ModuleHeader
        module={MODULE_META.m5.index}
        titleZh={MODULE_META.m5.titleZh}
        titleEn={MODULE_META.m5.titleEn}
        description="使用相同留出测试集的真实预测、误差分析与公平排名"
        datasetInfo={evaluation ? `${evaluation.evaluation_id} · ${statusLabel(evaluation.status)} · ${evaluation.experiments?.length ?? 0} 个实验` : '尚未运行评价'}
      />
      {errors.length > 0 ? (
        <Alert type="error" showIcon style={{ marginBottom: 10 }} message={`${errors.length} 个参数错误（见字段下方提示）`} description={errors.slice(0, 3).map((e) => `${e.path}: ${e.message}`).join('；')} />
      ) : null}
      {serverIssues.length > 0 ? (
        <Alert type="error" showIcon style={{ marginBottom: 10 }} message="后端拒绝了请求（未创建评价 ID）" description={serverIssues.map((i) => `${i.path}: ${i.message}`).join('；')} />
      ) : null}
      <ThreePane
        config={
          <>
            <PaneHead
              title={bilingual('评价设置', 'Evaluation Setup')}
              extra={
                <Button size="small" onClick={() => { setSelectedExperiments([]); setBatchChoice(''); setTestSelection('full'); setRangeStart(''); setRangeEnd(''); setEvaluation(null); setPredictions([]); setSeriesByExperiment({}) }}>
                  重置选择
                </Button>
              }
            />
            <div className="tn-field">
              <label className="tn-field-label">数据源 / 数据集</label>
              <Select
                size="small"
                style={{ width: '100%' }}
                value={datasetId || undefined}
                placeholder="选择数据集"
                options={datasets.map((d) => ({ value: d.dataset_id, label: `${d.display_id ?? d.dataset_id} · ${sourceDisplayName(d.source_key, d.source_display_name)} · ${scopeLabel(d.scope)}` }))}
                onChange={(value) => { setDatasetId(value); setEvaluation(null) }}
              />
            </div>
            <div className="tn-field">
              <label className="tn-field-label">批量任务快捷入口（Batch ID）</label>
              <Select
                size="small"
                style={{ width: '100%' }}
                value={batchChoice || undefined}
                placeholder="按批量任务 ID 一键载入成功实验"
                options={batches.map((b) => ({ value: b.batch_id, label: `${b.display_id ?? b.batch_id} · ${statusLabel(b.status)} · 完成 ${b.task_summary?.completed ?? 0}` }))}
                onChange={loadFromBatch}
              />
              <div className="tn-muted">失败或被跳过的模型会显示原因，并且不进入排名。</div>
            </div>
            {visibleFields(schema, values).map((spec) => (
              <ParamField
                key={spec.key}
                spec={spec}
                value={values[spec.key as keyof typeof values]}
                issues={fieldIssues(spec.key)}
                path={`m5.${spec.key}`}
                onChange={(key, value) => {
                  if (key === 'scope') setScope(value as 'single' | 'all')
                  else if (key === 'region_id') setRegionId(String(value ?? ''))
                  else if (key === 'experiment_ids') setSelectedExperiments((value as string[]) ?? [])
                  else if (key === 'test_selection') setTestSelection(value as 'full' | 'range')
                  else if (key === 'horizon_step') setHorizonStep(Number(value) || 1)
                }}
                disabledReason={fieldDisabledReason(spec, values)}
                compact
              />
            ))}
            {testSelection === 'range' ? (
              <>
                <div className="tn-field">
                  <label className="tn-field-label">子集开始时间</label>
                  <input
                    className="ant-input"
                    style={{ width: '100%', height: 28 }}
                    value={rangeStart}
                    placeholder="2024-08-01 00:00:00"
                    onChange={(event) => setRangeStart(event.target.value)}
                  />
                </div>
                <div className="tn-field">
                  <label className="tn-field-label">子集结束时间</label>
                  <input
                    className="ant-input"
                    style={{ width: '100%', height: 28 }}
                    value={rangeEnd}
                    placeholder="2024-08-05 23:45:00"
                    onChange={(event) => setRangeEnd(event.target.value)}
                  />
                </div>
              </>
            ) : null}
            <div className="tn-field">
              <label className="tn-field-label">只读快照（Read-only Snapshot）</label>
              <div className="tn-muted">
                {dataset ? (
                  <>
                    <div>来源：{sourceDisplayName(dataset.source_key, dataset.source_display_name)} · {unitDisplayLabel(dataset.unit_label)}</div>
                    <div>预测范围：{scopeLabel(dataset.scope)} · 区域 {dataset.region_count}</div>
                    <div>L/H/S：{dataset.L}/{dataset.H}/{dataset.S} · {frequencyLabel(dataset.frequency)}</div>
                    <div>预处理：{missingModeLabel(dataset.preprocess?.missing_mode)} / {scalingLabel(dataset.preprocess?.scaling)}</div>
                    <div>测试窗口：{dataset.window_counts?.test}</div>
                    <div>数据集哈希（Dataset hash）：{String(dataset.hash).slice(0, 16)}…</div>
                  </>
                ) : (
                  '选择数据集后显示快照'
                )}
              </div>
            </div>
            {compatibility ? (
              <div className="tn-field">
                <label className="tn-field-label">兼容性检查</label>
                <div className="tn-muted">
                  <div>可比较实验：{compatibility.eligible_experiments?.length ?? 0}</div>
                  <div>相同数据集：{compatibility.same_dataset ? '是' : '否'} · 相同评价范围：{compatibility.same_scope ? '是' : '否'}</div>
                  <div>允许标准排名：{compatibility.standard_ranking_allowed ? '是' : '否'}</div>
                  {(compatibility.non_eligible ?? []).map((item: any) => (
                    <div key={item.experiment_id} className="tn-warning-text">
                      ⚠ {item.display_id ?? item.experiment_id}（{statusLabel(item.status)}）不进入排名
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="tn-inline">
              <Button type="primary" onClick={runEvaluation} loading={busy} disabled={!valid}>{ACTION_LABELS.startEvaluation}</Button>
              <Button
                danger
                onClick={async () => {
                  if (!evaluation) return
                  try { await api.post(ENDPOINTS.evaluationStop(evaluation.evaluation_id)); messageApi.success('已请求停止') } catch (err) { messageApi.error(err instanceof ApiError ? err.message : String(err)) }
                }}
              >
                {ACTION_LABELS.stopEvaluation}
              </Button>
              <a href={evaluation ? downloadUrl(ENDPOINTS.evaluationExport(evaluation.evaluation_id)) : '#'}>
                <Button disabled={!evaluation}>{ACTION_LABELS.exportResults}</Button>
              </a>
            </div>
            {warnings.map((w) => (
              <div className="tn-warning-text" key={w.path + w.code}>⚠ {w.message}</div>
            ))}
          </>
        }
        visual={
          <Tabs
            className="tn-tabs-tight"
            activeKey={centerTab}
            onChange={setCenterTab}
            items={[
              {
                key: 'comparison',
                label: <BiLabel zh="预测对比" en="Prediction Comparison" />,
                children: (
                  <div className="tn-stack">
                    <div className="tn-inline">
                      <span className="tn-muted">预测步长</span>
                      <Select
                        size="small"
                        style={{ width: 90 }}
                        value={horizonStep}
                        options={Array.from({ length: dataset?.H ?? 1 }, (_, i) => ({ value: i + 1, label: `h=${i + 1}` }))}
                        onChange={setHorizonStep}
                      />
                      <span className="tn-muted">预测重叠按（区域、窗口、预测步长）计一次</span>
                    </div>
                    <LineChart
                      height={280}
                      x={comparisonSeries.x}
                      series={comparisonSeries.series}
                      xName="时间"
                      yName={dataset?.unit_label ? `流量（${unitDisplayLabel(dataset.unit_label)}）` : '流量值'}
                      empty={!comparisonSeries.series.length}
                    />
                    <div className="tn-muted">
                      真实值为留出测试集的真实观测（源单位）；全部区域默认显示区域平均曲线，可切换区域下钻。
                    </div>
                  </div>
                ),
              },
              {
                key: 'error',
                label: <BiLabel zh="误差分析" en="Error Analysis" />,
                children: (
                  <div className="tn-stack">
                    <LineChart height={240} x={errorSeries.x} series={errorSeries.series} xName="时间" yName="误差（预测值 − 真实值）" empty={!errorSeries.series.length} />
                    <Card size="small" title={bilingual('模型误差对比', 'Model Error Comparison')}>
                      {experimentReports.length ? (
                        <BarChart
                          height={200}
                          categories={experimentReports.map((e: any) => e.algorithm_label)}
                          values={experimentReports.map((e: any) => e.macro?.mae ?? null)}
                          color="#12A67A"
                          xName="模型"
                          yName="平均绝对误差（MAE）"
                        />
                      ) : (
                        <EmptyState text="运行评价后显示误差对比。" />
                      )}
                    </Card>
                    {(experimentReports ?? []).filter((e: any) => (e.errors ?? []).length).map((e: any) => (
                      <Alert
                        key={e.experiment_id}
                        type="warning"
                        showIcon
                        message={`${e.algorithm_label} 有 ${e.errors.length} 个区域失败/缺失`}
                        description={e.errors.slice(0, 3).map((err: any) => `${err.region_id}: ${err.error}`).join('；')}
                      />
                    ))}
                  </div>
                ),
              },
              {
                key: 'horizon',
                label: <BiLabel zh="预测时域分析" en="Forecast Horizon Analysis" />,
                children: (
                  <div className="tn-stack">
                    <Card size="small" title={bilingual('各预测步长的 MAE 曲线', 'MAE by Horizon Step')}>
                      <LineChart height={250} x={horizonCurves.x} series={horizonCurves.series} xName="预测步长" yName="平均绝对误差（MAE）" empty={!horizonCurves.series.length} />
                    </Card>
                    <div className="tn-muted">按预测步长汇总；全部区域时按有效样本数加权。</div>
                  </div>
                ),
              },
              {
                key: 'spatial',
                label: <BiLabel zh="空间评估" en="Spatial Evaluation" />,
                children: (
                  <div className="tn-stack">
                    {scope === 'all' ? (
                      <>
                        <div className="tn-inline">
                          {(['actual', 'predicted', 'absolute_error', 'relative_error'] as const).map((layer) => (
                            <Button key={layer} size="small" type={spatialLayer === layer ? 'primary' : 'default'} onClick={() => setSpatialLayer(layer)}>
                              {layer === 'actual' ? '真实值' : layer === 'predicted' ? '预测值' : layer === 'absolute_error' ? '绝对误差' : '相对误差'}
                            </Button>
                          ))}
                        </div>
                        <MapView
                          geojson={geojson}
                          entries={predictionRegionValues}
                          selected={[]}
                          onToggle={() => undefined}
                          height={380}
                          colorFor={(entry) => colorScale(entry?.value ?? null, colorBounds.min, colorBounds.max, BLUE_PALETTE)}
                          formatTooltip={(entry, regionId) => `${regionId}: ${entry?.value === null || entry?.value === undefined ? '无数据 / 无预测' : entry.value.toFixed(2)}`}
                          legend={
                            <>
                              <span>低</span>
                              {BLUE_PALETTE.map((color) => (
                                <span key={color} className="tn-legend-swatch" style={{ background: color }} />
                              ))}
                              <span>高</span>
                              <span className="tn-legend-swatch" style={{ background: '#c9d3e2' }} />无数据 / 失败
                            </>
                          }
                        />
                      </>
                    ) : (
                      <EmptyState text="空间评估仅对全部区域评价可用；单区域评价不绘制空间图层。" />
                    )}
                  </div>
                ),
              },
            ]}
          />
        }
        info={
          <div className="tn-stack">
            <Tabs
              className="tn-tabs-tight"
              activeKey={rightTab}
              onChange={setRightTab}
              items={[
                {
                  key: 'metrics',
                  label: <BiLabel zh="指标概览" en="Metrics Overview" />,
                  children: experimentReports.length ? (
                    <Table
                      size="small"
                      rowKey="experiment_id"
                      pagination={false}
                      dataSource={experimentReports}
                      columns={[
                        { title: '模型', dataIndex: 'algorithm_label' },
                        { title: '平均绝对误差（MAE）', render: (_: unknown, row: any) => (row.macro?.mae === null || row.macro?.mae === undefined ? '不适用' : Number(row.macro.mae).toFixed(1)) },
                        { title: '均方根误差（RMSE）', render: (_: unknown, row: any) => (row.macro?.rmse === null || row.macro?.rmse === undefined ? '不适用' : Number(row.macro.rmse).toFixed(1)) },
                        { title: '对称平均绝对百分比误差（sMAPE）', render: (_: unknown, row: any) => (row.macro?.smape === null || row.macro?.smape === undefined ? '不适用' : `${Number(row.macro.smape).toFixed(2)}%`) },
                        { title: '决定系数（R²）', render: (_: unknown, row: any) => (row.macro?.r2 === null || row.macro?.r2 === undefined ? '不适用' : Number(row.macro.r2).toFixed(4)) },
                        { title: '样本', dataIndex: ['macro', 'n_samples'] },
                        { title: '区域', dataIndex: 'coverage_regions' },
                      ]}
                    />
                  ) : (
                    <EmptyState text="运行评价后显示真实指标（逆标准化后的源单位）。" />
                  ),
                },
                {
                  key: 'ranking',
                  label: <BiLabel zh="模型排名" en="Model Ranking" />,
                  children: ranking.length ? (
                    <div>
                      <div className="tn-muted" style={{ marginBottom: 6 }}>
                        默认按 RMSE 升序；仅相同数据集、H 和测试目标时间的实验进入排名（完整测试集）。
                      </div>
                      {ranking.map((row: any) => (
                        <div className="tn-history-row" key={row.experiment_id}>
                          <div>
                            <strong>
                              #{row.rank} {row.algorithm_label}
                            </strong>
                            <div className="tn-muted">
                              RMSE {Number(row.macro.rmse).toFixed(1)} · MAE {Number(row.macro.mae).toFixed(1)} · R²{' '}
                              {row.macro.r2 === null ? '不适用' : Number(row.macro.r2).toFixed(4)}
                            </div>
                            <div className="tn-code">{row.display_id ?? row.experiment_id}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState text="暂无排名（需要可比较的成功实验）。" />
                  ),
                },
                {
                  key: 'regional',
                  label: <BiLabel zh="区域表现" en="Regional Performance" />,
                  children: experimentReports.length ? (
                    <Table
                      size="small"
                      rowKey={(row: any) => `${row.experiment_id}-${row.region_id}`}
                      pagination={{ pageSize: 10, size: 'small' }}
                      dataSource={experimentReports.flatMap((report: any) =>
                        (report.per_region ?? []).map((region: any) => ({ ...region, algorithm_label: report.algorithm_label })),
                      )}
                      columns={[
                        { title: '区域', dataIndex: 'region_id' },
                        { title: '模型', dataIndex: 'algorithm_label' },
                        { title: '平均绝对误差（MAE）', render: (_: unknown, row: any) => (row.mae === null ? '不适用' : Number(row.mae).toFixed(1)) },
                        { title: '均方根误差（RMSE）', render: (_: unknown, row: any) => (row.rmse === null ? '不适用' : Number(row.rmse).toFixed(1)) },
                        { title: '对称平均绝对百分比误差（sMAPE）', render: (_: unknown, row: any) => (row.smape === null ? '不适用' : `${Number(row.smape).toFixed(2)}%`) },
                        { title: '决定系数（R²）', render: (_: unknown, row: any) => (row.r2 === null ? '不适用' : Number(row.r2).toFixed(4)) },
                      ]}
                    />
                  ) : (
                    <EmptyState text="暂无区域级指标。" />
                  ),
                },
              ]}
            />
            <Collapse
              size="small"
              items={[
                {
                  key: 'history',
                  label: `${bilingual('评价历史', 'Evaluation History')}（${evaluations.length}）`,
                  children: evaluations.length ? (
                    evaluations.map((item) => (
                      <div className="tn-history-row" key={item.evaluation_id}>
                        <div>
                          <div className="tn-code">{item.evaluation_id}</div>
                          <div className="tn-muted">
                            {item.scope === 'all' ? '全部区域' : `单区域（${item.region_id ?? '—'}）`} · {item.experiments?.length ?? 0} 个实验 ·{' '}
                            {item.created_at}
                          </div>
                        </div>
                        <div className="tn-inline">
                          <StatusTag status={item.status} error={item.error} />
                          <Button size="small" onClick={() => openEvaluation(item.evaluation_id)}>查看</Button>
                          <a href={downloadUrl(ENDPOINTS.evaluationExport(item.evaluation_id))}>
                            <Button size="small">导出结果</Button>
                          </a>
                          <Popconfirm
                            title="删除该评价？"
                            description="只删除本评价的预测、指标与缓存，不影响数据集和实验。"
                            onConfirm={async () => {
                              try {
                                await api.del(ENDPOINTS.evaluationDelete(item.evaluation_id))
                                messageApi.success('已删除本评价')
                                loadHistory()
                                if (evaluation?.evaluation_id === item.evaluation_id) setEvaluation(null)
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
                  ) : (
                    <EmptyState text="暂无评价历史（真实空态）。" />
                  ),
                },
              ]}
            />
            <Button size="small" onClick={() => { setSelectedExperiments([]); setEvaluation(null); setPredictions([]); setSeriesByExperiment({}) }}>
              重置选择
            </Button>
          </div>
        }
      />
    </div>
  )
}
