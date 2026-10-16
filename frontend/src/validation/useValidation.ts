import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, ENDPOINTS, api, type Issue } from '../api/client'
import { checkGroup, crossFieldIssues, issuesByPath, type FieldSpec, type Values } from './engine'

export interface SchemaBundle {
  modules: Record<string, FieldSpec[]>
  models: Array<{
    key: string
    label: string
    category: string
    category_label_zh: string
    usage_zh: string
    default_mode: string
    supported_modes: string[]
    capabilities: Record<string, unknown>
    params: FieldSpec[]
    foundation_status?: Record<string, any>
  }>
}

let schemaCache: SchemaBundle | null = null

export function useSchema() {
  const [schema, setSchema] = useState<SchemaBundle | null>(schemaCache)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (schemaCache) return
    api
      .get<SchemaBundle>(ENDPOINTS.validationSchema)
      .then((data) => {
        schemaCache = data
        setSchema(data)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])
  return { schema, error }
}

export interface UseGroupValidationOptions {
  specs: FieldSpec[]
  values: Values
  pathPrefix: string
  algorithmKey?: string
  /** async (data dependent) confirmations, e.g. window counts or checkpoint state */
  remote?: {
    kind: string
    values: Values
    context?: Record<string, unknown>
    algorithm_key?: string
    mode?: string
  } | null
  remoteDebounceMs?: number
}

/**
 * Real-time validation for one parameter group.
 * - local rules run immediately on every change
 * - data/environment dependent rules are confirmed by the backend after a debounce
 * - stale async responses are discarded via a request sequence number
 */
export function useGroupValidation({ specs, values, pathPrefix, algorithmKey, remote, remoteDebounceMs = 350 }: UseGroupValidationOptions) {
  const local = useMemo(() => {
    const { issues } = checkGroup(specs, values, pathPrefix)
    if (algorithmKey) issues.push(...crossFieldIssues(algorithmKey, values, pathPrefix))
    return issues
  }, [specs, values, pathPrefix, algorithmKey])

  const [remoteIssues, setRemoteIssues] = useState<Issue[]>([])
  const [remoteState, setRemoteState] = useState<'idle' | 'checking' | 'checked' | 'failed'>('idle')
  const sequence = useRef(0)
  // The whole remote request (including algorithm_key / mode) is part of the key,
  // so a changed algorithm always triggers a fresh authoritative check.
  const remoteKey = remote ? JSON.stringify(remote) : null

  useEffect(() => {
    if (!remoteKey) {
      setRemoteIssues([])
      setRemoteState('idle')
      return
    }
    const current = ++sequence.current
    setRemoteState('checking')
    const timer = window.setTimeout(async () => {
      try {
        const payload = JSON.parse(remoteKey)
        const result = await api.post<{ issues: Issue[] }>(ENDPOINTS.validationCheck, payload)
        if (current !== sequence.current) return // stale response must not overwrite newer input
        setRemoteIssues(result.issues ?? [])
        setRemoteState('checked')
      } catch (err) {
        if (current !== sequence.current) return
        if (err instanceof ApiError) {
          setRemoteIssues(err.issues)
        } else {
          setRemoteIssues([
            {
              path: pathPrefix,
              code: 'VALIDATION_UNAVAILABLE',
              severity: 'warning',
              message: `服务器校验暂时不可用：${err instanceof Error ? err.message : String(err)}`,
              suggestion: '本地规则仍然生效；提交时服务器会再次校验。',
            },
          ])
        }
        setRemoteState('failed')
      }
    }, remoteDebounceMs)
    return () => window.clearTimeout(timer)
  }, [remoteKey, remoteDebounceMs, pathPrefix])

  const issues = useMemo(() => {
    const merged: Issue[] = [...local]
    for (const item of remoteIssues) {
      const exists = merged.some((m) => m.path === item.path && m.code === item.code && m.severity === item.severity)
      if (!exists) merged.push(item)
      else {
        const index = merged.findIndex((m) => m.path === item.path && m.code === item.code)
        if (index >= 0) merged[index] = item
      }
    }
    return merged
  }, [local, remoteIssues])

  const byPath = useMemo(() => issuesByPath(issues), [issues])
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')
  const fieldIssues = useCallback((key: string) => byPath[`${pathPrefix}.${key}`] ?? [], [byPath, pathPrefix])

  return {
    issues,
    byPath,
    errors,
    warnings,
    fieldIssues,
    valid: errors.length === 0,
    /** Never report "verified" while a remote confirmation is still pending. */
    verified: remoteState !== 'checking' && errors.length === 0,
    remoteState,
  }
}

export function mergeIssues(...groups: Issue[][]): Issue[] {
  const out: Issue[] = []
  for (const group of groups) {
    for (const item of group) {
      const index = out.findIndex((i) => i.path === item.path && i.code === item.code)
      if (index >= 0) out[index] = item
      else out.push(item)
    }
  }
  return out
}
