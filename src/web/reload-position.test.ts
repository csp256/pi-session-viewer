import { describe, expect, it } from 'vitest'
import { readReloadPosition, writeReloadPosition } from './reload-position'
import type { SessionViewBookmark } from './session-view-controller'

const bookmark: SessionViewBookmark = { token: 'session', leafId: null, eventId: 'a:user', enabledKinds: ['user', 'assistant'],
  scopeMode: 'all', projectCwd: '/work', viewport: { atNewest: true, scrollTop: 900, anchor: { eventId: 'a:user', offset: -12 } } }
function memory() {
  let value: string | null = null
  return { getItem: () => value, setItem: (_key: string, next: string) => { value = next }, removeItem: () => { value = null } }
}
describe('标签页重新加载位置', () => {
  it('只在 reload 时恢复，首次导航不使用旧位置', () => {
    const storage = memory()
    writeReloadPosition(bookmark, storage)
    expect(readReloadPosition('reload', storage)).toEqual(bookmark)
    expect(readReloadPosition('navigate', storage)).toBeNull()
    expect(readReloadPosition('back_forward', storage)).toBeNull()
    writeReloadPosition(null, storage)
    expect(readReloadPosition('reload', storage)).toBeNull()
  })
  it('拒绝损坏或非法位置；存储被禁用时不影响查看器', () => {
    for (const value of ['{', 'null', JSON.stringify({ ...bookmark, viewport: { scrollTop: -5 } }),
      JSON.stringify({ ...bookmark, enabledKinds: ['nonexistent'] }), JSON.stringify({ ...bookmark, viewport: { scrollTop: 0, anchor: { eventId: 'x', offset: 'wrong' } } })]) {
      expect(readReloadPosition('reload', { getItem: () => value })).toBeNull()
    }
    const fail = () => { throw new Error('Storage blocked') }
    expect(readReloadPosition('reload', { getItem: fail })).toBeNull()
    expect(() => writeReloadPosition(bookmark, { setItem: fail, removeItem: fail })).not.toThrow()
  })
})
