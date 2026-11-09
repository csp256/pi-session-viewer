import { appendFile, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'

test('未打开任何完整会话时，目录就显示大文件的名称并处理追加重命名', async ({ page }) => {
  const directory = path.resolve('tests/fixtures/sessions/name-index-check')
  const timestamp = '2026-01-01T10:00:00.000Z'
  const info = (id: string, name: string) => JSON.stringify({ type: 'session_info', id, parentId: 'large', timestamp, name }) + '\n'
  await mkdir(directory, { recursive: true })
  try {
    for (const id of ['alpha', 'beta']) {
      await writeFile(path.join(directory, `${id}.jsonl`), [
        JSON.stringify({ type: 'session', version: 3, id, timestamp, cwd: '/work/name-index-check' }),
        JSON.stringify({ type: 'message', id: 'user', parentId: null, timestamp, message: { role: 'user', content: 'Prompt preview, not a name' } }),
        JSON.stringify({ type: 'custom', id: 'large', parentId: 'user', data: 'x'.repeat(2 * 1024 * 1024) }),
      ].join('\n') + '\n' + info('info', `Indexed ${id} session`))
    }
    // 禁止读取完整会话，确保名称确实来自目录而非打开后的前端修正。
    await page.route('**/api/sessions/*', async (route) => route.fulfill({ status: 503, json: { error: 'Full session disabled for this test' } }))
    await page.goto('/#token=dev-token&cwd=/work/name-index-check')
    await expect(page.locator('.session-item-name').filter({ hasText: 'Indexed alpha session' })).toBeVisible()
    await expect(page.locator('.session-item-name').filter({ hasText: 'Indexed beta session' })).toBeVisible()
    await appendFile(path.join(directory, 'alpha.jsonl'), info('rename', 'Renamed alpha session'))
    await page.getByRole('button', { name: 'Reload sessions and list', exact: true }).click()
    await expect(page.locator('.session-item-name').filter({ hasText: 'Renamed alpha session' })).toBeVisible()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
