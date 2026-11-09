import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Stats } from 'node:fs'
import { createLruCache } from '../core/lru-cache'
import type { RawObject } from '../core/types'
import { sessionNameCacheDirectory } from './session-name-index'

export type EntryOffsets = Record<string, [number, number]>
interface EntryIndex { identity: string; offsets: EntryOffsets }
const memory = createLruCache<EntryIndex>({ maxEntries: 4 })
const defaultRoot = () => path.join(sessionNameCacheDirectory(), 'views', 'entries')
function identity(stat: Stats) { return JSON.stringify([1, stat.dev, stat.ino, stat.birthtimeMs, stat.mtimeMs, stat.size]) }
function indexPath(file: string, root: string) { return path.join(root, createHash('sha256').update(file).digest('hex') + '.json') }

export async function saveEntryOffsets(file: string, stat: Stats, offsets: EntryOffsets, root = defaultRoot()): Promise<void> {
  const target = indexPath(file, root)
  const value = { identity: identity(stat), offsets }
  memory.set(target, value)
  try {
    await fs.mkdir(root, { recursive: true, mode: 0o700 })
    const temporary = `${target}.${randomUUID()}.tmp`
    await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 })
    await fs.rename(temporary, target)
  } catch { /* 可丢弃的派生索引；无法写缓存时仍能顺序读取原始文件。 */ }
}

export async function indexedEntry(file: string, id: string, root = defaultRoot()): Promise<RawObject | undefined> {
  try {
    const stat = await fs.stat(file)
    const target = indexPath(file, root)
    let index = memory.get(target)
    if (!index) {
      index = JSON.parse(await fs.readFile(target, 'utf8')) as EntryIndex
      memory.set(target, index)
    }
    // 追加不移动已有记录；仍用原始 ID 校验读到的字节，截断或替换则回退。
    const prior = JSON.parse(index.identity) as number[]
    const current = JSON.parse(identity(stat)) as number[]
    if (!prior.slice(0, 4).every((value, position) => value === current[position]) || prior[5] > stat.size) return undefined
    if (!Object.hasOwn(index.offsets, id)) return undefined
    const [offset, length] = index.offsets[id]
    if (![offset, length].every((value) => Number.isSafeInteger(value) && value >= 0) || offset + length > stat.size) return undefined
    const handle = await fs.open(file, 'r')
    try {
      const bytes = Buffer.alloc(length)
      const { bytesRead } = await handle.read(bytes, 0, length, offset)
      if (bytesRead !== length) return undefined
      const entry = JSON.parse(bytes.toString('utf8')) as RawObject
      return entry?.id === id ? entry : undefined
    } finally { await handle.close() }
  } catch { return undefined }
}


export function rememberEntryOffsets(file: string, stat: Stats, offsets: EntryOffsets): void {
  memory.set(indexPath(file, defaultRoot()), { identity: identity(stat), offsets })
}
