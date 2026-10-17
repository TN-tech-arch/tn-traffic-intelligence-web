import { Checkbox, Input, Select } from 'antd'
import { WarningOutlined } from '@ant-design/icons'
import type { Issue } from '../api/client'
import type { FieldSpec } from '../validation/engine'
import HelpTip from './HelpTip'

interface Props {
  spec: FieldSpec
  value: unknown
  issues: Issue[]
  path: string
  onChange: (key: string, value: unknown) => void
  draft?: string
  onDraftChange?: (key: string, draft: string) => void
  disabledReason?: string
  compact?: boolean
}

function fieldDetail(spec: FieldSpec): string[] {
  const parts: string[] = []
  const bounds: string[] = []
  if (spec.min !== undefined && spec.min !== null) bounds.push(`${spec.exclusive_min ? '>' : '≥'} ${spec.min}`)
  if (spec.max !== undefined && spec.max !== null) bounds.push(`${spec.exclusive_max ? '<' : '≤'} ${spec.max}`)
  const facts: string[] = []
  if (spec.unit_zh) facts.push(`单位：${spec.unit_zh}`)
  if (bounds.length) facts.push(`范围：${bounds.join(' 且 ')}`)
  else if (spec.type === 'enum') facts.push(`可选：${(spec.enum ?? []).map(String).join(' / ')}`)
  const def = spec.default
  const hasDefault = def !== undefined && def !== null && def !== '' && !(Array.isArray(def) && def.length === 0)
  if (hasDefault) facts.push(`默认：${Array.isArray(def) ? def.join(', ') : String(def)}`)
  parts.push(facts.join(' · '))
  if (spec.suggestion_zh) parts.push(`建议：${spec.suggestion_zh}`)
  return parts
}

export default function ParamField({
  spec,
  value,
  issues,
  path,
  onChange,
  draft,
  onDraftChange,
  disabledReason,
  compact,
}: Props) {
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')
  const disabled = Boolean(disabledReason)
  const inputId = `field-${path.replace(/[^\w-]/g, '_')}`
  const describedBy = [
    errors.length ? `${inputId}-error` : null,
    warnings.length ? `${inputId}-warning` : null,
  ]
    .filter(Boolean)
    .join(' ')
  const status = errors.length ? ('error' as const) : warnings.length ? ('warning' as const) : undefined

  const style = compact ? { width: '100%', fontSize: 12 } : { width: '100%' }

  const renderControl = () => {
    if (spec.type === 'boolean') {
      return (
        <Checkbox
          id={inputId}
          checked={Boolean(value)}
          disabled={disabled}
          aria-invalid={errors.length > 0}
          aria-describedby={describedBy}
          onChange={(event) => onChange(spec.key, event.target.checked)}
        >
          <span className="tn-muted">{Boolean(value) ? '启用' : '关闭'}</span>
        </Checkbox>
      )
    }
    if (spec.type === 'enum' || spec.type === 'array') {
      const options = (spec.enum ?? []).map((option, index) => ({
        value: option as never,
        label: spec.enum_labels?.[index] ?? String(option),
      }))
      return (
        <Select
          id={inputId}
          {...(spec.type === 'array' ? { mode: 'multiple' as const } : {})}
          {...(spec.type === 'array' ? { showSearch: true, optionFilterProp: 'label' } : {})}
          size={compact ? 'small' : 'middle'}
          style={style}
          value={value as never}
          options={options}
          status={status}
          disabled={disabled}
          aria-invalid={errors.length > 0}
          aria-describedby={describedBy}
          onChange={(next) => onChange(spec.key, next)}
        />
      )
    }
    if (spec.type === 'integer' || spec.type === 'number') {
      const raw = draft !== undefined ? draft : value === null || value === undefined ? '' : String(value)
      return (
        <Input
          id={inputId}
          size={compact ? 'small' : 'middle'}
          style={style}
          value={raw}
          status={status}
          disabled={disabled}
          inputMode="decimal"
          aria-invalid={errors.length > 0}
          aria-describedby={describedBy}
          onChange={(event) => {
            const text = event.target.value
            onDraftChange?.(spec.key, text)
            const trimmed = text.trim()
            if (trimmed === '' || trimmed === '-' || trimmed.endsWith('.')) return
            const parsed = Number(trimmed)
            if (Number.isFinite(parsed)) onChange(spec.key, parsed)
          }}
          onBlur={() => {
            if (draft === undefined) return
            const trimmed = draft.trim()
            if (trimmed === '') onChange(spec.key, null)
            else if (Number.isFinite(Number(trimmed))) onChange(spec.key, Number(trimmed))
          }}
        />
      )
    }
    return (
      <Input
        id={inputId}
        size={compact ? 'small' : 'middle'}
        style={style}
        value={(value as string) ?? ''}
        status={status}
        disabled={disabled}
        aria-invalid={errors.length > 0}
        aria-describedby={describedBy}
        onChange={(event) => onChange(spec.key, event.target.value)}
      />
    )
  }

  return (
    <div
      className={`tn-field${errors.length ? ' has-error' : ''}${!errors.length && warnings.length ? ' has-warning' : ''}`}
      data-field={path}
    >
      <label className="tn-field-label" htmlFor={inputId}>
        {spec.label_zh ?? spec.label ?? spec.key}
        {spec.level === 'advanced' ? <span className="tn-muted">（Advanced）</span> : null}
        <HelpTip
          title={spec.help_zh || `${spec.label_zh ?? spec.key} 参数说明`}
          detail={
            <>
              {fieldDetail(spec).map((line) => (
                <div key={line}>{line}</div>
              ))}
            </>
          }
          label={spec.label_zh ?? spec.label ?? spec.key}
        />
        {disabledReason ? <span className="tn-muted">· {disabledReason}</span> : null}
      </label>
      {renderControl()}
      {errors.map((item) => (
        <div className="tn-error-text" key={`${item.path}-${item.code}`} id={`${inputId}-error`} role="alert">
          <span aria-hidden="true">✕</span>
          <span>
            {item.message}
            {item.suggestion ? <div>{item.suggestion}</div> : null}
          </span>
        </div>
      ))}
      {warnings.map((item) => (
        <div className="tn-warning-text" key={`${item.path}-${item.code}`} id={`${inputId}-warning`}>
          <WarningOutlined aria-hidden="true" />
          <span>
            {item.message}
            {item.suggestion ? <div>{item.suggestion}</div> : null}
          </span>
        </div>
      ))}
    </div>
  )
}
