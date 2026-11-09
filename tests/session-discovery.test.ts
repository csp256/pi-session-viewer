import { appendFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizePath } from '../src/core/path'
import {
  buildProjectSummaries,
  disambiguateProjectNames,
  discoverSessionCatalog,
  listSessions,
} from '../src/server/session-discovery'
import type { SessionListItem } from '../src/core/types'
import { piSessionHeader } from './helpers/pi-session'

const directories: string[] = []

beforeEach(async () => {
  const cache = await mkdtemp(path.join(os.tmpdir(), 'pi-session-discovery-cache-'))
  directories.push(cache)
  vi.stubEnv('PI_SESSION_VIEWER_CACHE_DIR', cache)
})

afterEach(async () => {
  vi.unstubAllEnvs()
  while (directories.length) {
    await rm(directories.pop() as string, { recursive: true, force: true })
  }
})

describe('SessionCatalogDiscovery at Filesystem Seam', () => {
  describe('path normalization and disambiguation', () => {
    it('normalizes backslashes and trailing slashes', () => {
      expect(normalizePath('C:\\Users\\admin\\project\\')).toBe('C:/Users/admin/project')
      expect(normalizePath('/home/user/repo//')).toBe('/home/user/repo')
      expect(normalizePath(null)).toBe('')
      expect(normalizePath('')).toBe('')
    })

    it('preserves single or distinct project basenames without extra prefix', () => {
      const names = disambiguateProjectNames([
        '/home/user/workspace/project-alpha',
        '/home/user/workspace/project-beta',
      ])
      expect(names.get('/home/user/workspace/project-alpha')).toBe('project-alpha')
      expect(names.get('/home/user/workspace/project-beta')).toBe('project-beta')
    })

    it('automatically adds parent directory prefix when basenames collide', () => {
      const names = disambiguateProjectNames([
        '/home/user/repo-one/server',
        '/home/user/repo-two/server',
        '/home/user/workspace/client',
      ])
      expect(names.get('/home/user/repo-one/server')).toBe('repo-one/server')
      expect(names.get('/home/user/repo-two/server')).toBe('repo-two/server')
      expect(names.get('/home/user/workspace/client')).toBe('client')
    })

    it('expands multiple directory levels when parent directories also collide', () => {
      const names = disambiguateProjectNames([
        '/home/user/work-a/packages/common',
        '/home/user/work-b/packages/common',
      ])
      expect(names.get('/home/user/work-a/packages/common')).toBe('work-a/packages/common')
      expect(names.get('/home/user/work-b/packages/common')).toBe('work-b/packages/common')
    })
  })

  describe('buildProjectSummaries', () => {
    const mockSessions: SessionListItem[] = [
      {
        token: 's1',
        id: '1',
        title: 'Session 1',
        cwd: '/home/user/repo-a/server',
        modifiedAt: '2026-09-10T10:00:00.000Z',
        relativePath: 'repo-a.jsonl',
      },
      {
        token: 's2',
        id: '2',
        title: 'Session 2',
        cwd: '/home/user/repo-a/server',
        modifiedAt: '2026-09-12T10:00:00.000Z',
        relativePath: 'repo-a-2.jsonl',
      },
      {
        token: 's3',
        id: '3',
        title: 'Session 3',
        cwd: '/home/user/repo-b/server',
        modifiedAt: '2026-09-11T10:00:00.000Z',
        relativePath: 'repo-b.jsonl',
      },
    ]

    it('groups sessions by unique cwd, disambiguates names, and sorts by activity', () => {
      const { projects, projectNames } = buildProjectSummaries(mockSessions)
      expect(projects).toHaveLength(2)

      expect(projects[0].cwd).toBe('/home/user/repo-a/server')
      expect(projects[0].name).toBe('repo-a/server')
      expect(projects[0].count).toBe(2)

      expect(projects[1].cwd).toBe('/home/user/repo-b/server')
      expect(projects[1].name).toBe('repo-b/server')
      expect(projects[1].count).toBe(1)

      expect(projectNames.get('/home/user/repo-a/server')).toBe('repo-a/server')
      expect(projectNames.get('/home/user/repo-b/server')).toBe('repo-b/server')
    })
  })

  describe('discoverSessionCatalog filesystem traversal', () => {
    it('读取前缀之后追加的最新名称，并在重命名后更新缓存', async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'pi-session-names-'))
      directories.push(root)
      const file = path.join(root, 'named.jsonl')
      const entry = (id: string, name: unknown) => JSON.stringify({
        type: 'session_info', id, parentId: null, timestamp: '2026-01-01T10:00:00.000Z', name,
      })
      await writeFile(file, [
        piSessionHeader('named', '2026-01-01T10:00:00.000Z', '/work/demo'),
        entry('early', 'Original name'),
        JSON.stringify({ type: 'custom', id: 'large', data: 'x'.repeat(300_000) }),
        entry('latest', '发布检查 · Release review'),
        '{"type":"session_info",',
        entry('invalid', 42),
        entry('empty', ''),
      ].join('\n') + '\n')

      const first = (await listSessions(root)).sessions[0]
      expect(first.name).toBe('发布检查 · Release review')
      expect(first.title).toBe(first.name)
      expect((await listSessions(root)).sessions[0]).toEqual(first)

      await appendFile(file, entry('rename', 'Renamed release review') + '\n')
      const renamed = (await listSessions(root)).sessions[0]
      expect(renamed.name).toBe('Renamed release review')
      expect(renamed.title).toBe(renamed.name)
    })

    it('短会话保留显式名称，未命名会话使用用户消息或文件名', async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'pi-session-name-fallback-'))
      directories.push(root)
      const header = (id: string) => piSessionHeader(id, '2026-01-01T10:00:00.000Z', '/work/demo')
      const user = JSON.stringify({
        type: 'message', id: 'user', parentId: null, timestamp: '2026-01-01T10:00:01.000Z',
        message: { role: 'user', content: 'First user request' },
      })
      await writeFile(path.join(root, 'short.jsonl'), [header('short'), user, JSON.stringify({
        type: 'session_info', id: 'info', parentId: 'user', name: 'Short named session',
      })].join('\n'))
      await writeFile(path.join(root, 'unnamed.jsonl'), [header('unnamed'), user].join('\n'))
      await writeFile(path.join(root, 'empty.jsonl'), header('empty'))
      await writeFile(path.join(root, 'large-unnamed.jsonl'), [header('large-unnamed'), user,
        JSON.stringify({ type: 'custom', id: 'large', data: 'x'.repeat(300_000) }),
      ].join('\n'))

      const sessions = (await listSessions(root)).sessions
      expect(sessions.find((s) => s.id === 'short')).toMatchObject({ name: 'Short named session', title: 'Short named session' })
      for (const id of ['unnamed', 'large-unnamed']) {
        const session = sessions.find((s) => s.id === id)!
        expect(session.name).toBeUndefined()
        expect(session.title).toBe('First user request')
      }
      expect(sessions.find((s) => s.id === 'empty')?.title).toBe('empty.jsonl')
    })

    it('保留带 parentSession 的派生会话及其名称，仍排除已知子代理', async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'pi-session-fork-test-'))
      directories.push(root)
      const timestamp = '2026-01-01T10:00:00.000Z'
      const original = path.join(root, 'symrs.jsonl')
      await writeFile(original, piSessionHeader('original', timestamp, '/work/symrs') + '\n')
      const fork = [
        piSessionHeader('fork', timestamp, '/work/isovis', { parentSession: original }),
        JSON.stringify({ type: 'custom', id: 'padding', data: 'x'.repeat(300_000) }),
        JSON.stringify({ type: 'session_info', id: 'name', parentId: 'padding', timestamp, name: 'isovis' }),
      ].join('\n') + '\n'
      await writeFile(path.join(root, 'isovis.jsonl'), fork)
      await writeFile(path.join(root, 'worker.jsonl'), piSessionHeader('subagent-worker', timestamp, '/work/isovis', { parentSession: original }) + '\n')
      const result = await discoverSessionCatalog(root, '/work/isovis')
      expect(result.sessions.map((session) => session.id).sort()).toEqual(['fork', 'original'])
      const session = result.sessions.find((session) => session.id === 'fork')!
      expect(session).toMatchObject({ name: 'isovis', title: 'isovis', parentSession: original, projectName: 'isovis' })
      expect(result.projects.find((project) => project.cwd === '/work/isovis')?.count).toBe(1)
      expect(result.initialSessionToken).toBe(session.token)
      expect((await listSessions(root)).sessions.find((session) => session.id === 'fork')).toEqual(session)
    })

    it('discovers top-level sessions, excludes subagents/mirrors, and pre-groups catalog', async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'pi-session-catalog-test-'))
      directories.push(root)

      const writeSession = async (relPath: string, id: string, cwd: string, extra: Record<string, unknown> = {}) => {
        const fullPath = path.join(root, relPath)
        await mkdir(path.dirname(fullPath), { recursive: true })
        const content = `${piSessionHeader(id, '2026-01-01T10:00:00.000Z', cwd, extra)}\n`
        await writeFile(fullPath, content)
      }

      // Valid sessions
      await writeSession('repo-a/session-1.jsonl', 's1', '/work/repo-a/server')
      await writeSession('repo-a/session-2.jsonl', 's2', '/work/repo-a/server')
      await writeSession('repo-b/session-3.jsonl', 's3', '/work/repo-b/server')
      await writeSession('repo-c/session-4.jsonl', 's4', '/work/client')

      // Subagent / excluded sessions
      await writeSession('subagent-artifacts/child.jsonl', 'sub-1', '/work/repo-a/server', { parentSession: 's1' })
      await writeSession('repo-a/subagents/run-0.jsonl', 'sub-2', '/work/repo-a/server')
      await writeSession('11111111-1111-4111-8111-111111111111/run-0/session.jsonl', 'run-0', '/work/repo-a/server')
      await writeSession('repo-a/run_transcript.jsonl', 'mirror', '/work/repo-a/server')
      await writeSession('events.jsonl', 'events', '/work/repo-a/server')

      const result = await discoverSessionCatalog(root, '/work/repo-b/server')

      expect(result.sessions.map((s) => s.id).sort()).toEqual(['s1', 's2', 's3', 's4'])
      expect(result.projects).toHaveLength(3)

      const repoA = result.projects.find((p) => p.cwd === '/work/repo-a/server')
      const repoB = result.projects.find((p) => p.cwd === '/work/repo-b/server')
      const client = result.projects.find((p) => p.cwd === '/work/client')

      expect(repoA?.count).toBe(2)
      expect(repoA?.name).toBe('repo-a/server')
      expect(repoB?.count).toBe(1)
      expect(repoB?.name).toBe('repo-b/server')
      expect(client?.count).toBe(1)
      expect(client?.name).toBe('client')

      // Pre-assigned projectName on sessions
      const s1 = result.sessions.find((s) => s.id === 's1')
      expect(s1?.projectName).toBe('repo-a/server')

      // Initial session token matches preferred currentCwd
      expect(result.initialSessionToken).toBe(result.sessions.find((s) => s.id === 's3')?.token)

      // listSessions alias also works identically
      const listResult = await listSessions(root)
      expect(listResult.sessions.map((s) => s.id).sort()).toEqual(['s1', 's2', 's3', 's4'])
    })
  })
})
