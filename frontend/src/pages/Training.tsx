import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Collapse,
  Pagination,
  Popconfirm,
  Progress,
  Select,
  Table,
  Tag,
  Tooltip,
  message,
} from 'antd'
import { ENDPOINTS, ApiError, api, type Issue } from '../api/client'
import { EmptyState, ModuleHeader } from '../components/Panes'
import ParamField from '../components/ParamField'
import StatusTag from '../components/StatusTag'
import { LineChart } from '../components/Charts'
import { useGroupValidation, useSchema } from '../validation/useValidation'
import { fieldDisabledReason, visibleFields, type FieldSpec, type Values } from '../validation/engine'
import {
  MODULE_META,
  frequencyLabel,
  missingModeLabel,
  modeLabel,
  scalingLabel,
  scopeLabel,
  sourceDisplayName,
  statusLabel,
  unitDisplayLabel,
} from '../i18n/terms'

const ALL_MODELS = 'all_models'
const HISTORY_PAGE_SIZE = 6
const RUNNING_STATUSES = ['Queued', 'Running', 'Stopping']

function formatDateTime(value?: string | null) {
  if (!value) return '—'
  return String(value).replace('T', ' ').replace(/(\.\d+)?Z$/, '')
}

function durationLabel(start?: string | null, end?: string | null) {
  if (!start) return '—'
  const started = Date.parse(start)
  const ended = end ? Date.parse(end) : Date.now()
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return '—'
  const seconds = Math.max(0, (ended - started) / 1000)
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`
  const minutes = Math.floor(seconds / 60)
  const remain = Math.round(seconds % 60)
  if (minutes < 60) return `${minutes} 分 ${remain} 秒`
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时 ${minutes % 60} 分`
}

function progressStatus(status?: string) {
  if (status === 'Failed' || status === 'Interrupted') return 'exception'
  if (status === 'Completed') return 'success'
  return 'normal'
}

