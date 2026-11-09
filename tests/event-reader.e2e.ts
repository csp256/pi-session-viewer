import { expect, test } from '@playwright/test'

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
  await page.goto('/#token=dev-token')
  await expect(page.locator('.event-row.event--assistant')).toBeVisible()
})

test('双击阅读完整 Markdown，保留单击选择并支持源码与关闭', async ({ page }) => {
  let remoteImageRequested = false
  page.on('request', (request) => { if (request.url().includes('reader-test.invalid')) remoteImageRequested = true })
  const row = page.locator('.event-row.event--assistant')
  await row.click()
  await expect(row).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await row.dblclick()
  const modal = page.getByRole('dialog')
  await expect(modal).toBeVisible()
  await expect(modal.getByRole('heading', { name: 'Reading example', exact: true })).toBeVisible()
  await expect(modal.locator('strong')).toHaveText('bold')
  await expect(modal.locator('.event-reader-markdown')).toHaveCSS('font-size', '24px')
  await expect(modal.locator('pre code')).toHaveCSS('font-size', '24px')
  await expect(modal.locator('pre code')).toContainText('print("readable")')
  await expect(modal.getByRole('table')).toHaveCount(1)
  await expect(modal.locator('.event-reader-markdown')).toContainText('END OF FULL MESSAGE')
  await expect(modal.getByRole('link', { name: 'Safe link', exact: true })).toHaveAttribute('rel', 'noopener noreferrer')
  await expect(modal.locator('script, img, a[href^="javascript:"]')).toHaveCount(0)
  expect(remoteImageRequested).toBe(false)
  expect(await page.evaluate(() => '__readerExecuted' in window)).toBe(false)
  await modal.getByRole('button', { name: 'Show source' }).click()
  await expect(modal.locator('.event-reader-source')).toHaveText(markdown)
  await expect(modal.locator('.event-reader-source')).toHaveCSS('font-size', '24px')
  await modal.getByRole('button', { name: 'Render Markdown' }).click()
  await expect(modal.locator('.event-reader-markdown')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(modal).toHaveCount(0)
  await expect(page.locator('[role="listbox"]')).toBeFocused()
  await expect(row).toHaveAttribute('aria-selected', 'true')
  await row.dblclick()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(modal).toHaveCount(0)
  await row.dblclick()
  await page.mouse.click(4, 4)
  await expect(modal).toHaveCount(0)
})

test('键盘打开，焦点约束与工具结果默认纯文本', async ({ page }) => {
  await page.locator('.event-row.event--assistant').click()
  await page.keyboard.press('Shift+Enter')
  const modal = page.getByRole('dialog')
  await expect(modal).toBeVisible()
  await expect(modal.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(modal.locator('.event-reader-body')).toBeFocused()
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press('Tab')
    expect(await modal.evaluate((node) => document.activeElement === document.body || node.contains(document.activeElement))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await page.getByRole('checkbox', { name: 'Tool Result', exact: true }).check()
  await page.locator('.event-row.event--tool-result').dblclick()
  expect(await modal.locator('.event-reader-source').textContent()).toBe(toolText)
})

test('窄屏与浅色主题下可阅读并单独滚动内容', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('.event-row.event--assistant').getByRole('button', { name: 'Open reading view' }).click()
  const modal = page.getByRole('dialog')
  await expect(modal.locator('.event-reader-markdown')).toHaveCSS('font-size', '24px')
  const bounds = await modal.boundingBox()
  expect(bounds!.width).toBeLessThan(390)
  expect(bounds!.height).toBeLessThan(844)
  const body = modal.locator('.event-reader-body')
  expect(await body.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true)
  await body.evaluate((node) => { node.scrollTop = node.scrollHeight })
  await expect(modal.getByText('END OF FULL MESSAGE', { exact: true })).toBeInViewport()
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: 'Switch to light mode' }).click()
  await page.locator('.event-row.event--assistant').dblclick()
  await expect(modal).toHaveCSS('background-color', 'rgb(255, 255, 255)')
})


test('阅读弹窗跟随界面语言', async ({ page }) => {
  await page.getByRole('button', { name: 'EN / 中' }).click()
  await page.locator('.event-row.event--assistant').dblclick()
  const modal = page.getByRole('dialog')
  await expect(modal).toContainText('阅读视图')
  await modal.getByRole('button', { name: '查看源码' }).click()
  await expect(modal.getByRole('button', { name: '渲染 Markdown' })).toBeVisible()
  await modal.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(modal).toHaveCount(0)
})
