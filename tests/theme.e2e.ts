import { expect, test } from '@playwright/test'

const base = { light: 'rgb(242, 244, 243)', dark: 'rgb(21, 27, 27)' }

test('默认使用深色主题，不受系统偏好影响', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible()
  await expect(page.locator('html')).toHaveCSS('background-color', base.dark)
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark')
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', base.dark)
})

test('切换主题并在刷新后保留选择', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Switch to light mode' }).click()
  await expect(page.locator('html')).toHaveCSS('background-color', base.light)
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', base.light)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Switch to dark mode' })).toBeVisible()
  await expect(page.locator('html')).toHaveCSS('background-color', base.light)

  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible()
  await expect(page.locator('html')).toHaveCSS('background-color', base.dark)
})

test('本地存储不可用时主题仍可切换', async ({ page }) => {
  await page.addInitScript(() => {
    const getItem = Storage.prototype.getItem
    const setItem = Storage.prototype.setItem
    Storage.prototype.getItem = function (key) {
      if (key === 'pi_session_viewer_theme') throw new Error('blocked')
      return getItem.call(this, key)
    }
    Storage.prototype.setItem = function (key, value) {
      if (key === 'pi_session_viewer_theme') throw new Error('blocked')
      return setItem.call(this, key, value)
    }
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Switch to light mode' }).click()
  await expect(page.locator('html')).toHaveCSS('background-color', base.light)
})

test('无效偏好回退到深色主题', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pi_session_viewer_theme', 'invalid'))
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible()
  await expect(page.locator('html')).toHaveCSS('background-color', base.dark)
})

test('按钮位于语言和刷新按钮之间；深色覆盖会话面板及详情并支持窄屏', async ({ page }) => {
  await page.goto('/#token=dev-token')
  const theme = page.getByRole('button', { name: 'Switch to light mode' })
  await expect(theme).toBeVisible()
  const buttons = page.locator('.header-actions > button')
  await expect(buttons.nth(0)).toHaveAttribute('aria-label', 'EN / 中')
  await expect(buttons.nth(1)).toHaveAttribute('aria-label', 'Switch to light mode')
  await expect(buttons.nth(2)).toHaveAttribute('aria-label', 'Reload sessions and list')
  await expect(page.locator('.event-row').first()).toBeVisible()
  await expect(page.locator('.app-header')).toHaveCSS('background-color', 'rgb(40, 53, 48)')
  for (const selector of ['.session-sidebar', '.inspector', '.branch-bar']) {
    await expect(page.locator(selector)).toHaveCSS('background-color', 'rgb(25, 33, 32)')
  }
  await page.locator('.event-row.event--user').first().click()
  await page.getByRole('tab', { name: 'Content', exact: true }).click()
  await expect(page.locator('.content-body-wrap pre')).toHaveCSS('background-color', 'rgb(25, 33, 32)')
  await expect(page.locator('.content-body-wrap pre')).toHaveCSS('color', 'rgb(224, 232, 229)')
  await page.screenshot({ path: 'test-results/theme-dark-desktop.png' })

  await page.getByRole('button', { name: 'EN / 中' }).click()
  await expect(page.getByRole('button', { name: '切换为浅色模式' })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: '切换为浅色模式' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await page.screenshot({ path: 'test-results/theme-dark-mobile.png' })
})
