import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { fileURLToPath } from 'node:url'
import { registerExtension } from './src/extension/index'

// Pi 可重新加载 TypeScript 源码；预编译 ESM 会被 Node 的原生模块缓存保留。
export default function extension(pi: ExtensionAPI): void {
  registerExtension(pi, { webRoot: fileURLToPath(new URL('./dist/web/', import.meta.url)) })
}
