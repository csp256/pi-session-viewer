import stripAnsi from 'strip-ansi'

/** 只处理展示文本；会话原文和 Raw 保持不变。 */
export function readableText(text: string): string {
  // 某些终端转录已丢失 ESC 字符，但保留了 SGR 颜色/样式参数。
  return stripAnsi(text).replace(/\[(?:\d{1,3};)*\d{1,3}m/g, '')
}
