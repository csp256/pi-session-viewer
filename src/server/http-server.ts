import { createServer, type Server } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { promises as fs } from 'node:fs'
import { hasValidBearerToken, isAllowedHost, isAllowedOrigin } from './security'
import { listSessions, resolveAllowedSessionFile, resolveSessionTarget } from './session-discovery'
import { computeContextProjections } from './context-projection'
import { readStaticAsset } from './static-assets'
import { readCompactSession, readOriginalEntry } from './session-content'
import { preparedSessionBody, readEventContent } from './prepared-session'
import { gzip } from 'node:zlib'
import { createLiveSessionReader } from './live-session'
import { createLruCache, type LruCache } from '../core/lru-cache'

export interface SessionHttpServerOptions {
  sessionRoot: string
  webRoot: string
  token: string
  host?: string
  port?: number
  version?: string
  currentCwd?: string
}

export interface SessionHttpServer {
  readonly host: string
  readonly port: number
  readonly token: string
  readonly url: string
  close(): Promise<void>
}

const CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY)
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'no-referrer')
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(body))
}

/**
 * Serialized session payloads, keyed by file identity (path, mtime, size).
 *
 * Answering a session request means reading the file, projecting every branch
 * through Pi, and serializing a body that can run to megabytes — all inside the
 * Pi process. Switching between sessions is the viewer's main gesture, so the
 * last few bodies are kept; a changed file changes its key and refetches.
 *
 * The weight of one body is its character count, a proxy for the bytes it costs.
 */
const SESSION_BODY_CACHE_WEIGHT = 64 * 1024 * 1024
type SessionBodyCache = LruCache<string>

function sendCachedJson(response: ServerResponse, body: string): void {
  response.statusCode = 200
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(body)
}

const contextJobs = createLruCache<Promise<Awaited<ReturnType<typeof computeContextProjections>>>>({ maxEntries: 8 })
function contextJob(key: string, absolute: string, content?: string) {
  const cached = contextJobs.get(key)
  if (cached) return cached
  const job = (async () => computeContextProjections(content ?? (await readCompactSession(absolute)).content))().catch(() => undefined)
  contextJobs.set(key, job)
  return job
}

interface SessionReadOptions {
  compact: boolean
  leafId?: string
  prepare: boolean
  fresh: boolean
  afterVersion?: string
}

