import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { TimelineEvent } from '../../core/types'
import { useI18n } from '../i18n'

export function EventReader({ event, onClose }: { event: TimelineEvent; onClose: () => void }) {
  const { t, localizeTitle } = useI18n()
  const dialog = useRef<HTMLDialogElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const [source, setSource] = useState(!['user', 'assistant', 'thinking'].includes(event.kind))
  const content = event.content ?? event.summary

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
    <dialog ref={dialog} className="event-reader" aria-labelledby="event-reader-title" onClose={onClose}
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
          {source ? <pre className="event-reader-source">{content}</pre> : (
            <div className="event-reader-markdown">
              <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
                a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
                // 消息里的远程图片不应在打开弹窗时自动发出请求。
                img: ({ alt }) => <span className="event-reader-image">[{alt || t.reader.image}]</span>,
              }}>{content}</Markdown>
            </div>
          )}
        </div>
      </div>
    </dialog>
  )
}
