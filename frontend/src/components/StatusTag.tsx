import { Tag, Tooltip } from 'antd'
import { statusLabel } from '../i18n/terms'

const COLORS: Record<string, string> = {
  Queued: 'blue',
  Created: 'blue',
  Running: 'processing',
  Stopping: 'warning',
  Stopped: 'default',
  Completed: 'success',
  Partial: 'warning',
  Failed: 'error',
  Skipped: 'default',
  Unavailable: 'default',
  Archived: 'default',
  Built: 'success',
  Interrupted: 'error',
  Missing: 'error',
  Draft: 'default',
}

export default function StatusTag({ status, error }: { status: string; error?: string | null }) {
  const label = statusLabel(status)
  const tag = <Tag color={COLORS[status] ?? 'default'}>{label}</Tag>
  const diagnostic = [`状态代码：${status}`, error ? (error.length > 400 ? `${error.slice(0, 400)}…` : error) : null]
    .filter(Boolean)
    .join('\n')
  return <Tooltip title={diagnostic}>{tag}</Tooltip>
}

export function RealBadge({ real = true, text }: { real?: boolean; text?: string }) {
  return (
    <Tag color={real ? 'green' : 'default'} style={{ fontSize: 10 }}>
      {text ?? (real ? '真实计算' : '未验证')}
    </Tag>
  )
}
