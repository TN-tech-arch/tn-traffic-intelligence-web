import type { ReactNode } from 'react'

export function ThreePane({
  config,
  visual,
  info,
  variant,
}: {
  config: ReactNode
  visual: ReactNode
  info?: ReactNode
  /** layout variant; "m1" uses 25% / 40% / 35% for the Module 1 workspace */
  variant?: 'default' | 'm1' | 'two'
}) {
  return (
    <div className={`tn-three-pane${variant === 'm1' ? ' tn-three-pane-m1' : ''}${variant === 'two' ? ' tn-two-pane' : ''}`}>
      <section className="tn-pane" aria-label="配置">
        {config}
      </section>
      <section className="tn-pane" aria-label="可视化">
        {visual}
      </section>
      {info ? (
        <section className="tn-pane tn-pane-info" aria-label="分析信息">
          {info}
        </section>
      ) : null}
    </div>
  )
}

export function PaneHead({ title, extra }: { title: string; extra?: ReactNode }) {
  return (
    <div className="tn-pane-head">
      <span>{title}</span>
      {extra}
    </div>
  )
}

export function ModuleHeader({
  module,
  titleZh,
  titleEn,
  description,
  datasetInfo,
}: {
  module: string
  titleZh: string
  titleEn: string
  description: string
  datasetInfo?: ReactNode
}) {
  return (
    <div className="tn-module-head">
      <div>
        <div className="tn-module-title">
          {module}｜{titleZh}
        </div>
        <div className="tn-module-title-en">{titleEn}</div>
        <div className="tn-module-desc">{description}</div>
      </div>
      <div className="tn-muted">{datasetInfo}</div>
    </div>
  )
}

export function EmptyState({ text }: { text: string }) {
  return <div className="tn-empty">{text}</div>
}
