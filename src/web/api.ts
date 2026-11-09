import type { ContextProjection, LiveSessionResponse, RawObject, SessionFileResponse, SessionListResponse } from '../core/types'

const PANEL_UNAVAILABLE_ERROR = 'Viewer server is unavailable or Pi has exited. Run /session-viewer on again from Pi.'

async function request(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch {
    throw new Error(PANEL_UNAVAILABLE_ERROR)
  }
}

async function readJson<T>(response: Response): Promise<T> {
  let payload: T & { error?: string; code?: string }
  try {
    payload = await response.json() as T & { error?: string; code?: string }
  } catch {
    throw new Error(PANEL_UNAVAILABLE_ERROR)
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error(PANEL_UNAVAILABLE_ERROR)
    const error = new Error(payload.error ?? `Request failed (${response.status})`)
    if (payload.code) {
      Object.assign(error, { code: payload.code })
    }
    throw error
  }
  return payload
}

export async function fetchSessions(accessToken: string): Promise<SessionListResponse> {
  return readJson<SessionListResponse>(await request('/api/sessions', {
    cache: 'no-store',
    headers: { Authorization: `Bearer ${accessToken}` },
  }))
}

export async function fetchSession(token: string, accessToken: string, signal?: AbortSignal, leafId?: string, fresh = false, afterVersion?: string): Promise<SessionFileResponse> {
  const params = new URLSearchParams()
  if (leafId) params.set('leaf', leafId)
  if (fresh) params.set('fresh', '1')
  if (afterVersion) params.set('since', afterVersion)
  const query = params.size ? `?${params}` : ''
  const response = await request(`/api/sessions/${encodeURIComponent(token)}${query}`, {
    signal, cache: 'no-store', headers: { Authorization: `Bearer ${accessToken}`, 'X-Pi-Viewer-Compact': '1' },
  })
  const payload = await readJson<SessionFileResponse>(response)
  return response.headers.get('X-Pi-Viewer-Stale') === '1' ? { ...payload, preparedRefreshNeeded: true } : payload
}

export async function resolveSession(
  target: string,
  parent: string | undefined,
  accessToken: string,
  signal?: AbortSignal,
): Promise<SessionFileResponse> {
  const searchParams = new URLSearchParams({ target })
  if (parent) searchParams.set('parent', parent)
  return readJson<SessionFileResponse>(await request(`/api/resolve?${searchParams.toString()}`, {
    signal,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${accessToken}`, 'X-Pi-Viewer-Compact': '1' },
  }))
}

export async function fetchSessionEntry(token: string, id: string, accessToken: string, signal?: AbortSignal): Promise<RawObject> {
  const params = new URLSearchParams({ session: token, id })
  return readJson<RawObject>(await request(`/api/entry?${params}`, {
    signal, cache: 'no-store', headers: { Authorization: `Bearer ${accessToken}` },
  }))
}

export async function fetchSessionContext(token: string, accessToken: string, signal?: AbortSignal, modifiedAt?: string): Promise<Record<string, ContextProjection> | null> {
  const params = new URLSearchParams({ session: token })
  if (modifiedAt) params.set('modifiedAt', modifiedAt)
  return readJson<Record<string, ContextProjection> | null>(await request(`/api/context?${params}`, {
    signal, cache: 'no-store', headers: { Authorization: `Bearer ${accessToken}` },
  }))
}


export async function fetchEventContent(token: string, entryId: string, eventId: string, accessToken: string, signal?: AbortSignal): Promise<string> {
  const params = new URLSearchParams({ session: token, entry: entryId, event: eventId })
  const result = await readJson<{ content: string }>(await request(`/api/content?${params}`, {
    signal, cache: 'no-store', headers: { Authorization: `Bearer ${accessToken}` },
  }))
  return result.content
}


export async function fetchLiveSession(token: string, accessToken: string, signal: AbortSignal, leaf?: string, cursor?: string): Promise<LiveSessionResponse | null> {
  const params = new URLSearchParams({ session: token })
  if (leaf) params.set('leaf', leaf)
  if (cursor) params.set('cursor', cursor)
  const response = await request(`/api/live?${params}`, { signal, cache: 'no-store', headers: { Authorization: `Bearer ${accessToken}` } })
  return response.status === 304 ? null : readJson(response)
}