export default function Training() {
  const [messageApi, contextHolder] = message.useMessage()
  const { schema, error: schemaError } = useSchema()
  const [datasets, setDatasets] = useState<any[]>([])
  const [datasetId, setDatasetId] = useState('')
  const [dataset, setDataset] = useState<any>(null)
  const [algorithm, setAlgorithm] = useState('arima')
  const [params, setParams] = useState<Values>({})
  const [allParams, setAllParams] = useState<Record<string, Values>>({})
  const [customized, setCustomized] = useState<Record<string, boolean>>({})
  const [preflight, setPreflight] = useState<any>(null)
  const [batch, setBatch] = useState<any>(null)
  const [experiment, setExperiment] = useState<any>(null)
  const [experiments, setExperiments] = useState<any[]>([])
  const [logs, setLogs] = useState<any[]>([])
  const [busy, setBusy] = useState(false)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [serverIssues, setServerIssues] = useState<Issue[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [historyDataset, setHistoryDataset] = useState('all')
  const [historyAlgorithm, setHistoryAlgorithm] = useState('all')
  const [historyStatus, setHistoryStatus] = useState('all')
  const [historyPage, setHistoryPage] = useState(1)

  const models = schema?.models ?? []
  const activeModel = models.find((model) => model.key === algorithm)
  const isAllModels = algorithm === ALL_MODELS
  const activeRun = experiment ?? batch
  const activeIsBatch = !experiment && Boolean(batch)

  const defaultsFor = useCallback(
    (key: string): Values => {
      const model = models.find((item) => item.key === key)
      if (!model) return {}
      return Object.fromEntries(model.params.map((spec) => [spec.key, spec.default]))
    },
    [models],
  )

  useEffect(() => {
    if (!models.length) return
    setParams((previous) => (Object.keys(previous).length ? previous : defaultsFor('arima')))
    setAllParams((previous) => {
      if (Object.keys(previous).length) return previous
      return Object.fromEntries(models.map((model) => [model.key, defaultsFor(model.key)]))
    })
  }, [defaultsFor, models])

  const loadDatasets = useCallback(() => {
    api
      .get<any>(ENDPOINTS.datasetList)
      .then((data) => {
        const built = data.datasets.filter((item: any) => item.status !== 'Archived')
        setDatasets(built)
        setDatasetId((previous) => {
          if (previous && built.some((item: any) => item.dataset_id === previous)) return previous
          return built[0]?.dataset_id ?? ''
        })
      })
      .catch(() => undefined)
  }, [])

  const loadHistory = useCallback(() => {
    api
      .get<any>(`${ENDPOINTS.experimentList}?limit=500`)
      .then((data) => setExperiments(data.experiments))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    loadDatasets()
    loadHistory()
  }, [loadDatasets, loadHistory])

  useEffect(() => {
    if (!datasetId) {
      setDataset(null)
      return
    }
    api
      .get<any>(ENDPOINTS.datasetGet(datasetId))
      .then(setDataset)
      .catch(() => setDataset(null))
  }, [datasetId])

  useEffect(() => {
    const experimentRunning = experiment && RUNNING_STATUSES.includes(experiment.status)
    const batchRunning = batch && ['Running', 'Created', 'Stopping'].includes(batch.status)
    if (!experimentRunning && !batchRunning) return
    const timer = window.setInterval(async () => {
      if (experiment && RUNNING_STATUSES.includes(experiment.status)) {
        try {
          const data = await api.get<any>(ENDPOINTS.experimentGet(experiment.experiment_id))
          setExperiment(data)
          if (!RUNNING_STATUSES.includes(data.status)) loadHistory()
        } catch {
          // Keep the last confirmed backend state.
        }
      }
      if (batch && ['Running', 'Created', 'Stopping'].includes(batch.status)) {
        try {
          const data = await api.get<any>(ENDPOINTS.batchGet(batch.batch_id))
          setBatch(data)
          if (!['Running', 'Created', 'Stopping'].includes(data.status)) loadHistory()
        } catch {
          // Keep the last confirmed backend state.
        }
      }
    }, 2500)
    return () => window.clearInterval(timer)
  }, [batch, experiment, loadHistory])

  useEffect(() => {
    if (experiment) {
      api
        .get<any>(ENDPOINTS.experimentLogs(experiment.experiment_id))
        .then((data) => setLogs(data.logs ?? []))
        .catch(() => setLogs([]))
      return
    }
    if (!batch?.experiments?.length) {
      setLogs([])
      return
    }
    let active = true
    Promise.all(
      batch.experiments.map(async (item: any) => {
        try {
          const data = await api.get<any>(ENDPOINTS.experimentLogs(item.experiment_id))
          return (data.logs ?? []).map((entry: any) => ({
            ...entry,
            experiment_display_id: item.display_id ?? item.experiment_id,
          }))
        } catch {
          return []
        }
      }),
    ).then((groups) => {
      if (!active) return
      setLogs(
        groups
          .flat()
          .sort((left, right) => String(left.at ?? '').localeCompare(String(right.at ?? ''))),
      )
    })
    return () => {
      active = false
    }
  }, [batch, experiment])

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
      ? {
          kind: 'all_models',
          values: allParams,
          context: {
            dataset_id: datasetId,
            region_count: dataset?.region_count,
            train_samples: dataset?.window_counts?.train,
          },
        }
      : null,
  })

  const activeIssues: Issue[] = isAllModels ? allValidation.issues : singleValidation.issues
  const activeErrors = activeIssues.filter((item) => item.severity === 'error')
  const activeWarnings = activeIssues.filter((item) => item.severity === 'warning')
  const runnable = Boolean(models.length && datasetId && activeErrors.length === 0)

  const algorithmOptions = [
    { value: ALL_MODELS, label: '全部模型（All Models，12 种）' },
    ...models.map((model) => ({
      value: model.key,
      label: `${model.label} · ${model.category_label_zh}`,
    })),
  ]

  const datasetField = useMemo<FieldSpec>(
    () => ({
      key: 'dataset_id',
      label: 'Dataset Selection',
      label_zh: '数据集选择（只读快照）',
      type: 'enum',
      enum: datasets.map((item) => item.dataset_id),
      enum_labels: datasets.map(
        (item) =>
          `${item.display_id ?? item.dataset_id} · ${sourceDisplayName(
            item.source_key,
            item.source_display_name,
          )} · ${scopeLabel(item.scope)}`,
      ),
      help_zh: '选择已构建并冻结的数据集；数据集参数只读，训练不会修改原始数据集。',
      suggestion_zh: '模块三构建完成后，在训练模块中选择该 DS ID。',
    }),
    [datasets],
  )

  const algorithmField = useMemo<FieldSpec>(
    () => ({
      key: 'algorithm_key',
      label: 'Prediction Algorithm',
      label_zh: '预测算法',
      type: 'enum',
      enum: algorithmOptions.map((item) => item.value),
      enum_labels: algorithmOptions.map((item) => item.label),
      default: 'arima',
      help_zh: '选择单个算法，或使用全部模型执行 12 种算法的批量编排。',
      suggestion_zh: '单模型调试优先选择 ARIMA；完整对比使用全部模型。',
    }),
    [models],
  )

  const historyDatasetOptions = useMemo(
    () =>
      Array.from(
        new Map(
          experiments.map((item) => [
            item.dataset_id,
            { value: item.dataset_id, label: item.dataset_display_id ?? item.dataset_id },
          ]),
        ).values(),
      ),
    [experiments],
  )

  const historyAlgorithmOptions = useMemo(
    () =>
      Array.from(
        new Map(
          experiments.map((item) => [
            item.algorithm_key,
            { value: item.algorithm_key, label: item.algorithm_label },
          ]),
        ).values(),
      ).sort((left, right) => left.label.localeCompare(right.label)),
    [experiments],
  )

  const historyStatusOptions = useMemo(
    () =>
      Array.from(new Set(experiments.map((item) => item.status)))
        .sort()
        .map((value) => ({ value, label: statusLabel(value) })),
    [experiments],
  )

  const filteredExperiments = useMemo(
    () =>
      experiments.filter(
        (item) =>
          (historyDataset === 'all' || item.dataset_id === historyDataset) &&
          (historyAlgorithm === 'all' || item.algorithm_key === historyAlgorithm) &&
          (historyStatus === 'all' || item.status === historyStatus),
      ),
    [experiments, historyAlgorithm, historyDataset, historyStatus],
  )

  useEffect(() => {
    setHistoryPage(1)
  }, [historyDataset, historyAlgorithm, historyStatus])

  useEffect(() => {
    const pages = Math.max(1, Math.ceil(filteredExperiments.length / HISTORY_PAGE_SIZE))
    if (historyPage > pages) setHistoryPage(pages)
  }, [filteredExperiments.length, historyPage])

  const visibleExperiments = filteredExperiments.slice(
    (historyPage - 1) * HISTORY_PAGE_SIZE,
    historyPage * HISTORY_PAGE_SIZE,
  )

  const epochHistory = useMemo(() => {
    const regions = experiment?.region_models ?? []
    return regions.find((item: any) => item.history?.epoch?.length)?.history ?? null
  }, [experiment])

  const regionRows = experiment?.region_models ?? []
  const batchRegionRows = batch?.region_summary ?? []
  const activeStatus = activeRun?.status ?? ''
  const currentProgress = activeIsBatch
    ? Math.round(
        (100 *
          ((batch?.task_summary?.completed ?? 0) +
            (batch?.task_summary?.failed ?? 0) +
            (batch?.task_summary?.skipped ?? 0))) /
          Math.max(1, batch?.experiments?.length ?? 12),
      )
    : Math.round(experiment?.progress?.percent ?? 0)
  const currentStartedAt = activeRun?.started_at ?? activeRun?.created_at
  const currentEndedAt = activeRun?.ended_at
  const currentRegionsDone =
    (activeRun?.region_completed ?? 0) + (activeRun?.region_failed ?? 0)

  const buildModelConfigs = () => {
    const configs: Record<string, any> = {}
    Object.entries(allParams).forEach(([key, value]) => {
      const model = models.find((item) => item.key === key)
      configs[key] = { mode: model?.default_mode, params: value }
    })
    return configs
  }

  const runPreflight = async () => {
    if (!datasetId) {
      messageApi.warning('请先选择一个已构建数据集。')
      return
    }
    setBusy(true)
    setServerIssues([])
    try {
      const payload = isAllModels
        ? {
            dataset_id: datasetId,
            algorithm_choice: ALL_MODELS,
            model_configs: buildModelConfigs(),
          }
        : {
            dataset_id: datasetId,
            algorithm_key: algorithm,
            mode: activeModel?.default_mode,
            params,
          }
      setPreflight(await api.post<any>(ENDPOINTS.preflight, payload))
    } catch (error) {
      if (error instanceof ApiError) setServerIssues(error.issues)
      else messageApi.error(String(error))
    } finally {
      setBusy(false)
    }
  }

  const runSingle = async () => {
    if (!runnable) {
      messageApi.error('当前参数未通过校验，无法开始训练。')
      return
    }
    setBusy(true)
    setServerIssues([])
    try {
      const created = await api.post<any>(ENDPOINTS.experimentRun, {
        dataset_id: datasetId,
        algorithm_key: algorithm,
        mode: activeModel?.default_mode,
        params,
      })
      const data = await api.get<any>(ENDPOINTS.experimentGet(created.experiment_id))
      setExperiment(data)
      setBatch(null)
      loadHistory()
      messageApi.success(`实验 ${created.display_id ?? created.experiment_id} 已提交。`)
    } catch (error) {
      if (error instanceof ApiError) {
        setServerIssues(error.issues)
        messageApi.error(`后端拒绝：${error.message}`)
      } else {
        messageApi.error(String(error))
      }
    } finally {
      setBusy(false)
    }
  }

  const runAllModels = async () => {
    if (!runnable) {
      messageApi.error('当前数据集或模型参数未通过校验。')
      return
    }
    const confirmed = window.confirm(
      `将按顺序运行 12 种算法。\n` +
        `数据集：${dataset?.display_id ?? datasetId}\n` +
        `范围：${dataset?.scope === 'all' ? `全部区域 ${dataset?.region_count} 个` : '单区域'}\n` +
        `计划区域模型任务：${12 * (dataset?.scope === 'all' ? dataset?.region_count ?? 1 : 1)}\n\n` +
        `运行期间可在页面停止。确定开始吗？`,
    )
    if (!confirmed) return
    setBusy(true)
    setServerIssues([])
    try {
      const created = await api.post<any>(ENDPOINTS.batchRun, {
        dataset_id: datasetId,
        model_configs: buildModelConfigs(),
        execution_policy: {
          sequential: true,
          continue_on_error: true,
          skip_unavailable_after_confirmation: true,
        },
      })
      const data = await api.get<any>(ENDPOINTS.batchGet(created.batch_id))
      setBatch(data)
      setExperiment(null)
      loadHistory()
      messageApi.success(`批量任务 ${created.display_id ?? created.batch_id} 已创建。`)
    } catch (error) {
      if (error instanceof ApiError) {
        setServerIssues(error.issues)
        messageApi.error(`后端拒绝：${error.message}`)
      } else {
        messageApi.error(String(error))
      }
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    try {
      if (batch && ['Running', 'Created', 'Stopping'].includes(batch.status)) {
        await api.post(ENDPOINTS.batchStop(batch.batch_id))
        messageApi.success('已请求停止批量任务。')
        const data = await api.get<any>(ENDPOINTS.batchGet(batch.batch_id))
        setBatch(data)
      } else if (experiment && RUNNING_STATUSES.includes(experiment.status)) {
        await api.post(ENDPOINTS.experimentStop(experiment.experiment_id))
        messageApi.success('已请求停止实验。')
      } else {
        messageApi.info('当前没有可停止的训练任务。')
      }
    } catch (error) {
      messageApi.error(error instanceof ApiError ? error.message : String(error))
    }
  }

  const openExperiment = async (experimentId: string) => {
    setLoadingId(experimentId)
    setServerIssues([])
    try {
      const data = await api.get<any>(ENDPOINTS.experimentGet(experimentId))
      setExperiment(data)
      setBatch(null)
    } catch (error) {
      messageApi.error(error instanceof ApiError ? error.message : String(error))
    } finally {
      setLoadingId(null)
    }
  }

  const deleteExperiment = async (item: any) => {
    setDeletingId(item.experiment_id)
    try {
      await api.del(ENDPOINTS.experimentDelete(item.experiment_id))
      setExperiments((previous) =>
        previous.filter((experimentItem) => experimentItem.experiment_id !== item.experiment_id),
      )
      if (experiment?.experiment_id === item.experiment_id) {
        setExperiment(null)
        setLogs([])
      }
      loadHistory()
      messageApi.success(`实验 ${item.display_id ?? item.experiment_id} 已删除。`)
    } catch (error) {
      messageApi.error(error instanceof ApiError ? error.message : String(error))
    } finally {
      setDeletingId(null)
    }
  }

  const downloadLogs = () => {
    if (!logs.length) {
      messageApi.warning('当前任务没有可下载的真实日志。')
      return
    }
    const text =
      logs
        .map(
          (entry) =>
            `[${entry.at ?? ''}] ${String(entry.level ?? 'info').toUpperCase()}` +
            `${entry.experiment_display_id ? ` [${entry.experiment_display_id}]` : ''}` +
            `${entry.region_id ? ` (${entry.region_id})` : ''} ${entry.message ?? ''}`,
        )
        .join('\n') + '\n'
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${activeRun?.display_id ?? activeRun?.experiment_id ?? 'training'}-logs.txt`
    link.click()
    URL.revokeObjectURL(url)
  }

  const resetAllModels = () => {
    setAllParams(Object.fromEntries(models.map((model) => [model.key, defaultsFor(model.key)])))
    setCustomized({})
    messageApi.success('已恢复 12 种算法的默认参数。')
  }

  if (schemaError) {
    return <Alert type="error" showIcon message="无法读取模型注册表" description={schemaError} />
  }

  return (
    <div>
      {contextHolder}
      <ModuleHeader
        module={MODULE_META.m4.index}
        titleZh={MODULE_META.m4.titleZh}
        titleEn={MODULE_META.m4.titleEn}
        description="12 种真实预测算法、全部模型批量编排与区域独立训练"
        datasetInfo={
          dataset
            ? `${dataset.display_id ?? dataset.dataset_id} · ${sourceDisplayName(
                dataset.source_key,
                dataset.source_display_name,
              )} · ${scopeLabel(dataset.scope)}`
            : '请先选择已构建数据集'
        }
      />
      {activeErrors.length ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 10 }}
          message={`${activeErrors.length} 个参数错误`}
          description={activeErrors
            .slice(0, 3)
            .map((item) => `${item.path}: ${item.message}`)
            .join('；')}
        />
      ) : null}
      {serverIssues.length ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 10 }}
          message="后端拒绝请求，未创建训练任务"
          description={serverIssues.map((item) => `${item.path}: ${item.message}`).join('；')}
        />
      ) : null}

      <div className="tn-m4-layout">
        <div className="tn-m4-column">
          <Card
            size="small"
            className="tn-m4-card"
            title="配置区（Configuration）"
            extra={
              <Tooltip title="只重置当前可编辑参数，不影响已保存实验。">
                <Button
                  size="small"
                  onClick={() => {
                    if (isAllModels) resetAllModels()
                    else setParams(defaultsFor(algorithm))
                    setDrafts({})
                  }}
                >
                  重置参数
                </Button>
              </Tooltip>
            }
          >
            <ParamField
              spec={datasetField}
              value={datasetId || undefined}
              issues={[]}
              path="m4.dataset_id"
              onChange={(_, value) => {
                setDatasetId(String(value ?? ''))
                setPreflight(null)
              }}
              compact
            />
            {dataset ? (
              <div className="tn-m4-dataset-summary" data-testid="m4-dataset-summary">
                <div><span>来源</span><strong>{sourceDisplayName(dataset.source_key, dataset.source_display_name)} · {unitDisplayLabel(dataset.unit_label)}</strong></div>
                <div><span>区域范围</span><strong>{dataset.scope === 'all' ? `全部区域 ${dataset.region_count} 个` : `单区域 ${dataset.region_ids?.[0] ?? '—'}`}</strong></div>
                <div><span>采样频率</span><strong>{frequencyLabel(String(dataset.frequency))} · {dataset.frequency_minutes} 分钟</strong></div>
                <div><span>时间范围</span><strong>{dataset.time_start ?? '—'} → {dataset.time_end ?? '—'}</strong></div>
                <div><span>L / H / S</span><strong>{dataset.L} / {dataset.H} / {dataset.S}</strong></div>
                <div><span>划分比例</span><strong>{dataset.ratios?.train} / {dataset.ratios?.validation} / {dataset.ratios?.test}</strong></div>
                <div><span>窗口数</span><strong>训练 {dataset.window_counts?.train ?? 0} · 验证 {dataset.window_counts?.validation ?? 0} · 测试 {dataset.window_counts?.test ?? 0}</strong></div>
                <div><span>预处理</span><strong>{missingModeLabel(dataset.preprocess?.missing_mode)} · {scalingLabel(dataset.preprocess?.scaling)}</strong></div>
              </div>
            ) : null}

            <ParamField
              spec={algorithmField}
              value={algorithm}
              issues={[]}
              path="m4.algorithm_key"
              onChange={(_, value) => {
                const nextAlgorithm = String(value ?? '')
                setAlgorithm(nextAlgorithm)
                setPreflight(null)
                if (nextAlgorithm !== ALL_MODELS) {
                  setParams(allParams[nextAlgorithm] ?? defaultsFor(nextAlgorithm))
                }
              }}
              compact
            />
            {isAllModels ? (
              <div className="tn-muted" style={{ marginTop: -6, marginBottom: 10 }}>
                批量编排会依次运行 12 种算法；全部区域仍按区域独立建模。
              </div>
            ) : activeModel ? (
              <div className="tn-inline" style={{ marginTop: -6, marginBottom: 10 }}>
                <Tag>{modeLabel(activeModel.default_mode)}</Tag>
                <span className="tn-muted">{activeModel.category_label_zh}</span>
              </div>
            ) : null}

            <div className="tn-field">
              {isAllModels ? (
                <>
                  <Collapse
                    size="small"
                    items={models.map((model) => {
                      const issues = allValidation.issues.filter(
                        (item) =>
                          item.path.startsWith(`model_configs.${model.key}.params`) &&
                          item.severity === 'error',
                      )
                      return {
                        key: model.key,
                        label: (
                          <span className="tn-inline">
                            <span>{model.label}</span>
                            <Tag>{modeLabel(model.default_mode)}</Tag>
                            {issues.length ? <Tag color="red">{issues.length} 个错误</Tag> : null}
                          </span>
                        ),
                        children: (
                          <>
                            <Button
                              size="small"
                              style={{ marginBottom: 6 }}
                              onClick={() => {
                                setAllParams((previous) => ({
                                  ...previous,
                                  [model.key]: defaultsFor(model.key),
                                }))
                                setCustomized((previous) => ({ ...previous, [model.key]: false }))
                              }}
                            >
                              恢复该算法默认值
                            </Button>
                            {visibleFields(model.params, allParams[model.key] ?? {})
                              .filter((spec) => spec.level !== 'advanced')
                              .map((spec) => (
                                <ParamField
                                  key={spec.key}
                                  spec={spec}
                                  value={(allParams[model.key] ?? {})[spec.key]}
                                  issues={allValidation.issues.filter(
                                    (item) =>
                                      item.path ===
                                      `model_configs.${model.key}.params.${spec.key}`,
                                  )}
                                  path={`model_configs.${model.key}.params.${spec.key}`}
                                  onChange={(key, value) => {
                                    setAllParams((previous) => ({
                                      ...previous,
                                      [model.key]: {
                                        ...(previous[model.key] ?? {}),
                                        [key]: value,
                                      },
                                    }))
                                    setCustomized((previous) => ({
                                      ...previous,
                                      [model.key]: true,
                                    }))
                                  }}
                                  disabledReason={fieldDisabledReason(
                                    spec,
                                    allParams[model.key] ?? {},
                                  )}
                                  compact
                                />
                              ))}
                          </>
                        ),
                      }
                    })}
                  />
                  <Button size="small" style={{ marginTop: 6 }} onClick={resetAllModels}>
                    恢复全部模型默认参数
                  </Button>
                </>
              ) : activeModel ? (
                visibleFields(activeModel.params, params)
                  .filter((spec) => spec.level !== 'advanced')
                  .map((spec) => (
                    <ParamField
                      key={spec.key}
                      spec={spec}
                      value={params[spec.key]}
                      issues={singleValidation.fieldIssues(spec.key)}
                      path={`model_configs.${algorithm}.params.${spec.key}`}
                      draft={drafts[`${algorithm}.${spec.key}`]}
                      onDraftChange={(key, text) =>
                        setDrafts((previous) => ({
                          ...previous,
                          [`${algorithm}.${key}`]: text,
                        }))
                      }
                      onChange={(key, value) => {
                        setParams((previous) => ({ ...previous, [key]: value }))
                        setAllParams((previous) => ({
                          ...previous,
                          [algorithm]: { ...(previous[algorithm] ?? {}), [key]: value },
                        }))
                        setCustomized((previous) => ({ ...previous, [algorithm]: true }))
                      }}
                      disabledReason={fieldDisabledReason(spec, params)}
                      compact
                    />
                  ))
              ) : (
                <EmptyState text="模型注册表加载中。" />
              )}
            </div>

            <div className="tn-field">
              <div className="tn-section-title">运行前检查（Preflight Summary）</div>
              <div className="tn-inline" style={{ marginBottom: 6 }}>
                <Button size="small" onClick={runPreflight} loading={busy} disabled={!datasetId}>
                  重新检查
                </Button>
                {!activeErrors.length && dataset ? <Tag color="green">参数校验通过</Tag> : null}
              </div>
              {preflight ? (
                <div className="tn-m4-preflight">
                  {isAllModels ? (
                    <>
                      <span>可运行模型：{preflight.runnable_count ?? 0} / 12</span>
                      <span>阻断错误：{preflight.blocking_error_count ?? 0}</span>
                    </>
                  ) : (
                    <>
                      <span>数据集有效：{dataset ? '是' : '否'}</span>
                      <span>算法与参数兼容：{preflight.valid ? '是' : '否'}</span>
                      <span>训练条件：{preflight.context?.train_samples ?? '—'} 个样本</span>
                    </>
                  )}
                  {(preflight.batch_issues ?? preflight.issues ?? []).slice(0, 4).map((item: any) => (
                    <span key={item.code + item.path} className="tn-warning-text">
                      {item.message}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="tn-muted">训练开始前会自动执行后端预检。</div>
              )}
              {activeWarnings.slice(0, 3).map((item) => (
                <div key={item.path + item.code} className="tn-warning-text">
                  {item.message}
                </div>
              ))}
            </div>

            <div className="tn-field" style={{ marginBottom: 0 }}>
              <div className="tn-section-title">操作（Actions）</div>
              <div className="tn-m4-actions">
                <Button
                  type="primary"
                  block
                  onClick={isAllModels ? runAllModels : runSingle}
                  loading={busy}
                  disabled={!runnable}
                >
                  {isAllModels ? '运行全部模型' : '开始训练'}
                </Button>
                <Button block danger onClick={stop}>
                  停止训练
                </Button>
              </div>
            </div>
          </Card>

          <Card
            size="small"
            className="tn-m4-card"
            title="实验历史（Experiment History）"
          >
            <div className="tn-m4-history-filters">
              <Select
                size="small"
                value={historyDataset}
                options={[{ value: 'all', label: '全部数据集' }, ...historyDatasetOptions]}
                onChange={setHistoryDataset}
              />
              <Select
                size="small"
                value={historyAlgorithm}
                options={[{ value: 'all', label: '全部算法' }, ...historyAlgorithmOptions]}
                onChange={setHistoryAlgorithm}
              />
              <Select
                size="small"
                value={historyStatus}
                options={[{ value: 'all', label: '全部状态' }, ...historyStatusOptions]}
                onChange={setHistoryStatus}
              />
            </div>
            <div className="tn-m4-history-list" data-testid="m4-experiment-history">
              {visibleExperiments.length ? (
                visibleExperiments.map((item) => (
                  <div className="tn-m4-history-item" key={item.experiment_id}>
                    <div className="tn-m4-history-head">
                      <span className="tn-m4-history-id">{item.display_id ?? item.experiment_id}</span>
                      <StatusTag status={item.status} error={item.error} />
                    </div>
                    <div className="tn-m4-history-meta">
                      <span><b>数据集</b>{item.dataset_display_id ?? item.dataset_id}</span>
                      <span><b>算法</b>{item.algorithm_label}</span>
                      <span><b>开始</b>{formatDateTime(item.started_at ?? item.created_at)}</span>
                    </div>
                    <div className="tn-m4-history-actions">
                      <Button
                        size="small"
                        loading={loadingId === item.experiment_id}
                        onClick={() => openExperiment(item.experiment_id)}
                      >
                        打开
                      </Button>
                      <Popconfirm
                        title="删除这条实验记录？"
                        description="将同步清理该实验的区域记录、日志和模型文件；被评估引用的实验会被后端拒绝删除。"
                        okText="确认删除"
                        cancelText="取消"
                        onConfirm={() => deleteExperiment(item)}
                      >
                        <Button size="small" danger loading={deletingId === item.experiment_id}>
                          删除记录
                        </Button>
                      </Popconfirm>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState text="没有符合筛选条件的实验历史。" />
              )}
            </div>
            {filteredExperiments.length > HISTORY_PAGE_SIZE ? (
              <Pagination
                size="small"
                current={historyPage}
                pageSize={HISTORY_PAGE_SIZE}
                total={filteredExperiments.length}
                showSizeChanger={false}
                onChange={setHistoryPage}
              />
            ) : null}
          </Card>
        </div>

        <div className="tn-m4-column">
          <Card
            size="small"
            className="tn-m4-card"
            title="1 · 当前实验详情（Current Experiment Details）"
          >
            {activeRun ? (
              <div className="tn-m4-detail-grid" data-testid="m4-current-details">
                <div className="tn-m4-detail-item">
                  <span>{activeIsBatch ? '批量任务 ID' : '实验 ID'}</span>
                  <strong>{activeRun.display_id ?? activeRun.experiment_id ?? activeRun.batch_id}</strong>
                </div>
                <div className="tn-m4-detail-item">
                  <span>算法</span>
                  <strong>{activeIsBatch ? '全部模型（12 种）' : activeRun.algorithm_label}</strong>
                </div>
                <div className="tn-m4-detail-item">
                  <span>当前状态</span>
                  <StatusTag status={activeRun.status} error={activeRun.error} />
                </div>
                <div className="tn-m4-detail-item">
                  <span>开始时间</span>
                  <strong>{currentStartedAt ? formatDateTime(currentStartedAt) : '排队中'}</strong>
                </div>
                <div className="tn-m4-detail-item">
                  <span>运行时长</span>
                  <strong>{durationLabel(currentStartedAt, currentEndedAt)}</strong>
                </div>
              </div>
            ) : (
              <EmptyState text="从左侧实验历史打开记录，或开始一项新的训练。" />
            )}
          </Card>

          <Card
            size="small"
            className="tn-m4-card"
            title="2 · 训练监控（Training Monitor）"
            extra={
              activeRun ? (
                <span className="tn-muted">
                  {currentRegionsDone} / {activeRun.region_total ?? 0} 区域完成
                </span>
              ) : null
            }
          >
            {activeRun ? (
              <div className="tn-m4-monitor">
                <div className="tn-m4-progress-head">
                  <div>
                    <strong>
                      {activeIsBatch
                        ? `${batch?.task_summary?.completed ?? 0} / ${batch?.experiments?.length ?? 12} 个模型实验完成`
                        : `${currentRegionsDone} / ${activeRun.region_total ?? 0} 个区域完成`}
                    </strong>
                    <div className="tn-muted">
                      状态：{statusLabel(activeStatus)}
                      {activeRun.progress?.message ? ` · ${activeRun.progress.message}` : ''}
                    </div>
                  </div>
                  <span>{currentProgress}%</span>
                </div>
                <Progress
                  percent={currentProgress}
                  status={progressStatus(activeStatus)}
                  showInfo={false}
                />

                {activeIsBatch ? (
                  <>
                    <Table
                      className="tn-m4-monitor-table"
                      size="small"
                      rowKey="experiment_id"
                      pagination={false}
                      dataSource={batch?.experiments ?? []}
                      columns={[
                        {
                          title: '模型实验',
                          dataIndex: 'display_id',
                          render: (value: string, row: any) => value ?? row.experiment_id,
                        },
                        { title: '算法', dataIndex: 'algorithm_label' },
                        {
                          title: '状态',
                          render: (_: unknown, row: any) => (
                            <StatusTag status={row.status} error={row.error} />
                          ),
                        },
                        {
                          title: '区域进度',
                          render: (_: unknown, row: any) =>
                            `${row.region_completed ?? 0} / ${row.region_total ?? 0}`,
                        },
                      ]}
                    />
                    {batchRegionRows.length ? (
                      <Table
                        className="tn-m4-monitor-table"
                        size="small"
                        rowKey={(row: any) => `${row.experiment_id}-${row.region_id}`}
                        pagination={{ pageSize: 8, size: 'small' }}
                        dataSource={batchRegionRows}
                        columns={[
                          { title: '模型实验', dataIndex: 'parent_display_id' },
                          { title: '区域', dataIndex: 'region_id' },
                          {
                            title: '状态',
                            render: (_: unknown, row: any) => (
                              <StatusTag status={row.status} error={row.error} />
                            ),
                          },
                          { title: '开始', dataIndex: 'started_at', render: (value: string) => formatDateTime(value) },
                          { title: '结束', dataIndex: 'ended_at', render: (value: string) => formatDateTime(value) },
                          {
                            title: '耗时',
                            render: (_: unknown, row: any) =>
                              durationLabel(row.started_at, row.ended_at),
                          },
                        ]}
                      />
                    ) : null}
                  </>
                ) : (
                  <>
                    {experiment?.scope === 'all' &&
                    regionRows.length < (experiment?.region_total ?? 0) ? (
                      <Alert
                        type="warning"
                        showIcon
                        message={`该历史任务仅保存了实际进入执行的 ${regionRows.length} 个区域记录，任务总区域数为 ${experiment?.region_total ?? 0}。未落库区域不推断状态。`}
                      />
                    ) : null}
                    <Table
                      className="tn-m4-monitor-table"
                      size="small"
                      rowKey="region_id"
                      pagination={regionRows.length > 8 ? { pageSize: 8, size: 'small' } : false}
                      dataSource={regionRows}
                      columns={[
                        { title: '区域', dataIndex: 'region_id' },
                        {
                          title: '状态',
                          render: (_: unknown, row: any) => (
                            <StatusTag status={row.status} error={row.error} />
                          ),
                        },
                        {
                          title: '开始时间',
                          dataIndex: 'started_at',
                          render: (value: string) => formatDateTime(value),
                        },
                        {
                          title: '结束时间',
                          dataIndex: 'ended_at',
                          render: (value: string) => formatDateTime(value),
                        },
                        {
                          title: '耗时',
                          render: (_: unknown, row: any) =>
                            durationLabel(row.started_at, row.ended_at),
                        },
                      ]}
                    />
                  </>
                )}

                <div className="tn-m4-monitor-section">
                  <div className="tn-m4-monitor-section-title">训练过程（Training Process）</div>
                  {activeIsBatch ? (
                    <div className="tn-m4-process-note">
                      批量任务按模型和区域独立执行。选择左侧任一实验记录可查看其真实训练过程与日志。
                    </div>
                  ) : epochHistory ? (
                    <div>
                      <div className="tn-m4-process-title">真实训练与验证 Loss</div>
                      <LineChart
                        height={280}
                        x={epochHistory.epoch.map((epoch: number) => `第 ${epoch} 轮`)}
                        xName="迭代轮次"
                        yName="Loss"
                        series={[
                          {
                            name: '训练 Loss',
                            data: epochHistory.train_loss,
                            color: '#2467E8',
                          },
                          {
                            name: '验证 Loss',
                            data: epochHistory.validation_loss,
                            color: '#F08C00',
                          },
                        ]}
                      />
                    </div>
                  ) : (
                    <div className="tn-m4-process-note">
                      当前算法不提供标准 epoch 训练过程。此处展示的是真实拟合状态、耗时与后端日志，不生成模拟 Loss 曲线。
                    </div>
                  )}
                </div>

                <div className="tn-m4-monitor-section">
                  <div className="tn-m4-monitor-section-title">训练日志（Training Logs）</div>
                  <div className="tn-m4-log-toolbar">
                    <span className="tn-muted">
                      {activeIsBatch
                        ? `批量任务 ${batch?.display_id ?? batch?.batch_id} 的成员实验日志`
                        : `实验 ${experiment?.display_id ?? experiment?.experiment_id} 的真实后端日志`}
                    </span>
                    <Button size="small" onClick={downloadLogs} disabled={!logs.length}>
                      下载日志
                    </Button>
                  </div>
                  {logs.length ? (
                    <div className="tn-m4-log-console" data-testid="m4-training-logs">
                      {logs.map((entry, index) => (
                        <div key={`${entry.at}-${index}`}>
                          <span className="tn-m4-log-time">[{entry.at ?? '—'}]</span>{' '}
                          <span className="tn-m4-log-level">
                            {String(entry.level ?? 'info').toUpperCase()}
                          </span>{' '}
                          {entry.experiment_display_id ? `[${entry.experiment_display_id}] ` : ''}
                          {entry.region_id ? `(${entry.region_id}) ` : ''}
                          {entry.message}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState text="当前任务没有可用日志；任务可能仍在排队或尚未开始。" />
                  )}
                </div>
              </div>
            ) : (
              <EmptyState text="训练监控将显示真实任务进度、区域状态、训练过程与日志。" />
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
