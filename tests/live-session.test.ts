import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createLiveSessionReader } from '../src/server/live-session'
import { applyPreparedDelta, hydrateEvents } from '../src/core/prepared-session-delta'
import { indexedEntry } from '../src/server/session-entry-index'
import type { SessionView } from '../src/core/types'

const timestamp = '2026-01-01T00:00:00Z'
const record = (id: string, parentId: string | null, data: Record<string, unknown>) => ({ id, parentId, timestamp, ...data })

describe('按需实时会话读取', () => {
  it('空闲不读取文件正文；仅解析追加字节并传输增量，保留工具关联与完整 Raw', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-live-'))
    const file = path.join(root, 'session.jsonl')
    const reader = createLiveSessionReader()
    try {
      const records: unknown[] = [{ type: 'session', version: 3, id: 'test', cwd: '/work', timestamp },
        record('u', null, { type: 'message', message: { role: 'user', content: 'Question' } }),
        record('a', 'u', { type: 'message', message: { role: 'assistant', content: [
          { type: 'thinking', thinking: 'Reason', thinkingSignature: 'opaque'.repeat(100000) },
          { type: 'toolCall', id: 'call', name: 'bash', arguments: { command: 'echo done' } },
        ] } })]
      for (let index = 0; index < 1000; index++) records.push(record(`g${index}`, index ? `g${index - 1}` : 'a', { type: 'custom', customType: 'goal-state', data: { body: 'state'.repeat(100) } }))
      const source = records.map((entry) => JSON.stringify(entry)).join('\r\n') + '\r\n'
      await fs.writeFile(file, source)
      const first = (await reader.read(file, 'session.jsonl', 'token'))!
      const prepared = first.snapshot!.prepared!
      expect(JSON.stringify(first)).not.toContain('opaqueopaque')
      const initialEvents = hydrateEvents(prepared.events, prepared.definitions)
      const byId = new Map(initialEvents.map((event) => [event.id, event]))
      const initial: SessionView = { events: initialEvents, stats: prepared.stats, branchEntries: [],
        turns: prepared.turns.map(({ eventIds, ...turn }) => ({ ...turn, events: eventIds.map((id) => byId.get(id)!) })) }
      const open = vi.spyOn(fs, 'open')
      expect(await reader.read(file, 'session.jsonl', 'token', undefined, first.cursor)).toBeNull()
      expect(open).not.toHaveBeenCalled()
      const result = record('r', 'g999', { type: 'message', message: { role: 'toolResult', toolCallId: 'call', toolName: 'bash', content: [{ type: 'text', text: 'complete output\n'.repeat(500) }] } })
      await fs.appendFile(file, JSON.stringify(result) + '\n')
      const next = (await reader.read(file, 'session.jsonl', 'token', undefined, first.cursor))!
      expect(open).toHaveBeenCalledTimes(1)
      open.mockRestore()
      expect(next.snapshot).toBeUndefined()
      expect(JSON.stringify(next).length).toBeLessThan(6000)
      expect(next.delta!.turns[0].eventIds).toBeUndefined()
      expect(next.delta!.turns[0].appendEventIds).toContain('r:result')
      expect(next.delta!.events.find((event) => event.kind === 'tool-call')?.pairedEventId).toBe('r:result')
      expect(await indexedEntry(file, 'r')).toEqual(result)
      const applied = applyPreparedDelta(initial, next.delta!, next.delta!.definitions ?? prepared.definitions)
      const current = (await reader.read(file, 'session.jsonl', 'token'))!.snapshot!.prepared!
      expect(applied.events).toEqual(hydrateEvents(current.events, current.definitions))
      expect(applied.turns.flatMap((turn) => turn.events.map((event) => event.id))).toEqual(current.turns.flatMap((turn) => turn.eventIds))
      expect(applied.stats).toEqual(current.stats)
      // 未完成的 UTF-8 JSON 行不触发半条记录更新。
      const tail = Buffer.from(JSON.stringify(record('new', 'r', { type: 'message', message: { role: 'user', content: '最新问题' } })) + '\n')
      const cut = tail.indexOf(Buffer.from('最新')) + 1
      await fs.appendFile(file, tail.subarray(0, cut))
      expect(await reader.read(file, 'session.jsonl', 'token', undefined, next.cursor)).toBeNull()
      await fs.appendFile(file, tail.subarray(cut))
      expect((await reader.read(file, 'session.jsonl', 'token', undefined, next.cursor))!.delta!.events.some((event) => event.content === '最新问题')).toBe(true)
      await fs.writeFile(file, records.slice(0, 2).map((entry) => JSON.stringify(entry)).join('\n') + '\n')
      expect((await reader.read(file, 'session.jsonl', 'token', undefined, next.cursor))!.snapshot).toBeDefined()
    } finally { vi.restoreAllMocks(); reader.dispose(); await fs.rm(root, { recursive: true, force: true }) }
  })
})

