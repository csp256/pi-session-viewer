import { expect, test } from '@playwright/test'

const timestamp = '2026-01-01T10:00:00.000Z'
const name = '发布检查 · Release review with a long descriptive session name'

test('侧栏优先显示命名会话，并在两种主题中强调名称', async ({ page }) => {
  const sessions = [
    { token: 'named', id: 'named', title: 'Old prompt preview', name },
    { token: 'unnamed', id: 'unnamed', title: 'Unnamed session user request' },
  ].map((session) => ({
    ...session, cwd: '/work/demo', timestamp, modifiedAt: timestamp, relativePath: `${session.token}.jsonl`,
  }))
  await page.route('**/api/sessions', async (route) => route.fulfill({ json: {
    root: '/sessions', currentCwd: '/work/demo', warnings: [], sessions,
    projects: [{ cwd: '/work/demo', name: 'demo', count: 2, latestModifiedAt: timestamp }],
  } }))
  await page.route('**/api/sessions/*', async (route) => {
    const token = new URL(route.request().url()).pathname.split('/').at(-1)!
    const session = sessions.find((item) => item.token === token)!
    const entries = [
      { type: 'session', version: 3, id: token, timestamp, cwd: session.cwd },
      { type: 'message', id: 'user', parentId: null, timestamp, message: { role: 'user', content: session.title } },
      ...(session.name ? [{ type: 'session_info', id: 'info', parentId: 'user', timestamp, name: session.name }] : []),
    ]
    await route.fulfill({ json: {
      token, relativePath: session.relativePath, modifiedAt: timestamp,
      content: entries.map((entry) => JSON.stringify(entry)).join('\n'),
    } })
  })

  await page.goto('/#token=dev-token')
  const named = page.locator('.session-item').filter({ hasText: name })
  const unnamed = page.locator('.session-item').filter({ hasText: 'Unnamed session user request' })
  const label = named.locator('strong')
  await expect(label).toHaveText(name)
  await expect(label).toHaveAttribute('title', name)
  await expect(label).toHaveClass('session-item-name')
  await expect(label).toHaveCSS('color', 'rgb(131, 203, 227)')
  await expect(named).not.toContainText('Old prompt preview')
  await expect(unnamed.locator('strong')).not.toHaveClass('session-item-name')
  await expect(named).toHaveAttribute('aria-current', 'page')

  await unnamed.click()
  await expect(unnamed).toHaveAttribute('aria-current', 'page')
  await expect(label).toHaveCSS('color', 'rgb(131, 203, 227)')
  await page.getByRole('button', { name: 'Switch to light mode' }).click()
  await expect(label).toHaveCSS('color', 'rgb(36, 107, 131)')
  await expect(unnamed.locator('strong')).not.toHaveCSS('color', 'rgb(36, 107, 131)')
  await named.click()
  await expect(page.locator('.header-session strong')).toHaveText(name)
  await expect(label).toHaveCSS('color', 'rgb(36, 107, 131)')
})
