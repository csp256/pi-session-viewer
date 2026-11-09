import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const run = promisify(execFile)
const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

describe('npm package tarball', () => {
  it('包含可重载的运行时源码与预构建资源，不包含测试或开发配置', async () => {
    await run('npm', ['run', 'build'], { cwd: projectRoot })
    const result = await run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: projectRoot })
    const report = JSON.parse(result.stdout) as Array<{ files: Array<{ path: string }> }>
    const files = report[0]?.files.map((file) => file.path) ?? []

    expect(files).toContain('package.json')
    expect(files).toContain('README.md')
    expect(files).toContain('README.zh-CN.md')
    expect(files).toContain('LICENSE')
    expect(files).toContain('extension.ts')
    expect(files).toContain('src/extension/index.ts')
    expect(files).toContain('src/server/session-name-index.ts')
    expect(files).not.toContain('src/web/App.tsx')
    expect(files.some((file) => file.endsWith('.test.ts'))).toBe(false)
    expect(files).toContain('dist/extension/index.js')
    expect(files).toContain('dist/standalone/index.js')
    expect(files).toContain('dist/web/index.html')
    expect(files.every((file) => file === 'package.json' || file === 'README.md' || file === 'README.zh-CN.md' || file === 'LICENSE' || file === 'extension.ts' || file.startsWith('src/extension/') || file.startsWith('src/server/') || file.startsWith('src/core/') || file.startsWith('dist/'))).toBe(true)
  }, 30_000)
})
