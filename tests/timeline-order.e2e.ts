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
      { type: 'message', id: 'a1', parentId: 'u1', timestamp, message: { role: 'assistant', content: [{ type: 'text', text: 'First answer' }, { type: 'toolCall', id: 'call', name: 'bash', arguments: { command: 'echo one' } }] } },
      { type: 'message', id: 'r1', parentId: 'a1', timestamp, message: { role: 'toolResult', toolCallId: 'call', toolName: 'bash', content: [{ type: 'text', text: 'Tool output' }], isError: false } },
      { type: 'message', id: 'u2', parentId: 'r1', timestamp, message: { role: 'user', content: 'Second question' } },
      { type: 'message', id: 'a2', parentId: 'u2', timestamp, message: { role: 'assistant', content: [{ type: 'text', text: 'Second answer' }] } },
    ].map((entry) => JSON.stringify(entry)).join('\n'),
  } }))
  await page.goto('/#token=dev-token')
  await expect(page.locator('.event-row')).toHaveCount(4)
})

test('反转轮次与事件，保留选择、筛选与键盘顺序，并记住偏好', async ({ page }) => {
  const rows = page.locator('.event-row')
  const order = page.getByRole('button', { name: 'Reverse timeline order' })
  const original = await rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-event-id')))
  await rows.nth(1).click()
  const selected = await rows.nth(1).getAttribute('data-event-id')
  await expect(order).toHaveAttribute('title', 'Oldest first · Reverse timeline order')
  await order.click()
  await expect(order).toHaveAttribute('title', 'Newest first · Reverse timeline order')
  await expect(order).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-event-id')))).toEqual([...original].reverse())
  await expect(page.locator('.event-row[aria-selected="true"]')).toHaveAttribute('data-event-id', selected!)
  await expect(page.getByRole('checkbox', { name: 'Tool Result', exact: true })).not.toBeChecked()
  await page.locator('[role="listbox"]').focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.locator('.event-row[aria-selected="true"]')).toHaveAttribute('data-event-id', original[0]!)
  await page.reload()
  await expect(order).toHaveAttribute('title', 'Newest first · Reverse timeline order')
  await expect(rows.first()).toContainText('Second answer')
  await order.click()
  await expect.poll(() => rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-event-id')))).toEqual(original)
})

test('反转后工具因果线连接方向正确，阅读弹窗仍打开对应内容', async ({ page }) => {
  await page.getByRole('checkbox', { name: 'Tool Call', exact: true }).check()
  await page.getByRole('checkbox', { name: 'Tool Result', exact: true }).check()
  const call = page.locator('.event-row.event--tool-call')
  const result = page.locator('.event-row.event--tool-result')
  await expect(call.locator('.causal-rail--start')).toHaveCount(1)
  await expect(result.locator('.causal-rail--end')).toHaveCount(1)
  await page.getByRole('button', { name: 'Reverse timeline order' }).click()
  await expect(call.locator('.causal-rail--end')).toHaveCount(1)
  await expect(result.locator('.causal-rail--start')).toHaveCount(1)
  await result.dblclick()
  await expect(page.getByRole('dialog').locator('.event-reader-source')).toHaveText('Tool output')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'EN / 中' }).click()
  await expect(page.getByRole('button', { name: '反转时间线顺序' })).toHaveAttribute('title', '最新在前 · 反转时间线顺序')
})

test('无效偏好回退；存储不可用仍可切换；窄屏按钮可用', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pi_session_viewer_timeline_order', 'invalid'))
  await page.reload()
  const order = page.getByRole('button', { name: 'Reverse timeline order' })
  await expect(order).toHaveAttribute('title', 'Oldest first · Reverse timeline order')
  await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked') } }))
  await page.reload()
  await page.setViewportSize({ width: 390, height: 844 })
  await order.click()
  await expect(order).toHaveAttribute('title', 'Newest first · Reverse timeline order')
  await expect(page.locator('.event-row').first()).toContainText('Second answer')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('大时间线反转后从最新事件开始，虚拟列表两端仍可到达', async ({ page }) => {
  const entries: unknown[] = [{ type: 'session', version: 3, id: 'order', timestamp, cwd: '/work/order' }]
  for (let index = 0; index < 1000; index += 1) {
    entries.push({ type: 'message', id: `u${index}`, parentId: index === 0 ? null : `a${index - 1}`, timestamp,
      message: { role: 'user', content: `Question ${index}` } })
    entries.push({ type: 'message', id: `a${index}`, parentId: `u${index}`, timestamp,
      message: { role: 'assistant', content: [{ type: 'text', text: `Answer ${index}` }] } })
  }
  await page.route('**/api/sessions/order', (route) => route.fulfill({ json: {
    token: 'order', relativePath: 'order.jsonl', modifiedAt: timestamp,
    content: entries.map((entry) => JSON.stringify(entry)).join('\n'),
  } }))
  // 新导航不恢复重新加载位置；这里单独验证大列表的顺序切换。
  await page.goto('/?large-order=1#token=dev-token')
  const rows = page.locator('.event-row')
  await expect(rows.first().locator('.event-summary')).toHaveText('Question 0')
  await page.getByRole('button', { name: 'Reverse timeline order' }).click()
  await expect(rows.first().locator('.event-summary')).toHaveText('Answer 999')
  expect(await rows.count()).toBeLessThan(100)
  const scroller = page.locator('[role="listbox"]')
  await scroller.evaluate((node) => { node.scrollTop = node.scrollHeight })
  await expect(rows.last().locator('.event-summary')).toHaveText('Question 0')
  await page.getByRole('button', { name: 'Reverse timeline order' }).click()
  await expect(rows.first().locator('.event-summary')).toHaveText('Question 0')
})


test('顺序按钮为计数右侧的紧凑双箭头，仅突出当前方向', async ({ page }) => {
  const button = page.getByRole('button', { name: 'Reverse timeline order' })
  await expect(button).toHaveText('')
  await expect(button).toHaveCSS('height', '26px')
  await expect(button).toHaveCSS('width', '32px')
  await expect(button.locator('[data-direction="down"]')).toHaveClass(/is-active/)
  await expect(button.locator('[data-direction="up"]')).not.toHaveClass(/is-active/)
  expect(await button.evaluate((node) => node.parentElement?.lastElementChild === node)).toBe(true)
  const count = page.locator('.branch-bar > span').first()
  const countBounds = (await count.boundingBox())!
  const buttonBounds = (await button.boundingBox())!
  expect(buttonBounds.x).toBeGreaterThanOrEqual(countBounds.x + countBounds.width)
  const context = page.locator('.branch-bar .context-summary')
  await expect(context).toContainText('Model context: 212 messages received')
  const contextBounds = (await context.boundingBox())!
  expect(buttonBounds.x).toBeGreaterThanOrEqual(contextBounds.x + contextBounds.width)
  expect(Math.abs((buttonBounds.y + buttonBounds.height / 2) - (contextBounds.y + contextBounds.height / 2))).toBeLessThan(1)
  await button.click()
  await expect(button.locator('[data-direction="up"]')).toHaveClass(/is-active/)
  await expect(button.locator('[data-direction="down"]')).not.toHaveClass(/is-active/)
  await button.press('Space')
  await expect(button.locator('[data-direction="down"]')).toHaveClass(/is-active/)
})
