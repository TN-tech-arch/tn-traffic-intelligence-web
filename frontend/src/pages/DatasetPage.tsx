import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Card, InputNumber, Popconfirm, Select, Table, Tabs, Tag, Tooltip, message } from 'antd'
import { ENDPOINTS, ApiError, api, type Issue } from '../api/client'
import { EmptyState, ModuleHeader, PaneHead, ThreePane } from '../components/Panes'
import ParamField from '../components/ParamField'
import StatusTag from '../components/StatusTag'
import BiLabel from '../components/BiLabel'
import { LineChart } from '../components/Charts'
import { useGroupValidation } from '../validation/useValidation'
import { fieldDisabledReason, visibleFields, type FieldSpec } from '../validation/engine'
import {
  ACTION_LABELS, MODULE_META, aggregationLabel, bilingual, frequencyLabel,
  missingModeLabel, regionDisplayLabel, scalingLabel, scopeLabel, sourceDisplayName, splitLabel, statusLabel,
  unitDisplayLabel,
} from '../i18n/terms'

const DEFAULT_CONFIG: Record<string, unknown> = {
  source_key: 'milano',
  scope: 'single',
  region_id: '',
  frequency: 'native',
  aggregation: 'mean',
  input_length: 24,
  output_length: 6,
  step: 1,
  train_ratio: 0.7,
  val_ratio: 0.15,
  test_ratio: 0.15,
  missing_mode: 'automatic',
  scaling: 'standard',
  label: '',
}

