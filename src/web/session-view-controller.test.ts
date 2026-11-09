import { describe, expect, it, vi } from 'vitest'
import { defaultEventKinds } from '../core/event-kinds'
import { parseSessionJsonl } from '../core/session-parser'
import { decodeSessionToken, encodeSessionToken } from '../core/session-token'
import type { ContextProjection, SessionFileResponse, SessionListItem, SessionListResponse } from '../core/types'
import { createSessionCache, sessionCacheKey } from './session-cache'
import { createSessionViewController, type SessionViewController } from './session-view-controller'

const HEADER = JSON.stringify({
  type: 'session',
  version: 3,
  id: 'session-1',
  timestamp: '2026-01-01T00:00:00.000Z',
  cwd: '/work/demo',
})

function content(text: string, id = 'user-1'): string {
  return [
    HEADER,
    JSON.stringify({
      type: 'message',
      id,
      parentId: null,
      timestamp: '2026-01-01T00:00:01.000Z',
      message: { role: 'user', timestamp: 1, content: text },
    }),
  ].join('\n')
}

function forkedContent(includeA = true, includeB = true): string {
  const entries: unknown[] = [
    JSON.parse(HEADER),
    { type: 'message', id: 'user-1', parentId: null, timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', timestamp: 1, content: 'Choose a branch' } },
  ]
  if (includeA) {
    entries.push({ type: 'message', id: 'assistant-a', parentId: 'user-1', timestamp: '2026-01-01T00:00:02.000Z', message: { role: 'assistant', timestamp: 2, content: [{ type: 'text', text: 'Branch A' }] } })
  }
  if (includeB) {
    entries.push({ type: 'message', id: 'assistant-b', parentId: 'user-1', timestamp: '2026-01-01T00:00:03.000Z', message: { role: 'assistant', timestamp: 3, content: [{ type: 'text', text: 'Branch B' }] } })
  }
  return entries.map((entry) => JSON.stringify(entry)).join('\n')
}

function session(token: string, modifiedAt = 'm1', relativePath = `${token}.jsonl`): SessionListItem {
  return {
    token,
    id: token,
    title: `Session ${token}`,
    cwd: '/work/demo',
    modifiedAt,
    relativePath,
  }
}

function payload(token: string, body: string, modifiedAt = 'm1', relativePath = `${token}.jsonl`): SessionFileResponse {
  return { token, modifiedAt, relativePath, content: body }
}

function catalog(sessions: SessionListItem[] = []): SessionListResponse {
  return { root: '/sessions', currentCwd: '/work/demo', projects: [], sessions, warnings: [] }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function createController(
  readServerSession: (token: string, signal?: AbortSignal, leafId?: string, fresh?: boolean, afterVersion?: string) => Promise<SessionFileResponse>,
  options: {
    resolveSubagent?: (targetFile: string, parentRelative?: string) => Promise<SessionFileResponse>
    cache?: ReturnType<typeof createSessionCache>
    readContext?: (token: string, signal?: AbortSignal) => Promise<Record<string, ContextProjection> | null>
    readImportedFile?: (file: unknown) => Promise<string>
    refreshCatalog?: () => Promise<SessionListResponse | null>
    parseSession?: typeof parseSessionJsonl
    initialCwd?: string | null
    initialCatalogLoading?: boolean
  } = {},
): SessionViewController<unknown> {
  return createSessionViewController<unknown>({
    readServerSession,
    readContext: options.readContext,
    resolveSubagent: options.resolveSubagent ?? (async (targetFile) => readServerSession(encodeSessionToken(targetFile))),
    readImportedFile: async (source) => options.readImportedFile
      ? options.readImportedFile(source.file)
      : String(source.file),
    refreshCatalog: options.refreshCatalog ?? (async () => catalog()),
    cache: options.cache ?? createSessionCache(),
    parseSession: options.parseSession ?? parseSessionJsonl,
    now: () => '2026-01-01T00:00:02.000Z',
    initialCwd: options.initialCwd,
    initialCatalogLoading: options.initialCatalogLoading,
  })
}

describe('Session View controller', () => {
  it('从完整会话修正缺失的目录名称，并在目录刷新及切换后保留', async () => {
    const named = content('First request') + '\n' + JSON.stringify({
      type: 'session_info', id: 'name', parentId: 'user-1', name: 'Saved session name',
    })
    const alpha = session('alpha')
    const beta = session('beta')
    const read = vi.fn(async (token: string) => payload(token, token === 'alpha' ? named : content('Beta request')))
    const controller = createController(read, { refreshCatalog: async () => catalog([alpha, beta]) })
    await controller.dispatch({ type: 'load-catalog', autoOpen: true })
    expect(controller.getSnapshot().sessionTitle).toBe('Saved session name')
    expect(controller.getSnapshot().active?.metadata).toMatchObject({ name: 'Saved session name', title: 'Saved session name' })
    expect(controller.getSnapshot().catalog.sessions[0]).toMatchObject({ name: 'Saved session name', title: 'Saved session name' })

    await controller.dispatch({ type: 'refresh' })
    expect(read).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot().active?.metadata?.name).toBe('Saved session name')
    await controller.dispatch({ type: 'open', session: beta })
    await controller.dispatch({ type: 'refresh' })
    expect(controller.getSnapshot().catalog.sessions[0]?.name).toBe('Saved session name')
    expect(controller.getSnapshot().catalog.sessions[1]?.name).toBeUndefined()
  })

  it('从完整缓存修正旧名称，但不会用旧版本名称覆盖新版本', async () => {
    const cache = createSessionCache()
    const named = (name: string) => content('First request') + '\n' + JSON.stringify({
      type: 'session_info', id: 'name', parentId: 'user-1', name,
    })
    const old = named('Cached saved name')
    cache.remember(sessionCacheKey('alpha', 'm1'), {
      token: 'alpha', modifiedAt: 'm1', content: old, parsed: parseSessionJsonl(old), contextProjections: null,
    })
    let listed = { ...session('alpha'), name: 'Stale catalog name' }
    const read = vi.fn(async (token: string) => payload(token, named('New saved name'), 'm2'))
    const controller = createController(read, { cache, refreshCatalog: async () => catalog([listed]) })
    await controller.dispatch({ type: 'load-catalog', autoOpen: true })
    expect(read).not.toHaveBeenCalled()
    expect(controller.getSnapshot().catalog.sessions[0]?.name).toBe('Cached saved name')
    expect(controller.getSnapshot().active?.metadata?.name).toBe('Cached saved name')

    listed = { ...listed, modifiedAt: 'm2', name: 'New catalog name' }
    await controller.dispatch({ type: 'refresh' })
    expect(read).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot().catalog.sessions[0]?.name).toBe('New saved name')
    expect(controller.getSnapshot().active?.metadata?.name).toBe('New saved name')
  })

  it('opens a server Session and commits a complete initial view', async () => {
    const controller = createController(async (token) => payload(token, content('Alpha request'), 'm1', 'alpha.jsonl'))

    await controller.dispatch({ type: 'open', session: session('alpha') })

    const snapshot = controller.getSnapshot()
    expect(snapshot.loading).toBe(false)
    expect(snapshot.active?.metadata?.token).toBe('alpha')
    expect(snapshot.active?.parsed.header?.id).toBe('session-1')
    expect(snapshot.view?.events.find((event) => event.id === 'user-1:user')?.summary).toBe('Alpha request')
    expect(snapshot.selectedLeafId).toBe('user-1')
    expect(snapshot.selectedEventId).toBe('missing-system-prompt:user-1')
    expect(snapshot.sessionTitle).toBe('Alpha request')
    expect(snapshot.selectedEvent?.id).toBe('missing-system-prompt:user-1')
    expect(snapshot.visibleTurns.length).toBeGreaterThan(0)
    expect(snapshot.loadError).toBe(null)
  })

  it('jumps to entry by finding its primary event', async () => {
    const controller = createController(async (token) => payload(token, content('Alpha request')))
    await controller.dispatch({ type: 'open', session: session('alpha') })
    await controller.dispatch({ type: 'jump-to-entry', entryId: 'user-1' })
    expect(controller.getSnapshot().selectedEventId).toBe('user-1:user')
  })

  it('默认只启用用户与 Pi 回复，并在打开会话时保持筛选', async () => {
    const controller = createController(async (token) => payload(token, content('Alpha request')))

    expect([...controller.getSnapshot().enabledKinds].sort()).toEqual(['assistant', 'user'])
    expect(controller.getSnapshot().enabledKinds.has('system')).toBe(false)

    await controller.dispatch({ type: 'open', session: session('alpha') })

    expect([...controller.getSnapshot().enabledKinds].sort()).toEqual(['assistant', 'user'])
    expect(controller.getSnapshot().visibleTurns.flatMap((turn) => turn.events).every(
      (event) => event.kind === 'user' || event.kind === 'assistant',
    )).toBe(true)
  })

  it('uses the exact cached version without reading or parsing it again', async () => {
    const cache = createSessionCache()
    const parsed = parseSessionJsonl(content('Cached response'), 'alpha.jsonl')
    cache.remember(sessionCacheKey('alpha', 'm1'), {
      token: 'alpha', modifiedAt: 'm1', content: content('Cached response'), parsed, contextProjections: null,
    })
    const read = vi.fn(async () => { throw new Error('should not read a cached Session') })
    const parse = vi.fn(parseSessionJsonl)
    const controller = createController(read, { cache, parseSession: parse })

    await controller.dispatch({ type: 'open', session: session('alpha') })

    expect(read).not.toHaveBeenCalled()
    expect(parse).not.toHaveBeenCalled()
    expect(controller.getSnapshot().active?.parsed).toBe(parsed)
  })

  it('keeps the committed Session while opening and lets only the newest open finish', async () => {
    const slow = deferred<SessionFileResponse>()
    const read = vi.fn((token: string) => token === 'slow' ? slow.promise : Promise.resolve(payload(token, content('Latest request'))))
    const controller = createController(read)
    await controller.dispatch({ type: 'open', session: session('existing') })

    const earlierOpen = controller.dispatch({ type: 'open', session: session('slow') })
    expect(controller.getSnapshot().loading).toBe(true)
    expect(controller.getSnapshot().active?.token).toBe('existing')
    await controller.dispatch({ type: 'open', session: session('latest') })
    slow.resolve(payload('slow', content('Stale response')))
    await earlierOpen

    expect(controller.getSnapshot().active?.token).toBe('latest')
    expect(controller.getSnapshot().view?.events.find((event) => event.id === 'user-1:user')?.summary).toBe('Latest request')
    expect(controller.getSnapshot().loading).toBe(false)
  })

  it('ignores stale request failures and keeps ordinary timeline actions from canceling a load', async () => {
    const slow = deferred<SessionFileResponse>()
    const controller = createController((token) => token === 'slow' ? slow.promise : Promise.resolve(payload(token, forkedContent())))
    await controller.dispatch({ type: 'open', session: session('existing') })
    const earlierOpen = controller.dispatch({ type: 'open', session: session('slow') })

    await controller.dispatch({ type: 'toggle-event-kind', kind: 'user' })
    await controller.dispatch({ type: 'select-event', eventId: 'missing-system-prompt:user-1' })
    expect(controller.getSnapshot().loading).toBe(true)
    expect(controller.getSnapshot().enabledKinds.has('user')).toBe(false)
    await controller.dispatch({ type: 'open', session: session('winner') })
    slow.reject(new Error('late network failure'))
    await earlierOpen

    expect(controller.getSnapshot().active?.token).toBe('winner')
    expect(controller.getSnapshot().loadError).toBe(null)
    expect(controller.getSnapshot().enabledKinds.has('user')).toBe(false)
  })

  it('lets a newer Session open supersede a pending refresh', async () => {
    const catalogResponse = deferred<SessionListResponse | null>()
    const read = vi.fn(async (token: string) => payload(token, content(`${token} body`), token === 'alpha' ? 'm1' : 'm1'))
    const controller = createController(read, { refreshCatalog: () => catalogResponse.promise })
    await controller.dispatch({ type: 'open', session: session('alpha') })
    const pendingRefresh = controller.dispatch({ type: 'refresh' })
    await controller.dispatch({ type: 'open', session: session('beta') })
    catalogResponse.resolve(catalog([session('alpha', 'm2')]))
    await pendingRefresh

    expect(controller.getSnapshot().active?.token).toBe('beta')
    expect(read.mock.calls.map(([token]) => token)).toEqual(['alpha', 'beta'])
    expect(controller.getSnapshot().loadError).toBe(null)
  })

  it('refreshes the Catalog without fetching an unchanged Session body', async () => {
    let listed = session('alpha', 'm1')
    const read = vi.fn(async (token: string) => payload(token, content('Alpha request'), 'm1'))
    const controller = createController(read, { refreshCatalog: async () => catalog([listed]) })
    await controller.dispatch({ type: 'open', session: session('alpha') })
    listed = { ...listed, title: 'Updated title' }

    await controller.dispatch({ type: 'refresh' })

    expect(read).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot().active?.metadata?.title).toBe('Updated title')
    expect(controller.getSnapshot().view?.events.find((event) => event.id === 'user-1:user')?.summary).toBe('Alpha request')
  })

  it('replaces a changed Session only after reading it and reconciles branch and event identifiers', async () => {
    let listed = session('alpha', 'm1', 'project/alpha.jsonl')
    const read = vi.fn(async (_token: string) => payload('alpha', forkedContent(), 'm1', 'project/alpha.jsonl'))
    const controller = createController(read, { refreshCatalog: async () => catalog([listed]) })
    await controller.dispatch({ type: 'open', session: listed })
    const branchA = controller.getSnapshot().active!.parsed.branches.find((branch) => branch.leafId === 'assistant-a')!
    await controller.dispatch({ type: 'select-branch', leafId: branchA.leafId })
    await controller.dispatch({ type: 'select-event', eventId: 'assistant-a:assistant:0' })
    await controller.dispatch({ type: 'ensure-event-kind', kind: 'thinking' })
    await controller.dispatch({ type: 'toggle-event-kind', kind: 'thinking' })

    listed = { ...listed, modifiedAt: 'm2', title: 'Changed Session' }
    read.mockImplementation(async () => payload('alpha', forkedContent(false, true), 'm2', 'project/alpha.jsonl'))
    await controller.dispatch({ type: 'refresh', viewport: { scrollTop: 420, anchor: { eventId: 'assistant-a:assistant:0', offset: 8 } } })

    const snapshot = controller.getSnapshot()
    expect(read).toHaveBeenCalledTimes(2)
    expect(snapshot.active?.metadata?.modifiedAt).toBe('m2')
    expect(snapshot.selectedLeafId).toBe('assistant-b')
    expect(snapshot.selectedEventId).toBe('missing-system-prompt:user-1')
    expect(snapshot.enabledKinds.has('thinking')).toBe(false)
    expect(snapshot.restoreIntent?.scrollTop).toBe(420)
    expect(snapshot.restoreIntent?.anchor?.eventId).toBe('assistant-a:assistant:0')
  })

  it('keeps the current view when a top-level open fails', async () => {
    const controller = createController(async (token) => {
      if (token === 'bad') throw new Error('network unavailable')
      return payload(token, content('Existing view'))
    })
    await controller.dispatch({ type: 'open', session: session('good') })

    await controller.dispatch({ type: 'open', session: session('bad') })

    expect(controller.getSnapshot().active?.token).toBe('good')
    expect(controller.getSnapshot().loadError).toEqual({ code: 'operation-failed' })
  })

  it('imports and refreshes a local Session through its retained file source', async () => {
    let contents = content('Imported version 1')
    let reads = 0
    const controller = createController(async (token) => payload(token, content('Child session')), {
      readImportedFile: async () => { reads += 1; return contents },
    })
    const source = { name: 'local.jsonl', file: { identity: 'file-1' } }

    await controller.dispatch({ type: 'import', source })
    contents = content('Imported version 2')
    await controller.dispatch({ type: 'refresh' })

    expect(reads).toBe(2)
    expect(controller.getSnapshot().active?.source.kind).toBe('file')
    expect(controller.getSnapshot().view?.events.find((event) => event.id === 'user-1:user')?.summary).toBe('Imported version 2')
    expect(controller.getSnapshot().enabledKinds.size).toBe(defaultEventKinds.length)
    expect(controller.getSnapshot().enabledKinds.has('system')).toBe(false)
  })

  it('reveals an explicitly jumped event kind and keeps branch selection independent from filters', async () => {
    const controller = createController(async (token) => payload(token, forkedContent()))
    await controller.dispatch({ type: 'open', session: session('alpha') })
    await controller.dispatch({ type: 'toggle-event-kind', kind: 'assistant' })
    await controller.dispatch({ type: 'select-branch', leafId: 'assistant-a' })
    await controller.dispatch({ type: 'select-event', eventId: 'assistant-a:assistant:0' })

    expect(controller.getSnapshot().selectedEventId).toBe('assistant-a:assistant:0')
    expect(controller.getSnapshot().enabledKinds.has('assistant')).toBe(false)

    await controller.dispatch({ type: 'jump-to-event', eventId: 'assistant-a:assistant:0' })

    expect(controller.getSnapshot().selectedEventId).toBe('assistant-a:assistant:0')
    expect(controller.getSnapshot().enabledKinds.has('assistant')).toBe(true)
    expect(controller.getSnapshot().restoreIntent?.eventId).toBe('assistant-a:assistant:0')
    expect(controller.getSnapshot().restoreIntent?.revealEventKind).toBe(true)

    await controller.dispatch({ type: 'ensure-event-kind', kind: 'system-prompt' })
    await controller.dispatch({ type: 'toggle-event-kind', kind: 'system-prompt' })
    await controller.dispatch({ type: 'select-branch', leafId: 'assistant-b' })
    expect(controller.getSnapshot().selectedEventId).toBe('missing-system-prompt:user-1')
    expect(controller.getSnapshot().enabledKinds.has('system-prompt')).toBe(false)
    expect(controller.getSnapshot().restoreIntent?.revealEventKind).toBe(false)
  })

  it('preserves a Selected event shared by both branches', async () => {
    const controller = createController(async (token) => payload(token, forkedContent()))
    await controller.dispatch({ type: 'open', session: session('alpha') })
    await controller.dispatch({ type: 'select-branch', leafId: 'assistant-a' })
    await controller.dispatch({ type: 'select-event', eventId: 'user-1:user' })
    await controller.dispatch({ type: 'select-branch', leafId: 'assistant-b' })

    expect(controller.getSnapshot().selectedEventId).toBe('user-1:user')
    expect(controller.getSnapshot().selectedLeafId).toBe('assistant-b')
  })

  it('selects the branch Context Projection and persists filters across Session changes', async () => {
    const projections = {
      'assistant-a': { leafId: 'assistant-a', messageCount: 2, contextEntryCount: 2, excluded: {} },
      'assistant-b': { leafId: 'assistant-b', messageCount: 3, contextEntryCount: 3, excluded: {} },
    }
    const controller = createController(async (token) => ({ ...payload(token, forkedContent()), contextProjections: projections }))
    await controller.dispatch({ type: 'ensure-event-kind', kind: 'thinking' })
    await controller.dispatch({ type: 'toggle-event-kind', kind: 'thinking' })
    await controller.dispatch({ type: 'open', session: session('alpha') })
    await controller.dispatch({ type: 'select-branch', leafId: 'assistant-a' })

    expect(controller.getSnapshot().contextProjection?.messageCount).toBe(2)
    expect(controller.getSnapshot().enabledKinds.has('thinking')).toBe(false)
  })

  it('prefers a runnable subagent Session and records a lightweight return frame', async () => {
    const parentPath = 'project/alpha.jsonl'
    const runId = '01234567-89ab-cdef-0123-456789abcdef'
    const transcriptPath = `project/subagent-artifacts/${runId}_agent_transcript.jsonl`
    const runnablePath = `project/alpha/${runId}/run-0/session.jsonl`
    const resolveCalls: Array<{ targetFile: string; parentRelative?: string }> = []
    const controller = createController(async (token) => {
      const path = decodeSessionToken(token)
      if (path === parentPath) return payload(token, content('Parent session'), 'parent-v1', parentPath)
      throw new Error(`missing ${path}`)
    }, {
      resolveSubagent: async (targetFile, parentRelative) => {
        resolveCalls.push({ targetFile, parentRelative })
        return payload(encodeSessionToken(runnablePath), content('Runnable child'), 'child-v1', runnablePath)
      },
    })
    await controller.dispatch({ type: 'open', session: session(encodeSessionToken(parentPath), 'parent-v1', parentPath) })
    await controller.dispatch({
      type: 'open-subagent',
      reference: { targetFile: transcriptPath, token: encodeSessionToken(transcriptPath), agentName: 'Review' },
      sourceEventId: 'user-1:user',
      viewport: { scrollTop: 260, anchor: { eventId: 'user-1:user', offset: 12 } },
    })

    expect(resolveCalls).toEqual([{ targetFile: transcriptPath, parentRelative: parentPath }])
    expect(controller.getSnapshot().active?.metadata?.relativePath).toBe(runnablePath)
    expect(controller.getSnapshot().navigation).toHaveLength(1)
    expect(controller.getSnapshot().navigation[0]).not.toHaveProperty('parsed')
    expect(controller.getSnapshot().navigation[0]).not.toHaveProperty('content')
    expect(controller.getSnapshot().navigation[0]?.selectedEventId).toBe('missing-system-prompt:user-1')
  })

  it('rejects a transcript mirror as a Session and preserves the active view with an Action Error', async () => {
    const runId = '01234567-89ab-cdef-0123-456789abcdef'
    const transcriptPath = `project/subagent-artifacts/${runId}_agent_transcript.jsonl`
    const controller = createController(async (token) => {
      const path = decodeSessionToken(token)
      if (path === 'project/alpha.jsonl') return payload(token, content('Parent session'), 'm1', path)
      throw new Error(`missing ${path}`)
    }, {
      resolveSubagent: async () => {
        throw { code: 'subagent-transcript-only' }
      },
    })
    await controller.dispatch({ type: 'open', session: session(encodeSessionToken('project/alpha.jsonl'), 'm1', 'project/alpha.jsonl') })
    const parent = controller.getSnapshot().active
    await controller.dispatch({
      type: 'open-subagent',
      reference: { targetFile: transcriptPath, token: encodeSessionToken(transcriptPath) },
    })

    expect(controller.getSnapshot().active).toBe(parent)
    expect(controller.getSnapshot().loadError).toBe(null)
    expect(controller.getSnapshot().actionError).toEqual({ code: 'subagent-transcript-only' })
    await controller.dispatch({ type: 'dismiss-action-error' })
    expect(controller.getSnapshot().actionError).toBe(null)
  })

  it('lets a newer Session open supersede a pending subagent jump', async () => {
    const parentPath = 'project/alpha.jsonl'
    const childPath = 'project/alpha/run-123/run-0/session.jsonl'
    const child = deferred<SessionFileResponse>()
    const controller = createController(async (token) => {
      const path = decodeSessionToken(token)
      if (path === parentPath) return payload(token, content('Parent'), 'm1', parentPath)
      return payload(token, content('New choice'), 'm1', path)
    }, {
      resolveSubagent: async () => child.promise,
    })
    await controller.dispatch({ type: 'open', session: session(encodeSessionToken(parentPath), 'm1', parentPath) })
    const pendingJump = controller.dispatch({
      type: 'open-subagent',
      reference: { targetFile: childPath, token: encodeSessionToken(childPath) },
    })
    await controller.dispatch({ type: 'open', session: session('latest') })
    child.resolve(payload(encodeSessionToken(childPath), content('Late child'), 'child-v1', childPath))
    await pendingJump

    expect(controller.getSnapshot().active?.token).toBe('latest')
    expect(controller.getSnapshot().navigation).toHaveLength(0)
    expect(controller.getSnapshot().actionError).toBe(null)
  })

  it('returns to the exact cached parent branch and event with global filters preserved', async () => {
    const parentPath = 'project/alpha.jsonl'
    const childPath = 'project/alpha/run-123/run-0/session.jsonl'
    const read = vi.fn(async (token: string) => {
      const path = decodeSessionToken(token)
      if (path === parentPath) return payload(token, forkedContent(), 'parent-v1', parentPath)
      return payload(token, content('Child session'), 'child-v1', childPath)
    })
    const controller = createController(read)
    await controller.dispatch({ type: 'open', session: session(encodeSessionToken(parentPath), 'parent-v1', parentPath) })
    await controller.dispatch({ type: 'select-branch', leafId: 'assistant-a' })
    await controller.dispatch({ type: 'select-event', eventId: 'assistant-a:assistant:0' })
    await controller.dispatch({ type: 'ensure-event-kind', kind: 'thinking' })
    await controller.dispatch({ type: 'toggle-event-kind', kind: 'thinking' })
    await controller.dispatch({
      type: 'open-subagent',
      reference: { targetFile: childPath, token: encodeSessionToken(childPath) },
      viewport: { scrollTop: 540, anchor: { eventId: 'assistant-a:assistant:0', offset: 16 } },
    })
    const parentReads = read.mock.calls.filter(([token]) => decodeSessionToken(token) === parentPath).length

    await controller.dispatch({ type: 'return-to-parent' })

    const snapshot = controller.getSnapshot()
    const finalParentReads = read.mock.calls.filter(([token]) => decodeSessionToken(token) === parentPath).length
    expect(finalParentReads).toBe(parentReads)
    expect(snapshot.active?.source).toEqual({ kind: 'server', token: encodeSessionToken(parentPath), modifiedAt: 'parent-v1' })
    expect(snapshot.selectedLeafId).toBe('assistant-a')
    expect(snapshot.selectedEventId).toBe('assistant-a:assistant:0')
    expect(snapshot.enabledKinds.has('thinking')).toBe(false)
    expect(snapshot.restoreIntent?.anchor).toEqual({ eventId: 'assistant-a:assistant:0', offset: 16 })
    expect(snapshot.restoreIntent?.scrollTop).toBe(540)
  })

  it('loads the latest parent version on a cache miss and falls back when saved branch and anchor disappeared', async () => {
    const parentPath = 'project/alpha.jsonl'
    const childPath = 'project/alpha/run-123/run-0/session.jsonl'
    const cache = createSessionCache({ maxEntries: 1, maxBytes: 1_000_000 })
    const read = vi.fn(async (token: string) => {
      const path = decodeSessionToken(token)
      if (path === childPath) return payload(token, content('Child session'), 'child-v1', childPath)
      if (path === parentPath && read.mock.calls.filter(([prior]) => decodeSessionToken(prior) === parentPath).length > 1) {
        return payload(token, forkedContent(false, true), 'parent-v2', parentPath)
      }
      return payload(token, forkedContent(), 'parent-v1', parentPath)
    })
    const controller = createController(read, { cache })
    await controller.dispatch({ type: 'open', session: session(encodeSessionToken(parentPath), 'parent-v1', parentPath) })
    await controller.dispatch({ type: 'select-branch', leafId: 'assistant-a' })
    await controller.dispatch({ type: 'select-event', eventId: 'assistant-a:assistant:0' })
    await controller.dispatch({
      type: 'open-subagent',
      reference: { targetFile: childPath, token: encodeSessionToken(childPath) },
      viewport: { scrollTop: 610, anchor: { eventId: 'assistant-a:assistant:0', offset: 4 } },
    })

    await controller.dispatch({ type: 'return-to-parent' })

    const snapshot = controller.getSnapshot()
    expect(snapshot.active?.source.kind).toBe('server')
    if (snapshot.active?.source.kind === 'server') expect(snapshot.active.source.modifiedAt).toBe('parent-v2')
    expect(snapshot.selectedLeafId).toBe('assistant-b')
    expect(snapshot.selectedEventId).toBe('missing-system-prompt:user-1')
    expect(snapshot.restoreIntent?.anchor).toBeUndefined()
    expect(snapshot.restoreIntent?.scrollTop).toBe(610)
  })

  it('rereads an imported parent source when returning from a child', async () => {
    let parentContents = content('Imported parent')
    let reads = 0
    const parentPath = 'project/imported.jsonl'
    const childPath = 'project/imported/run-123/run-0/session.jsonl'
    const controller = createController(async (token) => payload(token, content('Child'), 'child-v1', childPath), {
      readImportedFile: async () => { reads += 1; return parentContents },
    })
    const imported = { name: parentPath, file: { name: 'same-file' } }
    await controller.dispatch({ type: 'import', source: imported })
    parentContents = content('Imported parent reread')
    await controller.dispatch({
      type: 'open-subagent',
      reference: { targetFile: childPath, token: encodeSessionToken(childPath) },
    })
    expect(reads).toBe(1)
    await controller.dispatch({ type: 'return-to-parent' })

    expect(reads).toBe(2)
    expect(controller.getSnapshot().active?.source.kind).toBe('file')
    expect(controller.getSnapshot().view?.events.find((event) => event.id === 'user-1:user')?.summary).toBe('Imported parent reread')
  })

  it('restores a revisited child from its lightweight viewport record through nested returns', async () => {
    const parentPath = 'project/alpha.jsonl'
    const childPath = 'project/alpha/run-123/run-0/session.jsonl'
    const grandchildPath = 'project/alpha/run-123/run-0/grandchild.jsonl'
    const read = vi.fn(async (token: string) => {
      const path = decodeSessionToken(token)
      return path === parentPath
        ? payload(token, content('Parent'), 'parent-v1', parentPath)
        : path === childPath
          ? payload(token, forkedContent(), 'child-v1', childPath)
          : payload(token, content('Grandchild'), 'grandchild-v1', grandchildPath)
    })
    const controller = createController(read)
    const jumpToChild = () => controller.dispatch({
      type: 'open-subagent' as const,
      reference: { targetFile: childPath, token: encodeSessionToken(childPath) },
    })
    await controller.dispatch({ type: 'open', session: session(encodeSessionToken(parentPath), 'parent-v1', parentPath) })
    await jumpToChild()
    await controller.dispatch({
      type: 'open-subagent',
      reference: { targetFile: grandchildPath, token: encodeSessionToken(grandchildPath) },
    })
    expect(controller.getSnapshot().navigation).toHaveLength(2)
    await controller.dispatch({ type: 'return-to-parent' })
    expect(controller.getSnapshot().active?.metadata?.relativePath).toBe(childPath)
    expect(controller.getSnapshot().navigation).toHaveLength(1)
    await controller.dispatch({ type: 'select-branch', leafId: 'assistant-a' })
    await controller.dispatch({ type: 'select-event', eventId: 'assistant-a:assistant:0' })
    await controller.dispatch({
      type: 'return-to-parent',
      viewport: { scrollTop: 360, anchor: { eventId: 'assistant-a:assistant:0', offset: 12 } },
    })
    await jumpToChild()

    expect(controller.getSnapshot().active?.metadata?.relativePath).toBe(childPath)
    expect(controller.getSnapshot().selectedLeafId).toBe('assistant-a')
    expect(controller.getSnapshot().selectedEventId).toBe('assistant-a:assistant:0')
    expect(controller.getSnapshot().restoreIntent?.scrollTop).toBe(360)
    expect(controller.getSnapshot().restoreIntent?.anchor).toEqual({ eventId: 'assistant-a:assistant:0', offset: 12 })
    expect(read.mock.calls.filter(([token]) => decodeSessionToken(token) === childPath)).toHaveLength(1)

    await controller.dispatch({ type: 'return-to-parent' })
    expect(controller.getSnapshot().active?.metadata?.relativePath).toBe(parentPath)
    expect(controller.getSnapshot().navigation).toHaveLength(0)
  })

  it('acknowledges only the matching Timeline restore request', async () => {
    const controller = createController(async (token) => payload(token, forkedContent()))
    await controller.dispatch({ type: 'open', session: session('alpha') })
    await controller.dispatch({ type: 'jump-to-event', eventId: 'assistant-a:assistant:0' })
    const firstKey = controller.getSnapshot().restoreIntent!.key
    await controller.dispatch({ type: 'jump-to-event', eventId: 'assistant-b:assistant:0' })
    const latest = controller.getSnapshot().restoreIntent!

    await controller.dispatch({ type: 'acknowledge-timeline-restore', key: firstKey })
    expect(controller.getSnapshot().restoreIntent?.key).toBe(latest.key)
    await controller.dispatch({ type: 'acknowledge-timeline-restore', key: latest.key })
    expect(controller.getSnapshot().restoreIntent).toBe(null)
  })

  it('loads catalog, updates project/scope filters, and auto-opens initial session', async () => {
    const s1 = session('s1')
    const s2 = session('s2')
    const refreshCatalog = vi.fn(async () => ({
      root: '/var/sessions',
      currentCwd: '/work/app',
      projects: [{ cwd: '/work/app', name: 'app', count: 2, latestModifiedAt: '2026-01-01T00:00:00.000Z' }],
      sessions: [s1, s2],
      initialSessionToken: 's2',
      warnings: [],
    }))
    const read = vi.fn(async (token: string) => payload(token, content(`Hello ${token}`)))
    const controller = createController(read, { refreshCatalog })

    expect(controller.getSnapshot().catalog.loading).toBe(false)
    expect(controller.getSnapshot().catalog.sessions).toHaveLength(0)

    await controller.dispatch({ type: 'load-catalog', autoOpen: true })

    expect(refreshCatalog).toHaveBeenCalledTimes(1)
    const snapshot = controller.getSnapshot()
    expect(snapshot.catalog.root).toBe('/var/sessions')
    expect(snapshot.catalog.currentCwd).toBe('/work/app')
    expect(snapshot.catalog.projects).toHaveLength(1)
    expect(snapshot.catalog.sessions).toHaveLength(2)
    expect(snapshot.active?.token).toBe('s2')
    expect(snapshot.fullJsonlPath).toBe('/var/sessions/s2.jsonl')

    await controller.dispatch({ type: 'set-scope-mode', mode: 'all' })
    expect(controller.getSnapshot().catalog.scopeMode).toBe('all')

    await controller.dispatch({ type: 'set-project-filter', cwd: '/work/other' })
    expect(controller.getSnapshot().catalog.selectedProjectCwd).toBe('/work/other')
  })

  it('keeps the initial catalog loading until the initial load intent runs', async () => {
    const s1 = session('s1')
    const refreshCatalog = vi.fn(async () => ({
      root: '/var/sessions',
      currentCwd: '/work/demo',
      projects: [],
      sessions: [s1],
      warnings: [],
    }))
    const read = vi.fn(async (token: string) => payload(token, content(`Hello ${token}`)))
    const controller = createController(read, { refreshCatalog, initialCatalogLoading: true })

    expect(controller.getSnapshot().catalog.loading).toBe(true)
    expect(refreshCatalog).not.toHaveBeenCalled()
    await controller.dispatch({ type: 'load-catalog', autoOpen: true })

    expect(refreshCatalog).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot().active?.token).toBe('s1')
  })
})


