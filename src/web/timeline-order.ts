import { useEffect, useState } from 'react'
import type { TimelineTurn } from '../core/types'

export type TimelineOrder = 'oldest-first' | 'newest-first'
const STORAGE_KEY = 'pi_session_viewer_timeline_order'

export function parseTimelineOrder(value: string | null): TimelineOrder {
  return value === 'newest-first' ? value : 'oldest-first'
}

// 反转轮次及轮次内事件，保留原始顺序与因果数据供详情和分支逻辑使用。
export function orderTimelineTurns(turns: TimelineTurn[], order: TimelineOrder): TimelineTurn[] {
  return order === 'oldest-first' ? turns : [...turns].reverse().map((turn) => ({
    ...turn, events: [...turn.events].reverse(),
  }))
}

export function useTimelineOrder() {
  const [order, setOrder] = useState<TimelineOrder>(() => {
    try {
      return parseTimelineOrder(localStorage.getItem(STORAGE_KEY))
    } catch {
      return 'oldest-first'
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, order)
    } catch {
      // 存储不可用时仍可切换当前页面的显示顺序。
    }
  }, [order])
  const toggleOrder = () => setOrder((current) => current === 'oldest-first' ? 'newest-first' : 'oldest-first')
  return { order, toggleOrder }
}
