import { expect, test } from '@playwright/test'

const timestamp = '2026-01-01T10:00:00.000Z'
const original = { type: 'message', id: 'a', parentId: 'u', timestamp, message: { role: 'assistant', content: [
  { type: 'thinking', thinking: 'Readable reasoning', thinkingSignature: 'complete original provider signature' },
  { type: 'text', text: 'Full readable answer' },
] } }

test('不等待投影即可阅读，按需加载完整 Raw，失败可重试且保留当前选择', async ({ page }) => {
  let release!: () => void
  const contextReady = new Promise<void>((resolve) => { release = resolve })
  let rawRequests = 0
  try {
    await page.route('**/api/sessions', (route) => route.fulfill({ json: {
      root: '/sessions', warnings: [], currentCwd: '/work/demo',
      projects: [{ cwd: '/work/demo', name: 'demo', count: 1, latestModifiedAt: timestamp }],
      sessions: [{ token: 'large', id: 'large', title: 'Large fixture', cwd: '/work/demo', timestamp, modifiedAt: timestamp, relativePath: 'large.jsonl' }],
    } }))
    await page.route('**/api/sessions/large', async (route) => {
      expect(route.request().headers()['x-pi-viewer-compact']).toBe('1')
      await route.fulfill({ json: {
        token: 'large', relativePath: 'large.jsonl', modifiedAt: timestamp, contextDeferred: true, deferredRawEntryIds: ['a'],
        content: [
          { type: 'session', version: 3, id: 'large', timestamp, cwd: '/work/demo' },
          { type: 'message', id: 'u', parentId: null, timestamp, message: { role: 'user', content: 'User request' } },
          { ...original, message: { ...original.message, content: [{ type: 'thinking', thinking: 'Readable reasoning' }, { type: 'text', text: 'Full readable answer' }] } },
        ].map((entry) => JSON.stringify(entry)).join('\n'),
      } })
    })
    await page.route('**/api/context?**', async (route) => {
      await contextReady
      await route.fulfill({ json: { a: { leafId: 'a', messageCount: 2, contextEntryCount: 2, excluded: {} } } }).catch(() => {})
    })
    await page.route('**/api/entry?**', async (route) => {
      rawRequests += 1
      if (rawRequests === 1) await route.fulfill({ status: 503, json: { error: 'Temporary failure' } })
      else await route.fulfill({ json: original })
    })
    await page.goto('/#token=dev-token')
    await page.locator('.event-row.event--assistant').click()
    await expect(page.locator('.inspector-body')).toContainText('Full readable answer')
    await expect(page.locator('.context-summary')).toHaveCount(0)
    expect(rawRequests).toBe(0)
    const rawTab = page.getByRole('tab', { name: 'Raw', exact: true })
    await rawTab.click()
    await expect(page.getByRole('alert')).toContainText('Could not load the original entry.')
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(page.locator('.raw-view pre')).toContainText('complete original provider signature')
    expect(rawRequests).toBe(2)
    release()
    await expect(page.locator('.context-summary')).toContainText('2 messages received')
    await expect(rawTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.raw-view pre')).toContainText('complete original provider signature')
    await page.locator('.event-row.event--user').click()
    await expect(page.locator('.raw-view pre')).toContainText('User request')
    await expect(page.locator('.raw-view pre')).not.toContainText('provider signature')
  } finally { release() }
})

test('真实轻量索引支持完整正文、Raw、阅读弹窗及后台更新且保留选择', async ({ page }) => {
  const { appendFile, mkdir, rm, writeFile } = await import('node:fs/promises')
  const path = await import('node:path')
  const directory = path.resolve('tests/fixtures/sessions/prepared-view-check')
  const file = path.join(directory, 'session.jsonl')
  const text = 'Full tool text\n' + 'Never truncate selected content.\n'.repeat(500)
  let release!: () => void
  const freshAllowed = new Promise<void>((resolve) => { release = resolve })
  await mkdir(directory, { recursive: true })
  try {
    await writeFile(file, [
      { type: 'session', version: 3, id: 'prepared', timestamp, cwd: '/work/prepared-view-check' },
      { type: 'message', id: 'u', parentId: null, timestamp, message: { role: 'user', content: 'Prepared first question' } },
      { ...original, message: { role: 'assistant', content: [
        { type: 'thinking', thinking: 'Readable reasoning', thinkingSignature: 'Complete provider signature' },
        { type: 'text', text: 'Prepared answer' },
        { type: 'toolCall', id: 'call', name: 'bash', arguments: { command: 'echo example' } },
      ] } },
      { type: 'message', id: 'r', parentId: 'a', timestamp, message: { role: 'toolResult', toolCallId: 'call', toolName: 'bash', content: [{ type: 'text', text }], isError: false } },
      { type: 'session_info', id: 'name', parentId: 'r', timestamp, name: 'Prepared session check' },
    ].map((entry) => JSON.stringify(entry)).join('\n') + '\n')
    await page.route('**/api/sessions/**', async (route) => {
      if (new URL(route.request().url()).searchParams.has('fresh')) await freshAllowed
      await route.continue({ headers: { ...route.request().headers(), 'x-pi-viewer-prepared': '1' } }).catch(() => {})
    })
    await page.goto('/#token=dev-token&cwd=/work/prepared-view-check')
    await expect(page.locator('.event-row.event--assistant')).toBeVisible()
    await page.getByRole('checkbox', { name: 'Tool Result', exact: true }).check()
    const result = page.locator('.event-row.event--tool-result')
    await result.click()
    await expect(page.locator('.inspector-body pre')).toHaveText(text)
    await result.getByRole('button', { name: 'Open reading view' }).click()
    await expect(page.getByRole('dialog').locator('.event-reader-source')).toHaveText(text)
    await page.keyboard.press('Escape')
    await page.getByRole('checkbox', { name: 'Thinking', exact: true }).check()
    await page.locator('.event-row.event--thinking').click()
    await page.getByRole('tab', { name: 'Raw', exact: true }).click()
    await expect(page.locator('.raw-view pre')).toContainText('Complete provider signature')
    await appendFile(file, JSON.stringify({ type: 'message', id: 'new', parentId: 'name', timestamp, message: { role: 'user', content: 'Newest appended record' } }) + '\n')
    await page.reload()
    await expect(page.locator('.session-update-status')).toBeVisible()
    await expect(page.locator('.event-row.event--assistant')).toContainText('Prepared answer')
    const user = page.locator('.event-row.event--user').first()
    await user.click()
    const selected = await user.getAttribute('data-event-id')
    await page.getByRole('tab', { name: 'Overview', exact: true }).click()
    release()
    await expect(page.locator('.session-update-status')).toHaveCount(0)
    await expect(page.locator('.event-row').filter({ hasText: 'Newest appended record' })).toBeVisible()
    await expect(page.locator('.event-row[aria-selected="true"]')).toHaveAttribute('data-event-id', selected!)
    await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute('aria-selected', 'true')
  } finally {
    release()
    await rm(directory, { recursive: true, force: true })
  }
})
