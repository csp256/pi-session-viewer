import type { EventKind } from './types'

export const allEventKinds: EventKind[] = [
  'system-prompt',
  'tool-definitions',
  'user',
  'assistant',
  'thinking',
  'tool-call',
  'tool-result',
  'system',
]

// 首次打开仅显示对话；其余事件类型仍可通过筛选器或显式跳转显示。
export const defaultEventKinds: EventKind[] = ['user', 'assistant']
