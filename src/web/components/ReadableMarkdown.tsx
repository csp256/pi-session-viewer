import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useI18n } from '../i18n'

/** 消息里的 HTML 和远程图片不能在阅读时执行或自动发送请求。 */
export function ReadableMarkdown({ children }: { children: string }) {
  const { t } = useI18n()
  return <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
    img: ({ alt }) => <span className="event-reader-image">[{alt || t.reader.image}]</span>,
  }}>{children}</Markdown>
}
