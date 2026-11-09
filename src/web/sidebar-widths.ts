import { useEffect, useState } from 'react'

export type SidebarSide = 'left' | 'right'
export interface SidebarWidths { left: number; right: number }
export const DEFAULT_SIDEBAR_WIDTHS: SidebarWidths = { left: 240, right: 384 }
export const MIN_SIDEBAR_WIDTHS: SidebarWidths = { left: 180, right: 240 }
export const MIN_TIMELINE_WIDTH = 360
const STORAGE_KEY = 'pi_session_viewer_sidebar_widths'

export function parseSidebarWidths(raw: string | null): SidebarWidths {
  try {
    const value = JSON.parse(raw ?? 'null')
    if (value && [value.left, value.right].every((width) => typeof width === 'number' && Number.isFinite(width) && width > 0)) {
      return { left: value.left, right: value.right }
    }
  } catch {
    // 损坏的偏好使用默认值。
  }
  return { ...DEFAULT_SIDEBAR_WIDTHS }
}

// 缩小窗口时只约束显示宽度，保留用户偏好，以便窗口恢复后还原。
export function fitSidebarWidths(preferred: SidebarWidths, viewport: number): SidebarWidths {
  const left = Math.max(MIN_SIDEBAR_WIDTHS.left, preferred.left)
  const right = Math.max(MIN_SIDEBAR_WIDTHS.right, preferred.right)
  const budget = Math.max(MIN_SIDEBAR_WIDTHS.left + MIN_SIDEBAR_WIDTHS.right, viewport - MIN_TIMELINE_WIDTH)
  if (left + right <= budget) return { left, right }
  const extra = budget - MIN_SIDEBAR_WIDTHS.left - MIN_SIDEBAR_WIDTHS.right
  const ratio = extra / (left + right - MIN_SIDEBAR_WIDTHS.left - MIN_SIDEBAR_WIDTHS.right)
  const fittedLeft = Math.round(MIN_SIDEBAR_WIDTHS.left + (left - MIN_SIDEBAR_WIDTHS.left) * ratio)
  return { left: fittedLeft, right: budget - fittedLeft }
}

export function useSidebarWidths() {
  const [preferred, setPreferred] = useState<SidebarWidths>(() => {
    try {
      return parseSidebarWidths(localStorage.getItem(STORAGE_KEY))
    } catch {
      return { ...DEFAULT_SIDEBAR_WIDTHS }
    }
  })
  const [viewport, setViewport] = useState(() => window.innerWidth)
  const widths = fitSidebarWidths(preferred, viewport)

  useEffect(() => {
    const update = () => setViewport(window.innerWidth)
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  const maximum = (side: SidebarSide) => Math.max(
    MIN_SIDEBAR_WIDTHS[side], viewport - MIN_TIMELINE_WIDTH - widths[side === 'left' ? 'right' : 'left'],
  )
  const resize = (side: SidebarSide, width: number) => {
    const next = { ...widths, [side]: Math.round(Math.max(MIN_SIDEBAR_WIDTHS[side], Math.min(maximum(side), width))) }
    setPreferred(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // 禁用存储时仍允许当前页面调整布局。
    }
  }

  return { widths, maximum, resize }
}
