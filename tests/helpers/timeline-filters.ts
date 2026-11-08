import type { Page } from '@playwright/test'

// 详情交互测试主动开启辅助事件，不依赖首次打开时的默认筛选。
export async function enableDetailedEventFilters(page: Page) {
  for (const name of ['System Prompt', 'Tool Definitions', 'Thinking', 'Tool Call', 'Tool Result']) {
    await page.getByLabel(name, { exact: true }).check()
  }
}
