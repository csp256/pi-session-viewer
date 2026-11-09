import { useEffect, useState } from 'react'
import type { TimelineEvent } from '../core/types'

export type EventContentLoader = (event: TimelineEvent, signal: AbortSignal) => Promise<string>

export function useEventContent(event: TimelineEvent | null, loader?: EventContentLoader) {
  const [loaded, setLoaded] = useState<{ id: string; loader: EventContentLoader; content?: string; failed?: boolean } | null>(null)
  const [attempt, retry] = useState(0)
  useEffect(() => {
    if (!event?.contentDeferred || !loader) return
    const request = new AbortController()
    let active = true
    void loader(event, request.signal).then(
      (content) => { if (active) setLoaded({ id: event.id, loader, content }) },
      () => { if (active) setLoaded({ id: event.id, loader, failed: true }) },
    )
    return () => { active = false; request.abort() }
  }, [event?.id, event?.contentDeferred, loader, attempt])
  const result = loaded?.id === event?.id && loaded?.loader === loader ? loaded : null
  const deferred = Boolean(event?.contentDeferred && loader)
  return {
    event: event && deferred && result?.content !== undefined ? { ...event, content: result.content, contentDeferred: false } : event,
    loading: deferred && !result,
    failed: deferred && Boolean(result?.failed),
    retry: () => { setLoaded(null); retry((value) => value + 1) },
  }
}