async function sendSessionPayload(
  response: ServerResponse,
  sessionBodies: SessionBodyCache,
  absolute: string,
  relative: string,
  token: string,
  readOptions: SessionReadOptions,
): Promise<void> {
  const { compact, leafId, prepare, fresh, afterVersion } = readOptions
  const stat = await fs.stat(absolute)
  if (compact && (stat.size >= 16 * 1024 * 1024 || prepare)) {
    const prepared = await preparedSessionBody(absolute, relative, token, leafId, undefined, fresh, afterVersion)
    if (response.destroyed) return
    response.statusCode = 200
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Content-Encoding', 'gzip')
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Vary', 'X-Pi-Viewer-Compact')
    if (prepared.stale) response.setHeader('X-Pi-Viewer-Stale', '1')
    response.end(prepared.body)
    return
  }
  const cacheKey = `${relative}\u0000${stat.mtimeMs}\u0000${stat.size}\u0000${compact}`
  const cached = sessionBodies.get(cacheKey)
  if (cached !== undefined) {
    sendCachedJson(response, cached)
    return
  }
  const loaded = compact ? await readCompactSession(absolute, () => response.destroyed) : { content: await fs.readFile(absolute, 'utf8'), deferredRawEntryIds: [] }
  if (response.destroyed) return
  const { content, deferredRawEntryIds } = loaded
  // What the model actually received is computed by Pi itself; when Pi is not
  // reachable the field stays absent and the UI shows no marks.
  const contextProjections = compact ? undefined : await computeContextProjections(content, relative)
  if (compact) {
    // 先把正文完整发送给浏览器；上下文投影不应阻塞首次显示。
    const contextKey = `${absolute}\u0000${stat.mtime.toISOString()}`
    response.once('finish', () => setImmediate(() => { void contextJob(contextKey, absolute, content) }))
  }
  const payload = {
    token,
    relativePath: relative,
    modifiedAt: stat.mtime.toISOString(),
    content,
    ...(compact ? { contextDeferred: true } : {}),
    ...(contextProjections ? { contextProjections } : {}),
    ...(deferredRawEntryIds.length ? { deferredRawEntryIds } : {}),
  }
  const body = JSON.stringify(payload)
  sessionBodies.set(cacheKey, body)
  sendCachedJson(response, body)
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: SessionHttpServerOptions,
  sessionBodies: SessionBodyCache,
  live: ReturnType<typeof createLiveSessionReader>,
): Promise<void> {
  setSecurityHeaders(response)

  if (!isAllowedHost(request.headers.host)) {
    sendJson(response, 403, { error: 'Only local loopback access is allowed.' })
    return
  }

  if (!isAllowedOrigin(request)) {
    sendJson(response, 403, { error: 'Cross-origin request rejected.' })
    return
  }

  const pathname = (request.url ?? '/').split('?', 1)[0] || '/'
  const query = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams
  const readOptions: SessionReadOptions = {
    compact: request.headers['x-pi-viewer-compact'] === '1',
    prepare: request.headers['x-pi-viewer-prepared'] === '1',
    leafId: query.get('leaf') ?? undefined,
    fresh: query.get('fresh') === '1',
    afterVersion: query.get('since') ?? undefined,
  }

  if (pathname.startsWith('/api/') && !hasValidBearerToken(request, options.token)) {
    sendJson(response, 401, { error: 'Valid access token required.' })
    return
  }

  if (pathname.startsWith('/api/') && request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    sendJson(response, 405, { error: 'Only read-only GET requests are supported.' })
    return
  }

  if (pathname === '/api/health') {
    sendJson(response, 200, { status: 'ok', version: options.version ?? 'unknown' })
    return
  }

  if (pathname === '/api/sessions') {
    sendJson(response, 200, await listSessions(options.sessionRoot, options.currentCwd))
    return
  }

  if (pathname === '/api/live') {
    const token = query.get('session')
    if (!token) { sendJson(response, 400, { error: 'Session is required.' }); return }
    try {
      const { absolute, relative } = await resolveAllowedSessionFile(options.sessionRoot, token)
      const result = await live.read(absolute, relative, token, query.get('leaf') ?? undefined, query.get('cursor') ?? undefined)
      if (response.destroyed) return
      if (!result) { response.writeHead(304, { 'Cache-Control': 'no-store' }); response.end(); return }
      gzip(JSON.stringify(result), { level: 1 }, (error, body) => {
        if (response.destroyed) return
        if (error) { sendJson(response, 500, { error: 'Live update unavailable.' }); return }
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip', 'Cache-Control': 'no-store' })
        response.end(body)
      })
    } catch { if (!response.destroyed) sendJson(response, 404, { error: 'Live session unavailable.' }) }
    return
  }

  if (pathname === '/api/content') {
    const params = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams
    const token = params.get('session'), entryId = params.get('entry'), eventId = params.get('event')
    if (!token || !entryId || !eventId) { sendJson(response, 400, { error: 'Session, entry and event are required.' }); return }
    try {
      const { absolute, relative } = await resolveAllowedSessionFile(options.sessionRoot, token)
      const content = await readEventContent(absolute, relative, entryId, eventId)
      if (!response.destroyed) sendJson(response, content === undefined ? 404 : 200, content === undefined ? { error: 'Event not found.' } : { content })
    } catch { if (!response.destroyed) sendJson(response, 404, { error: 'Event content unavailable.' }) }
    return
  }

  if (pathname === '/api/context') {
    const token = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams.get('session')
    if (!token) { sendJson(response, 400, { error: 'Session identifier is required.' }); return }
    try {
      const { absolute } = await resolveAllowedSessionFile(options.sessionRoot, token)
      const stat = await fs.stat(absolute)
      const currentVersion = stat.mtime.toISOString()
      const expectedVersion = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams.get('modifiedAt') ?? currentVersion
      const key = `${absolute}\u0000${expectedVersion}`
      const cached = contextJobs.get(key)
      if (!cached && expectedVersion !== currentVersion) {
        sendJson(response, 409, { error: 'Session changed; refresh to load its context.' })
        return
      }
      const contextProjections = await (cached ?? contextJob(key, absolute))
      if (!response.destroyed) sendJson(response, 200, contextProjections ?? null)
    } catch {
      if (!response.destroyed) sendJson(response, 404, { error: 'Session context unavailable.' })
    }
    return
  }

  if (pathname === '/api/entry') {
    const params = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams
    const token = params.get('session')
    const id = params.get('id')
    if (!token || !id) { sendJson(response, 400, { error: 'Session and entry identifiers are required.' }); return }
    try {
      const { absolute } = await resolveAllowedSessionFile(options.sessionRoot, token)
      const entry = await readOriginalEntry(absolute, id, () => response.destroyed)
      if (!response.destroyed) sendJson(response, entry ? 200 : 404, entry ?? { error: 'Entry not found.' })
    } catch {
      if (!response.destroyed) sendJson(response, 404, { error: 'Session entry unavailable.' })
    }
    return
  }

  if (pathname === '/api/resolve') {
    const searchParams = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams
    const target = searchParams.get('target')
    const parent = searchParams.get('parent') ?? undefined
    if (!target) {
      sendJson(response, 400, { error: 'Target session identifier is required.' })
      return
    }

    try {
      const result = await resolveSessionTarget(options.sessionRoot, target, parent)
      if (result.kind === 'transcript-only') {
        sendJson(response, 422, {
          error: 'Subagent transcript is not a runnable session.',
          code: 'subagent-transcript-only',
        })
        return
      }
      if (result.kind === 'not-found') {
        sendJson(response, 404, { error: `No session file found for ${target}` })
        return
      }
      await sendSessionPayload(response, sessionBodies, result.absolute, result.relative, result.token, readOptions)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      sendJson(response, 500, { error: message })
    }
    return
  }

  const sessionPathPrefix = '/api/sessions/'
  if (pathname.startsWith(sessionPathPrefix)) {
    let token: string
    try {
      token = decodeURIComponent(pathname.slice(sessionPathPrefix.length))
    } catch {
      sendJson(response, 400, { error: 'Invalid session file identifier.' })
      return
    }
    try {
      const { absolute, relative } = await resolveAllowedSessionFile(options.sessionRoot, token)
      await sendSessionPayload(response, sessionBodies, absolute, relative, token, readOptions)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      sendJson(response, 404, { error: message })
    }
    return
  }

  if (request.method === 'GET') {
    const asset = await readStaticAsset(options.webRoot, pathname)
    if (asset) {
      response.statusCode = 200
      response.setHeader('Content-Type', asset.contentType)
      response.setHeader('Cache-Control', asset.cacheControl)
      response.end(asset.body)
      return
    }
  }

  sendJson(response, 404, { error: 'Requested resource not found.' })
}

function listen(server: Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      const address = server.address() as AddressInfo
      resolve(address.port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

function close(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

export async function startSessionHttpServer(options: SessionHttpServerOptions): Promise<SessionHttpServer> {
  const host = options.host ?? '127.0.0.1'
  const sessionBodies = createLruCache<string>({
    maxEntries: 8,
    maxWeight: SESSION_BODY_CACHE_WEIGHT,
    weigh: (body) => body.length,
  })
  const live = createLiveSessionReader()
  const httpServer = createServer((request, response) => {
    void handleRequest(request, response, options, sessionBodies, live)
  })
  const port = await listen(httpServer, host, options.port ?? 0)
  return {
    host,
    port,
    token: options.token,
    url: `http://${host}:${port}`,
    close: () => { live.dispose(); return close(httpServer) },
  }
}
