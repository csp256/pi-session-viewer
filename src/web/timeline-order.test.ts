import { describe, expect, it } from 'vitest'
import type { TimelineEvent, TimelineTurn } from '../core/types'
import { orderTimelineTurns, parseTimelineOrder } from './timeline-order'

const event = (id: string): TimelineEvent => ({ id, entryId: id, kind: 'user', title: id, summary: id, content: id, raw: {} })

describe('时间线显示顺序', () => {
  it('默认按原始顺序，未知或无效偏好也使用原始顺序', () => {
    for (const value of [null, '', 'invalid', 'oldest-first']) expect(parseTimelineOrder(value)).toBe('oldest-first')
    expect(parseTimelineOrder('newest-first')).toBe('newest-first')
  })

  it('反转轮次和轮次内事件，不修改输入、分组或事件数据', () => {
    const turns: TimelineTurn[] = [
      { id: 'one', index: 1, label: 'Turn 1', events: [event('a'), event('b')] },
      { id: 'two', index: 2, label: 'Turn 2', events: [event('c'), event('d')] },
    ]
    for (const turn of turns) { Object.freeze(turn.events); Object.freeze(turn) }
    Object.freeze(turns)
    expect(orderTimelineTurns(turns, 'oldest-first')).toBe(turns)
    const reversed = orderTimelineTurns(turns, 'newest-first')
    expect(reversed.map((turn) => turn.id)).toEqual(['two', 'one'])
    expect(reversed.flatMap((turn) => turn.events.map((item) => item.id))).toEqual(['d', 'c', 'b', 'a'])
    expect(reversed[0].events[0]).toBe(turns[1].events[1])
    expect(reversed[0].label).toBe('Turn 2')
    expect(turns.flatMap((turn) => turn.events.map((item) => item.id))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('空时间线可反转', () => {
    expect(orderTimelineTurns([], 'newest-first')).toEqual([])
  })
})
