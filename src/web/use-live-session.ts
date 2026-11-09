import { useEffect, useState } from 'react'
import type { LiveSessionResponse } from '../core/types'
import { fetchLiveSession } from './api'

type LiveStatus = 'off' | 'starting' | 'watching' | 'paused' | 'retrying'
interface LiveOptions {
  token: string | null
  accessToken: string | null
  leaf: string | null
  available: boolean
  version: string
  cursor?: string
  onUpdate(response: LiveSessionResponse, token: string, leaf: string | null): Promise<boolean>
}

/** 不重叠轮询；空闲只做 stat，隐藏页面停止请求，故障指数退避。 */
export function useLiveSession(options: LiveOptions) {
  const [enabled, setEnabled] = useState(false)
  const [status, setStatus] = useState<LiveStatus>('off')
  const { token, accessToken, leaf, available, onUpdate } = options
  // Live 自己的版本递增不能重启订阅；手动刷新或导航产生的快照需要重新同步。
  const resetKey = options.cursor ? 'live' : options.version
  useEffect(() => {
    if (!enabled || !available || !token || !accessToken) { setStatus(enabled ? 'paused' : 'off'); return }
    let active = true
    let cursor = options.cursor
    let timer: ReturnType<typeof setTimeout> | undefined
    let request: AbortController | undefined
    let running = false
    let failures = 0
    const poll = async () => {
      if (!active || running || document.hidden) return
      running = true
      request = new AbortController()
      if (!cursor) setStatus('starting')
      try {
        const result = await fetchLiveSession(token, accessToken, request.signal, leaf ?? undefined, cursor)
        if (!active || request.signal.aborted) return
        if (result) cursor = await onUpdate(result, token, leaf) ? result.cursor : undefined
        if (!active || request.signal.aborted) return
        failures = 0
        setStatus('watching')
      } catch {
        if (!active || request.signal.aborted) return
        failures += 1
        setStatus('retrying')
      } finally {
        running = false
        if (active && !document.hidden) timer = setTimeout(() => { void poll() }, Math.min(30_000, 2000 * 2 ** Math.min(failures, 4)))
      }
    }
    const visibility = () => {
      clearTimeout(timer)
      if (document.hidden) { request?.abort(); setStatus('paused') }
      else { void poll() }
    }
    document.addEventListener('visibilitychange', visibility)
    if (document.hidden) setStatus('paused')
    else void poll()
    return () => { active = false; clearTimeout(timer); request?.abort(); document.removeEventListener('visibilitychange', visibility) }
  }, [enabled, available, token, accessToken, leaf, resetKey, onUpdate])
  return { enabled, status, toggle: () => setEnabled((value) => !value) }
}
