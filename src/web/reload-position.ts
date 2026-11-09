import { allEventKinds } from '../core/event-kinds'
import type { SessionViewBookmark } from './session-view-controller'

const KEY = 'pi_session_viewer_reload_position'

/** 仅恢复本标签页的浏览器重新加载，不影响新打开的查看器或其他标签页。 */
export function readReloadPosition(navigationType?: string, storage?: Pick<Storage, 'getItem'>): SessionViewBookmark | null {
  try {
    const type = navigationType ?? (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type
    if (type !== 'reload') return null
    const value = JSON.parse((storage ?? window.sessionStorage).getItem(KEY) ?? 'null')
    if (!value || typeof value.token !== 'string' || !value.token || !value.viewport
      || !Number.isFinite(value.viewport.scrollTop) || value.viewport.scrollTop < 0
      || ![value.leafId, value.eventId, value.projectCwd].every((field) => field === null || typeof field === 'string')
      || !['current', 'all'].includes(value.scopeMode)
      || !Array.isArray(value.enabledKinds) || !value.enabledKinds.every((kind: unknown) => allEventKinds.some((known) => known === kind))) return null
    const anchor = value.viewport.anchor
    if (anchor !== null && (!anchor || typeof anchor.eventId !== 'string' || !Number.isFinite(anchor.offset))) return null
    return { token: value.token, leafId: value.leafId, eventId: value.eventId, projectCwd: value.projectCwd,
      scopeMode: value.scopeMode, enabledKinds: value.enabledKinds,
      viewport: { scrollTop: value.viewport.scrollTop, atNewest: value.viewport.atNewest === true, anchor } }
  } catch { return null }
}

export function writeReloadPosition(value: SessionViewBookmark | null, storage?: Pick<Storage, 'setItem' | 'removeItem'>): void {
  try {
    const target = storage ?? window.sessionStorage
    if (value) target.setItem(KEY, JSON.stringify(value))
    else target.removeItem(KEY)
  } catch { /* 无法使用存储时，当前页面的刷新仍能保持位置。 */ }
}
