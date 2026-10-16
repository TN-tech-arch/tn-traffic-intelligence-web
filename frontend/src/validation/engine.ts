/**
 * Client side validation.
 *
 * The rules are not duplicated by hand: the field metadata (type, min/max,
 * exclusive bounds, enum, warning threshold, visibility, enabled-when) is fetched
 * from `GET /api/validation/schema` and interpreted by this single generic
 * checker, which mirrors the server's `check_field()` implementation.  Anything
 * that depends on real data / environment is confirmed by calling
 * `POST /api/validation/check`, and the server always re-validates again.
 */

import type { Issue, Severity } from '../api/client'

export interface FieldSpec {
  key: string
  label?: string
  label_zh?: string
  type: 'integer' | 'number' | 'boolean' | 'enum' | 'string' | 'array'
  default?: unknown
  min?: number | null
  max?: number | null
  exclusive_min?: boolean
  exclusive_max?: boolean
  enum?: unknown[]
  enum_labels?: string[]
  enum_meta?: Array<Record<string, unknown>>
  unit_zh?: string
  help_zh?: string
  suggestion_zh?: string
  warning_above?: number | null
  warning_message_zh?: string
  warning_suggestion_zh?: string
  visible_when?: Record<string, unknown> | null
  enabled_when?: Record<string, unknown> | null
  depends_on?: string[]
  error_code?: string | null
  required?: boolean
  level?: 'basic' | 'advanced'
}

export type Values = Record<string, unknown>

export function isVisible(spec: FieldSpec, values: Values): boolean {
  if (!spec.visible_when) return true
  return Object.entries(spec.visible_when).every(([key, value]) => values[key] === value)
}

export function isEnabled(spec: FieldSpec, values: Values): boolean {
  if (!spec.enabled_when) return true
  return Object.entries(spec.enabled_when).every(([key, value]) => values[key] === value)
}

function rangeText(spec: FieldSpec): string {
  const { min, max } = spec
  if (min === undefined || min === null) {
    if (max === undefined || max === null) return ''
    return `建议不超过 ${max}`
  }
  if (max === undefined || max === null) return `不得小于 ${min}`
  const left = spec.exclusive_min ? '(' : '['
  const right = spec.exclusive_max ? ')' : ']'
  return `合法范围 ${left}${min}, ${max}${right}`
}

function issue(path: string, code: string, severity: Severity, message: string, suggestion: string, received?: unknown): Issue {
  return { path, code, severity, message, suggestion, received_value: received }
}

