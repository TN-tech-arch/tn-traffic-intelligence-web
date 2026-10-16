import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert, Button, Card, Collapse, Descriptions, Popconfirm, Progress, Select, Switch, Table, Tabs, Tag, Tooltip, message,
} from 'antd'
import { useNavigate } from 'react-router-dom'
import { ENDPOINTS, ApiError, api, type Issue } from '../api/client'
import { EmptyState, ModuleHeader, PaneHead, ThreePane } from '../components/Panes'
import ParamField from '../components/ParamField'
import StatusTag from '../components/StatusTag'
import { LineChart } from '../components/Charts'
import { useGroupValidation, useSchema } from '../validation/useValidation'
import type { Issue as IssueType } from '../api/client'
import { fieldDisabledReason, isVisible, visibleFields, type FieldSpec, type Values } from '../validation/engine'

const ALL_MODELS = 'all_models'

export default function Training() {
  const [messageApi, contextHolder] = message.useMessage()
  const navigate = useNavigate()
  const { schema, error: schemaError } = useSchema()
  const [datasets, setDatasets] = useState<any[]>([])
  const [datasetId, setDatasetId] = useState<string>('')
  const [dataset, setDataset] = useState<any>(null)
  const [algorithm, setAlgorithm] = useState<string>('arima')
  const [params, setParams] = useState<Values>({})
  const [allParams, setAllParams] = useState<Record<string, Values>>({})
  const [customized, setCustomized] = useState<Record<string, boolean>>({})
  const [advanced, setAdvanced] = useState(false)
  const [preflight, setPreflight] = useState<any>(null)
  const [batch, setBatch] = useState<any>(null)
  const [experiment, setExperiment] = useState<any>(null)
  const [experiments, setExperiments] = useState<any[]>([])
  const [batches, setBatches] = useState<any[]>([])
  const [logs, setLogs] = useState<any[]>([])
  const [tab, setTab] = useState('overview')
  const [monitorTab, setMonitorTab] = useState('monitor')
  const [busy, setBusy] = useState(false)
  const [serverIssues, setServerIssues] = useState<IssueType[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  const models = schema?.models ?? []
  const activeModel = models.find((m) => m.key === algorithm)
  const isAllModels = algorithm === ALL_MODELS

  const defaultsFor = useCallback(
    (key: string): Values => {
      const model = models.find((m) => m.key === key)
      if (!model) return {}
      const values: Values = {}
      model.params.forEach((spec) => {
        values[spec.key] = spec.default
      })
      return values
    },
    [models],
  )

  useEffect(() => {
    if (!models.length) return
    setParams((prev) => (Object.keys(prev).length ? prev : defaultsFor('arima')))
    setAllParams((prev) => {
      if (Object.keys(prev).length) return prev
      const next: Record<string, Values> = {}
      models.forEach((model) => {
        next[model.key] = defaultsFor(model.key)
      })
      return next
    })
  }, [models, defaultsFor])

  const loadDatasets = useCallback(() => {
    api
      .get<any>(ENDPOINTS.datasetList)
      .then((data) => {
        const built = data.datasets.filter((d: any) => d.status !== 'Archived')
        setDatasets(built)
        setDatasetId((prev) => {
          if (prev && built.some((d: any) => d.dataset_id === prev)) return prev
          return built[0]?.dataset_id ?? ''
        })
      })
      .catch(() => undefined)
  }, [])

  const loadHistory = useCallback(() => {
    api.get<any>(ENDPOINTS.experimentList).then((data) => setExperiments(data.experiments)).catch(() => undefined)
    api.get<any>(ENDPOINTS.batchList).then((data) => setBatches(data.batches)).catch(() => undefined)
  }, [])

  useEffect(() => {
    loadDatasets()
    loadHistory()
  }, [loadDatasets, loadHistory])

  useEffect(() => {
    if (!datasetId) return
    api.get<any>(ENDPOINTS.datasetGet(datasetId)).then(setDataset).catch(() => setDataset(null))
  }, [datasetId])

  // live polling for the running experiment / batch
  useEffect(() => {
    const running = experiment && ['Queued', 'Running', 'Stopping'].includes(experiment.status)
    const batchRunning = batch && ['Running', 'Created', 'Stopping'].includes(batch.status)
    if (!running && !batchRunning) return
    const timer = window.setInterval(async () => {
      if (experiment && running) {
        try {
          const data = await api.get<any>(ENDPOINTS.experimentGet(experiment.experiment_id))
          setExperiment(data)
          if (!['Queued', 'Running', 'Stopping'].includes(data.status)) loadHistory()
        } catch {
          /* keep previous state */
        }
      }
      if (batch && batchRunning) {
        try {
          const data = await api.get<any>(ENDPOINTS.batchGet(batch.batch_id))
          setBatch(data)
          if (!['Running', 'Created', 'Stopping'].includes(data.status)) loadHistory()
        } catch {
          /* ignore */
        }
      }
    }, 2500)
    return () => window.clearInterval(timer)
  }, [experiment, batch, loadHistory])

  useEffect(() => {
    if (!experiment) {
      setLogs([])
      return
    }
    api
      .get<any>(ENDPOINTS.experimentLogs(experiment.experiment_id))
      .then((data) => setLogs(data.logs))
      .catch(() => setLogs([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experiment?.experiment_id, experiment?.status, experiment?.progress?.percent])

  const singleValidation = useGroupValidation({
    specs: (activeModel?.params ?? []).filter((spec) => (advanced ? true : spec.level !== 'advanced')),
    values: params,
    pathPrefix: `model_configs.${algorithm}.params`,
    algorithmKey: algorithm,
    remote: datasetId
      ? {
          kind: 'model',
          values: params,
          algorithm_key: algorithm,
          mode: activeModel?.default_mode,
          context: {
            dataset_id: datasetId,
            train_samples: dataset?.window_counts?.train,
            region_count: dataset?.region_count,
            algorithm_key: algorithm,
          },
        }
      : null,
  })

  const allValidation = useGroupValidation({
    specs: [],
    values: {},
    pathPrefix: 'all_models',
    remote: datasetId
      ? { kind: 'all_models', values: allParams, context: { dataset_id: datasetId, region_count: dataset?.region_count, train_samples: dataset?.window_counts?.train } }
      : null,
  })

  const activeIssues: IssueType[] = isAllModels ? allValidation.issues : singleValidation.issues
  const activeErrors = activeIssues.filter((i) => i.severity === 'error')
  const activeWarnings = activeIssues.filter((i) => i.severity === 'warning')
  const runnable = activeErrors.length === 0

  const runPreflight = async () => {
    if (!datasetId) {
      messageApi.warning('请先选择一个已构建的 Dataset。')
      return
    }
    setBusy(true)
    setServerIssues([])
    try {
      const payload = isAllModels
        ? { dataset_id: datasetId, algorithm_choice: 'all_models', model_configs: buildModelConfigs() }
        : {
            dataset_id: datasetId,
            algorithm_key: algorithm,
            mode: activeModel?.default_mode,
            params,
          }
      const data = await api.post<any>(ENDPOINTS.preflight, payload)
      setPreflight(data)
    } catch (err) {
      if (err instanceof ApiError) setServerIssues(err.issues)
      else messageApi.error(String(err))
    } finally {
      setBusy(false)
    }
  }

  const buildModelConfigs = () => {
    const configs: Record<string, any> = {}
    Object.entries(allParams).forEach(([key, value]) => {
      const model = models.find((m) => m.key === key)
      configs[key] = { mode: model?.default_mode, params: value }
    })
    return configs
  }

  const runSingle = async () => {
    if (!runnable) {
      messageApi.error('存在参数错误，无法运行。请查看字段下方提示（服务器还会再次校验）。')
      return
    }
    setBusy(true)
    try {
      const created = await api.post<any>(ENDPOINTS.experimentRun, {
        dataset_id: datasetId,
        algorithm_key: algorithm,
        mode: activeModel?.default_mode,
        params,
      })
      messageApi.success(`Experiment ${created.experiment_id} 已提交（${created.region_count} 个区域）`)
      const data = await api.get<any>(ENDPOINTS.experimentGet(created.experiment_id))
      setExperiment(data)
      setMonitorTab('monitor')
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

  const runAllModels = async () => {
    if (!runnable) {
      messageApi.error('批次存在阻断性错误，无法提交。')
      return
    }
    const confirmed = window.confirm(
      `将按顺序运行 12 个算法：\n` +
        `地点/数据集：${dataset?.source_display_name} ${dataset?.dataset_id}\n` +
        `Scope：${dataset?.scope === 'all' ? `All Regions（${dataset?.region_count} 个区域）` : 'Single Region'}\n` +
        `计划任务数：${12 * (dataset?.scope === 'all' ? dataset?.region_count ?? 1 : 1)}\n` +
        `不可运行模型：${(preflight?.models ?? []).filter((m: any) => !m.runnable).map((m: any) => m.label).join(', ') || '无'}\n\n` +
        `默认顺序执行；可在实验历史中随时 Stop。估计耗时：无法可靠估计（取决于模型与硬件）。`,
    )
    if (!confirmed) return
    setBusy(true)
    try {
      const created = await api.post<any>(ENDPOINTS.batchRun, {
        dataset_id: datasetId,
        model_configs: buildModelConfigs(),
        execution_policy: { sequential: true, continue_on_error: true, skip_unavailable_after_confirmation: true },
      })
      messageApi.success(`Batch ${created.batch_id} 已创建（${created.experiments.length} 个实验计划）`)
      const data = await api.get<any>(ENDPOINTS.batchGet(created.batch_id))
      setBatch(data)
      setMonitorTab('batch')
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

  const stop = async () => {
    try {
      if (batch && ['Running', 'Created', 'Stopping'].includes(batch.status)) {
        await api.post(ENDPOINTS.batchStop(batch.batch_id))
        messageApi.success('已请求停止批次（后端确认后将把未开始任务置为 Cancelled/Skipped）')
      } else if (experiment && ['Queued', 'Running', 'Stopping'].includes(experiment.status)) {
        await api.post(ENDPOINTS.experimentStop(experiment.experiment_id))
        messageApi.success('已请求停止实验')
      }
    } catch (err) {
      messageApi.error(err instanceof ApiError ? err.message : String(err))
    }
  }

  const epochHistory = useMemo(() => {
    const regions = experiment?.region_models ?? []
    const withEpochs = regions.find((r: any) => r.history?.epoch?.length)
    if (!withEpochs) return null
    return withEpochs.history
  }, [experiment])

  const currentProgress = batch
    ? Math.round(
        (100 * ((batch.task_summary?.completed ?? 0) + (batch.task_summary?.failed ?? 0) + (batch.task_summary?.skipped ?? 0))) /
          Math.max(1, batch.experiments?.length ?? 12),
      )
    : Math.round(experiment?.progress?.percent ?? 0)

  if (schemaError) return <Alert type="error" showIcon message="无法读取模型注册表" description={schemaError} />

  return (
    <div>
      {contextHolder}
      <ModuleHeader
        module="Module 4"
        title="Model Training"
        description="12 种真实算法（含 TimesFM / Chronos Zero-shot）与 All Models 批量执行"
        datasetInfo={dataset ? `${dataset.dataset_id} · ${dataset.source_display_name} · L/H/S = ${dataset.L}/${dataset.H}/${dataset.S} · ${dataset.scope === 'all' ? `All Regions(${dataset.region_count})` : 'Single Region'}` : '请先构建数据集'}
      />
      {activeErrors.length > 0 ? (
        <Alert type="error" showIcon style={{ marginBottom: 10 }} message={`${activeErrors.length} 个阻断性错误（错误位于对应输入框下方）`} description={activeErrors.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join('；')} />
      ) : null}
      {serverIssues.length > 0 ? (
        <Alert type="error" showIcon style={{ marginBottom: 10 }} message="后端拒绝了请求（未创建任何 Job / Experiment / Batch）" description={serverIssues.map((i) => `${i.path}: ${i.message}`).join('；')} />
      ) : null}
      <ThreePane
        config={
          <>
            <PaneHead
              title="Configuration"
              extra={
                <Tooltip title="只重置当前可编辑参数，不影响已保存的实验">
                  <Button size="small" onClick={() => { isAllModels ? resetAllModels() : setParams(defaultsFor(algorithm)); setDrafts({}) }}>
                    Reset Parameters
                  </Button>
                </Tooltip>
              }
            />
            <div className="tn-field">
              <label className="tn-field-label">1 · Dataset Selection（只读快照）</label>
              <Select
                style={{ width: '100%' }}
                size="small"
                value={datasetId || undefined}
                placeholder="选择一个已构建的 Dataset"
                options={datasets.map((d) => ({ value: d.dataset_id, label: `${d.dataset_id} · ${d.source_display_name} · ${d.scope}` }))}
                onChange={(value) => setDatasetId(value)}
              />
              {dataset ? (
                <Descriptions size="small" column={1} style={{ marginTop: 8, fontSize: 11 }}>
                  <Descriptions.Item label="来源">{dataset.source_display_name} · {dataset.unit_label}</Descriptions.Item>
                  <Descriptions.Item label="Scope">{dataset.scope === 'all' ? `All Regions（${dataset.region_count} 个区域，独立建模）` : `Single Region（${dataset.region_ids?.[0]}）`}</Descriptions.Item>
                  <Descriptions.Item label="分辨率/聚合">{dataset.frequency} · {dataset.aggregation}</Descriptions.Item>
                  <Descriptions.Item label="L / H / S">{dataset.L} / {dataset.H} / {dataset.S}（H 继承自 Dataset，不可修改）</Descriptions.Item>
                  <Descriptions.Item label="Train/Val/Test">{dataset.ratios?.train} / {dataset.ratios?.validation} / {dataset.ratios?.test}</Descriptions.Item>
                  <Descriptions.Item label="窗口数">train {dataset.window_counts?.train} · val {dataset.window_counts?.validation} · test {dataset.window_counts?.test}</Descriptions.Item>
                  <Descriptions.Item label="预处理">{dataset.preprocess?.missing_mode} · {dataset.preprocess?.scaling}</Descriptions.Item>
                </Descriptions>
              ) : null}
            </div>

            <div className="tn-field">
              <label className="tn-field-label">2 · Prediction Algorithm</label>
              <div
                className={`tn-history-row${isAllModels ? ' active' : ''}`}
                style={{ background: isAllModels ? '#e7f0fe' : undefined, borderRadius: 6, padding: '8px 6px' }}
                role="button"
                tabIndex={0}
                onClick={() => setAlgorithm(ALL_MODELS)}
                onKeyDown={(e) => e.key === 'Enter' && setAlgorithm(ALL_MODELS)}
              >
                <div>
                  <strong>All Models (12)</strong>
                  <div className="tn-muted">批量编排：按顺序运行下方 12 个算法（不是第 13 种算法）</div>
                </div>
                {isAllModels ? <Tag color="blue">已选择</Tag> : null}
              </div>
              {['statistical', 'machine_learning', 'deep_learning', 'foundation'].map((category) => (
                <Collapse
                  key={category}
                  size="small"
                  ghost
                  defaultActiveKey={['statistical']}
                  items={[
                    {
                      key: category,
                      label: models.find((m) => m.category === category)?.category_label_zh ?? category,
                      children: models
                        .filter((m) => m.category === category)
                        .map((model) => (
                          <div
                            key={model.key}
                            className="tn-history-row"
                            style={{ background: algorithm === model.key ? '#f0f6ff' : undefined, cursor: 'pointer' }}
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              setAlgorithm(model.key)
                              setParams(allParams[model.key] ?? defaultsFor(model.key))
                            }}
                            onKeyDown={(e) => e.key === 'Enter' && setAlgorithm(model.key)}
                          >
                            <div>
                              <div style={{ fontSize: 12 }}>
                                {model.label}
                                {customized[model.key] ? <Tag color="gold" style={{ marginLeft: 6 }}>已自定义</Tag> : null}
                              </div>
                              <div className="tn-muted">{model.default_mode}{model.capabilities?.installed === false ? ' · 依赖未安装' : ''}</div>
                            </div>
                            <Tag color={model.category === 'foundation' ? 'purple' : 'blue'}>{model.category_label_zh}</Tag>
                          </div>
                        )),
                    },
                  ]}
                />
              ))}
            </div>

            <div className="tn-field">
              <label className="tn-field-label">
                3 · Model Parameters
                <Switch size="small" checked={advanced} onChange={setAdvanced} />
                <span className="tn-muted">{advanced ? '显示 Basic + Advanced' : '仅显示 Basic'}</span>
              </label>
              {isAllModels ? (
                <>
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 8, fontSize: 11 }}
                    message={`每个算法都有独立参数组；当前已自定义 ${Object.values(customized).filter(Boolean).length} 个算法。默认使用 registry preset。`}
                  />
                  <Collapse
                    size="small"
                    items={models.map((model) => {
                      const issues = allValidation.issues.filter((i) => i.path.startsWith(`model_configs.${model.key}.params`) && i.severity === 'error')
                      const warnings = allValidation.issues.filter((i) => i.path.startsWith(`model_configs.${model.key}.params`) && i.severity === 'warning')
                      return {
                        key: model.key,
                        label: (
                          <span className="tn-inline">
                            <span>{model.label}</span>
                            <Tag color={model.category === 'foundation' ? 'purple' : 'default'}>{model.default_mode}</Tag>
                            {customized[model.key] ? <Tag color="gold">自定义</Tag> : <Tag>默认</Tag>}
                            {issues.length ? <Tag color="red">{issues.length} Error</Tag> : <Tag color="green">可运行</Tag>}
                            {warnings.length ? <Tag color="orange">{warnings.length} Warning</Tag> : null}
                          </span>
                        ),
                        children: (
                          <div>
                            <div className="tn-inline" style={{ marginBottom: 6 }}>
                              <Button
                                size="small"
                                onClick={() => {
                                  setAllParams((prev) => ({ ...prev, [model.key]: defaultsFor(model.key) }))
                                  setCustomized((prev) => ({ ...prev, [model.key]: false }))
                                }}
                              >
                                恢复本算法默认值
                              </Button>
                              {issues.length ? (
                                <span className="tn-muted">跳转到该算法首个错误：{issues[0].path}</span>
                              ) : null}
                            </div>
                            {visibleFields(model.params, allParams[model.key] ?? {})
                              .filter((spec) => (advanced ? true : spec.level !== 'advanced'))
                              .map((spec) => (
                                <ParamField
                                  key={spec.key}
                                  spec={spec}
                                  value={(allParams[model.key] ?? {})[spec.key]}
                                  issues={allValidation.issues.filter((i) => i.path === `model_configs.${model.key}.params.${spec.key}`)}
                                  path={`model_configs.${model.key}.params.${spec.key}`}
                                  onChange={(key, value) => {
                                    setAllParams((prev) => ({ ...prev, [model.key]: { ...(prev[model.key] ?? {}), [key]: value } }))
                                    setCustomized((prev) => ({ ...prev, [model.key]: true }))
                                  }}
                                  disabledReason={fieldDisabledReason(spec, allParams[model.key] ?? {})}
                                  compact
                                />
                              ))}
                          </div>
                        ),
                      }
                    })}
                  />
                  <Button
                    size="small"
                    danger
                    style={{ marginTop: 6 }}
                    onClick={() =>
                      window.confirm('Reset All Model Parameters？这会丢弃 12 个算法的全部自定义参数（不影响已保存实验）。') && resetAllModels()
                    }
                  >
                    Reset All Model Parameters
                  </Button>
                </>
              ) : activeModel ? (
                <>
                  <div className="tn-muted" style={{ marginBottom: 6 }}>
                    使用模式：<Tag>{activeModel.default_mode}</Tag>
                    {activeModel.capabilities?.supports_finetune ? <Tag color="green">支持 Fine-tuning</Tag> : <Tag>仅 Zero-shot</Tag>}
                    {activeModel.capabilities?.requires_checkpoint ? <Tag color="purple">需要 checkpoint</Tag> : null}
                  </div>
                  {visibleFields(activeModel.params, params)
                    .filter((spec) => (advanced ? true : spec.level !== 'advanced'))
                    .map((spec) => (
                      <ParamField
                        key={spec.key}
                        spec={spec}
                        value={params[spec.key]}
                        issues={singleValidation.fieldIssues(spec.key)}
                        path={`model_configs.${algorithm}.params.${spec.key}`}
                        draft={drafts[`${algorithm}.${spec.key}`]}
                        onDraftChange={(key, text) => setDrafts((prev) => ({ ...prev, [`${algorithm}.${key}`]: text }))}
                        onChange={(key, value) => {
                          setParams((prev) => ({ ...prev, [key]: value }))
                          setCustomized((prev) => ({ ...prev, [algorithm]: true }))
                        }}
                        disabledReason={fieldDisabledReason(spec, params)}
                        compact
                      />
                    ))}
                </>
              ) : (
                <EmptyState text="模型注册表加载中…" />
              )}
            </div>

            <div className="tn-field">
              <label className="tn-field-label">5 · Preflight Summary</label>
              <Button size="small" onClick={runPreflight} loading={busy} disabled={!datasetId}>
                Check Compatibility
              </Button>
              {preflight ? (
                <div className="tn-muted" style={{ marginTop: 6 }}>
                  {isAllModels ? (
                    <>
                      <div>可运行模型：{preflight.runnable_count} / 12；阻断性错误 {preflight.blocking_error_count}</div>
                      {preflight.batch_issues?.map((issue: any) => (
                        <div key={issue.code} className="tn-warning-text">⚠ {issue.message}（{issue.suggestion}）</div>
                      ))}
                    </>
                  ) : (
                    <>
                      <div>可运行：{preflight.valid ? '是' : '否'}</div>
                      {preflight.issues?.map((issue: any) => (
                        <div key={issue.code + issue.path} className={issue.severity === 'error' ? 'tn-error-text' : 'tn-warning-text'}>
                          {issue.severity === 'error' ? '✕' : '⚠'} {issue.message}
                        </div>
                      ))}
                      <div>训练样本数（首区域）：{preflight.context?.train_samples ?? '—'}</div>
                    </>
                  )}
                </div>
              ) : (
                <div className="tn-muted" style={{ marginTop: 4 }}>运行前会自动预检；也可手动执行。</div>
              )}
            </div>

            <div className="tn-field">
              <label className="tn-field-label">6 · Actions</label>
              <div className="tn-inline">
                {isAllModels ? (
                  <Button type="primary" onClick={runAllModels} loading={busy} disabled={!runnable || !datasetId}>Run All Models</Button>
                ) : (
                  <Button
                    type="primary"
                    onClick={runSingle}
                    loading={busy}
                    disabled={!runnable || !datasetId}
                  >
                    Run Training
                  </Button>
                )}
                <Button onClick={stop} danger>Stop Training / Stop Batch</Button>
              </div>
              <div className="tn-inline" style={{ marginTop: 6 }}>
                <Tooltip title="只有已完成的实验才能保存/评估；Experiment ID 在 Run 时即已创建">
                  <Button
                    size="small"
                    disabled={!experiment || !['Completed', 'Partial'].includes(experiment?.status)}
                    onClick={() => messageApi.success(`实验 ${experiment.experiment_id} 的工件已落盘（data/artifacts/experiments/${experiment.experiment_id}）`)}
                  >
                    Save Model
                  </Button>
                </Tooltip>
                <Tooltip title="跳转到 Module 5 并对该实验使用 held-out Test 评估">
                  <Button
                    size="small"
                    disabled={!experiment || !['Completed', 'Partial'].includes(experiment?.status)}
                    onClick={() => navigate(`/evaluation?dataset=${datasetId}&experiment=${experiment?.experiment_id}`)}
                  >
                    Evaluate Model
                  </Button>
                </Tooltip>
              </div>
            </div>
          </>
        }
        visual={
          <Tabs
            className="tn-tabs-tight"
            activeKey={monitorTab}
            onChange={setMonitorTab}
            items={[
              {
                key: 'monitor',
                label: 'Training Monitor',
                children: (
                  <div className="tn-stack">
                    {experiment && !isAllModels ? (
                      <>
                        <Card size="small" title={`${experiment.algorithm_label} · ${experiment.mode}`}>
                          <div className="tn-inline">
                            <StatusTag status={experiment.status} error={experiment.error} />
                            <Tag>{experiment.experiment_id}</Tag>
                            <span className="tn-muted">{experiment.scope === 'all' ? 'All Regions' : 'Single Region'} · {experiment.region_completed}/{experiment.region_total} 区域完成</span>
                          </div>
                          <Progress percent={Math.round(experiment.progress?.percent ?? 0)} status={experiment.status === 'Failed' ? 'exception' : undefined} style={{ marginTop: 8 }} />
                          <div className="tn-muted">
                            {experiment.progress?.stage ?? '等待 Worker'} · {experiment.progress?.message ?? ''}
                          </div>
                          {epochHistory ? (
                            <LineChart
                              height={220}
                              x={epochHistory.epoch.map((e: number) => `epoch ${e}`)}
                              series={[
                                { name: 'Train Loss (MSE)', data: epochHistory.train_loss, color: '#2467E8' },
                                { name: 'Validation Loss', data: epochHistory.validation_loss, color: '#D98F00' },
                              ]}
                            />
                          ) : (
                            <div className="tn-muted" style={{ marginTop: 8 }}>
                              {experiment.history_type === 'zero_shot' || ['ARIMA', 'Prophet', 'Random Forest'].includes(experiment.algorithm_label)
                                ? '该算法没有 epoch 概念：不显示训练曲线，仅显示真实状态、耗时与日志。'
                                : '尚无 epoch 记录（Boosting 模型显示真实迭代指标）。'}
                            </div>
                          )}
                          {experiment.metrics?.macro_validation?.rmse ? (
                            <div className="tn-muted" style={{ marginTop: 6 }}>
                              验证集（真实预测）：MAE {Number(experiment.metrics.macro_validation.mae).toFixed(2)} · RMSE{' '}
                              {Number(experiment.metrics.macro_validation.rmse).toFixed(2)} · sMAPE{' '}
                              {Number(experiment.metrics.macro_validation.smape).toFixed(2)}% · R²{' '}
                              {experiment.metrics.macro_validation.r2 === null ? 'N/A' : Number(experiment.metrics.macro_validation.r2).toFixed(4)}
                            </div>
                          ) : null}
                          {experiment.scope === 'all' ? (
                            <Table
                              size="small"
                              style={{ marginTop: 8 }}
                              rowKey="region_id"
                              pagination={{ pageSize: 6, size: 'small' }}
                              dataSource={experiment.region_models ?? []}
                              columns={[
                                { title: 'Region', dataIndex: 'region_id' },
                                { title: '状态', render: (_: unknown, row: any) => <StatusTag status={row.status} error={row.error} /> },
                                { title: '验证 RMSE', render: (_: unknown, row: any) => row.metrics?.rmse ? Number(row.metrics.rmse).toFixed(1) : '—' },
                                { title: 'Epochs', render: (_: unknown, row: any) => row.history?.epochs_completed ?? '—' },
                              ]}
                            />
                          ) : null}
                        </Card>
                      </>
                    ) : null}
                    {batch ? (
                      <Card size="small" title={`All Models 批次 ${batch.batch_id}`}>
                        <div className="tn-inline">
                          <StatusTag status={batch.status} error={batch.error} />
                          <Tag>总任务 {batch.experiments?.length}</Tag>
                          <Tag color="green">Completed {batch.task_summary?.completed ?? 0}</Tag>
                          <Tag color="red">Failed {batch.task_summary?.failed ?? 0}</Tag>
                          <Tag>Skipped {batch.task_summary?.skipped ?? 0}</Tag>
                          <Tag color="orange">Partial {batch.task_summary?.partial ?? 0}</Tag>
                        </div>
                        <Progress percent={currentProgress} style={{ marginTop: 8 }} />
                        <Table
                          size="small"
                          style={{ marginTop: 8 }}
                          rowKey="experiment_id"
                          pagination={false}
                          dataSource={batch.experiments ?? []}
                          columns={[
                            { title: 'Model', dataIndex: 'algorithm_label', sorter: (a: any, b: any) => a.algorithm_label.localeCompare(b.algorithm_label) },
                            { title: 'Mode', dataIndex: 'mode', width: 90 },
                            {
                              title: 'Progress',
                              width: 130,
                              render: (_: unknown, row: any) => (
                                <Progress percent={Math.round(row.progress?.percent ?? 0)} size="small" />
                              ),
                            },
                            { title: 'Regions', width: 90, render: (_: unknown, row: any) => `${row.region_completed}/${row.region_total}` },
                            { title: 'Failed', dataIndex: 'region_failed', width: 70 },
                            { title: 'Status', width: 110, render: (_: unknown, row: any) => <StatusTag status={row.status} error={row.error} /> },
                            { title: '验证 RMSE', width: 110, render: (_: unknown, row: any) => row.metrics?.macro_validation?.rmse ? Number(row.metrics.macro_validation.rmse).toFixed(1) : '—' },
                            {
                              title: '',
                              render: (_: unknown, row: any) => (
                                <Button
                                  size="small"
                                  onClick={async () => {
                                    const data = await api.get<any>(ENDPOINTS.experimentGet(row.experiment_id))
                                    setExperiment(data)
                                    setMonitorTab('monitor')
                                    setAlgorithm(row.algorithm_key)
                                  }}
                                >
                                  查看
                                </Button>
                              ),
                            },
                          ]}
                        />
                        {batch.region_summary?.length ? (
                          <Table
                            size="small"
                            style={{ marginTop: 10 }}
                            rowKey={(row: any) => `${row.experiment_id}-${row.region_id}`}
                            pagination={{ pageSize: 6, size: 'small' }}
                            dataSource={batch.region_summary}
                            columns={[
                              { title: 'Experiment', dataIndex: 'experiment_id', width: 190 },
                              { title: 'Region', dataIndex: 'region_id' },
                              { title: '状态', render: (_: unknown, row: any) => <StatusTag status={row.status} error={row.error} /> },
                              { title: '验证 RMSE', render: (_: unknown, row: any) => row.metrics?.rmse ? Number(row.metrics.rmse).toFixed(1) : '—' },
                            ]}
                          />
                        ) : null}
                      </Card>
                    ) : null}
                    {!experiment && !batch ? <EmptyState text="选择算法并点击 Run 后，这里显示真实的训练状态、进度与日志。" /> : null}
                  </div>
                ),
              },
            ]}
          />
        }
        info={
          <Tabs
            className="tn-tabs-tight"
            activeKey={tab}
            onChange={setTab}
            items={[
              {
                key: 'overview',
                label: 'Training Overview',
                children: (
                  <div className="tn-stack">
                    {experiment ? (
                      <Card size="small" title="当前 Experiment">
                        <div className="tn-code">{experiment.experiment_id}</div>
                        <div className="tn-muted" style={{ marginTop: 6 }}>
                          <div>Batch：{experiment.batch_id ?? '（单模型运行）'}</div>
                          <div>Dataset：{experiment.dataset_id}</div>
                          <div>算法 / 模式：{experiment.algorithm_label} · {experiment.mode}</div>
                          <div>Scope：{experiment.scope === 'all' ? 'All Regions' : 'Single Region'} · 区域 {experiment.region_completed}/{experiment.region_total}</div>
                          <div>开始：{experiment.started_at ?? '—'} · 结束：{experiment.ended_at ?? '—'}</div>
                          <div>耗时：{experiment.metrics?.duration_seconds ?? '—'} 秒</div>
                        </div>
                        <div className="tn-section-title">不可变快照（运行即冻结）</div>
                        <pre className="tn-code" style={{ maxHeight: 200, overflow: 'auto' }}>{JSON.stringify(experiment.snapshot, null, 1)}</pre>
                      </Card>
                    ) : (
                      <EmptyState text="尚未运行实验。" />
                    )}
                    {batch ? (
                      <Card size="small" title="当前 Batch">
                        <div className="tn-code">{batch.batch_id}</div>
                        <div className="tn-muted" style={{ marginTop: 6 }}>
                          <div>Dataset：{batch.dataset_id}</div>
                          <div>Scope：{batch.scope === 'all' ? 'All Regions' : 'Single Region'} · 区域 {batch.region_count}</div>
                          <div>计划任务：{batch.planned_tasks}（12 算法 × {batch.region_count} 区域）</div>
                          <div>策略：顺序执行={String(batch.policy?.sequential)} · continue_on_error={String(batch.policy?.continue_on_error)} · 跳过不可用={String(batch.policy?.skip_unavailable_after_confirmation)}</div>
                        </div>
                      </Card>
                    ) : null}
                  </div>
                ),
              },
              {
                key: 'logs',
                label: 'Training Logs',
                children: (
                  <div className="tn-stack">
                    <div className="tn-inline">
                      <span className="tn-muted">实验 {experiment?.experiment_id ?? '—'} 的真实后端日志</span>
                      <a href={experiment ? `/api/experiments/${experiment.experiment_id}/logs` : '#'} download={`${experiment?.experiment_id ?? 'logs'}.json`}>
                        <Button size="small" disabled={!experiment}>下载日志</Button>
                      </a>
                    </div>
                    {logs.length ? (
                      <div className="tn-code" style={{ maxHeight: 420, overflow: 'auto' }}>
                        {logs.map((entry, index) => (
                          <div key={index}>
                            [{entry.at}] {entry.level.toUpperCase()} {entry.region_id ? `(${entry.region_id}) ` : ''}
                            {entry.message}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState text="暂无日志（实验尚未开始或已被清理）。" />
                    )}
                  </div>
                ),
              },
              {
                key: 'history',
                label: 'Experiment History',
                children: (
                  <div className="tn-stack">
                    <Table
                      size="small"
                      rowKey="batch_id"
                      title={() => 'Batches'}
                      dataSource={batches}
                      pagination={{ pageSize: 4, size: 'small' }}
                      columns={[
                        { title: 'Batch ID', dataIndex: 'batch_id', width: 180, render: (value: string) => <span className="tn-code">{value}</span> },
                        { title: 'Dataset', dataIndex: 'dataset_id', width: 170, ellipsis: true },
                        { title: '状态', render: (_: unknown, row: any) => <StatusTag status={row.status} error={row.error} /> },
                        { title: '完成/失败/跳过', render: (_: unknown, row: any) => `${row.task_summary?.completed ?? 0}/${row.task_summary?.failed ?? 0}/${row.task_summary?.skipped ?? 0}` },
                        { title: '创建时间', dataIndex: 'created_at', width: 150 },
                        {
                          title: '操作',
                          render: (_: unknown, row: any) => (
                            <div className="tn-inline">
                              <Button size="small" onClick={async () => { setBatch(await api.get<any>(ENDPOINTS.batchGet(row.batch_id))); setMonitorTab('batch') }}>Open</Button>
                              <Button size="small" danger disabled={!['Running', 'Created', 'Stopping'].includes(row.status)} onClick={async () => {
                                try { await api.post(ENDPOINTS.batchStop(row.batch_id)); messageApi.success('已请求停止批次'); loadHistory() } catch (err) { messageApi.error(String(err)) }
                              }}>Stop</Button>
                            </div>
                          ),
                        },
                      ]}
                    />
                    <Table
                      size="small"
                      rowKey="experiment_id"
                      title={() => 'Experiments'}
                      dataSource={experiments}
                      pagination={{ pageSize: 8, size: 'small' }}
                      columns={[
                        { title: 'Experiment ID', dataIndex: 'experiment_id', width: 200, render: (value: string) => <span className="tn-code">{value}</span> },
                        { title: 'Model', dataIndex: 'algorithm_label' },
                        { title: 'Mode', dataIndex: 'mode', width: 90 },
                        { title: 'Dataset', dataIndex: 'dataset_id', width: 165, ellipsis: true },
                        { title: '状态', render: (_: unknown, row: any) => <StatusTag status={row.status} error={row.error} /> },
                        { title: '创建时间', dataIndex: 'created_at', width: 150 },
                        {
                          title: '操作',
                          render: (_: unknown, row: any) => (
                            <div className="tn-inline">
                              <Button size="small" onClick={async () => { setExperiment(await api.get<any>(ENDPOINTS.experimentGet(row.experiment_id))); setMonitorTab('monitor') }}>Open</Button>
                              <Tooltip title="复制为草稿，不创建新的 Experiment ID">
                                <Button size="small" onClick={async () => {
                                  try {
                                    const draft = await api.post<any>(ENDPOINTS.experimentDuplicate(row.experiment_id))
                                    setAlgorithm(draft.algorithm_key)
                                    if (draft.algorithm_key === ALL_MODELS) {
                                      setAllParams((prev) => ({ ...prev, [draft.algorithm_key]: draft.params }))
                                    } else {
                                      setParams(draft.params)
                                      setAllParams((prev) => ({ ...prev, [draft.algorithm_key]: draft.params }))
                                    }
                                    setDatasetId(draft.dataset_id)
                                    messageApi.success('已复制为草稿（尚未创建新的 Experiment ID，Run 时才创建）')
                                  } catch (err) { messageApi.error(err instanceof ApiError ? err.message : String(err)) }
                                }}>Duplicate</Button>
                              </Tooltip>
                              <Button size="small" onClick={async () => {
                                try { await api.post(ENDPOINTS.experimentArchive(row.experiment_id, row.status !== 'Archived')); loadHistory(); messageApi.success('已更新归档状态') } catch (err) { messageApi.error(err instanceof ApiError ? err.message : String(err)) }
                              }}>{row.status === 'Archived' ? 'Unarchive' : 'Archive'}</Button>
                              <Popconfirm
                                title="删除该实验？"
                                description="被 Evaluation 引用的实验只能归档。"
                                onConfirm={async () => {
                                  try { await api.del(ENDPOINTS.experimentDelete(row.experiment_id)); loadHistory(); messageApi.success('已删除') } catch (err) { messageApi.error(err instanceof ApiError ? err.message : String(err)) }
                                }}
                              >
                                <Button size="small" danger>Delete</Button>
                              </Popconfirm>
                            </div>
                          ),
                        },
                      ]}
                    />
                  </div>
                ),
              },
            ]}
          />
        }
      />
    </div>
  )

  function resetAllModels() {
    const next: Record<string, Values> = {}
    models.forEach((model) => {
      next[model.key] = defaultsFor(model.key)
    })
    setAllParams(next)
    setCustomized({})
    messageApi.success('已恢复 12 个算法的默认参数（草稿级，不影响已保存实验）')
  }
}
