export type Locale = 'en' | 'zh-CN'

// 显式选择优先；只有首选语言确为中文时才自动启用中文，其他情况使用英文。
export function resolveInitialLocale(saved: string | null, preferredLanguage?: string): Locale {
  if (saved === 'en' || saved === 'zh-CN') return saved
  return /^zh(?:-|$)/i.test(preferredLanguage ?? '') ? 'zh-CN' : 'en'
}