/** Mirrors backend `check_field`. Returns the issues plus the coerced value. */
export function checkField(spec: FieldSpec, raw: unknown, path: string): { issues: Issue[]; value: unknown } {
  const issues: Issue[] = []
  const label = spec.label_zh ?? spec.label ?? spec.key
  const suggestion = spec.suggestion_zh ?? ''
  const range = rangeText(spec)

  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    if (spec.required !== false) {
      issues.push(
        issue(path, 'REQUIRED', 'error', `${label} 不能为空。`, suggestion || `请输入合法的${label}${range ? `，${range}` : ''}。`),
      )
    }
    return { issues, value: null }
  }

  let value: unknown = raw
  if (spec.type === 'integer') {
    if (typeof raw === 'boolean') {
      return { issues: [issue(path, 'NOT_AN_INTEGER', 'error', `${label} 必须是整数。`, '请输入整数。', raw)], value: null }
    }
    const number = typeof raw === 'number' ? raw : Number(String(raw).trim())
    if (!Number.isFinite(number)) {
      return { issues: [issue(path, 'NOT_A_NUMBER', 'error', `${label} 必须是数字，收到 “${String(raw)}”。`, '请输入整数。', raw)], value: null }
    }
    if (Math.abs(number - Math.round(number)) > 1e-9) {
      return { issues: [issue(path, 'NOT_AN_INTEGER', 'error', `${label} 必须是整数，收到 ${String(raw)}。`, '请输入整数，不要使用小数。', raw)], value: null }
    }
    value = Math.round(number)
  } else if (spec.type === 'number') {
    const number = typeof raw === 'number' ? raw : Number(String(raw).trim())
    if (!Number.isFinite(number)) {
      return { issues: [issue(path, 'NOT_A_NUMBER', 'error', `${label} 必须是数值，收到 “${String(raw)}”。`, '请输入数值。', raw)], value: null }
    }
    value = number
  } else if (spec.type === 'boolean') {
    if (typeof raw === 'boolean') value = raw
    else if (raw === 0 || raw === 1) value = Boolean(raw)
    else if (typeof raw === 'string' && ['true', 'false'].includes(raw.trim().toLowerCase())) value = raw.trim().toLowerCase() === 'true'
    else return { issues: [issue(path, 'TYPE_INVALID', 'error', `${label} 必须是 true/false。`, '请使用开关。', raw)], value: null }
  } else if (spec.type === 'enum') {
    const options = spec.enum ?? []
    if (options.length > 0 && !options.includes(raw as never)) {
      return {
        issues: [
          issue(
            path,
            spec.error_code || 'ENUM_INVALID',
            'error',
            `${label} 只能取 ${options.map((o) => String(o)).join(', ')} 之一，收到 “${String(raw)}”。`,
            suggestion || '请从合法取值中选择。',
            raw,
          ),
        ],
        value: null,
      }
    }
    value = raw
  }

  if (typeof value === 'number') {
    const { min, max, exclusive_min, exclusive_max } = spec
    if (min !== undefined && min !== null) {
      if (exclusive_min && value <= min) {
        return { issues: [issue(path, spec.error_code || 'OUT_OF_RANGE', 'error', `${label} 必须大于 ${min}，收到 ${value}。`, suggestion || `请调整为大于 ${min} 的值。`, value)], value: null }
      }
      if (!exclusive_min && value < min) {
        return { issues: [issue(path, spec.error_code || 'OUT_OF_RANGE', 'error', `${label} 不能小于 ${min}，收到 ${value}。`, suggestion || `请调整为 ${range} 之间的值。`, value)], value: null }
      }
    }
    if (max !== undefined && max !== null) {
      if (exclusive_max && value >= max) {
        return { issues: [issue(path, spec.error_code || 'OUT_OF_RANGE', 'error', `${label} 必须小于 ${max}，收到 ${value}。`, suggestion || `请调整为小于 ${max} 的值。`, value)], value: null }
      }
      if (!exclusive_max && value > max) {
        return { issues: [issue(path, spec.error_code || 'OUT_OF_RANGE', 'error', `${label} 不能大于 ${max}，收到 ${value}。`, suggestion || `请调整为 ${range} 之间的值。`, value)], value: null }
      }
    }
    const threshold = spec.warning_above
    if (threshold !== undefined && threshold !== null && value > threshold) {
      issues.push(
        issue(
          path,
          'LONG_TRAINING',
          'warning',
          spec.warning_message_zh || `${label} 取值 ${value} 较大，预计运行时间较长。`,
          spec.warning_suggestion_zh || '可适当降低该参数。',
          value,
        ),
      )
    }
  }
  return { issues, value }
}

/** Validate a whole parameter group; skips invisible / disabled fields exactly like the server. */
export function checkGroup(
  specs: FieldSpec[],
  values: Values,
  pathPrefix: string,
): { issues: Issue[]; coerced: Values } {
  const issues: Issue[] = []
  const coerced: Values = {}
  for (const spec of specs) {
    if (!isVisible(spec, values)) continue
    if (!isEnabled(spec, values)) {
      coerced[spec.key] = values[spec.key] ?? spec.default
      continue
    }
    const result = checkField(spec, values[spec.key], `${pathPrefix}.${spec.key}`)
    issues.push(...result.issues)
    coerced[spec.key] = result.value ?? values[spec.key] ?? spec.default
  }
  return { issues, coerced }
}

