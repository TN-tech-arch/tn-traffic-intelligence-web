import { createContext, useContext, useId, useMemo, useState, type ReactNode } from 'react'
import { Tooltip } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'

interface HelpState {
  openId: string | null
  setOpenId: (id: string | null) => void
}

const HelpContext = createContext<HelpState>({ openId: null, setOpenId: () => undefined })

/**
 * Ensures at most one help tooltip is visible at any time. Hovering a new ⓘ
 * immediately closes the previous one.
 */
export function HelpTipProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const value = useMemo(() => ({ openId, setOpenId }), [openId])
  return <HelpContext.Provider value={value}>{children}</HelpContext.Provider>
}

/**
 * Parameter help trigger: a ⓘ icon that opens a dark tooltip on **hover**
 * (150–250ms delay) or keyboard focus, never on click.
 */
export default function HelpTip({
  title,
  detail,
  label,
  placement = 'right',
}: {
  title: ReactNode
  detail?: ReactNode
  label?: string
  placement?: 'top' | 'topLeft' | 'topRight' | 'right' | 'left' | 'bottom'
}) {
  const id = useId()
  const { openId, setOpenId } = useContext(HelpContext)
  const open = openId === id
  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => {
        if (next) setOpenId(id)
        else if (openId === id) setOpenId(null)
      }}
      title={
        <div className="tn-help-content">
          <div>{title}</div>
          {detail ? <div className="tn-help-secondary">{detail}</div> : null}
        </div>
      }
      placement={placement}
      color="#1f2430"
      mouseEnterDelay={0.2}
      mouseLeaveDelay={0.05}
      autoAdjustOverflow
      overlayClassName="tn-help-tooltip"
      overlayStyle={{ maxWidth: 300 }}
      trigger={['hover', 'focus']}
    >
      <button
        type="button"
        className="tn-help-trigger"
        aria-label={label ? `${label} 帮助信息` : '参数帮助信息'}
        tabIndex={0}
        onMouseLeave={() => {
          // A click leaves the button focused; moving the mouse away must still
          // hide the help so it never lingers over the form.
          if (openId === id) setOpenId(null)
        }}
      >
        <InfoCircleOutlined aria-hidden="true" />
      </button>
    </Tooltip>
  )
}
