import { expect, test } from '@playwright/test'

// Playwright 默认隐藏所有原生滚动条；此处必须验证真正可见和可拖动的控件。
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })

const timestamp = '2026-01-01T10:00:00.000Z'
const markdown = '# Reading example\n\nA **bold** sentence with `inline code`.\n\n```python\nprint("readable")\n```\n\n| Name | Value |\n| --- | --- |\n| One | Two |\n\n[Safe link](https://example.com)\n\n[Unsafe](javascript:alert(1))\n\n![Remote image](https://reader-test.invalid/tracker.png)\n\n<script>window.__readerExecuted = true</script>\n\n' + Array.from({ length: 100 }, (_, i) => `Paragraph ${i}: Full content stays available in the reading view.`).join('\n\n') + '\n\nEND OF FULL MESSAGE'
const toolText = '# literal output\n  indentation stays\n<unsafe>not HTML</unsafe>'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/sessions', (route) => route.fulfill({ json: {
    root: '/sessions', warnings: [], currentCwd: '/work/demo',
    projects: [{ cwd: '/work/demo', name: 'demo', count: 1, latestModifiedAt: timestamp }],
    sessions: [{ token: 'reader', id: 'reader', name: 'Reader fixture', title: 'Reader fixture', cwd: '/work/demo', timestamp, modifiedAt: timestamp, relativePath: 'reader.jsonl' }],
  } }))
  await page.route('**/api/sessions/reader', (route) => route.fulfill({ json: {
    token: 'reader', relativePath: 'reader.jsonl', modifiedAt: timestamp,
    content: [
      { type: 'session', version: 3, id: 'reader', timestamp, cwd: '/work/demo' },
      { type: 'message', id: 'u1', parentId: null, timestamp, message: { role: 'user', content: 'Please explain the example.' } },
      { type: 'message', id: 'a1', parentId: 'u1', timestamp, message: { role: 'assistant', content: [{ type: 'text', text: markdown }, { type: 'toolCall', id: 'call1', name: 'bash', arguments: { command: 'echo example' } }] } },
      { type: 'message', id: 'r1', parentId: 'a1', timestamp, message: { role: 'toolResult', toolCallId: 'call1', toolName: 'bash', content: [{ type: 'text', text: toolText }], isError: false } },
    ].map((entry) => JSON.stringify(entry)).join('\n'),
  } }))
})

test('阅读弹窗的滚动条始终占位，可仅用鼠标拖动', async ({ page }) => {
  await page.goto('/#token=dev-token')
  await page.locator('.event-row.event--assistant').dblclick()
  const body = page.getByRole('dialog').locator('.event-reader-body')
  await expect(body).toBeVisible()
  const geometry = await body.evaluate((node) => ({ gutter: node.offsetWidth - node.clientWidth, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight }))
  expect(geometry.gutter).toBe(14)
  expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight)
  const bounds = (await body.boundingBox())!
  // 从滚动块拖动，而非使用滚轮、触控板或脚本滚动。
  await page.mouse.move(bounds.x + bounds.width - 7, bounds.y + 15)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width - 7, bounds.y + 160, { steps: 12 })
  await page.mouse.up()
  await expect.poll(() => body.evaluate((node) => node.scrollTop)).toBeGreaterThan(100)
  await page.mouse.move(0, 0)
  await expect.poll(() => body.evaluate((node) => getComputedStyle(node, '::-webkit-scrollbar-thumb').backgroundColor)).toBe('rgb(165, 181, 174)')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Switch to light mode' }).click()
  await page.locator('.event-row.event--assistant').dblclick()
  await page.mouse.move(0, 0)
  await expect.poll(() => body.evaluate((node) => getComputedStyle(node, '::-webkit-scrollbar-thumb').backgroundColor)).toBe('rgb(104, 115, 111)')
})

test('长时间线无需滚轮也能拖动滚动条导航', async ({ page }) => {
  const entries: unknown[] = [{ type: 'session', version: 3, id: 'reader', timestamp, cwd: '/work/demo' }]
  for (let index = 0; index < 500; index += 1) {
    entries.push({ type: 'message', id: `u${index}`, parentId: index === 0 ? null : `a${index - 1}`, timestamp, message: { role: 'user', content: `Question ${index}` } })
    entries.push({ type: 'message', id: `a${index}`, parentId: `u${index}`, timestamp, message: { role: 'assistant', content: [{ type: 'text', text: `Answer ${index}` }] } })
  }
  await page.route('**/api/sessions/reader', (route) => route.fulfill({ json: {
    token: 'reader', relativePath: 'reader.jsonl', modifiedAt: timestamp,
    content: entries.map((entry) => JSON.stringify(entry)).join('\n'),
  } }))
  await page.goto('/#token=dev-token')
  const scroller = page.locator('[role="listbox"]')
  await expect(page.locator('.event-row').first()).toContainText('Question 0')
  await page.locator('.event-row').first().click()
  await expect(page.locator('.event-row').first()).toHaveAttribute('aria-selected', 'true')
  expect(await scroller.evaluate((node) => node.offsetWidth - node.clientWidth)).toBe(14)
  // 刻意静置，验证空闲后仍保留可拖动的滚动条。
  await page.mouse.move(0, 0)
  await page.waitForTimeout(3000)
  const bounds = (await scroller.boundingBox())!
  await page.mouse.move(bounds.x + bounds.width - 7, bounds.y + 12)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width - 7, bounds.y + bounds.height - 8, { steps: 20 })
  await page.mouse.up()
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(1000)
  await expect(page.locator('.event-row').last()).toContainText('Answer 499')
})