it('增量上下文标记与 Pi 完整投影一致，分支切换与无换行文件也能同步', async () => {
  const { computeContextProjections } = await import('../src/server/context-projection')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-live-context-'))
  const file = path.join(root, 'session.jsonl')
  const reader = createLiveSessionReader()
  try {
    const header = { type: 'session', version: 3, id: 'context', cwd: '/work', timestamp }
    const entries = [header, record('u', null, { type: 'message', message: { role: 'user', content: 'Question' } }),
      record('a', 'u', { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'Old attempt' }] } })]
    await fs.writeFile(file, entries.map((entry) => JSON.stringify(entry)).join('\n'))
    const first = (await reader.read(file, 'session.jsonl', 'token'))!
    await fs.appendFile(file, '\n' + JSON.stringify(record('edit', 'a', { type: 'context_edit', targetId: 'a', replacement: null })) + '\n')
    const next = (await reader.read(file, 'session.jsonl', 'token', undefined, first.cursor))!
    const expected = await computeContextProjections(await fs.readFile(file, 'utf8'), 'session.jsonl')
    expect(next.delta!.contextProjection?.excluded).toEqual(expected?.edit.excluded)
    if (expected) expect(next.delta!.events.find((event) => event.entryId === 'a')?.contextExclusion?.editId).toBe('edit')
    const old = first.snapshot!.prepared!
    const events = hydrateEvents(old.events, old.definitions)
    const byId = new Map(events.map((event) => [event.id, event]))
    const view: SessionView = { events, stats: old.stats, branchEntries: [], turns: old.turns.map(({ eventIds, ...turn }) => ({ ...turn, events: eventIds.map((id) => byId.get(id)!) })) }
    const edited = applyPreparedDelta(view, next.delta!, old.definitions)
    await fs.appendFile(file, JSON.stringify(record('fork', 'u', { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'New branch' }] } })) + '\n')
    const forked = (await reader.read(file, 'session.jsonl', 'token', undefined, next.cursor))!
    const applied = applyPreparedDelta(edited, forked.delta!, forked.delta!.definitions ?? old.definitions)
    const full = (await reader.read(file, 'session.jsonl', 'token'))!.snapshot!.prepared!
    expect(applied.events).toEqual(hydrateEvents(full.events, full.definitions))
    expect(applied.events.some((event) => event.entryId === 'edit')).toBe(false)
    expect(full.parsed.branches).toHaveLength(2)
  } finally { reader.dispose(); await fs.rm(root, { recursive: true, force: true }) }
})

it('初始化读取期间追加的数据在下一次只发送增量，而不反复重建完整快照', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-live-race-'))
  const file = path.join(root, 'session.jsonl')
  const reader = createLiveSessionReader()
  try {
    await fs.writeFile(file, [
      { type: 'session', version: 3, id: 'race', cwd: '/work', timestamp },
      record('u', null, { type: 'message', message: { role: 'user', content: 'Initial question' } }),
    ].map((entry) => JSON.stringify(entry)).join('\n') + '\n')
    const originalStat = fs.stat.bind(fs)
    let count = 0
    const stat = vi.spyOn(fs, 'stat').mockImplementation((async (...args: Parameters<typeof fs.stat>) => {
      if (++count === 2) await fs.appendFile(file, JSON.stringify(record('late', 'u', { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'Arrived during setup' }] } })) + '\n')
      return originalStat(...args)
    }) as typeof fs.stat)
    const first = (await reader.read(file, 'session.jsonl', 'token'))!
    stat.mockRestore()
    const next = (await reader.read(file, 'session.jsonl', 'token', undefined, first.cursor))!
    expect(next.snapshot).toBeUndefined()
    expect(next.delta!.events.some((event) => event.content === 'Arrived during setup')).toBe(true)
  } finally { vi.restoreAllMocks(); reader.dispose(); await fs.rm(root, { recursive: true, force: true }) }
})

it('缺少 JSONL 分隔换行时回退完整解析，不虚构一条追加记录', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-live-boundary-'))
  const file = path.join(root, 'session.jsonl')
  const reader = createLiveSessionReader()
  try {
    await fs.writeFile(file, [
      { type: 'session', version: 3, id: 'boundary', cwd: '/work', timestamp },
      record('u', null, { type: 'message', message: { role: 'user', content: 'Initial question' } }),
    ].map((entry) => JSON.stringify(entry)).join('\n'))
    const first = (await reader.read(file, 'session.jsonl', 'token'))!
    await fs.appendFile(file, JSON.stringify(record('bad', 'u', { type: 'message', message: { role: 'user', content: 'Not a valid separate line' } })) + '\n')
    const next = (await reader.read(file, 'session.jsonl', 'token', undefined, first.cursor))!
    expect(next.snapshot!.prepared!.events).toEqual([])
    expect(next.snapshot!.prepared!.parsed.warnings.some((warning) => warning.code === 'invalid-json')).toBe(true)
  } finally { reader.dispose(); await fs.rm(root, { recursive: true, force: true }) }
})
