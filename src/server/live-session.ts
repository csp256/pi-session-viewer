import { randomUUID } from 'node:crypto'
import { promises as fs, type Stats } from 'node:fs'
import { appendSessionJsonl, parseSessionJsonl } from '../core/session-parser'
import { buildSessionView } from '../core/session-view'
import { diffPreparedSessions } from '../core/prepared-session-delta'
import type { ContextProjection, LiveSessionResponse, ParsedSession, PreparedSessionView } from '../core/types'
import { loadPiContextApi, computeLiveContextProjection } from './context-projection'
import { prepareSessionView } from './prepared-session'
import { readCompactSession, stripProviderSignatures } from './session-content'
import { rememberEntryOffsets, type EntryOffsets } from './session-entry-index'

const MAX_TAIL_BYTES = 16 * 1024 * 1024
const IDLE_MS = 30_000
interface LiveState {
  projection?: ContextProjection
  stat: Stats
  offset: number
  partial: boolean
  boundary: boolean
  offsets: EntryOffsets
  parsed: ParsedSession
  piEntries: unknown[]
  snapshot: PreparedSessionView
  cursor: string
  previous?: string
  delta?: LiveSessionResponse['delta']
  touched: number
  weight: number
}
function identity(stat: Stats) { return [stat.dev, stat.ino, stat.birthtimeMs, stat.mtimeMs, stat.size].join(':') }
function sameFile(a: Stats, b: Stats) { return a.dev === b.dev && a.ino === b.ino && a.birthtimeMs === b.birthtimeMs }

