import { useLocation, useNavigate } from 'react-router-dom'
import { Badge, Button, Popover, Tooltip } from 'antd'
import { QuestionCircleOutlined, SettingOutlined, ApiOutlined } from '@ant-design/icons'
import { useEffect, useState } from 'react'
import { ENDPOINTS, api } from '../api/client'
import { NAV_ITEMS } from '../i18n/terms'

interface Health {
  status: string
  version: string
  database: { ok: boolean; counts: Record<string, number> }
  worker: { pending_jobs: number | null; last_heartbeat: string | null }
  environment: Record<string, unknown>
}

export default function BrandHeader() {
  const navigate = useNavigate()
  const location = useLocation()
  const [health, setHealth] = useState<Health | null>(null)

  useEffect(() => {
    let alive = true
    const load = () => {
      api
        .get<Health>(ENDPOINTS.health)
        .then((data) => alive && setHealth(data))
        .catch(() => alive && setHealth(null))
    }
    load()
    const timer = window.setInterval(load, 8000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  return (
    <header>
      <div className="tn-hero">
        <div className="tn-hero-brand">
          <img className="tn-logo" src="/brand/tn-logo.svg" alt="TN — TianNuo Traffic Intelligence" />
          <div>
            <div className="tn-hero-title">TianNuo Traffic Intelligence</div>
            <div className="tn-hero-sub">智能流量分析与预测平台 · From Data to Smarter Mobility · 田诺</div>
          </div>
        </div>
        <div className="tn-hero-right">
          <Tooltip title={health ? `后端 v${health.version} · 数据库 ${health.database.ok ? '正常' : '异常'}` : '后端未连接'}>
            <Badge
              status={health ? (health.database.ok ? 'success' : 'error') : 'default'}
              text={<span style={{ color: '#fff', fontSize: 12 }}>{health ? 'API 已连接' : 'API 离线'}</span>}
            />
          </Tooltip>
          <Tooltip
            title={
              health
                ? `待处理任务 ${health.worker.pending_jobs ?? 0} · 最近心跳 ${health.worker.last_heartbeat ?? '无'}`
                : '无法读取 Worker 状态'
            }
          >
            <Button size="small" ghost icon={<ApiOutlined />}>
              任务进程
            </Button>
          </Tooltip>
          <Popover
            placement="bottomRight"
            title="帮助 / 关于"
            content={
              <div style={{ maxWidth: 320, fontSize: 12, lineHeight: 1.6 }}>
                <p style={{ margin: 0 }}>
                  本平台使用三组真实区域流量数据（Milano 88 区 / Trentino 223 区 / ZTE 148 个有时序区域），
                  提供当前可运行的真实预测算法与“全部模型（All Models）”批量执行。
                </p>
                <p style={{ margin: '6px 0 0' }}>
                  所有统计、训练与预测结果均由真实数据计算得出；单位未证实的来源不做量纲推断。
                </p>
                <p style={{ margin: '6px 0 0' }}>作者：田诺（TianNuo）</p>
              </div>
            }
          >
            <Button size="small" ghost icon={<QuestionCircleOutlined />}>
              帮助
            </Button>
          </Popover>
          <Tooltip title={`当前环境：${String(health?.environment?.platform ?? '未知')}`}>
            <Button size="small" ghost icon={<SettingOutlined />}>
              设置
            </Button>
          </Tooltip>
        </div>
      </div>
      <nav className="tn-nav" aria-label="模块导航">
        {NAV_ITEMS.map((item) => {
          const active = item.key === '/' ? location.pathname === '/' : location.pathname.startsWith(item.key)
          return (
            <button
              key={item.key}
              type="button"
              className={`tn-nav-item${active ? ' active' : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => navigate(item.key)}
            >
              <span aria-hidden="true" style={{ fontSize: 16 }}>
                {item.icon}
              </span>
              <span>
                <span style={{ display: 'block' }}>{item.label}</span>
                <span className="tn-nav-sub">{item.sub}</span>
              </span>
            </button>
          )
        })}
      </nav>
    </header>
  )
}
