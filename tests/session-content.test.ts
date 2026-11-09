import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readCompactSession, readOriginalEntry } from '../src/server/session-content'
import { computeContextProjections } from '../src/server/context-projection'

describe('轻量会话传输与完整原始记录', () => {
  it('只延后助手签名，保留文本、工具参数、用户数据和损坏行，Raw 仍完整', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'viewer-compact-'))
    try {
      const file = path.join(root, 'session.jsonl')
      const entries = [
        { type: 'session', version: 3, id: 's', timestamp: '2026-01-01T00:00:00Z', cwd: '/work' },
        { type: 'message', id: 'u', parentId: null, message: { role: 'user', content: [{ type: 'text', text: 'Keep text', thinkingSignature: 'user data' }] } },
        { type: 'message', id: 'a', parentId: 'u', message: { role: 'assistant', content: [
          { type: 'thinking', thinking: 'Readable reasoning', thinkingSignature: 's'.repeat(2 * 1024 * 1024) },
          { type: 'text', text: 'Readable answer', textSignature: 'signed text' },
          { type: 'toolCall', id: 'call', name: 'bash', arguments: { command: 'echo example' } },
        ] } },
      ]
      const content = entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n{invalid Signature\n'
      await writeFile(file, content)
      const compact = await readCompactSession(file)
      expect(compact.deferredRawEntryIds).toEqual(['a'])
      expect(compact.content.length).toBeLessThan(2000)
      const lines = compact.content.split('\n')
      expect(JSON.parse(lines[1])).toEqual(entries[1])
      expect(JSON.parse(lines[2]).message.content).toEqual([
        { type: 'thinking', thinking: 'Readable reasoning' },
        { type: 'text', text: 'Readable answer' },
        { type: 'toolCall', id: 'call', name: 'bash', arguments: { command: 'echo example' } },
      ])
      expect(compact.content).toContain('{invalid Signature')
      expect(await readOriginalEntry(file, 'a')).toEqual(entries[2])
      expect(await readOriginalEntry(file, 'missing')).toBeUndefined()
      expect(await readFile(file, 'utf8')).toBe(content)
      expect(await computeContextProjections(compact.content)).toEqual(await computeContextProjections(content))
      await expect(readCompactSession(file, () => true)).rejects.toThrow('cancelled')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
