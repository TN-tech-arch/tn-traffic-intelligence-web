import type { ReactNode } from 'react'

export function ThreePane({ config, visual, info }: { config: ReactNode; visual: ReactNode; info: ReactNode }) {
  return (
    <div className="tn-three-pane">
      <section className="tn-pane" aria-label="Configuration">
        {config}
      </section>
      <section className="tn-pane" aria-label="Visualization">
        {visual}
      </section>
      <section className="tn-pane tn-pane-info" aria-label="Information">
        {info}
      </section>
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
  title,
  description,
  datasetInfo,
}: {
  module: string
  title: string
  description: string
  datasetInfo?: ReactNode
}) {
  return (
    <div className="tn-module-head">
      <div>
        <div className="tn-module-title">
          {module} / {title}
        </div>
        <div className="tn-module-desc">{description}</div>
      </div>
      <div className="tn-muted">{datasetInfo}</div>
    </div>
  )
}

export function EmptyState({ text }: { text: string }) {
  return <div className="tn-empty">{text}</div>
}
