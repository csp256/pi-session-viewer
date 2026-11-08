import { expect, test } from '@playwright/test'

test('默认只显示用户与 Pi 回复，其他事件仍可手动启用', async ({ page }) => {
  await page.goto('/#token=dev-token')
  await expect(page.locator('.event-row').first()).toBeVisible()
  const filters = page.locator('.filter-options input[type="checkbox"]')
  await expect(filters).toHaveCount(8)
  await expect(page.locator('.filter-options input:checked')).toHaveCount(2)
  await expect(page.getByLabel('User', { exact: true })).toBeChecked()
  await expect(page.getByLabel('Pi Response', { exact: true })).toBeChecked()
  await expect(page.locator('.event-row:not(.event--user):not(.event--assistant)')).toHaveCount(0)

  await page.getByLabel('Tool Call', { exact: true }).check()
  await expect(page.locator('.event-row.event--tool-call').first()).toBeVisible()
  await page.getByLabel('Tool Call', { exact: true }).uncheck()
  await expect(page.locator('.event-row.event--tool-call')).toHaveCount(0)

  await page.getByTitle('Select all event types', { exact: true }).click()
  await expect(page.locator('.filter-options input:checked')).toHaveCount(8)
  await page.getByTitle('Deselect all event types', { exact: true }).click()
  await expect(page.locator('.filter-options input:checked')).toHaveCount(0)
  await expect(page.getByText('Select at least one event type.')).toBeVisible()

  await page.reload()
  await expect(page.locator('.filter-options input:checked')).toHaveCount(2)
  await expect(page.getByLabel('User', { exact: true })).toBeChecked()
  await expect(page.getByLabel('Pi Response', { exact: true })).toBeChecked()
})