it('正文先显示，投影延后补齐且不重置用户选择与筛选，并更新缓存', async () => {
  const later = deferred<Record<string, ContextProjection> | null>()
  const read = vi.fn(async (token: string) => ({ ...payload(token, content(token)), ...(token === 'alpha' ? { contextDeferred: true, deferredRawEntryIds: ['user-1'] } : {}) }))
  const readContext = vi.fn(() => later.promise)
  const controller = createController(read, { readContext })
  await controller.dispatch({ type: 'open', session: session('alpha') })
  expect(controller.getSnapshot().loading).toBe(false)
  expect(controller.getSnapshot().contextProjection).toBeUndefined()
  expect(controller.getSnapshot().active?.parsed.deferredRawEntryIds).toEqual(['user-1'])
  const event = controller.getSnapshot().view!.events.find((item) => item.kind === 'user')!
  await controller.dispatch({ type: 'select-event', eventId: event.id })
  await controller.dispatch({ type: 'toggle-event-kind', kind: 'thinking' })
  const kinds = controller.getSnapshot().enabledKinds
  later.resolve({ 'user-1': { leafId: 'user-1', messageCount: 1, contextEntryCount: 1, excluded: {} } })
  await vi.waitFor(() => expect(controller.getSnapshot().contextProjection?.messageCount).toBe(1))
  expect(controller.getSnapshot().selectedEventId).toBe(event.id)
  expect(controller.getSnapshot().enabledKinds).toBe(kinds)
  await controller.dispatch({ type: 'open', session: session('beta') })
  await controller.dispatch({ type: 'open', session: session('alpha') })
  expect(readContext).toHaveBeenCalledTimes(1)
  expect(controller.getSnapshot().contextProjection?.messageCount).toBe(1)
})

