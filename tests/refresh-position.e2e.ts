import { test, expect } from '@playwright/test'

for (const order of ['oldest-first', 'newest-first'] as const) {
  test(`${order}：刷新与重新加载保持最新端，历史阅读保留原锚点和会话`, async ({ page }) => {
    let count = 65, preferOther = false
    const modified = () => new Date(Date.UTC(2026, 0, 1, 0, 0, count)).toISOString()
    const session = (token: string) => ({ token, id: token, name: token, title: token, cwd: '/work/sticky', modifiedAt: modified(), relativePath: `${token}.jsonl` })
    await page.addInitScript((value) => localStorage.setItem('pi_session_viewer_timeline_order', value), order)
    await page.route('**/api/sessions', (route) => route.fulfill({ json: {
      root: '/sessions', currentCwd: '/work/sticky', projects: [{ cwd: '/work/sticky', name: 'sticky', count: 2, latestModifiedAt: modified() }],
      sessions: [session('sticky'), session('other')], warnings: [], initialSessionToken: preferOther ? 'other' : 'sticky',
    } }))
    await page.route('**/api/sessions/*', (route) => {
      const token = new URL(route.request().url()).pathname.split('/').at(-1)!
      const records: unknown[] = [{ type: 'session', version: 3, id: token, cwd: '/work/sticky', timestamp: modified() }]
      for (let index = 0; index < (token === 'sticky' ? count : 1); index++) {
        records.push({ type: 'message', id: `u${index}`, parentId: index ? `a${index - 1}` : null, message: { role: 'user', content: `Question ${index}` } })
        records.push({ type: 'message', id: `a${index}`, parentId: `u${index}`, message: { role: 'assistant', content: [{ type: 'text', text: `${token} Answer ${index}` }] } })
      }
      return route.fulfill({ json: { token, relativePath: `${token}.jsonl`, modifiedAt: modified(), content: records.map((record) => JSON.stringify(record)).join('\n') } })
    })
    await page.goto('/#token=dev-token')
    const scroller = page.locator('.timeline-scroll')
    const latest = () => page.locator('.event-row').filter({ hasText: `sticky Answer ${count - 1}` })
    await expect(scroller).toBeVisible()
    await page.waitForTimeout(250)
    await scroller.evaluate((element, direction) => { element.scrollTop = direction === 'oldest-first' ? element.scrollHeight : 0 }, order)
    await expect(latest()).toBeVisible()
    count += 12
    await page.getByRole('button', { name: 'Reload sessions and list', exact: true }).click()
    await expect(latest()).toBeVisible()
    // 目录的默认会话变了，重新加载仍应回到原会话的最新端。
    preferOther = true
    count += 12
    await page.reload()
    await expect(latest()).toBeVisible()
    await page.waitForTimeout(350)
    const anchorPosition = () => scroller.evaluate((element) => {
      const top = element.getBoundingClientRect().top + element.clientTop
      const row = [...element.querySelectorAll<HTMLElement>('.event-row')].find((row) => row.getBoundingClientRect().bottom > top)
      return row ? { id: row.dataset.eventId!, offset: row.getBoundingClientRect().top - top } : null
    })
    await scroller.evaluate((element) => { element.scrollTop = element.scrollHeight / 2 })
    await page.waitForTimeout(250)
    const anchor = (await anchorPosition())!
    count += 8
    await page.getByRole('button', { name: 'Reload sessions and list', exact: true }).click()
    await expect(page.locator('.session-summary > div').first().locator('strong')).toHaveText(String(count * 2))
    const restoredOffset = () => scroller.evaluate((element, id) => {
      const row = [...element.querySelectorAll<HTMLElement>('.event-row')].find((row) => row.dataset.eventId === id)
      return row ? row.getBoundingClientRect().top - element.getBoundingClientRect().top - element.clientTop : null
    }, anchor.id)
    await expect.poll(restoredOffset).not.toBeNull()
    await expect.poll(async () => Math.abs((await restoredOffset() ?? 9999) - anchor.offset)).toBeLessThan(2)
    count += 8
    await page.reload()
    await expect.poll(restoredOffset).not.toBeNull()
    await expect.poll(async () => Math.abs((await restoredOffset() ?? 9999) - anchor.offset)).toBeLessThan(2)
    await expect(page.locator('.session-summary > div').first().locator('strong')).toHaveText(String(count * 2))
  })
}
