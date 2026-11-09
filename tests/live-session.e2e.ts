import { test, expect } from '@playwright/test'
import { mkdir, writeFile, appendFile, rm } from 'node:fs/promises'
import path from 'node:path'

test('Live 只更新当前会话、空闲轻量检查、保持阅读位置并在最新端自动跟随', async ({ page }) => {
  test.setTimeout(45_000)
  const directory = path.resolve('tests/fixtures/sessions/live-check')
  const file = path.join(directory, 'session.jsonl')
  const timestamp = '2026-01-01T00:00:00Z'
  await mkdir(directory, { recursive: true })
  try {
    const records: unknown[] = [{ type: 'session', version: 3, id: 'live-check', cwd: '/work/live-check', timestamp }]
    for (let index = 0; index < 60; index++) {
      records.push({ type: 'message', id: `u${index}`, parentId: index ? `a${index - 1}` : null, timestamp, message: { role: 'user', content: `Question ${index}` } })
      records.push({ type: 'message', id: `a${index}`, parentId: `u${index}`, timestamp, message: { role: 'assistant', content: [{ type: 'text', text: `Answer ${index}` }] } })
    }
    await writeFile(file, records.map((entry) => JSON.stringify(entry)).join('\n') + '\n')
    let requests = 0, idle = 0, catalogs = 0
    const updates: unknown[] = []
    page.on('request', (request) => { const url = new URL(request.url()); if (url.pathname === '/api/live') requests++; if (url.pathname === '/api/sessions') catalogs++ })
    page.on('response', async (response) => {
      if (new URL(response.url()).pathname !== '/api/live') return
      if (response.status() === 304) idle++
      else if (response.status() === 200) updates.push(await response.json().catch(() => null))
    })
    await page.goto('/#token=dev-token&cwd=/work/live-check')
    const live = page.getByRole('button', { name: 'Live updates', exact: true })
    await expect(live).toHaveAttribute('aria-pressed', 'false')
    await page.locator('.event-row.event--user').first().click()
    await page.getByRole('tab', { name: 'Overview', exact: true }).click()
    const selected = await page.locator('.event-row[aria-selected="true"]').getAttribute('data-event-id')
    await live.click()
    await expect(live).toHaveAttribute('data-status', 'watching')
    await expect.poll(() => idle).toBeGreaterThan(0)
    const catalogCount = catalogs
    await appendFile(file, JSON.stringify({ type: 'message', id: 'new', parentId: 'a59', timestamp, message: { role: 'user', content: 'Live appended question' } }) + '\n')
    await expect.poll(() => updates.some((update: any) => update?.delta?.events.some((event: any) => event.content === 'Live appended question'))).toBe(true)
    await expect(page.locator('.event-row[aria-selected="true"]')).toHaveAttribute('data-event-id', selected!)
    await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute('aria-selected', 'true')
    const scroller = page.locator('.timeline-scroll')
    expect(await scroller.evaluate((element) => element.scrollTop)).toBeLessThan(20)
    expect(catalogs).toBe(catalogCount)
    await scroller.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await expect(page.locator('.event-row').filter({ hasText: 'Live appended question' })).toBeVisible()
    await appendFile(file, JSON.stringify({ type: 'message', id: 'answer', parentId: 'new', timestamp, message: { role: 'assistant', content: [{ type: 'text', text: 'Live final answer' }] } }) + '\n')
    await expect(page.locator('.event-row').filter({ hasText: 'Live final answer' })).toBeVisible()
    // 浏览器后台暂停；回到前台立即继续。
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')) })
    await expect(live).toHaveAttribute('data-status', 'paused')
    const paused = requests
    await page.waitForTimeout(2400)
    expect(requests).toBe(paused)
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')) })
    await expect(live).toHaveAttribute('data-status', 'watching')
    let failOnce = true
    await page.route('**/api/live?**', async (route) => {
      if (failOnce) { failOnce = false; await route.fulfill({ status: 503, json: { error: 'Temporary disconnect' } }) }
      else await route.continue()
    })
    await expect(live).toHaveAttribute('data-status', 'retrying', { timeout: 6000 })
    await expect(live).toHaveAttribute('data-status', 'watching', { timeout: 10_000 })
    await page.setViewportSize({ width: 320, height: 720 })
    const bounds = (await live.boundingBox())!
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320)
    await live.click()
    await expect(live).toHaveAttribute('aria-pressed', 'false')
    const stopped = requests
    await page.waitForTimeout(2400)
    expect(requests).toBe(stopped)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
