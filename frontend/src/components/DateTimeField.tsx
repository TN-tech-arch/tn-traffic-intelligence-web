import { DatePicker } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import type { Issue } from '../api/client'
import HelpTip from './HelpTip'

export default function DateTimeField({
  id,
  label,
  value,
  issues,
  onChange,
  disabledDate,
  help,
  detail,
}: {
  id: string
  label: string
  value?: string | null
  issues: Issue[]
  onChange: (value: string | null) => void
  disabledDate?: (current: Dayjs) => boolean
  help: string
  detail?: string
}) {
  const errors = issues.filter((item) => item.severity === 'error')
  const warnings = issues.filter((item) => item.severity === 'warning')
  const inputId = `field-${id.replace(/[^\w-]/g, '_')}`
  return (
    <div
      className={`tn-field${errors.length ? ' has-error' : ''}${!errors.length && warnings.length ? ' has-warning' : ''}`}
      data-field={id}
    >
      <label className="tn-field-label" htmlFor={inputId}>
        {label}
        <HelpTip title={help} detail={detail} label={label} />
      </label>
      <DatePicker
        id={inputId}
        showTime={{ format: 'HH:mm' }}
        format="YYYY-MM-DD HH:mm"
        style={{ width: '100%' }}
        size="small"
        value={value ? dayjs(value) : null}
        disabledDate={disabledDate}
        status={errors.length ? 'error' : warnings.length ? 'warning' : undefined}
        aria-invalid={errors.length > 0}
        aria-describedby={errors.length ? `${inputId}-error` : undefined}
        onChange={(next: Dayjs | null) => onChange(next ? next.format('YYYY-MM-DD HH:mm:ss') : null)}
      />
      {errors.map((item) => (
        <div className="tn-error-text" id={`${inputId}-error`} key={item.code + item.path} role="alert">
          <span aria-hidden="true">✕</span>
          <span>
            {item.message}
            {item.suggestion ? <div>{item.suggestion}</div> : null}
          </span>
        </div>
      ))}
      {warnings.map((item) => (
        <div className="tn-warning-text" key={item.code + item.path}>
          <span aria-hidden="true">⚠</span>
          <span>{item.message}</span>
        </div>
      ))}
    </div>
  )
}
