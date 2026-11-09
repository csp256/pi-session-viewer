import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ReadableMarkdown } from './ReadableMarkdown'
import { readableText } from '../readable-text'
import type { TimelineEvent } from '../../core/types'
import { useI18n } from '../i18n'
import { useEventContent, type EventContentLoader } from '../event-content'

export function EventReader({ event: originalEvent, onClose, loadContent }: { event: TimelineEvent; onClose: () => void; loadContent?: EventContentLoader }) {
  const loaded = useEventContent(originalEvent, loadContent)
  const event = loaded.event!
  const { t, localizeTitle } = useI18n()
  const dialog = useRef<HTMLDialogElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const [source, setSource] = useState(!['user', 'assistant', 'thinking'].includes(event.kind))
  const content = readableText(event.content ?? event.summary)

  useEffect(() => {
    const element = dialog.current!
    const previousFocus = document.activeElement
    element.showModal()
    closeButton.current?.focus()
    return () => {
      element.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])

  return (
    <dialog ref={dialog} className="event-reader" aria-labelledby="event-reader-title" onClose={(event) => { if (!event.currentTarget.open) onClose() }}
      onClick={(click) => { if (click.target === click.currentTarget) dialog.current?.close() }}>
      <div className="event-reader-layout">
        <header className="event-reader-header">
          <div><span>{t.reader.label} · {t.timeline.kinds[event.kind]}</span><h2 id="event-reader-title">{localizeTitle(event.title)}</h2></div>
          <div className="event-reader-actions">
            <button type="button" aria-pressed={source} onClick={() => setSource(!source)}>{source ? t.reader.renderMarkdown : t.reader.showSource}</button>
            <button ref={closeButton} type="button" autoFocus aria-label={t.common.close} onClick={() => dialog.current?.close()}><X size={20} /></button>
          </div>
        </header>
        <div className="event-reader-body" tabIndex={0}>
          {loaded.loading ? <div role="status">{t.common.loading}</div> : loaded.failed ? <div role="alert">
            <p>{t.inspector.views.contentLoadError}</p><button type="button" onClick={loaded.retry}>{t.inspector.views.retryRaw}</button>
          </div> : source ? <pre className="event-reader-source">{content}</pre> : (
            <div className="event-reader-markdown">
              <ReadableMarkdown>{content}</ReadableMarkdown>
            </div>
          )}
        </div>
      </div>
    </dialog>
  )
}
