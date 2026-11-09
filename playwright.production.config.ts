import { defineConfig } from '@playwright/test'
import base from './playwright.config'

const port = process.env.PORT ?? '5191'

// 扩展实际提供 dist/web，而非 Vite 开发资源；验证主题在 CSS 转换后仍能切换。
export default defineConfig(base, {
  testMatch: ['**/live-session.e2e.ts', '**/large-session-loading.e2e.ts', '**/scrollbars.e2e.ts', '**/inspector-tab.e2e.ts', '**/timeline-order.e2e.ts', '**/event-reader.e2e.ts', '**/theme.e2e.ts', '**/localization.e2e.ts', '**/default-filters.e2e.ts', '**/session-names.e2e.ts', '**/sidebar-resize.e2e.ts', '**/catalog-name-index.e2e.ts'],
  use: { baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: 'node dist/standalone/index.js',
    env: {
      PORT: port,
      PI_SESSION_VIEWER_TOKEN: 'dev-token',
      PI_SESSION_VIEWER_CACHE_DIR: 'test-results/session-name-index',
      PI_CODING_AGENT_SESSION_DIR: 'tests/fixtures/sessions',
    },
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
