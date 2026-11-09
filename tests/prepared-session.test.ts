import { appendFile, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import type { SessionFileResponse } from '../src/core/types'
import { parseSessionJsonl } from '../src/core/session-parser'
import { buildSessionView } from '../src/core/session-view'
import { preparedSessionBody, readEventContent } from '../src/server/prepared-session'
import { indexedEntry } from '../src/server/session-entry-index'

const stamp = '2026-01-01T00:00:00.000Z'
const decode = (body: Buffer) => JSON.parse(gunzipSync(body).toString('utf8')) as SessionFileResponse

describe('持久化轻量时间线索引', () => {
  it('保留完整顺序、分支与文本，按需读取正文和原始记录，追加后先显示快照', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'viewer-prepared-'))
    try {
      const file = path.join(root, 'session.jsonl')
      const cache = path.join(root, 'cache')
      const output = '完整工具输出\n' + 'x'.repeat(1024 * 1024)
      const result = { type: 'message', id: 'r', parentId: 'a', timestamp: stamp, message: { role: 'toolResult', toolCallId: 'call', toolName: 'bash', content: [{ type: 'text', text: output }], isError: false } }
      const entries = [
        { type: 'session', version: 3, id: 'session', timestamp: stamp, cwd: '/work' },
        { type: 'message', id: 'u', parentId: null, timestamp: stamp, message: { role: 'user', content: '用户问题' } },
        { type: 'message', id: 'a', parentId: 'u', timestamp: stamp, message: { role: 'assistant', content: [
          { type: 'thinking', thinking: 'Readable reasoning', thinkingSignature: 's'.repeat(1024 * 1024) },
          { type: 'text', text: 'Readable answer' },
          { type: 'toolCall', id: 'call', name: 'bash', arguments: { command: 'echo example' } },
        ] } }, result,
        { type: 'session_info', id: 'name', parentId: 'r', timestamp: stamp, name: 'Named large session' },
      ]
      // CRLF 与 UTF-8 都必须保留准确字节偏移。
      const content = entries.map((entry) => JSON.stringify(entry)).join('\r\n') + '\r\n'
      await writeFile(file, content)
      await utimes(file, new Date(stamp), new Date(stamp))
      const first = await preparedSessionBody(file, 'session.jsonl', 'token', undefined, cache)
      const payload = decode(first.body)
      const prepared = payload.prepared!
      const original = buildSessionView(parseSessionJsonl(content, 'session.jsonl'))
      expect(first.stale).toBe(false)
      expect(prepared.events.map((event) => event.id)).toEqual(original.events.map((event) => event.id))
      expect(prepared.turns.flatMap((turn) => turn.eventIds)).toEqual(original.turns.flatMap((turn) => turn.events.map((event) => event.id)))
      expect(prepared.stats).toEqual(original.stats)
      expect(prepared.parsed.displayTitle).toBe('Named large session')
      expect(prepared.parsed.rawEntriesDeferred).toBe(true)
      expect(prepared.events.find((event) => event.kind === 'assistant')?.content).toBe('Readable answer')
      const deferred = prepared.events.find((event) => event.kind === 'tool-result')!
      expect(deferred.content).toBe('')
      expect(deferred.contentDeferred).toBe(true)
      expect(deferred.contentLength).toBe(output.length)
      expect(await readEventContent(file, 'session.jsonl', deferred.entryId, deferred.id)).toBe(output)
      expect(await indexedEntry(file, 'r', path.join(cache, 'entries'))).toEqual(result)
      expect((await preparedSessionBody(file, 'session.jsonl', 'token', undefined, cache)).body).toEqual(first.body)
      await appendFile(file, JSON.stringify({ type: 'message', id: 'next', parentId: 'name', timestamp: stamp, message: { role: 'user', content: 'Latest entry' } }) + '\n')
      await utimes(file, new Date(stamp), new Date('2026-01-01T00:01:00Z'))
      const stale = await preparedSessionBody(file, 'session.jsonl', 'token', undefined, cache)
      expect(stale.stale).toBe(true)
      expect(stale.body).toEqual(first.body)
      // 追加后已有记录的偏移仍有效，不必为了打开 Raw 扫描整个文件。
      expect(await indexedEntry(file, 'r', path.join(cache, 'entries'))).toEqual(result)
      const fresh = await preparedSessionBody(file, 'session.jsonl', 'token', undefined, cache, true)
      expect(decode(fresh.body).prepared!.events.some((event) => event.summary === 'Latest entry')).toBe(true)
      expect(fresh.stale).toBe(false)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
