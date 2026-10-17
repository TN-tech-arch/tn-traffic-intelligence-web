import { Collapse, Spin, Tag } from 'antd'
import { BulbOutlined, WarningOutlined } from '@ant-design/icons'

export interface InsightItem {
  key: string
  label: string
  text: string
  level: 'info' | 'warning'
  metrics?: Record<string, unknown>
}

export interface InsightPayload {
  available?: boolean
  items: InsightItem[]
  warnings?: string[]
  details?: Array<{ label: string; value: string }>
  reliability?: { level: string; notes?: string[] }
}

const RELIABILITY_LABEL: Record<string, { text: string; color: string }> = {
  high: { text: '可靠性：高', color: 'green' },
  medium: { text: '可靠性：中', color: 'gold' },
  low: { text: '可靠性：低', color: 'orange' },
  none: { text: '可靠性：不可用', color: 'default' },
}

export default function InsightCard({
  title,
  insights,
  loading,
  subtitle,
}: {
  title: string
  insights?: InsightPayload | null
  loading?: boolean
  subtitle?: string
}) {
  const reliability = insights?.reliability?.level ? RELIABILITY_LABEL[insights.reliability.level] : null
  return (
    <div className="tn-insight-card">
      <div className="tn-insight-head">
        <span className="tn-inline">
          <BulbOutlined style={{ color: '#2467E8' }} />
          <strong>{title}</strong>
        </span>
        <span className="tn-inline">
          {reliability ? <Tag color={reliability.color}>{reliability.text}</Tag> : null}
          {loading ? <Spin size="small" /> : null}
        </span>
      </div>
      {subtitle ? <div className="tn-muted" style={{ marginBottom: 6 }}>{subtitle}</div> : null}
      {loading && !insights ? (
        <div className="tn-empty">正在按当前参数计算…</div>
      ) : !insights || insights.items.length === 0 ? (
        <div className="tn-empty">暂无可生成的结论。</div>
      ) : (
        <div className="tn-stack" style={{ gap: 6 }}>
          {insights.items.map((item) => (
            <div className={`tn-insight-item ${item.level}`} key={item.key}>
              <span className="tn-insight-label">
                {item.level === 'warning' ? <WarningOutlined aria-hidden="true" /> : null} {item.label}
              </span>
              <span>{item.text}</span>
            </div>
          ))}
        </div>
      )}
      {(insights?.warnings ?? []).length > 0 ? (
        <div style={{ marginTop: 6 }}>
          {insights!.warnings!.map((warning) => (
            <div className="tn-warning-text" key={warning}>
              <WarningOutlined aria-hidden="true" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      ) : null}
      {insights?.details?.length ? (
        <Collapse
          size="small"
          ghost
          style={{ marginTop: 4 }}
          items={[
            {
              key: 'details',
              label: '展开详情 / 统计依据',
              children: (
                <div className="tn-insight-details">
                  {insights.details.map((detail) => (
                    <div key={`${detail.label}-${detail.value}`}>
                      <span className="tn-insight-detail-label">{detail.label}</span>
                      <span>{detail.value}</span>
                    </div>
                  ))}
                  {(insights.reliability?.notes ?? []).length ? (
                    <div>
                      <span className="tn-insight-detail-label">可靠性说明</span>
                      <span>{insights.reliability!.notes!.join('；')}</span>
                    </div>
                  ) : null}
                </div>
              ),
            },
          ]}
        />
      ) : null}
    </div>
  )
}
