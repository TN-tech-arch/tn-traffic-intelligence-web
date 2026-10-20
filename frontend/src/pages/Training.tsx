import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert, Button, Card, Collapse, Descriptions, Popconfirm, Progress, Select, Table, Tabs, Tag, Tooltip, message,
} from 'antd'
import { useNavigate } from 'react-router-dom'
import { ENDPOINTS, ApiError, api, type Issue } from '../api/client'
import { EmptyState, ModuleHeader, PaneHead, ThreePane } from '../components/Panes'
import ParamField from '../components/ParamField'
import StatusTag from '../components/StatusTag'
import BiLabel from '../components/BiLabel'
import { LineChart } from '../components/Charts'
import { useGroupValidation, useSchema } from '../validation/useValidation'
import type { Issue as IssueType } from '../api/client'
import { fieldDisabledReason, isVisible, visibleFields, type FieldSpec, type Values } from '../validation/engine'
import {
  ACTION_LABELS, MODULE_META, algorithmCategoryLabel, bilingual,
  frequencyLabel, missingModeLabel, modeLabel, scalingLabel, scopeLabel,
  sourceDisplayName, unitDisplayLabel,
} from '../i18n/terms'

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
    specs: (activeModel?.params ?? []).filter((spec) => spec.level !== 'advanced'),
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
      messageApi.warning('请先选择一个已构建的数据集。')
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
      messageApi.success(`实验 ${created.display_id ?? created.experiment_id} 已提交（${created.region_count} 个区域）`)
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
        `数据源/数据集：${sourceDisplayName(dataset?.source_key, dataset?.source_display_name)} ${dataset?.display_id ?? dataset?.dataset_id}\n` +
        `预测范围：${dataset?.scope === 'all' ? `全部区域（${dataset?.region_count} 个区域）` : '单区域'}\n` +
        `计划任务数：${12 * (dataset?.scope === 'all' ? dataset?.region_count ?? 1 : 1)}\n` +
        `不可运行模型：${(preflight?.models ?? []).filter((m: any) => !m.runnable).map((m: any) => m.label).join(', ') || '无'}\n\n` +
        `默认顺序执行；可在实验历史中随时停止。估计耗时：无法可靠估计（取决于模型与硬件）。`,
    )
    if (!confirmed) return
    setBusy(true)
    try {
      const created = await api.post<any>(ENDPOINTS.batchRun, {
        dataset_id: datasetId,
        model_configs: buildModelConfigs(),
        execution_policy: { sequential: true, continue_on_error: true, skip_unavailable_after_confirmation: true },
      })
      messageApi.success(`批量任务 ${created.display_id ?? created.batch_id} 已创建（${created.experiments.length} 个实验计划）`)
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
        messageApi.success('已请求停止批次（后端确认后将把未开始任务置为已取消或已跳过）')
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
        module={MODULE_META.m4.index}
        titleZh={MODULE_META.m4.titleZh}
        titleEn={MODULE_META.m4.titleEn}
        description="12 种真实算法（含 TimesFM / Chronos 零样本预测）与全部模型批量执行"
        datasetInfo={dataset ? `${dataset.display_id ?? dataset.dataset_id} · ${sourceDisplayName(dataset.source_key, dataset.source_display_name)} · L/H/S = ${dataset.L}/${dataset.H}/${dataset.S} · ${dataset.scope === 'all' ? `全部区域（${dataset.region_count}）` : '单区域'}` : '请先构建数据集'}
      />
      {activeErrors.length > 0 ? (
        <Alert type="error" showIcon style={{ marginBottom: 10 }} message={`${activeErrors.length} 个阻断性错误（错误位于对应输入框下方）`} description={activeErrors.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join('；')} />
      ) : null}
      {serverIssues.length > 0 ? (
        <Alert type="error" showIcon style={{ marginBottom: 10 }} message="后端拒绝了请求（未创建任何任务、实验或批量任务）" description={serverIssues.map((i) => `${i.path}: ${i.message}`).join('；')} />
      ) : null}
      <ThreePane
        config={
          <>
            <PaneHead
              title={bilingual('配置', 'Configuration')}
              extra={
                <Tooltip title="只重置当前可编辑参数，不影响已保存的实验">
                  <Button size="small" onClick={() => { isAllModels ? resetAllModels() : setParams(defaultsFor(algorithm)); setDrafts({}) }}>
                    重置参数
                  </Button>
                </Tooltip>
              }
            />
            <div className="tn-field">
              <label className="tn-field-label">1 · 数据集选择（Dataset Selection，只读快照）</label>
              <Select
                style={{ width: '100%' }}
                size="small"
                value={datasetId || undefined}
                placeholder="选择一个已构建的数据集"
                options={datasets.map((d) => ({ value: d.dataset_id, label: `${d.display_id ?? d.dataset_id} · ${sourceDisplayName(d.source_key, d.source_display_name)} · ${scopeLabel(d.scope)}` }))}
                onChange={(value) => setDatasetId(value)}
              />
              {dataset ? (
                <Descriptions size="small" column={1} style={{ marginTop: 8, fontSize: 11 }}>
                  <Descriptions.Item label="来源">{sourceDisplayName(dataset.source_key, dataset.source_display_name)} · {unitDisplayLabel(dataset.unit_label)}</Descriptions.Item>
                  <Descriptions.Item label="预测范围">{dataset.scope === 'all' ? `全部区域（${dataset.region_count} 个区域，独立建模）` : `单区域（${dataset.region_ids?.[0]}）`}</Descriptions.Item>
                  <Descriptions.Item label="数据频率">
                    {frequencyLabel(String(dataset.frequency))}（{dataset.frequency_minutes} 分钟）
                  </Descriptions.Item>
                  <Descriptions.Item label="构建时间范围">{dataset.time_start ?? '—'} → {dataset.time_end ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label="L / H / S">{dataset.L} / {dataset.H} / {dataset.S}</Descriptions.Item>
                  <Descriptions.Item label="训练 / 验证 / 测试">{dataset.ratios?.train} / {dataset.ratios?.validation} / {dataset.ratios?.test}</Descriptions.Item>
                  <Descriptions.Item label="窗口数">训练 {dataset.window_counts?.train} · 验证 {dataset.window_counts?.validation} · 测试 {dataset.window_counts?.test}</Descriptions.Item>
                  <Descriptions.Item label="预处理">{missingModeLabel(dataset.preprocess?.missing_mode)} · {scalingLabel(dataset.preprocess?.scaling)}</Descriptions.Item>
                </Descriptions>
              ) : null}
            </div>

            <div className="tn-field">
              <label className="tn-field-label">2 · 预测算法（Prediction Algorithm）</label>
              <div
                className={`tn-history-row${isAllModels ? ' active' : ''}`}
                style={{ background: isAllModels ? '#e7f0fe' : undefined, borderRadius: 6, padding: '8px 6px' }}
                role="button"
                tabIndex={0}
                onClick={() => setAlgorithm(ALL_MODELS)}
                onKeyDown={(e) => e.key === 'Enter' && setAlgorithm(ALL_MODELS)}
              >
                <div>
                  <strong>全部模型（All Models，12 种）</strong>
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
                      label: models.find((m) => m.category === category)?.category_label_zh ?? algorithmCategoryLabel(category),
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
                              <div className="tn-muted">{modeLabel(model.default_mode)}{model.capabilities?.installed === false ? ' · 依赖未安装' : ''}</div>
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
                3 · 模型参数（Model Parameters）
              </label>
              {isAllModels ? (
                <>
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 8, fontSize: 11 }}
                    message={`每个算法都有独立参数组；当前已自定义 ${Object.values(customized).filter(Boolean).length} 个算法。默认使用注册表预设。`}
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
                            <Tag color={model.category === 'foundation' ? 'purple' : 'default'}>{modeLabel(model.default_mode)}</Tag>
                            {customized[model.key] ? <Tag color="gold">自定义</Tag> : <Tag>默认</Tag>}
                            {issues.length ? <Tag color="red">{issues.length} 个错误</Tag> : <Tag color="green">可运行</Tag>}
                            {warnings.length ? <Tag color="orange">{warnings.length} 条警告</Tag> : null}
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
                              .filter((spec) => spec.level !== 'advanced')
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
                      window.confirm('重置全部模型参数？这会丢弃 12 个算法的全部自定义参数（不影响已保存实验）。') && resetAllModels()
                    }
                  >
                    重置全部模型参数
                  </Button>
                </>
              ) : activeModel ? (
                <>
                  <div className="tn-muted" style={{ marginBottom: 6 }}>
                    使用模式：<Tag>{modeLabel(activeModel.default_mode)}</Tag>
                    {activeModel.capabilities?.supports_finetune ? <Tag color="green">支持微调</Tag> : <Tag>仅零样本预测</Tag>}
                    {activeModel.capabilities?.requires_checkpoint ? <Tag color="purple">需要模型权重</Tag> : null}
                  </div>
                  {visibleFields(activeModel.params, params)
                    .filter((spec) => spec.level !== 'advanced')
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
              <label className="tn-field-label">4 · 运行前检查（Preflight Summary）</label>
              <Button size="small" onClick={runPreflight} loading={busy} disabled={!datasetId}>
                检查兼容性
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
              <label className="tn-field-label">5 · 操作（Actions）</label>
              <div className="tn-inline">
                {isAllModels ? (
                  <Button type="primary" onClick={runAllModels} loading={busy} disabled={!runnable || !datasetId}>运行全部模型</Button>
                ) : (
                  <Button
                    type="primary"
                    onClick={runSingle}
                    loading={busy}
                    disabled={!runnable || !datasetId}
                  >
                    开始训练
                  </Button>
                )}
                <Button onClick={stop} danger>{isAllModels || batch ? ACTION_LABELS.stopBatch : ACTION_LABELS.stopTraining}</Button>
              </div>
              <div className="tn-inline" style={{ marginTop: 6 }}>
                    <Tooltip title="只有已完成或部分完成的实验才能保存与评估；实验 ID 在开始训练时创建">
                  <Button
                    size="small"
                    disabled={!experiment || !['Completed', 'Partial'].includes(experiment?.status)}
                    onClick={() => messageApi.success(`实验 ${experiment.display_id ?? experiment.experiment_id} 的工件已落盘（data/artifacts/experiments/${experiment.experiment_id}）`)}
                  >
                    保存模型
                  </Button>
                </Tooltip>
                <Tooltip title="跳转到模块五，并使用留出测试集评估该实验">
                  <Button
                    size="small"
                    disabled={!experiment || !['Completed', 'Partial'].includes(experiment?.status)}
                    onClick={() => navigate(`/evaluation?dataset=${datasetId}&experiment=${experiment?.experiment_id}`)}
                  >
                    开始评估
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
                label: <BiLabel zh="训练监控" en="Training Monitor" />,
                children: (
                  <div className="tn-stack">
                    {experiment && !isAllModels ? (
                      <>
                        <Card size="small" title={`${experiment.algorithm_label} · ${modeLabel(experiment.mode)}`}>
                          <div className="tn-inline">
                            <StatusTag status={experiment.status} error={experiment.error} />
                            <Tag>{experiment.display_id ?? experiment.experiment_id}</Tag>
                            {experiment.batch_id ? <Tag color="blue">BATCH {experiment.batch_display_id ?? experiment.batch_id}</Tag> : null}
                            <span className="tn-muted">{scopeLabel(experiment.scope)} · {experiment.region_completed}/{experiment.region_total} 区域完成</span>
                          </div>
                          <Progress percent={Math.round(experiment.progress?.percent ?? 0)} status={experiment.status === 'Failed' ? 'exception' : undefined} style={{ marginTop: 8 }} />
                          <div className="tn-muted">
                            {experiment.progress?.stage ?? '等待任务进程'} · {experiment.progress?.message ?? ''}
                          </div>
                          {epochHistory ? (
                            <LineChart
                              height={220}
                              x={epochHistory.epoch.map((e: number) => `第 ${e} 轮`)}
                              xName="训练轮次"
                              yName="损失值"
                              series={[
                                { name: '训练损失（MSE）', data: epochHistory.train_loss, color: '#2467E8' },
                                { name: '验证损失', data: epochHistory.validation_loss, color: '#D98F00' },
                              ]}
                            />
                          ) : (
                            <div className="tn-muted" style={{ marginTop: 8 }}>
                              {experiment.history_type === 'zero_shot' || ['ARIMA', 'Prophet', 'Random Forest'].includes(experiment.algorithm_label)
                                ? '该算法没有训练轮次概念：不显示训练曲线，仅显示真实状态、耗时与日志。'
                                : '尚无训练轮次记录（Boosting 模型显示真实迭代指标）。'}
                            </div>
                          )}
                          {experiment.metrics?.macro_validation?.rmse ? (
                            <div className="tn-muted" style={{ marginTop: 6 }}>
                              验证集（真实预测）：平均绝对误差 MAE {Number(experiment.metrics.macro_validation.mae).toFixed(2)} · 均方根误差 RMSE{' '}
                              {Number(experiment.metrics.macro_validation.rmse).toFixed(2)} · sMAPE{' '}
                              {Number(experiment.metrics.macro_validation.smape).toFixed(2)}% · R²{' '}
                              {experiment.metrics.macro_validation.r2 === null ? '不适用' : Number(experiment.metrics.macro_validation.r2).toFixed(4)}
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
                                { title: '区域', dataIndex: 'region_id' },
                                { title: '区域实验 ID', dataIndex: 'region_experiment_id', render: (value: string | null) => value ?? '—' },
                                { title: '状态', render: (_: unknown, row: any) => <StatusTag status={row.status} error={row.error} /> },
                                { title: '验证 RMSE', render: (_: unknown, row: any) => row.metrics?.rmse ? Number(row.metrics.rmse).toFixed(1) : '—' },
                                { title: '训练轮数', render: (_: unknown, row: any) => row.history?.epochs_completed ?? '—' },
                              ]}
                            />
                          ) : null}
                        </Card>
                      </>
                    ) : null}
                    {batch ? (
                          <Card size="small" title={`全部模型批次 ${batch.display_id ?? batch.batch_id}`}>
                        <div className="tn-inline">
                          <StatusTag status={batch.status} error={batch.error} />
                          <Tag>总任务 {batch.experiments?.length}</Tag>
                          <Tag color="green">已完成 {batch.task_summary?.completed ?? 0}</Tag>
                          <Tag color="red">已失败 {batch.task_summary?.failed ?? 0}</Tag>
                          <Tag>已跳过 {batch.task_summary?.skipped ?? 0}</Tag>
                          <Tag color="orange">部分完成 {batch.task_summary?.partial ?? 0}</Tag>
                        </div>
                        <Progress percent={currentProgress} style={{ marginTop: 8 }} />
                        <Table
                          size="small"
                          style={{ marginTop: 8 }}
                          rowKey="experiment_id"
                          pagination={false}
                          dataSource={batch.experiments ?? []}
                          columns={[
                            { title: '实验 ID', dataIndex: 'display_id', width: 240, render: (value: string, row: any) => value ?? row.experiment_id },
                            { title: '模型', dataIndex: 'algorithm_label', sorter: (a: any, b: any) => a.algorithm_label.localeCompare(b.algorithm_label) },
                            { title: '执行模式', dataIndex: 'mode', width: 100, render: (value: string) => modeLabel(value) },
                            {
                              title: '进度',
                              width: 130,
                              render: (_: unknown, row: any) => (
                                <Progress percent={Math.round(row.progress?.percent ?? 0)} size="small" />
                              ),
                            },
                            { title: '区域', width: 90, render: (_: unknown, row: any) => `${row.region_completed}/${row.region_total}` },
                            { title: '失败区域', dataIndex: 'region_failed', width: 80 },
                            { title: '状态', width: 110, render: (_: unknown, row: any) => <StatusTag status={row.status} error={row.error} /> },
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
                              { title: '实验 ID', dataIndex: 'display_id', width: 220, render: (value: string, row: any) => value ?? row.experiment_id },
                              { title: '区域', dataIndex: 'region_id' },
                              { title: '状态', render: (_: unknown, row: any) => <StatusTag status={row.status} error={row.error} /> },
                              { title: '验证 RMSE', render: (_: unknown, row: any) => row.metrics?.rmse ? Number(row.metrics.rmse).toFixed(1) : '—' },
                            ]}
                          />
                        ) : null}
                      </Card>
                    ) : null}
                    {!experiment && !batch ? <EmptyState text="选择算法并开始训练后，这里显示真实的训练状态、进度与日志。" /> : null}
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
                label: <BiLabel zh="训练概览" en="Training Overview" />,
                children: (
                  <div className="tn-stack">
                    {experiment ? (
                      <Card size="small" title="当前实验（Experiment）">
                        <div className="tn-code">{experiment.display_id ?? experiment.experiment_id}</div>
                        <div className="tn-muted" style={{ marginTop: 6 }}>
                          <div>批量任务：{experiment.batch_display_id ?? experiment.batch_id ?? '（单模型运行）'}</div>
                          <div>数据集：{experiment.dataset?.display_id ?? experiment.dataset_id}</div>
                          <div>算法 / 模式：{experiment.algorithm_label} · {modeLabel(experiment.mode)}</div>
                          <div>预测范围：{scopeLabel(experiment.scope)} · 区域 {experiment.region_completed}/{experiment.region_total}</div>
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
                      <Card size="small" title="当前批量任务（Batch）">
                        <div className="tn-code">{batch.display_id ?? batch.batch_id}</div>
                        <div className="tn-muted" style={{ marginTop: 6 }}>
                          <div>数据集：{batch.dataset_display_id ?? batch.dataset_id}</div>
                          <div>预测范围：{scopeLabel(batch.scope)} · 区域 {batch.region_count}</div>
                          <div>计划任务：{batch.planned_tasks}（12 算法 × {batch.region_count} 区域）</div>
                          <div>策略：顺序执行={batch.policy?.sequential ? '是' : '否'} · 出错后继续={batch.policy?.continue_on_error ? '是' : '否'} · 跳过不可用={batch.policy?.skip_unavailable_after_confirmation ? '是' : '否'}</div>
                        </div>
                      </Card>
                    ) : null}
                  </div>
                ),
              },
              {
                key: 'logs',
                label: <BiLabel zh="训练日志" en="Training Logs" />,
                children: (
                  <div className="tn-stack">
                    <div className="tn-inline">
                      <span className="tn-muted">实验 {experiment?.display_id ?? experiment?.experiment_id ?? '—'} 的真实后端日志</span>
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
                label: <BiLabel zh="实验历史" en="Experiment History" />,
                children: (
                  <div className="tn-stack">
                    <Table
                      size="small"
                      rowKey="batch_id"
                      title={() => '批量任务（Batches）'}
                      dataSource={batches}
                      pagination={{ pageSize: 4, size: 'small' }}
                      columns={[
                        { title: '批量任务 ID', dataIndex: 'display_id', width: 220, render: (value: string, row: any) => <span className="tn-code">{value ?? row.batch_id}</span> },
                        { title: '数据集', dataIndex: 'dataset_display_id', width: 210, ellipsis: true, render: (value: string, row: any) => value ?? row.dataset_id },
                        { title: '状态', render: (_: unknown, row: any) => <StatusTag status={row.status} error={row.error} /> },
                        { title: '完成/失败/跳过', render: (_: unknown, row: any) => `${row.task_summary?.completed ?? 0}/${row.task_summary?.failed ?? 0}/${row.task_summary?.skipped ?? 0}` },
                        { title: '创建时间', dataIndex: 'created_at', width: 150 },
                        {
                          title: '操作',
                          render: (_: unknown, row: any) => (
                            <div className="tn-inline">
                              <Button size="small" onClick={async () => { setBatch(await api.get<any>(ENDPOINTS.batchGet(row.batch_id))); setMonitorTab('batch') }}>{ACTION_LABELS.open}</Button>
                              <Button size="small" danger disabled={!['Running', 'Created', 'Stopping'].includes(row.status)} onClick={async () => {
                                try { await api.post(ENDPOINTS.batchStop(row.batch_id)); messageApi.success('已请求停止批次'); loadHistory() } catch (err) { messageApi.error(String(err)) }
                              }}>停止</Button>
                            </div>
                          ),
                        },
                      ]}
                    />
                    <Table
                      size="small"
                      rowKey="experiment_id"
                      title={() => '实验（Experiments）'}
                      dataSource={experiments}
                      pagination={{ pageSize: 8, size: 'small' }}
                      columns={[
                        { title: '实验 ID', dataIndex: 'display_id', width: 240, render: (value: string, row: any) => <span className="tn-code">{value ?? row.experiment_id}</span> },
                        { title: '模型', dataIndex: 'algorithm_label' },
                        { title: '执行模式', dataIndex: 'mode', width: 100, render: (value: string) => modeLabel(value) },
                        { title: '数据集', dataIndex: 'dataset_display_id', width: 210, ellipsis: true, render: (value: string, row: any) => value ?? row.dataset_id },
                        { title: '状态', render: (_: unknown, row: any) => <StatusTag status={row.status} error={row.error} /> },
                        { title: '创建时间', dataIndex: 'created_at', width: 150 },
                        {
                          title: '操作',
                          render: (_: unknown, row: any) => (
                            <div className="tn-inline">
                              <Button size="small" onClick={async () => { setExperiment(await api.get<any>(ENDPOINTS.experimentGet(row.experiment_id))); setMonitorTab('monitor') }}>{ACTION_LABELS.open}</Button>
                              <Tooltip title="复制为草稿，不创建新的实验 ID">
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
                                    messageApi.success('已复制为草稿（尚未创建新的实验 ID，开始训练时才创建）')
                                  } catch (err) { messageApi.error(err instanceof ApiError ? err.message : String(err)) }
                                }}>{ACTION_LABELS.duplicate}</Button>
                              </Tooltip>
                              <Button size="small" onClick={async () => {
                                try { await api.post(ENDPOINTS.experimentArchive(row.experiment_id, row.status !== 'Archived')); loadHistory(); messageApi.success('已更新归档状态') } catch (err) { messageApi.error(err instanceof ApiError ? err.message : String(err)) }
                              }}>{row.status === 'Archived' ? ACTION_LABELS.unarchive : ACTION_LABELS.archive}</Button>
                              <Popconfirm
                                title="删除该实验？"
                                description="被评价引用的实验只能归档。"
                                onConfirm={async () => {
                                  try { await api.del(ENDPOINTS.experimentDelete(row.experiment_id)); loadHistory(); messageApi.success('已删除') } catch (err) { messageApi.error(err instanceof ApiError ? err.message : String(err)) }
                                }}
                              >
                                <Button size="small" danger>{ACTION_LABELS.deleteRecord}</Button>
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
