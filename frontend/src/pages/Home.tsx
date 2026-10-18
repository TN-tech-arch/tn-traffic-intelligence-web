import { useEffect, useState } from 'react'
import { Button, Card, Col, Row, Spin, Tag, Timeline, Alert } from 'antd'
import { useNavigate } from 'react-router-dom'
import { ENDPOINTS, api } from '../api/client'
import StatusTag from '../components/StatusTag'
import { EmptyState } from '../components/Panes'
import HelpTip from '../components/HelpTip'
import {
  MODULE_META, activityKindLabel, bilingual, localizeUserText, modeLabel, sourceDisplayName, unitDisplayLabel,
} from '../i18n/terms'

interface DashboardPayload {
  sources: Array<{
    key: string
    display_name: string
    native_frequency: string
    series_region_count: number
    gis_region_count: number
    time_start: string
    time_end: string
    unit_label: string
    fingerprint: string
    zero_value_count: number
    no_data_region_count: number
  }>
  counts: Record<string, number>
  recent_activity: Array<{ id: string; kind: string; title: string; status: string; created_at: string; meta: string }>
  workflow: Array<{ step: number; module: string; title: string; route: string; description_zh: string }>
  algorithms: Array<{ key: string; label: string; category: string; category_label_zh: string; default_mode: string }>
  environment: Record<string, any>
  disclaimer_zh: string[]
}

