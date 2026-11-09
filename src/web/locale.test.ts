import { describe, expect, it } from 'vitest'
import { resolveInitialLocale } from './locale'

describe('默认语言', () => {
  it.each(['en-US', 'en', 'fr-FR', 'ja-JP', 'de-DE', '', undefined, 'zhfoo'])(
    '非中文或未知首选语言 %s 使用英文', (language) => {
      expect(resolveInitialLocale(null, language)).toBe('en')
    },
  )
  it.each(['zh', 'zh-CN', 'zh-TW', 'zh-Hant-HK', 'ZH-cn'])(
    '中文首选语言 %s 使用中文界面', (language) => {
      expect(resolveInitialLocale(null, language)).toBe('zh-CN')
    },
  )
  it('显式选择优先于系统语言，损坏的偏好忽略', () => {
    expect(resolveInitialLocale('en', 'zh-CN')).toBe('en')
    expect(resolveInitialLocale('zh-CN', 'en-US')).toBe('zh-CN')
    expect(resolveInitialLocale('invalid', 'en-US')).toBe('en')
    expect(resolveInitialLocale('invalid', 'zh-TW')).toBe('zh-CN')
  })
})
