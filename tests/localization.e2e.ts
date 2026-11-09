import { expect, test } from '@playwright/test'

test('浏览器标题随语言切换并在刷新后保留', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('Pi Session Viewer')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')

  await page.getByRole('button', { name: 'EN / 中' }).click()
  await expect(page).toHaveTitle('Pi 会话分析')
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')

  await page.reload()
  await expect(page).toHaveTitle('Pi 会话分析')
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')

  await page.getByRole('button', { name: 'EN / 中' }).click()
  await expect(page).toHaveTitle('Pi Session Viewer')
  await page.reload()
  await expect(page).toHaveTitle('Pi Session Viewer')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
})

test('首次访问时浏览器标题使用浏览器语言', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN' })
  try {
    const page = await context.newPage()
    await page.goto('/')
    await expect(page).toHaveTitle('Pi 会话分析')
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  } finally {
    await context.close()
  }
})

for (const locale of ['en-US', 'fr-FR', 'ja-JP', 'zh-TW', 'zh-Hant-HK']) {
  test(`无保存偏好时按首选语言决定界面：${locale}`, async ({ browser }) => {
    const context = await browser.newContext({ locale })
    try {
      const page = await context.newPage()
      await page.goto('/')
      const chinese = locale.startsWith('zh')
      await expect(page).toHaveTitle(chinese ? 'Pi 会话分析' : 'Pi Session Viewer')
      await expect(page.locator('html')).toHaveAttribute('lang', chinese ? 'zh-CN' : 'en')
    } finally {
      await context.close()
    }
  })
}

test('首选语言列表中的英文不会被次要的中文覆盖', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'languages', { value: ['en-US', 'zh-CN'], configurable: true })
    Object.defineProperty(navigator, 'language', { value: 'zh-CN', configurable: true })
  })
  await page.goto('/')
  await expect(page).toHaveTitle('Pi Session Viewer')
})

test('即使存储不可读，中文首选语言仍会生效', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN' })
  try {
    await context.addInitScript(() => {
      const get = Storage.prototype.getItem
      Storage.prototype.getItem = function (key) {
        if (key === 'pi_session_viewer_locale') throw new Error('blocked')
        return get.call(this, key)
      }
    })
    const page = await context.newPage()
    await page.goto('/')
    await expect(page).toHaveTitle('Pi 会话分析')
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  } finally {
    await context.close()
  }
})

for (const [locale, saved] of [['zh-CN', 'en'], ['en-US', 'zh-CN']]) {
  test(`保存的 ${saved} 优先于系统 ${locale}`, async ({ browser }) => {
    const context = await browser.newContext({ locale })
    try {
      await context.addInitScript((value) => localStorage.setItem('pi_session_viewer_locale', value), saved)
      const page = await context.newPage()
      await page.goto('/')
      await expect(page.locator('html')).toHaveAttribute('lang', saved)
    } finally {
      await context.close()
    }
  })
}
