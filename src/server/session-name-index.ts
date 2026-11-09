import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createLruCache } from '../core/lru-cache'

const CHUNK_SIZE = 64 * 1024
const GUARD_SIZE = 128

interface IndexEntry {
  version: 1
  dev: number
  ino: number
  birthtimeMs: number
  size: number
  mtimeMs: number
  ctimeMs: number
  offset: number
  name: string | null
  displayName: string | null
  guard: string
}

export interface NameLookup {
  name: string | undefined
  /** 会话文件实际读取字节数，包括追加验证用的固定大小指纹。 */
  bytesRead: number
}

export function sessionNameCacheDirectory(): string {
  if (process.env.PI_SESSION_VIEWER_CACHE_DIR) return path.resolve(process.env.PI_SESSION_VIEWER_CACHE_DIR)
  const agentDir = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), '.pi', 'agent')
  return path.join(agentDir, 'cache', 'pi-session-viewer', 'session-names')
}

function validEntry(value: unknown): value is IndexEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as IndexEntry
  return entry.version === 1
    && ['dev', 'ino', 'birthtimeMs', 'size', 'mtimeMs', 'ctimeMs', 'offset'].every((key) => {
      const field = entry[key as keyof IndexEntry]
      return typeof field === 'number' && Number.isFinite(field) && field >= 0
    })
    && Number.isSafeInteger(entry.size) && Number.isSafeInteger(entry.offset) && entry.offset <= entry.size
    && (entry.name === null || typeof entry.name === 'string')
    && (entry.displayName === null || typeof entry.displayName === 'string')
    && typeof entry.guard === 'string' && /^[a-f0-9]{64}$/.test(entry.guard)
}

async function fingerprint(handle: FileHandle, size: number): Promise<{ guard: string; bytesRead: number }> {
  const hash = createHash('sha256')
  let bytesRead = 0
  for (const start of [0, Math.max(0, size - GUARD_SIZE)]) {
    const buffer = Buffer.alloc(Math.min(GUARD_SIZE, size))
    const result = await handle.read(buffer, 0, buffer.length, start)
    bytesRead += result.bytesRead
    hash.update(buffer.subarray(0, result.bytesRead))
  }
  return { guard: hash.digest('hex'), bytesRead }
}

// 按字节记录完整行边界，未写完的行下次重新读取；UTF-8 只在整行齐全后解码。
async function scan(handle: FileHandle, start: number, end: number, initialName: string | null) {
  let name = initialName
  let offset = start
  let position = start
  let bytesRead = 0
  let parts: Buffer[] = []
  let prefix = ''
  let skip = false
  let classified = false

  const add = (part: Buffer) => {
    if (skip) return
    if (!classified) {
      prefix = (prefix + part.subarray(0, 1024).toString('utf8')).slice(0, 1024)
      const type = prefix.match(/^\s*\{\s*"type"\s*:\s*"([^"]+)"/)
      if (type) {
        classified = true
        skip = type[1] !== 'session_info'
      } else if (prefix.length >= 1024) classified = true
      // Pi 把 type 写在行首；巨大工具结果可直接跳过，不保留整行。
      if (skip) { parts = []; return }
    }
    parts.push(part)
  }
  const candidateName = (): string | null => {
    if (skip || !parts.length) return name
    const line = Buffer.concat(parts).toString('utf8')
    if (!line.includes('session_info')) return name
    try {
      const entry = JSON.parse(line)
      if (entry?.type === 'session_info' && typeof entry.name === 'string' && entry.name) return entry.name
    } catch {
      // 损坏或尚未写完的行不影响已知名称。
    }
    return name
  }

  while (position < end) {
    const buffer = Buffer.allocUnsafe(Math.min(CHUNK_SIZE, end - position))
    const read = await handle.read(buffer, 0, buffer.length, position)
    if (!read.bytesRead) break
    bytesRead += read.bytesRead
    const chunk = buffer.subarray(0, read.bytesRead)
    let from = 0
    for (let newline = chunk.indexOf(10, from); newline !== -1; newline = chunk.indexOf(10, from)) {
      add(chunk.subarray(from, newline))
      name = candidateName()
      offset = position + newline + 1
      parts = []; prefix = ''; skip = false; classified = false
      from = newline + 1
    }
    if (from < chunk.length) add(chunk.subarray(from))
    position += read.bytesRead
  }
  return { name, displayName: candidateName(), offset, bytesRead }
}

export function createSessionNameIndex(cacheDirectory?: string) {
  const memory = createLruCache<IndexEntry>({ maxEntries: 4096 })
  const pending = new Map<string, Promise<NameLookup>>()

  async function lookup(filePath: string): Promise<NameLookup> {
    const cacheDir = cacheDirectory ?? sessionNameCacheDirectory()
    const cachePath = path.join(cacheDir, `${createHash('sha256').update(filePath).digest('hex')}.json`)
    let previous = memory.get(filePath)
    if (!previous) {
      try {
        const entry: unknown = JSON.parse(await fs.readFile(cachePath, 'utf8'))
        if (validEntry(entry)) previous = entry
      } catch {
        // 索引缺失、损坏或不可读时重新扫描，索引不是会话的权威来源。
      }
    }
    const handle = await fs.open(filePath, 'r')
    try {
      const stat = await handle.stat()
      const sameFile = previous && previous.dev === stat.dev && previous.ino === stat.ino && previous.birthtimeMs === stat.birthtimeMs
      if (previous && sameFile && previous.size === stat.size && previous.mtimeMs === stat.mtimeMs && previous.ctimeMs === stat.ctimeMs) {
        memory.set(filePath, previous)
        return { name: previous.displayName ?? undefined, bytesRead: 0 }
      }
      let start = 0
      let name: string | null = null
      let bytesRead = 0
      if (previous && sameFile && stat.size > previous.size) {
        const guard = await fingerprint(handle, previous.size)
        bytesRead += guard.bytesRead
        if (guard.guard === previous.guard) {
          start = previous.offset
          name = previous.name
        }
      }
      const result = await scan(handle, start, stat.size, name)
      bytesRead += result.bytesRead
      const guard = await fingerprint(handle, stat.size)
      bytesRead += guard.bytesRead
      const after = await handle.stat()
      // 扫描期间变化的文件留到下次重新验证，避免持久化不一致的检查点。
      if (after.size === stat.size && after.mtimeMs === stat.mtimeMs && after.ctimeMs === stat.ctimeMs) {
        const entry: IndexEntry = {
          version: 1, dev: stat.dev, ino: stat.ino, birthtimeMs: stat.birthtimeMs,
          size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs,
          offset: result.offset, name: result.name, displayName: result.displayName, guard: guard.guard,
        }
        memory.set(filePath, entry)
        const temporary = `${cachePath}.${process.pid}.${randomUUID()}.tmp`
        try {
          await fs.mkdir(cacheDir, { recursive: true, mode: 0o700 })
          await fs.writeFile(temporary, JSON.stringify(entry), { mode: 0o600 })
          await fs.rename(temporary, cachePath)
        } catch {
          // 不可写的索引目录不妨碍发现名称；当前进程仍可使用内存缓存。
        } finally {
          await fs.rm(temporary, { force: true }).catch(() => {})
        }
      }
      return { name: result.displayName ?? undefined, bytesRead }
    } finally {
      await handle.close()
    }
  }

  return {
    lookup(filePath: string): Promise<NameLookup> {
      const key = path.resolve(filePath)
      const existing = pending.get(key)
      if (existing) return existing
      const result = lookup(key).finally(() => pending.delete(key))
      pending.set(key, result)
      return result
    },
  }
}
