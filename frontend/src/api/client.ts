/**
 * Typed API client.
 *
 * Every response that can carry field level validation issues is normalised into
 * the same structured shape the backend produces: {path, code, severity, message,
 * suggestion, received_value} so the UI can always attach errors to the field
 * that caused them instead of showing a generic dialog.
 */

import { localizeUserText } from '../i18n/terms'

export type Severity = 'error' | 'warning' | 'info'

export interface Issue {
  path: string
  code: string
  severity: Severity
  message: string
  suggestion?: string
  received_value?: unknown
  group?: string
}

export class ApiError extends Error {
  status: number
  issues: Issue[]
  requestId?: string
  payload: any

  constructor(status: number, message: string, issues: Issue[], requestId: string | undefined, payload: any) {
    super(message)
    this.status = status
    this.issues = issues
    this.requestId = requestId
    this.payload = payload
  }

  issuesFor(path: string): Issue[] {
    return this.issues.filter((i) => i.path === path)
  }
}

const BASE = import.meta.env.VITE_API_BASE ?? ''

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const text = await response.text()
  let payload: any = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = { message: text }
    }
  }
  if (!response.ok) {
    const issues: Issue[] = (payload?.issues ?? []).map((item: Issue) => ({
      ...item,
      message: localizeUserText(item.message),
      suggestion: item.suggestion ? localizeUserText(item.suggestion) : item.suggestion,
    }))
    const message = localizeUserText(
      payload?.message ??
        (issues.length ? `请求被拒绝（${issues.filter((i) => i.severity === 'error').length} 个错误）` : response.statusText),
    )
    throw new ApiError(response.status, message, issues, payload?.request_id, payload)
  }
  return payload as T
}

export const api = {
  get: <T,>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  del: <T,>(path: string) => request<T>(path, { method: 'DELETE' }),
}

export const ENDPOINTS = {
  health: '/api/health',
  dashboard: '/api/dashboard',
  sources: '/api/data/sources',
  quality: (key: string) => `/api/data/quality?source_key=${key}`,
  regions: (key: string, hasTimeseries?: boolean) =>
    `/api/data/regions?source_key=${key}${hasTimeseries === undefined ? '' : `&has_timeseries=${hasTimeseries}`}`,
  geometry: (key: string) => `/api/data/geometry?source_key=${key}`,
  series: (key: string, region: string, frequency: string, aggregation: string, start?: number, points?: number) =>
    `/api/data/series?source_key=${key}&region_id=${encodeURIComponent(region)}&frequency=${frequency}` +
    `&aggregation=${aggregation}${start !== undefined ? `&start_index=${start}` : ''}` +
    `${points !== undefined ? `&window_points=${points}` : ''}`,
  temporal: '/api/analysis/temporal',
  spatial: '/api/analysis/spatial',
  compare: '/api/analysis/compare',
  clusterFeatures: '/api/clusters/features',
  clusterValidate: '/api/clusters/validate',
  clusterRange: '/api/clusters/range',
  clusterRun: '/api/clusters/run',
  clusterList: '/api/clusters',
  clusterGet: (id: string) => `/api/clusters/${id}`,
  validationSchema: '/api/validation/schema',
  validationCheck: '/api/validation/check',
  datasetValidate: '/api/datasets/validate',
  datasetPreview: '/api/datasets/preview',
  datasetPreviewWindow: '/api/datasets/preview-window',
  datasetBuild: '/api/datasets/build',
  datasetList: '/api/datasets?include_archived=true',
  datasetGet: (id: string) => `/api/datasets/${id}`,
  datasetWindows: (id: string, split: string, region: string, offset = 0, limit = 20) =>
    `/api/datasets/${id}/windows?split=${split}&region_id=${encodeURIComponent(region)}&offset=${offset}&limit=${limit}`,
  datasetDelete: (id: string) => `/api/datasets/${id}`,
  modelRegistry: '/api/models/registry',
  foundation: '/api/models/foundation',
  preflight: '/api/models/preflight',
  experimentRun: '/api/experiments/run',
  experimentList: '/api/experiments',
  experimentGet: (id: string) => `/api/experiments/${id}`,
  experimentLogs: (id: string) => `/api/experiments/${id}/logs`,
  experimentStop: (id: string) => `/api/experiments/${id}/stop`,
  experimentDuplicate: (id: string) => `/api/experiments/${id}/duplicate`,
  experimentArchive: (id: string, archived = true) => `/api/experiments/${id}/archive?archived=${archived}`,
  experimentDelete: (id: string) => `/api/experiments/${id}`,
  batchRun: '/api/batches/run',
  batchList: '/api/batches',
  batchGet: (id: string) => `/api/batches/${id}`,
  batchStop: (id: string) => `/api/batches/${id}/stop`,
  evaluationValidate: '/api/evaluations/validate',
  evaluationRun: '/api/evaluations/run',
  evaluationList: '/api/evaluations',
  evaluationGet: (id: string) => `/api/evaluations/${id}`,
  evaluationSeries: (id: string, experiment: string, region?: string, horizonStep?: number) =>
    `/api/evaluations/${id}/series?experiment_id=${experiment}` +
    `${region ? `&region_id=${encodeURIComponent(region)}` : ''}${horizonStep ? `&horizon_step=${horizonStep}` : ''}`,
  evaluationExport: (id: string) => `/api/evaluations/${id}/export?format=csv`,
  evaluationDelete: (id: string) => `/api/evaluations/${id}`,
  evaluationStop: (id: string) => `/api/evaluations/${id}/stop`,
  job: (id: string) => `/api/jobs/${id}`,
}

export function downloadUrl(path: string): string {
  return `${BASE}${path}`
}
