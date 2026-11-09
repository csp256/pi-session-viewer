import { useEffect, useRef, useState } from 'react'
import { DEFAULT_SIDEBAR_WIDTHS, MIN_SIDEBAR_WIDTHS, type SidebarSide } from '../sidebar-widths'

interface SidebarResizerProps {
  side: SidebarSide
  width: number
  maximum: number
  label: string
  onResize: (width: number) => void
}

export function SidebarResizer({ side, width, maximum, label, onResize }: SidebarResizerProps) {
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const direction = side === 'left' ? 1 : -1

  useEffect(() => {
    if (!dragging) return
    document.documentElement.classList.add('is-resizing-panels')
    return () => document.documentElement.classList.remove('is-resizing-panels')
  }, [dragging])

  const finish = () => {
    drag.current = null
    setDragging(false)
  }

  return (
    <div
      className={`sidebar-resizer sidebar-resizer--${side}${dragging ? ' is-dragging' : ''}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={MIN_SIDEBAR_WIDTHS[side]}
      aria-valuemax={maximum}
      aria-valuenow={width}
      title={label}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return
        event.preventDefault()
        event.currentTarget.focus()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { pointerId: event.pointerId, x: event.clientX, width }
        setDragging(true)
      }}
      onPointerMove={(event) => {
        const start = drag.current
        if (!start || start.pointerId !== event.pointerId) return
        onResize(start.width + direction * (event.clientX - start.x))
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onDoubleClick={() => onResize(DEFAULT_SIDEBAR_WIDTHS[side])}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 64 : 16
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          onResize(width + (event.key === 'ArrowRight' ? 1 : -1) * direction * step)
        } else if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault()
          onResize(event.key === 'Home' ? MIN_SIDEBAR_WIDTHS[side] : maximum)
        }
      }}
    />
  )
}
