import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Card, Collapse, InputNumber, Popconfirm, Tooltip, message } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { ENDPOINTS, ApiError, api, type Issue } from '../api/client'
import { EmptyState, ModuleHeader, PaneHead, ThreePane } from '../components/Panes'
import ParamField from '../components/ParamField'
import StatusTag from '../components/StatusTag'
import { LineChart } from '../components/Charts'
import DateTimeField from '../components/DateTimeField'
import { useGroupValidation } from '../validation/useValidation'
import { fieldDisabledReason, visibleFields, type FieldSpec } from '../validation/engine'
import {
  ACTION_LABELS, MODULE_META, bilingual,
  missingModeLabel, regionDisplayLabel, scalingLabel, scopeLabel, sourceDisplayName, splitLabel, statusLabel,
} from '../i18n/terms'

const DEFAULT_CONFIG: Record<string, unknown> = {
  source_key: 'milano',
  scope: 'single',
  region_id: '',
  frequency: 'native',
  aggregation: 'mean',
  time_start: null,
  time_end: null,
  input_length: 24,
  output_length: 6,
  step: 1,
  train_ratio: 0.7,
  val_ratio: 0.15,
  test_ratio: 0.15,
  missing_mode: 'automatic',
  scaling: 'standard',
}

export default function DatasetPage() {
  const [messageApi, contextHolder] = message.useMessage()
  const [config, setConfig] = useState<Record<string, unknown>>({ ...DEFAULT_CONFIG })
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [regions, setRegions] = useState<any[]>([])
  const [sourceMeta, setSourceMeta] = useState<any>(null)
  const [preview, setPreview] = useState<any>(null)
  const [datasets, setDatasets] = useState<any[]>([])
  const [selectedDataset, setSelectedDataset] = useState<any>(null)
  const [previewWindowInfo, setPreviewWindowInfo] = useState<any>(null)
  const [previewWindowBusy, setPreviewWindowBusy] = useState(false)
  const [windowJumpValue, setWindowJumpValue] = useState<number>(1)
  const [datasetPage, setDatasetPage] = useState(0)
  const [busy, setBusy] = useState(false)
  const [serverIssues, setServerIssues] = useState<Issue[]>([])
  const previewRequested = useRef(false)
  const skipSourceDateReset = useRef(false)

  const schema: FieldSpec[] = useMemo(
    () => [
      { key: 'source_key', label_zh: '数据源', type: 'enum', enum: ['milano', 'trentino', 'zte'], enum_labels: ['Milano', 'Trentino', 'ZTE 4G Downlink'], default: 'milano', help_zh: '选择数据集所在的数据源，一个数据集只能属于一个数据源。', suggestion_zh: '三个来源的时间范围与单位不同，请分别建模。' },
      { key: 'scope', label_zh: '预测范围', type: 'enum', enum: ['single', 'all'], enum_labels: ['单区域', '全部区域'], default: 'single', help_zh: '单区域只建模一个区域；全部区域对当前数据源全部有效区域分别建模（区域独立，不做联合空间建模）。', suggestion_zh: '先用单区域验证流程。' },
      { key: 'region_id', label_zh: '区域', type: 'enum', enum: regions.filter((r) => r.has_timeseries).map((r) => r.region_id), enum_labels: regions.filter((r) => r.has_timeseries).map((r) => regionDisplayLabel(r.region_id, r.display_name)), default: '', required: false, visible_when: { scope: 'single' }, help_zh: '单区域范围下必须选择一个有数据的区域。', suggestion_zh: '无数据区域不可选。' },
      { key: 'time_start', label_zh: '开始日期时间', type: 'string', default: '', required: false, help_zh: '预测数据集构建时间范围的起点（含边界）。默认使用数据源完整有效范围。', suggestion_zh: '格式 YYYY-MM-DD HH:mm:ss；必须早于结束时间。' },
      { key: 'time_end', label_zh: '结束日期时间', type: 'string', default: '', required: false, help_zh: '预测数据集构建时间范围的终点（含边界）。默认使用数据源完整有效范围。', suggestion_zh: '不能超过数据源真实结束时间。' },
      { key: 'input_length', label_zh: '输入长度（L）', type: 'integer', min: 1, max: 5000, default: 24, unit_zh: '点', help_zh: '每个样本的历史输入点数（按重采样后的点计）。', suggestion_zh: '10 分钟频率下 144 点 ≈ 1 天。' },
      { key: 'output_length', label_zh: '输出长度（H）', type: 'integer', min: 1, max: 5000, default: 6, unit_zh: '点', help_zh: '预测目标点数；Module 4/5 继承该值且不可修改。', suggestion_zh: '先用 6-24 验证流程。' },
      { key: 'step', label_zh: '滑动步长（S）', type: 'integer', min: 1, max: 5000, default: 1, unit_zh: '点', help_zh: '相邻窗口起点的间隔。', suggestion_zh: 'S 越大窗口越少、训练越快。' },
      { key: 'train_ratio', label_zh: '训练集比例', type: 'number', min: 0.05, max: 0.95, default: 0.7, help_zh: '按时序划分的训练段比例。', suggestion_zh: '常用 0.7。' },
      { key: 'val_ratio', label_zh: '验证集比例', type: 'number', min: 0, max: 0.9, default: 0.15, help_zh: '验证段比例。', suggestion_zh: '常用 0.15。' },
      { key: 'test_ratio', label_zh: '测试集比例', type: 'number', min: 0, max: 0.9, default: 0.15, help_zh: '测试段比例，Module 5 的正式评分来源。', suggestion_zh: '常用 0.15。' },
    ],
    [regions],
  )

  const { fieldIssues, errors, warnings, valid } = useGroupValidation({
    specs: schema,
    values: config,
    pathPrefix: 'm3',
    remote: { kind: 'm3', values: config },
    remoteDebounceMs: 500,
  })

  const loadDatasets = useCallback(() => {
    api
      .get<any>(ENDPOINTS.datasetList)
      .then((data) => setDatasets(data.datasets))
      .catch(() => undefined)
  }, [])

  useEffect(loadDatasets, [loadDatasets])

  useEffect(() => {
    const key = config.source_key as string
    if (!key) return
    api
      .get<any>(ENDPOINTS.regions(key))
      .then((data) => {
        setRegions(data.regions)
        setSourceMeta(data.source)
        setConfig((prev) => {
          const current = prev.region_id as string
          const stillValid = data.regions.some((r: any) => r.region_id === current && r.has_timeseries)
          const first = data.regions.find((r: any) => r.has_timeseries)
          if (skipSourceDateReset.current) {
            skipSourceDateReset.current = false
            return {
              ...prev,
              region_id: stillValid ? current : first?.region_id ?? '',
            }
          }
          return {
            ...prev,
            region_id: stillValid ? current : first?.region_id ?? '',
            frequency: 'native',
            aggregation: 'mean',
            time_start: data.source?.time_start ?? null,
            time_end: data.source?.time_end ?? null,
          }
        })
      })
      .catch(() => undefined)
  }, [config.source_key])

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

  const runPreview = async () => {
    if (!valid) {
      messageApi.error('存在参数错误，请先修正字段下方提示的问题。')
      return
    }
    setBusy(true)
    setServerIssues([])
    try {
      const data = await api.post<any>(ENDPOINTS.datasetPreview, { values: config })
      setPreview(data)
      const split = data.preview_split ?? 'test'
      const firstWindow = data.preview_windows?.[0] ?? null
      setPreviewWindowInfo({
        split,
        index: data.preview_window_index ?? 0,
        total: data.preview_window_total ?? 0,
        candidate: data.preview_window_stats?.[split]?.candidate_windows ?? 0,
        excluded: data.preview_window_stats?.[split]?.excluded_windows ?? 0,
        overlap: data.preview_overlap_points ?? 0,
        stats: data.preview_window_stats ?? {},
        window: firstWindow,
      })
      setWindowJumpValue(1)
      previewRequested.current = true
    } catch (err) {
      if (err instanceof ApiError) {
        setServerIssues(err.issues)
        messageApi.error(`预览被拒绝：${err.message}`)
      } else messageApi.error(String(err))
    } finally {
      setBusy(false)
    }
  }

  const loadPreviewWindow = async (split: string, index: number) => {
    if (!preview?.preview_region_id) return
    setPreviewWindowBusy(true)
    try {
      const data = await api.post<any>(ENDPOINTS.datasetPreviewWindow, {
        values: config,
        split,
        window_index: index,
        preview_region_id: preview.preview_region_id,
      })
      setPreviewWindowInfo((prev: any) => ({
        ...prev,
        split: data.split,
        index: data.window_index,
        total: data.total_windows,
        candidate: data.candidate_windows,
        excluded: data.excluded_windows,
        overlap: data.overlap_points,
        window: data.window,
      }))
      setWindowJumpValue(data.window_index + 1)
    } catch (err) {
      messageApi.error(err instanceof ApiError ? err.message : String(err))
    } finally {
      setPreviewWindowBusy(false)
    }
  }

  const commitWindowJump = () => {
    if (!previewWindowInfo || previewWindowBusy || previewWindowTotal === 0) return
    const target = Math.min(Math.max(1, windowJumpValue), previewWindowTotal) - 1
    if (target !== previewWindowIndex) {
      loadPreviewWindow(previewWindowInfo.split, target)
    }
  }

  const previewWindow = previewWindowInfo?.window
  const previewWindowTotal = previewWindowInfo?.total ?? 0
  const previewWindowIndex = previewWindowInfo?.index ?? 0
  const runPreviewRef = useRef(runPreview)
  runPreviewRef.current = runPreview

  useEffect(() => {
    if (!previewRequested.current || !valid) return
    const timer = window.setTimeout(() => {
      runPreviewRef.current()
    }, 700)
    return () => window.clearTimeout(timer)
  }, [config, valid])

  const build = async () => {
    if (!valid) {
      messageApi.error('参数未通过校验，无法构建数据集。')
      return
    }
    setBusy(true)
    setServerIssues([])
    try {
      const data = await api.post<any>(ENDPOINTS.datasetBuild, { values: config })
      messageApi.success(`数据集已构建：${data.dataset_id}`)
      setSelectedDataset(data)
      loadDatasets()
      runPreview()
    } catch (err) {
      if (err instanceof ApiError) {
        setServerIssues(err.issues)
        messageApi.error(`构建被拒绝：${err.message}（未生成任何半成品数据集 ID）`)
      } else messageApi.error(String(err))
    } finally {
      setBusy(false)
    }
  }

  const openDataset = async (datasetId: string) => {
    try {
      const data = await api.get<any>(ENDPOINTS.datasetGet(datasetId))
      setSelectedDataset(data)
      previewRequested.current = false
      setPreview(null)
      setPreviewWindowInfo(null)
      skipSourceDateReset.current = String(data.source_key) !== String(config.source_key)
      setConfig((prev) => ({
        ...prev,
        source_key: data.source_key,
        scope: data.scope,
        region_id: data.region_ids?.[0] ?? '',
        frequency: 'native',
        aggregation: 'mean',
        time_start: data.time_start ?? null,
        time_end: data.time_end ?? null,
        input_length: data.L,
        output_length: data.H,
        step: data.S,
        train_ratio: data.ratios.train,
        val_ratio: data.ratios.validation,
        test_ratio: data.ratios.test,
        missing_mode: data.preprocess?.missing_mode ?? 'automatic',
        scaling: data.preprocess?.scaling ?? 'standard',
      }))
      messageApi.success(`已打开 ${datasetId}（历史参数被冻结，修改需另存新的数据集 ID）`)
    } catch (err) {
      messageApi.error(String(err))
    }
  }

  const train: any[] = preview?.split_boundaries ?? []
  const previewWindowStats = previewWindowInfo?.stats?.[previewWindowInfo?.split] ?? {
    candidate_windows: previewWindowInfo?.candidate ?? 0,
    valid_windows: previewWindowTotal,
    excluded_windows: previewWindowInfo?.excluded ?? 0,
  }
  const previewXLength = previewWindow?.X?.length ?? 0
  const previewYLength = previewWindow?.Y?.length ?? 0
  const previewChartX = previewWindow
    ? [...(previewWindow.X_timestamps ?? []), ...(previewWindow.Y_timestamps ?? [])]
    : []
  const previewChartSeries = previewWindow
    ? [
        {
          name: `X 历史输入（L=${preview?.L ?? config.input_length}）`,
          data: [...previewWindow.X, ...Array(previewYLength).fill(null)],
          color: '#2467E8',
        },
        {
          name: `Y 预测目标（H=${preview?.H ?? config.output_length}）`,
          data: [...Array(previewXLength).fill(null), ...previewWindow.Y],
          color: '#D98F00',
        },
      ]
    : []
  const datasetPageSize = 6
  const datasetPageCount = Math.max(1, Math.ceil(datasets.length / datasetPageSize))
  const currentDatasetPage = Math.min(datasetPage, datasetPageCount - 1)
  const visibleDatasets = datasets.slice(
    currentDatasetPage * datasetPageSize,
    (currentDatasetPage + 1) * datasetPageSize,
  )

  return (
    <div>
      {contextHolder}
      <ModuleHeader
        module={MODULE_META.m3.index}
        titleZh={MODULE_META.m3.titleZh}
        titleEn={MODULE_META.m3.titleEn}
        description="滑窗 L/H/S、无泄漏时间切分、因果预处理与数据集 ID 持久化"
        datasetInfo={selectedDataset ? `当前数据集 ${selectedDataset.dataset_id} · ${statusLabel(selectedDataset.status)}` : '尚未打开已保存数据集'}
      />
      {errors.length > 0 ? (
        <Alert type="error" showIcon style={{ marginBottom: 10 }} message={`${errors.length} 个参数错误（错误显示在对应输入框下方）`} description={errors.slice(0, 3).map((e) => `${e.path}: ${e.message}`).join('；')} />
      ) : null}
      {warnings.length > 0 ? (
        <Alert type="warning" showIcon style={{ marginBottom: 10 }} message={`${warnings.length} 条警告（与错误分开，不阻止保存）`} description={warnings.map((w) => w.message).join('；')} />
      ) : null}
      {serverIssues.length > 0 ? (
        <Alert type="error" showIcon style={{ marginBottom: 10 }} message="后端拒绝了请求（未产生任何数据）" description={serverIssues.map((i) => `${i.path}: ${i.message}`).join('；')} />
      ) : null}
      <ThreePane
        variant="two"
        config={
          <>
            <PaneHead
              title={bilingual('配置', 'Configuration')}
              extra={
                <Button size="small" onClick={() => {
                  previewRequested.current = false
                  const first = regions.find((r) => r.has_timeseries)
                  setConfig({
                    ...DEFAULT_CONFIG,
                    region_id: first?.region_id ?? '',
                    time_start: sourceMeta?.time_start ?? null,
                    time_end: sourceMeta?.time_end ?? null,
                  })
                  setDrafts({})
                  setPreview(null)
                  setPreviewWindowInfo(null)
                  setSelectedDataset(null)
                }}>
                  {ACTION_LABELS.reset}
                </Button>
              }
            />
            {visibleFields(schema, config)
              .filter((spec) => !['time_start', 'time_end'].includes(spec.key))
              .map((spec) => (
              <ParamField
                key={spec.key}
                spec={spec}
                value={config[spec.key]}
                issues={fieldIssues(spec.key)}
                path={`m3.${spec.key}`}
                draft={drafts[spec.key]}
                onDraftChange={(key, text) => setDrafts((prev) => ({ ...prev, [key]: text }))}
                onChange={(key, value) => setConfig((prev) => ({ ...prev, [key]: value }))}
                disabledReason={fieldDisabledReason(spec, config)}
                compact
              />
            ))}
            <div className="tn-section-title">构建时间范围（Dataset Time Range）</div>
            <DateTimeField
              id="m3.time_start"
              label="开始日期时间"
              value={config.time_start as string | null}
              issues={fieldIssues('time_start')}
              disabledDate={disabledDate}
              help="预测数据集使用的起始时间（含边界）。默认是数据源完整有效范围，可主动缩小。"
              detail="日期会转换为真实索引；不会读取范围以外的观测。"
              onChange={(value) => setConfig((prev) => ({ ...prev, time_start: value }))}
            />
            <DateTimeField
              id="m3.time_end"
              label="结束日期时间"
              value={config.time_end as string | null}
              issues={fieldIssues('time_end')}
              disabledDate={disabledDate}
              help="预测数据集使用的结束时间（含边界）。"
              detail="不能超过数据源真实结束时间；构建后时间范围冻结在数据集快照中。"
              onChange={(value) => setConfig((prev) => ({ ...prev, time_end: value }))}
            />
            <div className="tn-muted">
              数据可用范围：{sourceMeta?.time_start ?? '—'} ～ {sourceMeta?.time_end ?? '—'} · 原生频率{' '}
              {sourceMeta?.native_frequency_minutes ?? '—'} 分钟（不重采样）
            </div>
            <div className="tn-inline" style={{ marginTop: 8 }}>
              <Button onClick={runPreview} loading={busy}>{ACTION_LABELS.preview}</Button>
              <Button type="primary" onClick={build} loading={busy} disabled={!valid}>{ACTION_LABELS.buildDataset}</Button>
            </div>
            <div className="tn-section-title">数据集管理（Dataset Management）</div>
            {visibleDatasets.length ? (
              <>
                {visibleDatasets.map((row: any) => (
                  <div className="tn-m3-dataset-row" key={row.dataset_id}>
                    <div className="tn-inline" style={{ justifyContent: 'space-between' }}>
                      <span className="tn-code">{row.dataset_id}</span>
                      <StatusTag status={row.status} />
                    </div>
                    <div className="tn-muted">
                      {scopeLabel(row.scope)} · {row.region_count} 个区域 · L/H/S = {row.L}/{row.H}/{row.S}
                    </div>
                    <div className="tn-muted">{row.created_at}</div>
                    <div className="tn-inline" style={{ marginTop: 5 }}>
                      <Button size="small" onClick={() => openDataset(row.dataset_id)}>{ACTION_LABELS.open}</Button>
                      <Popconfirm
                        title="删除该数据集？"
                        description="仅当未被引用时可删除；被引用时会返回依赖保护错误。"
                        onConfirm={async () => {
                          try {
                            await api.del(ENDPOINTS.datasetDelete(row.dataset_id))
                            messageApi.success('已删除')
                            loadDatasets()
                          } catch (err) {
                            messageApi.error(err instanceof ApiError ? err.message : String(err))
                          }
                        }}
                      >
                        <Tooltip title={row.is_referenced ? '已被实验或评价引用，不能删除' : '删除会同时移除工件目录'}>
                          <Button size="small" danger disabled={row.is_referenced}>{ACTION_LABELS.deleteRecord}</Button>
                        </Tooltip>
                      </Popconfirm>
                    </div>
                  </div>
                ))}
                <div className="tn-inline" style={{ justifyContent: 'space-between', marginTop: 6 }}>
                  <Button size="small" disabled={currentDatasetPage <= 0} onClick={() => setDatasetPage(currentDatasetPage - 1)}>上一页</Button>
                  <span className="tn-muted">{currentDatasetPage + 1} / {datasetPageCount}</span>
                  <Button size="small" disabled={currentDatasetPage >= datasetPageCount - 1} onClick={() => setDatasetPage(currentDatasetPage + 1)}>下一页</Button>
                </div>
              </>
            ) : (
              <EmptyState text="暂无已保存数据集。" />
            )}
          </>
        }
        visual={
          <div className="tn-stack">
            <Card size="small" style={{ order: 1 }} title="1 · 数据集概览（Dataset Overview）">
              <div className="tn-stack" data-testid="dataset-overview">
                <div className="tn-muted">
                  <div>
                    当前配置：{sourceDisplayName(String(config.source_key), String(config.source_key))}
                    {' · '}{config.scope === 'all' ? `全部区域（${regions.filter((r) => r.has_timeseries).length}）` : `单区域（${regionDisplayLabel(String(config.region_id), regions.find((r) => r.region_id === config.region_id)?.display_name)}）`}
                    {' · '}L/H/S = {String(config.input_length)}/{String(config.output_length)}/{String(config.step)}
                  </div>
                  <div>
                    构建频率：原生 {sourceMeta?.native_frequency_minutes ?? '—'} 分钟 · 原始观测（不重采样）
                    {' · '}比例：{String(config.train_ratio)}/{String(config.val_ratio)}/{String(config.test_ratio)}
                  </div>
                  <div>
                    构建范围：{String(config.time_start ?? '完整有效范围').replace('T', ' ')}
                    {' ～ '}{String(config.time_end ?? '完整有效范围').replace('T', ' ')}
                  </div>
                  <div>
                    预处理默认规则：{missingModeLabel(String(config.missing_mode))} · {scalingLabel(String(config.scaling))}
                  </div>
                  <div>
                    状态：{selectedDataset
                      ? `已保存 ${selectedDataset.dataset_id} · ${statusLabel(selectedDataset.status)}`
                      : preview
                        ? '当前草稿已预览，尚未保存'
                        : '当前草稿尚未预览'}
                  </div>
                </div>
                {(preview || selectedDataset) ? (
                  <div className="tn-muted">
                    <div>
                      窗口数：训练 {preview?.window_counts?.train ?? selectedDataset?.window_counts?.train ?? 0}
                      {' · '}验证 {preview?.window_counts?.validation ?? selectedDataset?.window_counts?.validation ?? 0}
                      {' · '}测试 {preview?.window_counts?.test ?? selectedDataset?.window_counts?.test ?? 0}
                    </div>
                    <div>
                      首个有效 X/Y 起点：{preview?.preview_first_input_start_at ?? '—'}
                      {' · '}最后有效 Y 目标：{preview?.preview_last_target_end_at ?? '—'}
                    </div>
                  </div>
                ) : null}
              </div>
            </Card>

            <div data-testid="sliding-window-preview" style={{ order: 3 }}>
            <Card size="small" title="3 · 滑动窗口预览（Sliding Window Preview）">
              {previewWindow ? (
                <>
                  <div className="tn-inline" style={{ marginBottom: 8 }}>
                    <span className="tn-muted">数据集划分：</span>
                    {['train', 'validation', 'test'].map((split) => {
                      const count = previewWindowInfo?.stats?.[split]?.valid_windows ?? 0
                      return (
                        <Button
                          key={split}
                          size="small"
                          type={previewWindowInfo?.split === split ? 'primary' : 'default'}
                          disabled={count === 0 || previewWindowBusy}
                          onClick={() => loadPreviewWindow(split, 0)}
                        >
                          {splitLabel(split)}（{count}）
                        </Button>
                      )
                    })}
                  </div>
                  <div className="tn-inline" style={{ marginBottom: 8 }}>
                    <Button
                      size="small"
                      disabled={previewWindowBusy || previewWindowIndex <= 0}
                      onClick={() => loadPreviewWindow(previewWindowInfo.split, previewWindowIndex - 1)}
                    >
                      上一窗口
                    </Button>
                    <Button
                      size="small"
                      disabled={previewWindowBusy || previewWindowIndex >= previewWindowTotal - 1}
                      onClick={() => loadPreviewWindow(previewWindowInfo.split, previewWindowIndex + 1)}
                    >
                      下一窗口
                    </Button>
                    <span className="tn-muted">
                      当前窗口 {previewWindowIndex + 1} / {previewWindowTotal}
                    </span>
                    <InputNumber
                      size="small"
                      min={1}
                      max={Math.max(1, previewWindowTotal)}
                      value={windowJumpValue}
                      disabled={previewWindowBusy || previewWindowTotal === 0}
                      onChange={(value) => setWindowJumpValue(typeof value === 'number' ? value : 1)}
                      onPressEnter={commitWindowJump}
                      style={{ width: 96 }}
                      aria-label="窗口序号"
                    />
                    <Button size="small" disabled={previewWindowBusy || previewWindowTotal === 0} onClick={commitWindowJump}>
                      跳转
                    </Button>
                  </div>
                  <div className="tn-muted" style={{ marginBottom: 6 }}>
                    区域 {preview.preview_region_id} · X：{previewWindow.input_start_at} → {previewWindow.input_end_at}
                    {' '}· Y：{previewWindow.target_start_at} → {previewWindow.target_end_at}
                    {' '}· L/H/S = {preview.L}/{preview.H}/{preview.S}
                    {previewWindow.imputed_input_positions?.length
                      ? ` · X 含 ${previewWindow.imputed_input_positions.length} 个因果插值点`
                      : ''}
                  </div>
                  <LineChart
                    height={210}
                    x={previewChartX}
                    series={previewChartSeries}
                    xName="真实时间"
                    yName="数值"
                    empty={!preview}
                  />
                  <div className="tn-muted" style={{ marginTop: 4 }}>
                    <div>
                      当前划分 {splitLabel(previewWindowInfo.split)}：候选窗口 {previewWindowStats.candidate_windows}，
                      有效窗口 {previewWindowStats.valid_windows}，排除窗口 {previewWindowStats.excluded_windows}。
                    </div>
                    <div>
                      窗口起点每前进 S={preview.S} 个时间点；相邻窗口共享最多{' '}
                      {Math.max(0, Number(preview.L) - Number(preview.S))} 个输入点
                      （L−S，最小为 0）。X 使用历史输入，Y 为后续目标；Y 目标均为真实观测，缺失目标不会补造。
                    </div>
                    <div>
                      X 可利用预测起点之前的因果插值；切换数据源、区域、日期范围或 L/H/S 后，
                      自动重新计算窗口。
                    </div>
                  </div>
                </>
              ) : (
                <EmptyState text="点击“实时预览”后显示真实有效窗口。" />
              )}
            </Card>
            </div>

            <Card size="small" style={{ order: 2 }} title="2 · 时间顺序划分预览（Chronological Split Preview）">
              {train.length ? (
                <>
                  <table style={{ width: '100%', fontSize: 12 }}>
                    <thead>
                      <tr style={{ color: '#5b7095', textAlign: 'left' }}>
                        <th>数据集划分</th><th>时间范围</th><th>窗口数</th><th>候选窗口</th>
                      </tr>
                    </thead>
                    <tbody>
                      {train.map((row: any) => (
                        <tr key={row.split} style={{ borderTop: '1px dashed #e3ebf6' }}>
                          <td>{splitLabel(row.split)}</td>
                          <td className="tn-muted">{row.start_at} → {row.end_at}</td>
                          <td>{row.window_count}</td>
                          <td>{row.candidate_windows}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <LineChart
                    height={170}
                    x={train.map((row: any) => row.split)}
                    xName="数据集划分"
                    yName="窗口数"
                    series={[
                      { name: '窗口数', data: train.map((row: any) => row.window_count), type: 'bar' },
                      { name: '候选窗口', data: train.map((row: any) => row.candidate_windows), type: 'bar' },
                    ]}
                  />
                </>
              ) : (
                <EmptyState text="预览后显示训练集、验证集和测试集的真实日期边界与窗口数。" />
              )}
            </Card>

            <Card size="small" style={{ order: 4 }} title="4 · 数据质量摘要（Data Quality Summary）">
              <div className="tn-stack" data-testid="data-quality-summary">
                {preview ? (
                  <div className="tn-muted">
                    <div>时间点数：{preview.time_points}（{preview.time_start} → {preview.time_end}）</div>
                    <div>区域数：{preview.region_count} · 原始缺失点：{preview.missing?.missing_points_before}</div>
                    <div>因果插值点：{preview.missing?.imputed_points}（{missingModeLabel(preview.missing?.mode)}）</div>
                    <div>真实零值保留：{preview.missing?.zero_points_preserved}</div>
                    <div>泄漏防护：目标完全落在单一 split；插值不引用预测起点之后的值。</div>
                    {preview.empty_splits?.length ? (
                      <div style={{ color: '#d4380d' }}>空集合：{preview.empty_splits.join(', ')}</div>
                    ) : null}
                  </div>
                ) : (
                  <EmptyState text="实时预览后显示当前草稿的完整质量摘要。" />
                )}
                {selectedDataset?.quality ? (
                  <Collapse
                    size="small"
                    ghost
                    items={[{
                      key: 'quality',
                      label: '查看已保存数据集的完整质量报告',
                      children: <pre className="tn-code">{JSON.stringify(selectedDataset.quality, null, 2)}</pre>,
                    }]}
                  />
                ) : null}
              </div>
            </Card>

          </div>
        }
      />
    </div>
  )
}