export default function Home() {
  const [data, setData] = useState<DashboardPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    api
      .get<DashboardPayload>(ENDPOINTS.dashboard)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  if (error) return <Alert type="error" showIcon message="无法读取首页数据" description={error} />
  if (!data)
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Spin tip="正在读取真实数据概况..." />
      </div>
    )

  const activityTitle = (item: DashboardPayload['recent_activity'][number]) => {
    if (item.kind === 'Evaluation') {
      return item.title.startsWith('all') ? '全部区域评价' : '单区域评价'
    }
    if (item.kind === 'Batch') {
      const count = item.title.match(/(\d+)\s+algorithms?/)?.[1]
      return count ? `全部模型 · ${count} 个算法` : '全部模型批量任务'
    }
    if (item.kind === 'Experiment' && item.title.includes('·')) {
      const [algorithm, mode] = item.title.split('·').map((part) => part.trim())
      return `${algorithm} · ${modeLabel(mode)}`
    }
    return item.title
  }

  return (
    <div className="tn-stack">
      <Card
        styles={{ body: { padding: 20 } }}
        style={{ background: 'linear-gradient(115deg,#ffffff 0%,#eaf2ff 60%,#dfeaff 100%)' }}
      >
        <Row gutter={16} align="middle">
          <Col flex="auto">
            <h2 style={{ margin: 0, fontSize: 22 }}>欢迎使用 TianNuo Traffic Intelligence</h2>
            <p className="tn-muted" style={{ maxWidth: 720, marginTop: 8 }}>
              智能流量分析与预测平台：从三组真实区域流量数据出发，完成
              时空探索 → 功能区聚类 → 预测数据集构建 → 12 种算法训练（含全部模型批处理） → 留出测试集公平评价 的完整闭环。
              所有统计、训练曲线与预测结果均由真实数据计算，不使用模拟结果。
            </p>
            <div className="tn-inline" style={{ marginTop: 10 }}>
              <Button type="primary" onClick={() => navigate('/exploration')}>
                开始探索
              </Button>
              <Button onClick={() => navigate('/training')}>前往模型训练</Button>
            </div>
          </Col>
          <Col>
            <img src="/brand/tn-logo.svg" alt="TN" style={{ width: 96, height: 96 }} />
          </Col>
        </Row>
      </Card>

      <div className="tn-stat-grid">
        <div className="tn-stat">
          <div className="tn-stat-value">{data.counts.data_sources}</div>
          <div className="tn-stat-label">数据源（Data Sources）</div>
        </div>
        <div className="tn-stat">
          <div className="tn-stat-value">{data.counts.valid_regions}</div>
          <div className="tn-stat-label">
            有效时序区域（Valid Regions）· GIS 多边形 {data.counts.gis_regions} · 无数据 {data.counts.no_data_regions}
          </div>
        </div>
        <div className="tn-stat">
          <div className="tn-stat-value">{data.counts.algorithms}</div>
          <div className="tn-stat-label">预测算法（Forecasting Algorithms）</div>
        </div>
        <div className="tn-stat">
          <div className="tn-stat-value">{data.counts.modules}</div>
          <div className="tn-stat-label">核心模块（Core Modules）</div>
        </div>
        <div className="tn-stat">
          <div className="tn-stat-value">{data.counts.datasets}</div>
          <div className="tn-stat-label">已构建数据集（Built Datasets）· 已归档 {data.counts.datasets_archived}</div>
        </div>
        <div className="tn-stat">
          <div className="tn-stat-value">{data.counts.experiments}</div>
          <div className="tn-stat-label">
            实验（Experiments）· 已完成 {data.counts.experiments_completed} · 批次 {data.counts.batches} · 评价 {data.counts.evaluations}
          </div>
        </div>
      </div>

      <Row gutter={14}>
        <Col xs={24} lg={14}>
          <Card title={bilingual('数据源概览', 'Dataset Overview')} size="small">
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#5b7095' }}>
                  <th>来源</th>
                  <th>时序区域</th>
                  <th>GIS 多边形</th>
                  <th>频率</th>
                  <th>时间范围</th>
                </tr>
              </thead>
              <tbody>
                {data.sources.map((source) => (
                  <tr key={source.key} style={{ borderTop: '1px dashed #e3ebf6' }}>
                    <td>
                      <strong>{sourceDisplayName(source.key, source.display_name)}</strong>
                      <div className="tn-muted">{unitDisplayLabel(source.unit_label)}</div>
                    </td>
                    <td>{source.series_region_count}</td>
                    <td>
                      {source.gis_region_count}
                      {source.no_data_region_count > 0 ? (
                        <Tag color="default" style={{ marginLeft: 6 }}>
                          无数据 {source.no_data_region_count}
                        </Tag>
                      ) : null}
                    </td>
                    <td>{source.native_frequency}</td>
                    <td className="tn-muted">
                      {source.time_start} → {source.time_end}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="tn-muted" style={{ marginTop: 8 }}>
              {data.disclaimer_zh.map((line) => (
                <div key={line}>· {line}</div>
              ))}
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card
            title={(
              <span className="tn-inline">
                {bilingual('最近活动', 'Recent Activity')}
                <HelpTip
                  label="最近活动"
                  title="按创建时间倒序显示数据库中的数据集、实验、批量任务和评价记录。"
                  detail="这里没有示例数据；状态使用统一中文名称，ID 与技术字段会保留以便追溯。"
                />
              </span>
            )}
            size="small"
          >
            <div className="tn-muted" style={{ marginBottom: 10 }}>
              最近创建的数据集、实验、批量任务和评价记录，直接来自数据库。
            </div>
            {data.recent_activity.length === 0 ? (
              <EmptyState text="暂无历史记录：还没有创建任何数据集、实验或评价。" />
            ) : (
              <Timeline
                items={data.recent_activity.map((item) => ({
                  children: (
                    <div>
                      <div className="tn-inline">
                        <Tag color="blue">{activityKindLabel(item.kind)}</Tag>
                        <span>{activityTitle(item)}</span>
                        <StatusTag status={item.status} />
                      </div>
                      <div className="tn-code" style={{ marginTop: 4 }}>
                        {item.id}
                      </div>
                      <div className="tn-muted">
                        {item.created_at} · {item.meta}
                      </div>
                    </div>
                  ),
                }))}
              />
            )}
          </Card>
        </Col>
      </Row>

      <Card title={bilingual('五模块工作流', 'Five-Module Workflow')} size="small">
        <Row gutter={12}>
          {data.workflow.map((step) => (
            <Col xs={24} md={12} xl={8} key={step.step} style={{ marginBottom: 12 }}>
              <div
                className="tn-pane"
                style={{ cursor: 'pointer', height: '100%' }}
                onClick={() => navigate(step.route)}
                role="link"
                tabIndex={0}
                onKeyDown={(event) => event.key === 'Enter' && navigate(step.route)}
              >
                <div className="tn-inline">
                  <Tag color="blue">{MODULE_META[`m${step.step}` as keyof typeof MODULE_META]?.index ?? step.module}</Tag>
                  <strong>{MODULE_META[`m${step.step}` as keyof typeof MODULE_META]?.titleZh ?? step.title}</strong>
                </div>
                <div className="tn-muted" style={{ marginTop: 2 }}>
                  {MODULE_META[`m${step.step}` as keyof typeof MODULE_META]?.titleEn ?? ''}
                </div>
                <div className="tn-muted" style={{ marginTop: 6 }}>
                  {localizeUserText(step.description_zh)}
                </div>
              </div>
            </Col>
          ))}
        </Row>
      </Card>

      <Card title={bilingual('12 种预测算法', '12 Forecasting Algorithms')} size="small">
        <div className="tn-inline">
          {data.algorithms.map((algo) => (
            <Tag key={algo.key} color={algo.category === 'foundation' ? 'purple' : 'blue'}>
              {algo.label} · {modeLabel(algo.default_mode)}
            </Tag>
          ))}
          <Tag color="gold">全部模型（All Models，批量执行，不是第 13 种算法）</Tag>
        </div>
      </Card>
    </div>
  )
}
