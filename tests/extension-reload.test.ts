import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { importPiInternal } from './helpers/pi-runtime'

interface LoadedExtensions {
  errors: Array<{ error: string }>
  extensions: Array<{ commands: Map<string, { description: string }> }>
}
interface PiLoader {
  loadExtensions(paths: string[], cwd: string): Promise<LoadedExtensions>
}
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

describe('Pi 真实扩展加载与重载', () => {
  it('同一进程重载后使用修改后的后端，而非 Node 缓存的旧 ESM', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'viewer-reload-'))
    try {
      const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
      const relativeEntry = manifest.pi.extensions[0] as string
      const entry = path.resolve(directory, relativeEntry)
      const source = path.join(directory, 'src/extension/index.ts')
      await mkdir(path.dirname(source), { recursive: true })
      await writeFile(path.join(directory, 'package.json'), '{"type":"module"}')
      await writeFile(entry, await readFile(path.join(root, relativeEntry), 'utf8'))
      const backend = (version: string) => `export function registerExtension(pi, options) {
        pi.registerCommand('probe', { description: '${version}', handler: async () => {} });
        pi.registerCommand('web-root', { description: options.webRoot, handler: async () => {} });
      }`
      await writeFile(source, backend('old-build'))
      const { loadExtensions } = await importPiInternal<PiLoader>('dist/core/extensions/loader.js')
      const first = await loadExtensions([entry], directory)
      expect(first.errors).toEqual([])
      expect(first.extensions[0].commands.get('probe')?.description).toBe('old-build')
      await writeFile(source, backend('new-build'))
      const second = await loadExtensions([entry], directory)
      expect(second.errors).toEqual([])
      expect(second.extensions[0].commands.get('probe')?.description).toBe('new-build')
      expect(second.extensions[0].commands.get('web-root')?.description).toBe(path.join(directory, 'dist/web/'))
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('真实源码入口能通过 Pi 加载并注册面板命令', async () => {
    const { loadExtensions } = await importPiInternal<PiLoader>('dist/core/extensions/loader.js')
    const loaded = await loadExtensions([path.join(root, 'extension.ts')], root)
    expect(loaded.errors).toEqual([])
    expect(loaded.extensions[0].commands.has('session-viewer')).toBe(true)
  })
})
