import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { gzip } from 'node:zlib'
import { promisify } from 'node:util'
import { buildSessionView } from '../core/session-view'
import { getSessionTitle, parseSessionJsonl } from '../core/session-parser'
import type { CapturedToolDefinition, ParsedSession, PreparedSessionView, SessionFileResponse, SessionView, TimelineEvent } from '../core/types'
import { computeContextProjections } from './context-projection'
import { readCompactSession, readOriginalEntry } from './session-content'
import { sessionNameCacheDirectory } from './session-name-index'
import { saveEntryOffsets } from './session-entry-index'

const zip = promisify(gzip)
const VERSION = 1
const pending = new Map<string, Promise<Buffer>>()

// 一个会话分支只保留一个当前版本；压缩后的索引不包含大段工具输出或提供方签名。
export async function preparedSessionBody(absolute: string, relative: string, token: string, requestedLeaf?: string,
  cacheRoot = path.join(sessionNameCacheDirectory(), 'views'), fresh = false, afterVersion?: string): Promise<{ body: Buffer; stale: boolean }> {
  const stat = await fs.stat(absolute)
  const key = createHash('sha256').update(`${absolute}\0${requestedLeaf ?? ''}`).digest('hex')
  const identity = JSON.stringify([VERSION, stat.dev, stat.ino, stat.birthtimeMs, stat.mtimeMs, stat.size])
  const manifest = path.join(cacheRoot, `${key}.json`)
  let previous: { identity: string; body: string } | undefined
  try {
    previous = JSON.parse(await fs.readFile(manifest, 'utf8'))
    if (previous?.identity === identity && path.basename(previous.body) === previous.body) {
      return { body: await fs.readFile(path.join(cacheRoot, previous.body)), stale: false }
    }
    if (previous && path.basename(previous.body) === previous.body) {
      const prior = JSON.parse(previous.identity) as number[]
      const current = JSON.parse(identity) as number[]
      const appended = prior.slice(0, 4).every((value, index) => value === current[index]) && prior[5] <= stat.size
      if (fresh && afterVersion && appended && Math.floor(prior[4]) > Date.parse(afterVersion)) {
        return { body: await fs.readFile(path.join(cacheRoot, previous.body)), stale: false }
      }
      if (!fresh && appended) {
        const body = await fs.readFile(path.join(cacheRoot, previous.body))
        // 已有快照先显示；追加的新记录在后台构建，调用方可显式请求新版本。
        setImmediate(() => { void preparedSessionBody(absolute, relative, token, requestedLeaf, cacheRoot, true).catch(() => {}) })
        return { body, stale: true }
      }
    }
  } catch { /* 缓存缺失或失效时重新生成，不修改原始会话。 */ }
  const pendingKey = manifest
  const existing = pending.get(pendingKey)
  if (existing) return { body: await existing, stale: false }
  const job = (async () => {
    const compact = await readCompactSession(absolute, undefined, true)
    await saveEntryOffsets(absolute, stat, compact.offsets, path.join(cacheRoot, 'entries'))
    const parsed = parseSessionJsonl(compact.content, relative)
    const projections = await computeContextProjections(compact.content, relative)
    const leafId = requestedLeaf && parsed.branches.some((branch) => branch.leafId === requestedLeaf)
      ? requestedLeaf : parsed.currentLeafId
    const view = buildSessionView(parsed, leafId, leafId ? projections?.[leafId] : undefined)
    const payload: SessionFileResponse = {
      token, relativePath: relative, modifiedAt: stat.mtime.toISOString(), content: '', contextProjections: projections,
      prepared: prepareSessionView(parsed, view, leafId),
    }
    const body = await zip(JSON.stringify(payload), { level: 1 })
    // 索引是可丢弃的本地缓存，写入失败不影响本次读取。
    try {
      await fs.mkdir(cacheRoot, { recursive: true, mode: 0o700 })
      const bodyName = `${key}.${randomUUID()}.gz`
      await fs.writeFile(path.join(cacheRoot, bodyName), body, { mode: 0o600 })
      const temporary = `${manifest}.${randomUUID()}.tmp`
      await fs.writeFile(temporary, JSON.stringify({ identity, body: bodyName }), { mode: 0o600 })
      await fs.rename(temporary, manifest)
      if (previous?.body && path.basename(previous.body) === previous.body) await fs.unlink(path.join(cacheRoot, previous.body)).catch(() => {})
    } catch { /* 只读缓存目录也能直接提供生成结果。 */ }
    return body
  })()
  pending.set(pendingKey, job)
  try { return { body: await job, stale: false } } finally { pending.delete(pendingKey) }
}

export async function readEventContent(absolute: string, relative: string, entryId: string, eventId: string): Promise<string | undefined> {
  const raw = await readOriginalEntry(absolute, entryId)
  if (!raw) return undefined
  // 保留同一记录生成的全部事件，以精确匹配思考、文本或工具调用的事件 ID。
  const header = { type: 'session', version: 3, id: 'entry-preview', timestamp: '1970-01-01T00:00:00Z', cwd: '' }
  const parsed = parseSessionJsonl(`${JSON.stringify(header)}\n${JSON.stringify(raw)}`, relative)
  return buildSessionView(parsed).events.find((event) => event.id === eventId)?.content
}


export function prepareSessionView(parsed: ParsedSession, view: SessionView, leafId: string | null): PreparedSessionView {
  const definitions: CapturedToolDefinition[] = []
  const definitionIds = new Map<CapturedToolDefinition, number>()
  const events = view.events.map((event): TimelineEvent => {
    const { raw: _raw, toolDefinition, ...metadata } = event
    const defer = event.content.length > 256 && event.kind !== 'system-prompt' && event.kind !== 'tool-definitions'
      && event.kind !== 'user' && event.kind !== 'assistant' && event.kind !== 'thinking' && !event.contextEdit
    let toolDefinitionRef: number | undefined
    if (toolDefinition) {
      toolDefinitionRef = definitionIds.get(toolDefinition)
      if (toolDefinitionRef === undefined) {
        toolDefinitionRef = definitions.length
        definitions.push(toolDefinition)
        definitionIds.set(toolDefinition, toolDefinitionRef)
      }
    }
    return { ...metadata, raw: {}, content: defer ? '' : event.content, contentLength: event.content.length,
      ...(defer ? { contentDeferred: true } : {}), ...(toolDefinitionRef !== undefined ? { toolDefinitionRef } : {}) }
  })
  return {
    parsed: { ...parsed, entries: parsed.entries.filter((entry) => entry.type === 'session_info').slice(-1),
      displayTitle: getSessionTitle(parsed), rawEntriesDeferred: true },
    leafId, events, definitions, stats: view.stats,
    turns: view.turns.map(({ events: turnEvents, ...turn }) => ({ ...turn, eventIds: turnEvents.map((event) => event.id) })),
  }
}