export default function DatasetPage() {
  const [messageApi, contextHolder] = message.useMessage()
  const [config, setConfig] = useState<Record<string, unknown>>({ ...DEFAULT_CONFIG })
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [regions, setRegions] = useState<any[]>([])
  const [preview, setPreview] = useState<any>(null)
  const [datasets, setDatasets] = useState<any[]>([])
  const [selectedDataset, setSelectedDataset] = useState<any>(null)
  const [windowRows, setWindowRows] = useState<any[]>([])
  const [windowSplit, setWindowSplit] = useState('train')
  const [windowRegion, setWindowRegion] = useState<string>('')
  const [previewWindowInfo, setPreviewWindowInfo] = useState<any>(null)
  const [previewWindowBusy, setPreviewWindowBusy] = useState(false)
  const [windowJumpValue, setWindowJumpValue] = useState<number>(1)
  const [tab, setTab] = useState('overview')
  const [busy, setBusy] = useState(false)
  const [serverIssues, setServerIssues] = useState<Issue[]>([])
  const previewRequested = useRef(false)

  const schema: FieldSpec[] = useMemo(
    () => [
      { key: 'source_key', label_zh: '数据源', type: 'enum', enum: ['milano', 'trentino', 'zte'], enum_labels: ['Milano', 'Trentino', 'ZTE 4G Downlink'], default: 'milano', help_zh: '选择数据集所在的数据源，一个数据集只能属于一个数据源。', suggestion_zh: '三个来源的时间范围与单位不同，请分别建模。' },
      { key: 'scope', label_zh: '预测范围', type: 'enum', enum: ['single', 'all'], enum_labels: ['单区域', '全部区域'], default: 'single', help_zh: '单区域只建模一个区域；全部区域对当前数据源全部有效区域分别建模（区域独立，不做联合空间建模）。', suggestion_zh: '先用单区域验证流程。' },
      { key: 'region_id', label_zh: '区域', type: 'enum', enum: regions.filter((r) => r.has_timeseries).map((r) => r.region_id), enum_labels: regions.filter((r) => r.has_timeseries).map((r) => regionDisplayLabel(r.region_id, r.display_name)), default: '', required: false, visible_when: { scope: 'single' }, help_zh: '单区域范围下必须选择一个有数据的区域。', suggestion_zh: '无数据区域不可选。' },
      { key: 'frequency', label_zh: '时间分辨率', type: 'enum', enum: ['native', '30min', '60min', '1day'], enum_labels: ['原生频率', '30 分钟', '1 小时', '1 天'], default: 'native', help_zh: '重采样频率，必须是原生频率的整数倍。', suggestion_zh: '1 小时可显著减少窗口数量。' },
      { key: 'aggregation', label_zh: '聚合方式', type: 'enum', enum: ['mean', 'sum'], enum_labels: ['均值', '求和'], default: 'mean', help_zh: '求和为桶内观测相加，均值为桶内平均；单位未确认，不代表物理总量。', suggestion_zh: '原生频率下无影响。' },
      { key: 'input_length', label_zh: '输入长度（L）', type: 'integer', min: 1, max: 5000, default: 24, unit_zh: '点', help_zh: '每个样本的历史输入点数（按重采样后的点计）。', suggestion_zh: '10 分钟频率下 144 点 ≈ 1 天。' },
      { key: 'output_length', label_zh: '输出长度（H）', type: 'integer', min: 1, max: 5000, default: 6, unit_zh: '点', help_zh: '预测目标点数；Module 4/5 继承该值且不可修改。', suggestion_zh: '先用 6-24 验证流程。' },
      { key: 'step', label_zh: '滑动步长（S）', type: 'integer', min: 1, max: 5000, default: 1, unit_zh: '点', help_zh: '相邻窗口起点的间隔。', suggestion_zh: 'S 越大窗口越少、训练越快。' },
      { key: 'train_ratio', label_zh: '训练集比例', type: 'number', min: 0.05, max: 0.95, default: 0.7, help_zh: '按时序划分的训练段比例。', suggestion_zh: '常用 0.7。' },
      { key: 'val_ratio', label_zh: '验证集比例', type: 'number', min: 0, max: 0.9, default: 0.15, help_zh: '验证段比例。', suggestion_zh: '常用 0.15。' },
      { key: 'test_ratio', label_zh: '测试集比例', type: 'number', min: 0, max: 0.9, default: 0.15, help_zh: '测试段比例，Module 5 的正式评分来源。', suggestion_zh: '常用 0.15。' },
      { key: 'missing_mode', label_zh: '缺失值处理', type: 'enum', enum: ['automatic', 'causal_interpolation', 'drop_invalid'], enum_labels: ['自动（前向填充）', '因果安全插值（Causal-safe Interpolation）', '丢弃无效窗口（Drop Invalid Windows）'], default: 'automatic', level: 'advanced', help_zh: '自动模式只用过去值前向填充；因果安全插值在两个已观测端点间插值，但窗口预测起点必须晚于插值右端点，否则该窗口作废；丢弃无效窗口会直接移除含缺失的窗口。', suggestion_zh: 'ZTE 真实零值不会被视为缺失。' },
      { key: 'scaling', label_zh: '标准化', type: 'enum', enum: ['standard', 'minmax', 'none'], enum_labels: ['标准化（StandardScaler）', '最小-最大缩放（MinMaxScaler）', '无归一化'], default: 'standard', level: 'advanced', help_zh: '仅用训练段已观测样本拟合；评估时逆变换回源单位。', suggestion_zh: '默认使用标准化。' },
      { key: 'label', label_zh: '数据集名称', type: 'string', default: '', required: false, help_zh: '可选名称，便于在历史中识别。', suggestion_zh: '留空自动生成。' },
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
        setConfig((prev) => {
          const current = prev.region_id as string
          const stillValid = data.regions.some((r: any) => r.region_id === current && r.has_timeseries)
          if (stillValid) return prev
          const first = data.regions.find((r: any) => r.has_timeseries)
          return { ...prev, region_id: first?.region_id ?? '' }
        })
      })
      .catch(() => undefined)
  }, [config.source_key])

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
      setWindowRegion(data.preview_region_id)
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
      setConfig((prev) => ({
        ...prev,
        source_key: data.source_key,
        scope: data.scope,
        region_id: data.region_ids?.[0] ?? '',
        frequency: data.frequency,
        aggregation: data.aggregation,
        input_length: data.L,
        output_length: data.H,
        step: data.S,
        train_ratio: data.ratios.train,
        val_ratio: data.ratios.validation,
        test_ratio: data.ratios.test,
        missing_mode: data.preprocess?.missing_mode ?? 'automatic',
        scaling: data.preprocess?.scaling ?? 'standard',
      }))
      loadWindows(datasetId, windowSplit, data.region_ids?.[0] ?? '')
      setTab('overview')
      messageApi.success(`已打开 ${datasetId}（历史参数被冻结，修改需另存新的数据集 ID）`)
    } catch (err) {
      messageApi.error(String(err))
    }
  }

  const loadWindows = async (datasetId: string, split: string, regionId: string, offset = 0) => {
    if (!datasetId || !regionId) return
    try {
      const data = await api.get<any>(ENDPOINTS.datasetWindows(datasetId, split, regionId, offset, 10))
      setWindowRows(data.windows)
    } catch (err) {
      setWindowRows([])
    }
  }

  useEffect(() => {
    if (selectedDataset && windowRegion) loadWindows(selectedDataset.dataset_id, windowSplit, windowRegion)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDataset?.dataset_id, windowSplit, windowRegion])

  const windows = preview?.window_counts ?? {}
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
        config={
          <>
            <PaneHead
              title={bilingual('配置', 'Configuration')}
              extra={
                <Button size="small" onClick={() => {
                  previewRequested.current = false
                  setConfig({ ...DEFAULT_CONFIG })
                  setDrafts({})
                  setPreview(null)
                  setPreviewWindowInfo(null)
                  setSelectedDataset(null)
                }}>
                  {ACTION_LABELS.reset}
                </Button>
              }
            />
            {visibleFields(schema, config).map((spec) => (
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
            <div className="tn-inline" style={{ marginTop: 8 }}>
              <Button onClick={runPreview} loading={busy}>{ACTION_LABELS.preview}</Button>
              <Button type="primary" onClick={build} loading={busy} disabled={!valid}>{ACTION_LABELS.buildDataset}</Button>
            </div>
          </>
        }
        visual={
          <div className="tn-stack">
            <div data-testid="sliding-window-preview">
            <Card size="small" title="1 · 滑动窗口预览（Sliding Window Preview）">
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
                      X 可利用预测起点之前的因果插值；切换数据源、区域、日期范围、时间分辨率、L/H/S 或缺失值处理后，
                      自动重新计算窗口。
                    </div>
                  </div>
                </>
              ) : (
                <EmptyState text="点击“实时预览”后显示真实有效窗口。" />
              )}
            </Card>
            </div>

            <Card size="small" title="2 · 时间顺序划分预览（Chronological Split Preview）">
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

            <Card size="small" title="3 · 预测时间范围预览（Forecast Time Preview）">
              {preview ? (
                <div className="tn-muted">
                  <div>测试集有效窗口：{windows.test ?? 0}（候选 {preview.split_boundaries?.find((s: any) => s.split === 'test')?.candidate_windows ?? 0}）</div>
                  <div>首个可用 X/Y 起点：{preview.preview_windows?.[0]?.input_start_at ?? '—'}</div>
                  <div>最后可用 Y 目标：{preview.preview_windows?.[preview.preview_windows.length - 1]?.target_end_at ?? '—'}</div>
                  <div>预测范围：{preview.scope === 'all' ? `全部区域（${preview.region_count} 个区域，独立建模）` : `单区域（${preview.region_ids?.[0]}）`}</div>
                  <div>时间轴：{preview.time_start} → {preview.time_end}，共 {preview.time_points} 点 @ {preview.frequency_minutes} 分钟</div>
                  {preview.scope === 'all' ? (
                    <div style={{ marginTop: 6 }}>
                      区域窗口摘要（前 5）：{Object.entries(preview.window_counts_per_region ?? {}).slice(0, 5).map(([region, counts]: any) => `${region}:${counts.test}`).join('，')}
                    </div>
                  ) : null}
                </div>
              ) : (
                <EmptyState text="预览后显示测试集可预测覆盖时间。" />
              )}
            </Card>
          </div>
        }
        info={
          <Tabs
            className="tn-tabs-tight"
            activeKey={tab}
            onChange={setTab}
            items={[
              {
                key: 'overview',
                label: <BiLabel zh="数据集概览" en="Dataset Overview" />,
                children: (
                  <div className="tn-stack">
                    {selectedDataset ? (
                      <Card size="small" title="已保存数据集（不可变快照）">
                        <div className="tn-code">{selectedDataset.dataset_id}</div>
                        <div className="tn-muted" style={{ marginTop: 6 }}>
                          <div>来源：{sourceDisplayName(selectedDataset.source_key, selectedDataset.source_display_name)}（{unitDisplayLabel(selectedDataset.unit_label)}）</div>
                          <div>预测范围：{selectedDataset.scope === 'all' ? `全部区域（${selectedDataset.region_count}）` : `单区域（${selectedDataset.region_ids?.[0]}）`}</div>
                          <div>L/H/S = {selectedDataset.L}/{selectedDataset.H}/{selectedDataset.S} · {frequencyLabel(selectedDataset.frequency)} · {aggregationLabel(selectedDataset.aggregation)}</div>
                          <div>比例：{selectedDataset.ratios?.train}/{selectedDataset.ratios?.validation}/{selectedDataset.ratios?.test}</div>
                          <div>窗口数：训练 {selectedDataset.window_counts?.train} · 验证 {selectedDataset.window_counts?.validation} · 测试 {selectedDataset.window_counts?.test}</div>
                          <div>预处理：{missingModeLabel(selectedDataset.preprocess?.missing_mode)} · {scalingLabel(selectedDataset.preprocess?.scaling)}</div>
                          <div>创建时间：{selectedDataset.created_at}</div>
                          <div>引用状态：{selectedDataset.is_referenced ? '已被实验或评价引用（只能归档）' : '未被引用（可删除）'}</div>
                        </div>
                      </Card>
                    ) : (
                      <EmptyState text="打开历史数据集或构建新数据集后显示快照。" />
                    )}
                    {preview ? (
                      <Card size="small" title="当前草稿预览统计">
                        <div className="tn-muted">
                          <div>窗口总数：训练 {windows.train} / 验证 {windows.validation} / 测试 {windows.test}</div>
                          <div>缺失处理：{missingModeLabel(preview.missing?.mode)}，插值点 {preview.missing?.imputed_points}，原始缺失 {preview.missing?.missing_points_before}</div>
                          <div>标准化：{scalingLabel(preview.scaling)}</div>
                        </div>
                      </Card>
                    ) : null}
                  </div>
                ),
              },
              {
                key: 'windows',
                label: <BiLabel zh="窗口预览" en="Window Preview" />,
                children: (
                  <div className="tn-stack">
                    <div className="tn-inline">
                      <Tag color="blue">数据集划分</Tag>
                      <Button size="small" type={windowSplit === 'train' ? 'primary' : 'default'} onClick={() => setWindowSplit('train')}>训练集</Button>
                      <Button size="small" type={windowSplit === 'validation' ? 'primary' : 'default'} onClick={() => setWindowSplit('validation')}>验证集</Button>
                      <Button size="small" type={windowSplit === 'test' ? 'primary' : 'default'} onClick={() => setWindowSplit('test')}>测试集</Button>
                    </div>
                    {selectedDataset ? (
                      <Table
                        size="small"
                        rowKey="origin_index"
                        dataSource={windowRows}
                        pagination={false}
                        columns={[
                          { title: 'origin_index', dataIndex: 'origin_index' },
                          { title: 'X 范围', render: (_: unknown, row: any) => <span className="tn-muted">{row.input_start_at}<br />{row.input_end_at}</span> },
                          { title: 'Y 目标', render: (_: unknown, row: any) => <span className="tn-muted">{row.target_start_at}<br />{row.target_end_at}</span> },
                          { title: 'X 值', render: (_: unknown, row: any) => row.X.map((v: number) => v.toFixed(1)).join(', ') },
                          { title: 'Y 值', render: (_: unknown, row: any) => row.Y.map((v: number) => v.toFixed(1)).join(', ') },
                        ]}
                      />
                    ) : (
                      <EmptyState text="打开一个已保存数据集后可查看真实 X/Y 样本。" />
                    )}
                  </div>
                ),
              },
              {
                key: 'quality',
                label: <BiLabel zh="数据质量" en="Data Quality" />,
                children: (
                  <div className="tn-stack">
                    <Card size="small" title="构建质量报告（真实统计）">
                      {preview ? (
                        <div className="tn-muted">
                          <div>时间点数：{preview.time_points}（{preview.time_start} → {preview.time_end}）</div>
                          <div>区域数：{preview.region_count}</div>
                          <div>缺失点（处理前）：{preview.missing?.missing_points_before}</div>
                          <div>插值点：{preview.missing?.imputed_points}（策略 {missingModeLabel(preview.missing?.mode)}）</div>
                          <div>零值保留计数：{preview.missing?.zero_points_preserved}</div>
                          <div>泄漏检查：目标完全落在单一 split 内；插值绝不引用预测起点之后的值。</div>
                          {preview.empty_splits?.length ? <div style={{ color: '#d4380d' }}>空集合：{preview.empty_splits.join(', ')}</div> : null}
                        </div>
                      ) : (
                        <EmptyState text="预览后显示质量报告。" />
                      )}
                    </Card>
                    {selectedDataset ? (
                      <Card size="small" title="已保存数据集质量">
                        <pre className="tn-code">{JSON.stringify(selectedDataset.quality, null, 2)}</pre>
                      </Card>
                    ) : null}
                  </div>
                ),
              },
              {
                key: 'management',
                label: <BiLabel zh="数据集管理" en="Dataset Management" />,
                children: (
                  <Table
                    size="small"
                    rowKey="dataset_id"
                    dataSource={datasets}
                    pagination={{ pageSize: 8, size: 'small' }}
                    columns={[
                      { title: '数据集 ID', dataIndex: 'dataset_id', width: 190, render: (value: string) => <span className="tn-code">{value}</span> },
                      { title: '预测范围', render: (_: unknown, row: any) => `${scopeLabel(row.scope)} · ${row.region_count}` },
                      { title: 'L/H/S', render: (_: unknown, row: any) => `${row.L}/${row.H}/${row.S}` },
                      { title: '状态', render: (_: unknown, row: any) => <StatusTag status={row.status} /> },
                      { title: '创建时间', dataIndex: 'created_at', width: 150 },
                      {
                        title: '操作',
                        render: (_: unknown, row: any) => (
                          <div className="tn-inline">
                            <Button size="small" onClick={() => openDataset(row.dataset_id)}>{ACTION_LABELS.open}</Button>
                            <Button
                              size="small"
                              onClick={async () => {
                                try {
                                  await api.post(ENDPOINTS.datasetArchive(row.dataset_id, row.status !== 'Archived'))
                                  messageApi.success(row.status === 'Archived' ? '已恢复' : '已归档')
                                  loadDatasets()
                                } catch (err) {
                                  messageApi.error(err instanceof ApiError ? err.message : String(err))
                                }
                              }}
                            >
                              {row.status === 'Archived' ? ACTION_LABELS.unarchive : ACTION_LABELS.archive}
                            </Button>
                            <Tooltip title={row.is_referenced ? '已被实验或评价引用，只能归档' : '删除会同时移除工件目录'}>
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
                                <Button size="small" danger disabled={row.is_referenced}>{ACTION_LABELS.deleteRecord}</Button>
                              </Popconfirm>
                            </Tooltip>
                          </div>
                        ),
                      },
                    ]}
                  />
                ),
              },
            ]}
          />
        }
      />
    </div>
  )
}