it('切换会话中止旧请求，旧内容与投影均不能覆盖新会话', async () => {
  const old = deferred<SessionFileResponse>()
  let oldSignal: AbortSignal | undefined
  const parse = vi.fn(parseSessionJsonl)
  const controller = createController(async (token, signal) => {
    if (token === 'alpha') { oldSignal = signal; return old.promise }
    return payload(token, content('Beta'))
  }, { parseSession: parse })
  const opening = controller.dispatch({ type: 'open', session: session('alpha') })
  await controller.dispatch({ type: 'open', session: session('beta') })
  expect(oldSignal?.aborted).toBe(true)
  old.resolve(payload('alpha', content('Old data')))
  await opening
  expect(controller.getSnapshot().active?.token).toBe('beta')
  expect(parse).toHaveBeenCalledTimes(1)
})


it('轻量索引不解析完整会话，能按需切换分支且复用已加载的分支', async () => {
  const make = (leaf: string): SessionFileResponse => ({ ...payload('indexed', ''), prepared: {
    parsed: { header: JSON.parse(HEADER), sourceName: 'indexed.jsonl', entries: [], warnings: [], currentLeafId: 'a',
      displayTitle: 'Indexed session', rawEntriesDeferred: true,
      branches: [{ leafId: 'a', label: 'A', isCurrent: true }, { leafId: 'b', label: 'B', isCurrent: false }] },
    leafId: leaf, definitions: [], stats: { entryCount: 60000, turnCount: 1 },
    events: [{ id: leaf + ':user', entryId: leaf, kind: 'user', title: 'User', summary: leaf, content: leaf, raw: {} }],
    turns: [{ id: 'turn', index: 1, label: 'Turn', eventIds: [leaf + ':user'] }],
  } })
  const parse = vi.fn(parseSessionJsonl)
  const read = vi.fn(async (_token: string, _signal?: AbortSignal, leaf?: string) => make(leaf ?? 'a'))
  const controller = createController(read, { parseSession: parse })
  await controller.dispatch({ type: 'open', session: session('indexed') })
  expect(parse).not.toHaveBeenCalled()
  expect(controller.getSnapshot().sessionTitle).toBe('Indexed session')
  expect(controller.getSnapshot().view?.stats.entryCount).toBe(60000)
  await controller.dispatch({ type: 'select-branch', leafId: 'b' })
  expect(controller.getSnapshot().view?.events[0].content).toBe('b')
  expect(controller.getSnapshot().selectedLeafId).toBe('b')
  await controller.dispatch({ type: 'select-branch', leafId: 'a' })
  expect(controller.getSnapshot().view?.events[0].content).toBe('a')
  expect(read).toHaveBeenCalledTimes(2)
})

