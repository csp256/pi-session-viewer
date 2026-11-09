import { expect, test, type Locator, type Page } from '@playwright/test'

async function width(locator: Locator) {
  return locator.evaluate((element) => element.getBoundingClientRect().width)
}

async function drag(page: Page, separator: Locator, delta: number) {
  const box = (await separator.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + 160
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + delta, y, { steps: 8 })
  await page.mouse.up()
}

test('左右分隔条可拖动、缩小、独立调整并在刷新后保留', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/#token=dev-token')
  const left = page.getByRole('separator', { name: 'Resize session sidebar' })
  const right = page.getByRole('separator', { name: 'Resize details sidebar' })
  const sidebar = page.locator('.sidebar-layer')
  const inspector = page.locator('.inspector')
  await expect(left).toHaveAttribute('aria-valuenow', '240')
  await expect(right).toHaveAttribute('aria-valuenow', '384')

  await drag(page, left, 120)
  expect(await width(sidebar)).toBe(360)
  expect(await width(inspector)).toBe(384)
  expect(await width(page.locator('.product-mark'))).toBe(360)
  await drag(page, right, -100)
  expect(await width(inspector)).toBe(484)
  expect(await width(sidebar)).toBe(360)
  await drag(page, left, -60)
  await drag(page, right, 40)
  expect(await width(sidebar)).toBe(300)
  expect(await width(inspector)).toBe(444)
  await expect(page.locator('html')).not.toHaveClass(/is-resizing-panels/)

  await page.reload()
  await expect(left).toHaveAttribute('aria-valuenow', '300')
  await expect(right).toHaveAttribute('aria-valuenow', '444')
  expect(await width(sidebar)).toBe(300)
  expect(await width(inspector)).toBe(444)
  await left.dblclick()
  await right.dblclick()
  await expect(left).toHaveAttribute('aria-valuenow', '240')
  await expect(right).toHaveAttribute('aria-valuenow', '384')
})

test('键盘可调整宽度，并限制最小侧栏和时间轴空间', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/')
  const left = page.getByRole('separator', { name: 'Resize session sidebar' })
  const right = page.getByRole('separator', { name: 'Resize details sidebar' })
  await left.focus()
  await left.press('ArrowRight')
  await expect(left).toHaveAttribute('aria-valuenow', '256')
  await right.focus()
  await right.press('Shift+ArrowLeft')
  await expect(right).toHaveAttribute('aria-valuenow', '448')
  await left.press('Home')
  await expect(left).toHaveAttribute('aria-valuenow', '180')
  await right.press('Home')
  await expect(right).toHaveAttribute('aria-valuenow', '240')
  await left.press('End')
  await expect(left).toHaveAttribute('aria-valuenow', '680')
  expect(await width(page.locator('.main-stage'))).toBeGreaterThanOrEqual(360)
  await drag(page, right, -1000)
  await expect(right).toHaveAttribute('aria-valuenow', '240')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1280)
})

test('窗口变小时约束宽度，恢复窗口后还原偏好，窄屏保留抽屉', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/#token=dev-token')
  const left = page.getByRole('separator', { name: 'Resize session sidebar' })
  const right = page.getByRole('separator', { name: 'Resize details sidebar' })
  await drag(page, left, 160)
  await drag(page, right, -116)
  await page.setViewportSize({ width: 981, height: 1000 })
  await expect.poll(() => width(page.locator('.main-stage'))).toBeGreaterThanOrEqual(360)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(981)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(left).toBeHidden()
  await expect(right).toBeHidden()
  await page.getByRole('button', { name: 'Open session list', exact: true }).click()
  await expect(page.locator('.sidebar-layer')).toHaveClass(/is-open/)
  await expect(page.locator('.session-sidebar')).toBeVisible()
  await page.getByRole('button', { name: 'Close overlay', exact: true }).click({ position: { x: 380, y: 20 } })
  await page.getByRole('button', { name: 'Open details', exact: true }).click()
  await expect(page.locator('.inspector')).toHaveClass(/is-mobile-open/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await expect(left).toHaveAttribute('aria-valuenow', '400')
  await expect(right).toHaveAttribute('aria-valuenow', '500')
})

test('存储不可用时仍可拖动；取消指针操作后恢复光标', async ({ page }) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem
    const set = Storage.prototype.setItem
    Storage.prototype.getItem = function (key) {
      if (key === 'pi_session_viewer_sidebar_widths') throw new Error('blocked')
      return get.call(this, key)
    }
    Storage.prototype.setItem = function (key, value) {
      if (key === 'pi_session_viewer_sidebar_widths') throw new Error('blocked')
      return set.call(this, key, value)
    }
  })
  await page.goto('/')
  const left = page.getByRole('separator', { name: 'Resize session sidebar' })
  await drag(page, left, 60)
  await expect(left).toHaveAttribute('aria-valuenow', '300')
  const box = (await left.boundingBox())!
  await page.mouse.move(box.x + 4, box.y + 100)
  await page.mouse.down()
  await expect(page.locator('html')).toHaveClass(/is-resizing-panels/)
  await left.dispatchEvent('pointercancel', { pointerId: 1 })
  await expect(page.locator('html')).not.toHaveClass(/is-resizing-panels/)
  await page.mouse.up()
  await page.getByRole('button', { name: 'EN / 中' }).click()
  await expect(page.getByRole('separator', { name: '调整会话侧栏宽度' })).toBeVisible()
})
