import { expect, test } from '@playwright/test'

const timestamp = '2026-01-01T10:00:00.000Z'
test.beforeEach(async ({ page }) => {
  await page.route('**/api/sessions', (route) => route.fulfill({ json: {
    root: '/sessions', warnings: [], currentCwd: '/work/order',
    projects: [{ cwd: '/work/order', name: 'order', count: 1, latestModifiedAt: timestamp }],
    sessions: [{ token: 'order', id: 'order', name: 'Order test', cwd: '/work/order', title: 'Order test', timestamp, modifiedAt: timestamp, relativePath: 'order.jsonl' }],
  } }))
  await page.route('**/api/sessions/order', (route) => route.fulfill({ json: {
    token: 'order', relativePath: 'order.jsonl', modifiedAt: timestamp,
    contextProjections: { a2: { leafId: 'a2', messageCount: 212, contextEntryCount: 212, excluded: {} } },
    content: [
      { type: 'session', version: 3, id: 'order', timestamp, cwd: '/work/order' },
      { type: 'message', id: 'u1', parentId: null, timestamp, message: { role: 'user', content: 'First question' } },
      { type: 'custom', customType: 'pi-session-viewer.system-prompt', id: 'prompt', parentId: 'u1', timestamp, data: { prompt: '# Instructions\nBe helpful.', targetUserEntryId: 'u1' } },
      { type: 'message', id: 'a1', parentId: 'prompt', timestamp, message: { role: 'assistant', content: [{ type: 'text', text: 'First answer' }, { type: 'toolCall', id: 'call', name: 'bash', arguments: { command: 'echo one' } }] } },
      { type: 'message', id: 'r1', parentId: 'a1', timestamp, message: { role: 'toolResult', toolCallId: 'call', toolName: 'bash', content: [{ type: 'text', text: 'Tool output' }], isError: false } },
      { type: 'message', id: 'u2', parentId: 'r1', timestamp, message: { role: 'user', content: 'Second question' } },
      { type: 'message', id: 'a2', parentId: 'u2', timestamp, message: { role: 'assistant', content: [{ type: 'text', text: 'Second answer' }] } },
    ].map((entry) => JSON.stringify(entry)).join('\n'),
  } }))
  await page.goto('/#token=dev-token')
  await expect(page.locator('.event-row')).toHaveCount(4)
})

for (const tab of ['Overview', 'Content', 'Raw']) {
  test(`切换事件保留 ${tab} 页签并刷新对应详情`, async ({ page }) => {
    const rows = page.locator('.event-row')
    await rows.first().click()
    const selectedTab = page.getByRole('tab', { name: tab, exact: true })
    await selectedTab.click()
    await rows.nth(1).click()
    await expect(selectedTab).toHaveAttribute('aria-selected', 'true')
    const body = page.locator('.inspector-body')
    if (tab === 'Overview') {
      await expect(body.locator('.inspector-overview')).toBeVisible()
      await expect(body).toContainText('a1')
    } else {
      await expect(body.locator(tab === 'Raw' ? '.raw-view pre' : '.content-view pre')).toContainText('First answer')
    }
    await page.getByRole('checkbox', { name: 'Tool Result', exact: true }).check()
    await page.locator('.event-row.event--tool-result').click()
    await expect(selectedTab).toHaveAttribute('aria-selected', 'true')
    if (tab !== 'Overview') await expect(body.locator('pre')).toContainText('Tool output')
    await rows.first().click()
    await expect(selectedTab).toHaveAttribute('aria-selected', 'true')
  })
}

test('专用页签不可用时临时回退，返回提示词后恢复原选择', async ({ page }) => {
  await page.getByRole('checkbox', { name: 'System Prompt', exact: true }).check()
  const prompt = page.locator('.event-row.event--system-prompt').filter({ hasText: 'Full snapshot' })
  await prompt.click()
  const composition = page.getByRole('tab', { name: 'Composition', exact: true })
  await composition.click()
  await page.locator('.event-row.event--user').first().click()
  await expect(composition).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'Content', exact: true })).toHaveAttribute('aria-selected', 'true')
  await prompt.click()
  await expect(composition).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.prompt-composition')).toBeVisible()
})
