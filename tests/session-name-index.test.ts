import { appendFile, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSessionNameIndex } from '../src/server/session-name-index'

let root: string
let file: string
let cache: string
const info = (name: string) => JSON.stringify({ type: 'session_info', name })

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'pi-name-index-'))
  file = path.join(root, 'session.jsonl')
  cache = path.join(root, 'cache')
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('持久化增量名称索引', () => {
  it('巨大工具结果只需首次扫描；重启后无需重读会话，追加只读取新增字节和固定指纹', async () => {
    const content = [info('First'), JSON.stringify({ type: 'message', data: 'x'.repeat(6 * 1024 * 1024) }), info('Latest')].join('\n') + '\n'
    await writeFile(file, content)
    const first = await createSessionNameIndex(cache).lookup(file)
    expect(first.name).toBe('Latest')
    expect(first.bytesRead).toBe(Buffer.byteLength(content) + 256)
    const restarted = createSessionNameIndex(cache)
    expect(await restarted.lookup(file)).toEqual({ name: 'Latest', bytesRead: 0 })
    const appended = info('Renamed · 发布') + '\n'
    await appendFile(file, appended)
    const next = await restarted.lookup(file)
    expect(next.name).toBe('Renamed · 发布')
    expect(next.bytesRead).toBe(Buffer.byteLength(appended) + 512)
    expect(await createSessionNameIndex(cache).lookup(file)).toEqual({ name: next.name, bytesRead: 0 })
  })

  it('未命名的大文件也会记住扫描位置，后续新增名称无需重扫', async () => {
    await writeFile(file, JSON.stringify({ type: 'message', data: 'x'.repeat(400_000) }) + '\n')
    const index = createSessionNameIndex(cache)
    expect((await index.lookup(file)).name).toBeUndefined()
    const line = info('New name') + '\n'
    await appendFile(file, line)
    const result = await createSessionNameIndex(cache).lookup(file)
    expect(result).toEqual({ name: 'New name', bytesRead: Buffer.byteLength(line) + 512 })
  })

  it('部分写入的最后一行在重启后重新读取，并保留 UTF-8', async () => {
    const prefix = info('Previous') + '\n'
    const next = Buffer.from(info('新的名称 · café 🌟') + '\n')
    const split = next.indexOf(Buffer.from('名')) + 1
    await writeFile(file, Buffer.concat([Buffer.from(prefix), next.subarray(0, split)]))
    expect((await createSessionNameIndex(cache).lookup(file)).name).toBe('Previous')
    const checkpoint = JSON.parse(await readFile(path.join(cache, (await readdir(cache))[0]), 'utf8'))
    expect(checkpoint.offset).toBe(Buffer.byteLength(prefix))
    await appendFile(file, next.subarray(split))
    expect((await createSessionNameIndex(cache).lookup(file)).name).toBe('新的名称 · café 🌟')
  })

  it('无结尾换行的有效名称可显示，下一次追加仍从该行起点读取', async () => {
    await writeFile(file, info('First'))
    expect((await createSessionNameIndex(cache).lookup(file)).name).toBe('First')
    await appendFile(file, '\r\n' + info('Second') + '\r\n')
    expect((await createSessionNameIndex(cache).lookup(file)).name).toBe('Second')
  })

  it('跨读取块的大名称、不同键序和损坏行可被正确处理', async () => {
    const longName = '发布'.repeat(40_000)
    await writeFile(file, info(longName) + '\r\n')
    const index = createSessionNameIndex(cache)
    expect((await index.lookup(file)).name).toBe(longName)
    await appendFile(file, '{bad json session_info}\n' + JSON.stringify({ name: 'Reordered', type: 'session_info' }) + '\n' + info('') + '\n')
    expect((await index.lookup(file)).name).toBe('Reordered')
  })

  it('不会把工具内容中的 session_info 当作名称', async () => {
    await writeFile(file, info('Real') + '\n' + JSON.stringify({ type: 'message', content: info('Fake') }) + '\n')
    expect((await createSessionNameIndex(cache).lookup(file)).name).toBe('Real')
  })

  it.each(['{bad json', '{}', '{"version":999}'])('损坏或未知版本的磁盘缓存安全重建：%s', async (contents) => {
    await writeFile(file, info('Real') + '\n')
    await createSessionNameIndex(cache).lookup(file)
    await writeFile(path.join(cache, (await readdir(cache))[0]), contents)
    const result = await createSessionNameIndex(cache).lookup(file)
    expect(result.name).toBe('Real')
    expect(result.bytesRead).toBeGreaterThan(0)
  })

  it('文件被截断、替换或增长式重写时重新建立索引', async () => {
    await writeFile(file, info('Original') + '\n' + JSON.stringify({ type: 'message', data: 'x'.repeat(400_000) }) + '\n')
    const index = createSessionNameIndex(cache)
    await index.lookup(file)
    await writeFile(file, info('Truncated') + '\n')
    expect((await index.lookup(file)).name).toBe('Truncated')
    const replacement = path.join(root, 'replacement.jsonl')
    await writeFile(replacement, info('Replacement') + '\n')
    await rename(replacement, file)
    expect((await index.lookup(file)).name).toBe('Replacement')
    const rewritten = info('Rewritten') + '\n' + JSON.stringify({ type: 'message', data: 'x'.repeat(500_000) }) + '\n'
    await writeFile(file, rewritten)
    const result = await index.lookup(file)
    expect(result.name).toBe('Rewritten')
    expect(result.bytesRead).toBeGreaterThanOrEqual(Buffer.byteLength(rewritten))
  })

  it('缓存目录不可写时仍能发现名称并使用内存索引', async () => {
    await writeFile(file, info('Real') + '\n')
    await writeFile(cache, 'not a directory')
    const index = createSessionNameIndex(cache)
    expect((await index.lookup(file)).name).toBe('Real')
    expect(await index.lookup(file)).toEqual({ name: 'Real', bytesRead: 0 })
  })

  it('合并同一文件的并发查询', async () => {
    await writeFile(file, info('Real') + '\n')
    const index = createSessionNameIndex(cache)
    const first = index.lookup(file)
    const second = index.lookup(file)
    expect(second).toBe(first)
    expect((await first).name).toBe('Real')
  })
})
