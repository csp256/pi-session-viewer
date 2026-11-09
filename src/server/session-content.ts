import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { indexedEntry, type EntryOffsets } from './session-entry-index'
import type { RawObject } from '../core/types'

function object(value: unknown): value is RawObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function* byteLines(file: string) {
  const stream = createReadStream(file)
  let remainder = Buffer.alloc(0)
  let offset = 0
  try {
    for await (const chunk of stream) {
      const bytes = remainder.length ? Buffer.concat([remainder, chunk as Buffer]) : chunk as Buffer
      let start = 0
      for (let end = bytes.indexOf(10, start); end !== -1; end = bytes.indexOf(10, start)) {
        yield { line: bytes.subarray(start, end).toString('utf8'), offset: offset + start, length: end - start }
        start = end + 1
      }
      offset += start
      remainder = Buffer.from(bytes.subarray(start))
    }
    if (remainder.length) yield { line: remainder.toString('utf8'), offset, length: remainder.length }
  } finally { stream.destroy() }
}

// 签名仅供提供方继续推理，不是可读内容；完整原始记录通过独立端点按需读取。
export async function readCompactSession(file: string, cancelled: () => boolean = () => false, indexEntries = false): Promise<{
  content: string; deferredRawEntryIds: string[]; offsets: EntryOffsets
}> {
  const content: string[] = []
  const offsets: EntryOffsets = Object.create(null)
  const deferredRawEntryIds: string[] = []
  for await (const { line, offset, length } of byteLines(file)) {
    if (cancelled()) throw new Error('Session request cancelled')
    let output = line
    if (indexEntries || line.includes('Signature')) {
      try {
        const entry: unknown = JSON.parse(line)
        if (indexEntries && object(entry) && typeof entry.id === 'string' && !Object.hasOwn(offsets, entry.id)) offsets[entry.id] = [offset, length]
        if (object(entry) && entry.type === 'message' && typeof entry.id === 'string'
          && object(entry.message) && entry.message.role === 'assistant' && Array.isArray(entry.message.content)) {
          let changed = false
          for (const block of entry.message.content) {
            if (!object(block)) continue
            for (const key of ['thinkingSignature', 'textSignature']) {
              if (Object.hasOwn(block, key)) { delete block[key]; changed = true }
            }
          }
          if (changed) { output = JSON.stringify(entry); deferredRawEntryIds.push(entry.id) }
        }
      } catch {
        // 损坏行保持原样，由共享解析器报告警告。
      }
    }
    content.push(output)
  }
  return { content: content.join('\n'), deferredRawEntryIds, offsets }
}

export async function readOriginalEntry(file: string, id: string, cancelled: () => boolean = () => false): Promise<RawObject | undefined> {
  const indexed = await indexedEntry(file, id)
  if (indexed) return indexed
  const stream = createReadStream(file)
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      if (cancelled()) return undefined
      try {
        const entry: unknown = JSON.parse(line)
        if (object(entry) && entry.id === id) return entry
      } catch { /* 损坏行不妨碍查找后续记录。 */ }
    }
    return undefined
  } finally {
    lines.close()
    stream.destroy()
  }
}