/** Cross field rules that must exist on both sides (kept identical to the server). */
export function crossFieldIssues(
  algorithmKey: string,
  params: Values,
  pathPrefix: string,
): Issue[] {
  const issues: Issue[] = []
  const int = (key: string) => (typeof params[key] === 'number' ? (params[key] as number) : undefined)
  if (algorithmKey === 'transformer') {
    const dModel = int('d_model')
    const heads = int('n_heads')
    if (dModel && heads && dModel % heads !== 0) {
      issues.push(
        issue(
          `${pathPrefix}.n_heads`,
          'DIVISIBLE',
          'error',
          `n_heads=${heads} 不能整除 d_model=${dModel}（${dModel} % ${heads} = ${dModel % heads}）。`,
          `请把 d_model 调整为 ${heads} 的整数倍，例如 ${Math.floor(dModel / heads) * heads} 或 ${(Math.floor(dModel / heads) + 1) * heads}。`,
          heads,
        ),
      )
    }
  }
  if (algorithmKey === 'lightgbm') {
    const leaves = int('num_leaves')
    const depth = int('max_depth')
    if (leaves && depth && leaves > 2 ** Math.min(depth, 20)) {
      issues.push(
        issue(
          `${pathPrefix}.num_leaves`,
          'LEAVES_EXCEED_DEPTH',
          'error',
          `num_leaves=${leaves} 超过 2^max_depth=${2 ** Math.min(depth, 20)} 的上限。`,
          '请降低 num_leaves 或提高 max_depth。',
          leaves,
        ),
      )
    }
  }
  if (['rnn', 'lstm', 'gru'].includes(algorithmKey)) {
    const layers = int('num_layers')
    const dropout = typeof params.dropout === 'number' ? (params.dropout as number) : 0
    if (layers === 1 && dropout > 0) {
      issues.push(
        issue(`${pathPrefix}.dropout`, 'DROPOUT_IGNORED_SINGLE_LAYER', 'warning', `num_layers=1 时 dropout=${dropout} 不会生效。`, '将 num_layers 设为大于 1，或把 dropout 设为 0。', dropout),
      )
    }
  }
  if (['arima', 'prophet'].includes(algorithmKey)) {
    const mode = params.mode
    if (mode && mode !== 'fit') {
      issues.push(issue(`${pathPrefix}.mode`, 'MODE_NOT_SUPPORTED', 'error', `该统计模型只支持 Fit 模式。`, '请将执行模式改为 fit。', mode))
    }
  }
  if (algorithmKey === 'arima') {
    const d = int('d') ?? 0
    const trend = params.trend as string | undefined
    const allowed: Record<number, string[]> = { 0: ['n', 'c', 't', 'ct'], 1: ['n', 't'], 2: ['n'] }
    const list = allowed[d] ?? ['n']
    if (trend && !list.includes(trend)) {
      issues.push(
        issue(
          `${pathPrefix}.trend`,
          'TREND_INCOMPATIBLE_WITH_DIFFERENCING',
          'error',
          `statsmodels ARIMA 在 d=${d} 时不允许 trend='${trend}'：差分会把低阶趋势项消掉，该组合会被库直接拒绝。`,
          `请将 trend 改为 ${list.join(' / ')}，或把 d 调整为 0。`,
          trend,
        ),
      )
    }
  }
  return issues
}

export function issuesByPath(issues: Issue[]): Record<string, Issue[]> {
  const map: Record<string, Issue[]> = {}
  for (const item of issues) {
    if (!map[item.path]) map[item.path] = []
    map[item.path].push(item)
  }
  return map
}

/** Fields that must be rendered for the current values (mirrors the server's visible()). */
export function visibleFields(specs: FieldSpec[], values: Values): FieldSpec[] {
  return specs.filter((spec) => isVisible(spec, values))
}

export function fieldDisabledReason(spec: FieldSpec, values: Values): string | undefined {
  if (isEnabled(spec, values)) return undefined
  const rule = spec.enabled_when ?? {}
  const parts = Object.entries(rule).map(([key, value]) => `${key} = ${String(value)}`)
  return `当前不可用（需满足 ${parts.join(' 且 ')}）`
}
