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
