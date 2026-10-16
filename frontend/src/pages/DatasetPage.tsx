import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Popconfirm, Table, Tabs, Tag, Tooltip, message } from 'antd'
import { ENDPOINTS, ApiError, api, type Issue } from '../api/client'
import { EmptyState, ModuleHeader, PaneHead, ThreePane } from '../components/Panes'
import ParamField from '../components/ParamField'
import StatusTag from '../components/StatusTag'
import { LineChart } from '../components/Charts'
import { useGroupValidation } from '../validation/useValidation'
import { fieldDisabledReason, visibleFields, type FieldSpec } from '../validation/engine'

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
  const [tab, setTab] = useState('overview')
  const [busy, setBusy] = useState(false)
  const [serverIssues, setServerIssues] = useState<Issue[]>([])

  const schema: FieldSpec[] = useMemo(
    () => [
      { key: 'source_key', label_zh: 'Dataset / Location', type: 'enum', enum: ['milano', 'trentino', 'zte'], enum_labels: ['Milano', 'Trentino', 'ZTE 4G Downlink'], default: 'milano', help_zh: '选择数据集所在的地点来源，一个数据集只能属于一个地点。', suggestion_zh: '三个来源的时间范围与单位不同，请分别建模。' },
      { key: 'scope', label_zh: 'Prediction Scope', type: 'enum', enum: ['single', 'all'], enum_labels: ['Single Region', 'All Regions'], default: 'single', help_zh: 'Single Region 只建模一个区域；All Regions 对当前地点全部有效区域分别建模（区域独立，不做联合空间建模）。', suggestion_zh: '先用 Single Region 验证流程。' },
      { key: 'region_id', label_zh: 'Region', type: 'enum', enum: regions.filter((r) => r.has_timeseries).map((r) => r.region_id), enum_labels: regions.filter((r) => r.has_timeseries).map((r) => `${r.region_id} · ${r.display_name}`), default: '', required: false, visible_when: { scope: 'single' }, help_zh: 'Single Region 时必须选择一个有数据的区域。', suggestion_zh: 'No Data 区域不可选。' },
      { key: 'frequency', label_zh: 'Temporal Resolution', type: 'enum', enum: ['native', '30min', '60min', '1day'], enum_labels: ['原生频率', '30 分钟', '1 小时', '1 天'], default: 'native', help_zh: '重采样频率，必须是原生频率的整数倍。', suggestion_zh: '1 小时可显著减少窗口数量。' },
      { key: 'aggregation', label_zh: 'Aggregation', type: 'enum', enum: ['mean', 'sum'], enum_labels: ['均值 mean', '求和 sum'], default: 'mean', help_zh: 'sum 为桶内求和，mean 为桶内平均；单位未确认，不代表物理总量。', suggestion_zh: '原生频率下无影响。' },
      { key: 'input_length', label_zh: 'Input Length (L)', type: 'integer', min: 1, max: 5000, default: 24, unit_zh: '点', help_zh: '每个样本的历史输入点数（按重采样后的点计）。', suggestion_zh: '10 分钟频率下 144 点 ≈ 1 天。' },
      { key: 'output_length', label_zh: 'Output Length (H)', type: 'integer', min: 1, max: 5000, default: 6, unit_zh: '点', help_zh: '预测目标点数；Module 4/5 继承该值且不可修改。', suggestion_zh: '先用 6-24 验证流程。' },
      { key: 'step', label_zh: 'Sliding Step (S)', type: 'integer', min: 1, max: 5000, default: 1, unit_zh: '点', help_zh: '相邻窗口起点的间隔。', suggestion_zh: 'S 越大窗口越少、训练越快。' },
      { key: 'train_ratio', label_zh: 'Train Ratio', type: 'number', min: 0.05, max: 0.95, default: 0.7, help_zh: '按时序划分的训练段比例。', suggestion_zh: '常用 0.7。' },
      { key: 'val_ratio', label_zh: 'Validation Ratio', type: 'number', min: 0, max: 0.9, default: 0.15, help_zh: '验证段比例。', suggestion_zh: '常用 0.15。' },
      { key: 'test_ratio', label_zh: 'Test Ratio', type: 'number', min: 0, max: 0.9, default: 0.15, help_zh: '测试段比例，Module 5 的正式评分来源。', suggestion_zh: '常用 0.15。' },
      { key: 'missing_mode', label_zh: 'Missing Handling', type: 'enum', enum: ['automatic', 'causal_interpolation', 'drop_invalid'], enum_labels: ['Automatic（前向填充）', 'Causal-safe Interpolation', 'Drop Invalid Windows'], default: 'automatic', level: 'advanced', help_zh: 'automatic 只用过去值前向填充；causal_interpolation 在两个已观测端点间插值，但窗口预测起点必须晚于插值右端点，否则该窗口作废；drop_invalid 直接丢弃含缺失窗口。', suggestion_zh: 'ZTE 真实零值不会被视为缺失。' },
      { key: 'scaling', label_zh: 'Scaling', type: 'enum', enum: ['standard', 'minmax', 'none'], enum_labels: ['StandardScaler', 'MinMaxScaler', 'None'], default: 'standard', level: 'advanced', help_zh: '仅用训练段已观测样本拟合；评估时逆变换回源单位。', suggestion_zh: '默认 StandardScaler。' },
      { key: 'label', label_zh: 'Dataset Label', type: 'string', default: '', required: false, help_zh: '可选名称，便于在历史中识别。', suggestion_zh: '留空自动生成。' },
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
    } catch (err) {
      if (err instanceof ApiError) {
        setServerIssues(err.issues)
        messageApi.error(`预览被拒绝：${err.message}`)
      } else messageApi.error(String(err))
    } finally {
      setBusy(false)
    }
  }

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
        messageApi.error(`构建被拒绝：${err.message}（未生成任何半成品 Dataset ID）`)
      } else messageApi.error(String(err))
    } finally {
      setBusy(false)
    }
  }

  const openDataset = async (datasetId: string) => {
    try {
      const data = await api.get<any>(ENDPOINTS.datasetGet(datasetId))
      setSelectedDataset(data)
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
      messageApi.success(`已打开 ${datasetId}（历史参数被冻结，修改需另存新 Dataset ID）`)
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

  return (
    <div>
      {contextHolder}
      <ModuleHeader
        module="Module 3"
        title="Forecasting Dataset Construction"
        description="滑窗 L/H/S、无泄漏时间切分、因果预处理与 Dataset ID 持久化"
        datasetInfo={selectedDataset ? `当前数据集 ${selectedDataset.dataset_id} · ${selectedDataset.status}` : '尚未打开已保存数据集'}
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
              title="Configuration"
              extra={
                <Button size="small" onClick={() => { setConfig({ ...DEFAULT_CONFIG }); setDrafts({}); setPreview(null) }}>
                  Reset Configuration
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
              <Button onClick={runPreview} loading={busy}>实时预览</Button>
              <Button type="primary" onClick={build} loading={busy} disabled={!valid}>Save &amp; Build Dataset</Button>
            </div>
          </>
        }
        visual={
          <div className="tn-stack">
            <Card size="small" title="1 · Sliding Window Preview（真实 X/Y 与端点时间）">
              {preview?.preview_windows?.length ? (
                <>
                  {preview.preview_windows.map((window: any, index: number) => (
                    <div key={index} className="tn-muted">
                      窗口 #{index + 1}（region {preview.preview_region_id}）：X 起于 {window.input_start_at}，止于{' '}
                      {window.input_end_at} → Y 目标 {window.target_start_at} ~ {window.target_end_at}
                      {window.imputed_input_positions?.length ? `（X 含 ${window.imputed_input_positions.length} 个因果插值点）` : ''}
                    </div>
                  ))}
                  <LineChart
                    height={210}
                    x={[
                      ...preview.preview_windows[0].X.map((_: number, i: number) => `X${i + 1}`),
                      ...preview.preview_windows[0].Y.map((_: number, i: number) => `Y${i + 1}`),
                    ]}
                    series={[
                      { name: `X（L=${config.input_length}）`, data: preview.preview_windows[0].X, color: '#2467E8' },
                      { name: `Y（H=${config.output_length}）`, data: preview.preview_windows[0].Y, color: '#D98F00' },
                    ]}
                    empty={!preview}
                  />
                  <div className="tn-muted">
                    Y 的每个目标点都必须是真实观测（缺失处理不会填补目标），X 允许使用预测起点之前的因果插值。
                  </div>
                </>
              ) : (
                <EmptyState text="点击“实时预览”后显示真实滑窗边界。" />
              )}
            </Card>

            <Card size="small" title="2 · Chronological Split Preview（真实时间轴）">
              {train.length ? (
                <>
                  <table style={{ width: '100%', fontSize: 12 }}>
                    <thead>
                      <tr style={{ color: '#5b7095', textAlign: 'left' }}>
                        <th>Split</th><th>时间范围</th><th>窗口数</th><th>候选窗口</th>
                      </tr>
                    </thead>
                    <tbody>
                      {train.map((row: any) => (
                        <tr key={row.split} style={{ borderTop: '1px dashed #e3ebf6' }}>
                          <td>{row.split}</td>
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
                    series={[
                      { name: '窗口数', data: train.map((row: any) => row.window_count), type: 'bar' },
                      { name: '候选窗口', data: train.map((row: any) => row.candidate_windows), type: 'bar' },
                    ]}
                  />
                </>
              ) : (
                <EmptyState text="预览后显示 Train / Validation / Test 的真实日期边界与窗口数。" />
              )}
            </Card>

            <Card size="small" title="3 · Forecast Time Preview（可预测覆盖范围）">
              {preview ? (
                <div className="tn-muted">
                  <div>测试集有效窗口：{windows.test ?? 0}（候选 {preview.split_boundaries?.find((s: any) => s.split === 'test')?.candidate_windows ?? 0}）</div>
                  <div>首个可用 X/Y 起点：{preview.preview_windows?.[0]?.input_start_at ?? '—'}</div>
                  <div>最后可用 Y 目标：{preview.preview_windows?.[preview.preview_windows.length - 1]?.target_end_at ?? '—'}</div>
                  <div>Scope：{preview.scope === 'all' ? `All Regions（${preview.region_count} 个区域，独立建模）` : `Single Region（${preview.region_ids?.[0]}）`}</div>
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
                label: 'Dataset Overview',
                children: (
                  <div className="tn-stack">
                    {selectedDataset ? (
                      <Card size="small" title="已保存数据集（不可变快照）">
                        <div className="tn-code">{selectedDataset.dataset_id}</div>
                        <div className="tn-muted" style={{ marginTop: 6 }}>
                          <div>来源：{selectedDataset.source_display_name}（{selectedDataset.unit_label}）</div>
                          <div>Scope：{selectedDataset.scope === 'all' ? `All Regions（${selectedDataset.region_count}）` : `Single Region（${selectedDataset.region_ids?.[0]}）`}</div>
                          <div>L/H/S = {selectedDataset.L}/{selectedDataset.H}/{selectedDataset.S} @ {selectedDataset.frequency}（{selectedDataset.aggregation}）</div>
                          <div>比例：{selectedDataset.ratios?.train}/{selectedDataset.ratios?.validation}/{selectedDataset.ratios?.test}</div>
                          <div>窗口数：train {selectedDataset.window_counts?.train} · val {selectedDataset.window_counts?.validation} · test {selectedDataset.window_counts?.test}</div>
                          <div>预处理：{selectedDataset.preprocess?.missing_mode} / {selectedDataset.preprocess?.scaling}</div>
                          <div>创建时间：{selectedDataset.created_at}</div>
                          <div>引用状态：{selectedDataset.is_referenced ? '已被实验/评价引用（只能 Archive）' : '未被引用（可删除）'}</div>
                        </div>
                      </Card>
                    ) : (
                      <EmptyState text="打开历史数据集或构建新数据集后显示快照。" />
                    )}
                    {preview ? (
                      <Card size="small" title="当前草稿预览统计">
                        <div className="tn-muted">
                          <div>窗口总数：train {windows.train} / val {windows.validation} / test {windows.test}</div>
                          <div>缺失处理：{preview.missing?.mode}，插值点 {preview.missing?.imputed_points}，原始缺失 {preview.missing?.missing_points_before}</div>
                          <div>标准化：{preview.scaling}</div>
                        </div>
                      </Card>
                    ) : null}
                  </div>
                ),
              },
              {
                key: 'windows',
                label: 'Window Preview',
                children: (
                  <div className="tn-stack">
                    <div className="tn-inline">
                      <Tag color="blue">split</Tag>
                      <Button size="small" type={windowSplit === 'train' ? 'primary' : 'default'} onClick={() => setWindowSplit('train')}>train</Button>
                      <Button size="small" type={windowSplit === 'validation' ? 'primary' : 'default'} onClick={() => setWindowSplit('validation')}>validation</Button>
                      <Button size="small" type={windowSplit === 'test' ? 'primary' : 'default'} onClick={() => setWindowSplit('test')}>test</Button>
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
                      <EmptyState text="打开一个已保存 Dataset 后可查看真实 X/Y 样本。" />
                    )}
                  </div>
                ),
              },
              {
                key: 'quality',
                label: 'Data Quality',
                children: (
                  <div className="tn-stack">
                    <Card size="small" title="构建质量报告（真实统计）">
                      {preview ? (
                        <div className="tn-muted">
                          <div>时间点数：{preview.time_points}（{preview.time_start} → {preview.time_end}）</div>
                          <div>区域数：{preview.region_count}</div>
                          <div>缺失点（处理前）：{preview.missing?.missing_points_before}</div>
                          <div>插值点：{preview.missing?.imputed_points}（策略 {preview.missing?.mode}）</div>
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
                label: 'Dataset Management',
                children: (
                  <Table
                    size="small"
                    rowKey="dataset_id"
                    dataSource={datasets}
                    pagination={{ pageSize: 8, size: 'small' }}
                    columns={[
                      { title: 'Dataset ID', dataIndex: 'dataset_id', width: 190, render: (value: string) => <span className="tn-code">{value}</span> },
                      { title: 'Scope', render: (_: unknown, row: any) => `${row.scope === 'all' ? 'All' : 'Single'} · ${row.region_count}` },
                      { title: 'L/H/S', render: (_: unknown, row: any) => `${row.L}/${row.H}/${row.S}` },
                      { title: '状态', render: (_: unknown, row: any) => <StatusTag status={row.status} /> },
                      { title: '创建时间', dataIndex: 'created_at', width: 150 },
                      {
                        title: '操作',
                        render: (_: unknown, row: any) => (
                          <div className="tn-inline">
                            <Button size="small" onClick={() => openDataset(row.dataset_id)}>Open</Button>
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
                              {row.status === 'Archived' ? 'Unarchive' : 'Archive'}
                            </Button>
                            <Tooltip title={row.is_referenced ? '已被 Experiment/Evaluation 引用，只能 Archive' : '删除会同时移除工件目录'}>
                              <Popconfirm
                                title="删除该 Dataset？"
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
                                <Button size="small" danger disabled={row.is_referenced}>Delete</Button>
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
