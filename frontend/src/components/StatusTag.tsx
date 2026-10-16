import { Tag, Tooltip } from 'antd'

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
  const tag = <Tag color={COLORS[status] ?? 'default'}>{status}</Tag>
  if (!error) return tag
  return <Tooltip title={error.length > 400 ? `${error.slice(0, 400)}…` : error}>{tag}</Tooltip>
}

export function RealBadge({ real = true, text }: { real?: boolean; text?: string }) {
  return (
    <Tag color={real ? 'green' : 'default'} style={{ fontSize: 10 }}>
      {text ?? (real ? '真实计算' : '未验证')}
    </Tag>
  )
}
