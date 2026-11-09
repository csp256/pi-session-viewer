import { describe, expect, it } from 'vitest'
import { readableText } from './readable-text'

describe('readableText', () => {
  it('清除实际 ANSI 颜色码并保留 Markdown', () => {
    expect(readableText('\x1b[38;2;167;152;215mThinking:\x1b[39m \x1b[38;2;150;160;164m**Checking borrow_objects support**\x1b[39m'))
      .toBe('Thinking: **Checking borrow_objects support**')
  })

  it('清除丢失 ESC 的 SGR 颜色码', () => {
    expect(readableText('[38;2;167;152;215mThinking:[39m [38;2;150;160;164m**Checking borrow_objects support**[39m'))
      .toBe('Thinking: **Checking borrow_objects support**')
    expect(readableText('[1;32mgreen[0m [38;5;120mindexed[39m')).toBe('green indexed')
  })

  it('去除终端超链接和控制序列而不丢失可读文本', () => {
    expect(readableText('\x1b]8;;https://example.com\x07link\x1b]8;;\x07\x1b[2K')).toBe('link')
  })

  it('保留普通代码、Markdown、空白及多语言文本', () => {
    const text = '# Heading\n\n**检查** `items[0]` [link](https://example.com)\n  indented\n'
    expect(readableText(text)).toBe(text)
    expect(readableText('')).toBe('')
  })
})
