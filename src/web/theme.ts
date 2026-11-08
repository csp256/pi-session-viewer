import { useLayoutEffect, useState } from 'react'

type Theme = 'light' | 'dark'
const STORAGE_KEY = 'pi_session_viewer_theme'

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // 存储不可用时使用默认深色主题。
  }
  return 'dark'
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initialTheme)

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      'content', getComputedStyle(document.documentElement).backgroundColor,
    )
  }, [theme])

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(nextTheme)
    try {
      localStorage.setItem(STORAGE_KEY, nextTheme)
    } catch {
      // 存储不可用时仍允许切换当前页面的主题。
    }
  }

  return { theme, toggleTheme }
}