/** 每个 HTTP 服务独立管理；闲置超时或服务关闭后释放解析状态。 */
export function createLiveSessionReader() {
  const states = new Map<string, LiveState>()
  const jobs = new Map<string, Promise<LiveState>>()
  let disposed = false
  const prune = () => {
    const now = Date.now()
    for (const [key, state] of states) if (now - state.touched > IDLE_MS) states.delete(key)
  }
  const timer = setInterval(prune, IDLE_MS)
  timer.unref()

  async function update(absolute: string, relative: string, leaf: string | undefined, prior?: LiveState): Promise<LiveState> {
    const stat = await fs.stat(absolute)
    if (prior && sameFile(prior.stat, stat) && stat.size >= prior.offset
      && (stat.size > prior.offset || identity(stat) === identity(prior.stat))) {
      if (identity(stat) === identity(prior.stat) && (prior.partial || stat.size === prior.offset)) return prior
      const length = Math.min(MAX_TAIL_BYTES, stat.size - prior.offset)
      if (length === 0) { prior.stat = stat; return prior }
      const handle = await fs.open(absolute, 'r')
      let bytes: Buffer
      try {
        bytes = Buffer.alloc(length)
        const read = await handle.read(bytes, 0, length, prior.offset)
        bytes = bytes.subarray(0, read.bytesRead)
      } finally { await handle.close() }
      const after = await fs.stat(absolute)
      if (!sameFile(stat, after) || after.size < prior.offset + bytes.length) throw new Error('Session replaced while reading')
      if (!prior.boundary && bytes[0] !== 10 && !(bytes[0] === 13 && bytes[1] === 10)) {
        return update(absolute, relative, leaf)
      }
      const end = bytes.lastIndexOf(10) + 1
      if (end === 0 && length < MAX_TAIL_BYTES) { prior.stat = stat; prior.partial = true; return prior }
      if (end > 0) {
        const raw = bytes.subarray(0, end).toString('utf8')
        const lines: string[] = []
        let offset = prior.offset
        for (const line of raw.split('\n').slice(0, -1)) {
          const byteLength = Buffer.byteLength(line)
          let output = line
          try {
            const entry = JSON.parse(line)
            if (entry && typeof entry === 'object' && typeof entry.id === 'string' && !Object.hasOwn(prior.offsets, entry.id)) prior.offsets[entry.id] = [offset, byteLength]
            if (stripProviderSignatures(entry)) output = JSON.stringify(entry)
          } catch { /* 共享解析器报告完整但损坏的行。 */ }
          lines.push(output)
          offset += byteLength + 1
        }
        const content = lines.join('\n') + '\n'
        const parsed = appendSessionJsonl(prior.parsed, content)
        const api = await loadPiContextApi()
        const additional = api?.parseSessionEntries(content) ?? []
        const piEntries = [...prior.piEntries, ...additional]
        const leafId = leaf && parsed.branches.some((branch) => branch.leafId === leaf) ? leaf : parsed.currentLeafId
        const projection = await computeLiveContextProjection(piEntries, leafId)
        const snapshot = prepareSessionView(parsed, buildSessionView(parsed, leafId, projection), leafId)
        const next: LiveState = { ...prior, stat, offset, boundary: true, partial: end < bytes.length && length < MAX_TAIL_BYTES, parsed, piEntries, snapshot, projection,
          cursor: randomUUID(), previous: prior.cursor, weight: prior.weight + content.length * 3, delta: { ...diffPreparedSessions(prior.snapshot, snapshot, stat.mtime.toISOString()), contextProjection: projection }, touched: Date.now() }
        rememberEntryOffsets(absolute, stat, prior.offsets)
        return next
      }
      // 单条记录超过分块上限时使用完整快照，不能截断正文或错过记录。
    }
    const compact = await readCompactSession(absolute, undefined, true, true)
    const after = await fs.stat(absolute)
    if (!sameFile(stat, after) || after.size < compact.cursor) throw new Error('Session replaced while reading')
    const parsed = { ...parseSessionJsonl(compact.content, relative), sourceLineCount: compact.lineCount }
    const api = await loadPiContextApi()
    const piEntries = api?.parseSessionEntries(compact.content) ?? []
    const leafId = leaf && parsed.branches.some((branch) => branch.leafId === leaf) ? leaf : parsed.currentLeafId
    const projection = await computeLiveContextProjection(piEntries, leafId)
    rememberEntryOffsets(absolute, after, compact.offsets)
    return { stat: after, offset: compact.cursor, partial: compact.partial, boundary: compact.boundary, offsets: compact.offsets, parsed, piEntries, projection,
      snapshot: prepareSessionView(parsed, buildSessionView(parsed, leafId, projection), leafId), cursor: randomUUID(), touched: Date.now(),
      weight: compact.content.length * 3 }
  }

  return {
    async read(absolute: string, relative: string, token: string, leaf?: string, cursor?: string): Promise<LiveSessionResponse | null> {
      if (disposed) throw new Error('Live reader closed')
      prune()
      const key = `${absolute}\0${leaf ?? ''}`
      let job = jobs.get(key)
      if (!job) {
        const prior = states.get(key)
        job = update(absolute, relative, leaf, prior)
        jobs.set(key, job)
      }
      let state: LiveState
      try { state = await job } finally { if (jobs.get(key) === job) jobs.delete(key) }
      state.touched = Date.now()
      if (!disposed) {
        states.delete(key)
        states.set(key, state)
        let weight = [...states.values()].reduce((sum, value) => sum + value.weight, 0)
        while (states.size > 1 && (states.size > 2 || weight > 384 * 1024 * 1024)) {
          const oldest = states.keys().next().value!
          weight -= states.get(oldest)!.weight
          states.delete(oldest)
        }
      }
      if (cursor === state.cursor) return null
      if (cursor === state.previous && state.delta) return { cursor: state.cursor, delta: state.delta }
      return { cursor: state.cursor, snapshot: { token, relativePath: relative, modifiedAt: state.stat.mtime.toISOString(), content: '', prepared: state.snapshot, contextProjections: state.projection && state.snapshot.leafId ? { [state.snapshot.leafId]: state.projection } : undefined } }
    },
    dispose() { disposed = true; clearInterval(timer); states.clear() },
  }
}