it('Live 更新保持选择和锚点，忽略导航后到达的其他会话更新', async () => {
  const { prepareSessionView } = await import('../server/prepared-session')
  const { buildSessionView } = await import('../core/session-view')
  const { diffPreparedSessions } = await import('../core/prepared-session-delta')
  const original = content('Reading history')
  const firstParsed = parseSessionJsonl(original, 'live.jsonl')
  const first = prepareSessionView(firstParsed, buildSessionView(firstParsed), firstParsed.currentLeafId)
  const controller = createController(async () => payload('live', original))
  await controller.dispatch({ type: 'open', session: session('live') })
  const viewport = { scrollTop: 180, anchor: { eventId: 'user-1:user', offset: -10 } }
  await controller.dispatch({ type: 'select-event', eventId: 'user-1:user' })
  await controller.dispatch({ type: 'live-update', token: 'live', leaf: null,
    response: { cursor: 'first', snapshot: { ...payload('live', ''), prepared: first } }, viewport })
  const nextParsed = parseSessionJsonl(original + '\n' + JSON.stringify({ type: 'message', id: 'next', parentId: 'user-1',
    timestamp: '2026-01-01T00:00:03Z', message: { role: 'assistant', content: [{ type: 'text', text: 'New answer' }] } }), 'live.jsonl')
  const next = prepareSessionView(nextParsed, buildSessionView(nextParsed), nextParsed.currentLeafId)
  const response = { cursor: 'second', delta: diffPreparedSessions(first, next, '2026-01-01T00:00:03Z') }
  await controller.dispatch({ type: 'live-update', token: 'live', leaf: null, response, viewport })
  expect(controller.getSnapshot().view?.events.some((event) => event.content === 'New answer')).toBe(true)
  expect(controller.getSnapshot().selectedEventId).toBe('user-1:user')
  expect(controller.getSnapshot().restoreIntent?.anchor).toEqual(viewport.anchor)
  expect(controller.getSnapshot().active?.parsed.liveCursor).toBe('second')
  await controller.dispatch({ type: 'live-update', token: 'somewhere-else', leaf: null, response: { ...response, cursor: 'stale' }, viewport })
  expect(controller.getSnapshot().active?.parsed.liveCursor).toBe('second')
})
