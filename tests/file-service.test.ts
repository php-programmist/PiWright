/** FileService против реального временного каталога: листинг, чтение, границы пути, вотчер. */
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { FileService, resolveWithinRoot } from '../src/main/files/file-service'
import { toProjectRelative } from '../src/shared/file-paths'
import type { ProjectEntry } from '../src/shared/ipc-contracts'

let dir: string
let project: ProjectEntry
let service: FileService

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'piwright-files-'))
  project = { kind: 'native', dir }
  mkdirSync(join(dir, 'sub'))
  mkdirSync(join(dir, 'sub', 'deep'))
  mkdirSync(join(dir, '.git'))
  writeFileSync(join(dir, 'a.txt'), 'hello')
  writeFileSync(join(dir, 'sub', 'b.txt'), 'bee')
  writeFileSync(join(dir, 'sub', 'deep', 'c.txt'), 'sea')
  writeFileSync(join(dir, '.git', 'head'), 'ref')
  writeFileSync(join(dir, 'binary.bin'), Buffer.from([1, 0, 2]))
  writeFileSync(join(dir, 'big.txt'), 'x'.repeat(3 * 1024 * 1024))
  service = new FileService({ onChanged: () => {} })
})

afterAll(() => {
  service.dispose()
  rmSync(dir, { recursive: true, force: true })
})

describe('FileService.listDir', () => {
  it('lists dirs first, hides .git, sorts by name', async () => {
    const result = await service.listDir(project, '')
    expect(result.ok).toBe(true)
    expect(result.entries).toEqual([
      { name: 'sub', kind: 'dir' },
      { name: 'a.txt', kind: 'file' },
      { name: 'big.txt', kind: 'file' },
      { name: 'binary.bin', kind: 'file' }
    ])
  })

  it('lists a nested directory lazily', async () => {
    const result = await service.listDir(project, 'sub')
    expect(result.entries).toEqual([
      { name: 'deep', kind: 'dir' },
      { name: 'b.txt', kind: 'file' }
    ])
  })

  it('fails for a path outside the project', async () => {
    const result = await service.listDir(project, '../../..')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('outside the project')
  })
})

describe('FileService.read', () => {
  it('reads a text file by relative path', async () => {
    expect(await service.read(project, 'a.txt')).toMatchObject({ ok: true, content: 'hello' })
    expect(await service.read(project, 'sub/deep/c.txt')).toMatchObject({ ok: true, content: 'sea' })
  })

  it('replaces binary content with a placeholder', async () => {
    expect(await service.read(project, 'binary.bin')).toMatchObject({ ok: true, content: '(binary file)' })
  })

  it('replaces oversized files with a placeholder', async () => {
    expect(await service.read(project, 'big.txt')).toMatchObject({ ok: true, content: '(file too large to display)' })
  })

  it('fails for directories, missing files and paths outside the project', async () => {
    expect(await service.read(project, 'sub')).toMatchObject({ ok: false })
    expect(await service.read(project, 'nope.txt')).toMatchObject({ ok: false })
    expect(await service.read(project, '../x')).toMatchObject({ ok: false, error: 'Path is outside the project' })
  })
})

describe('resolveWithinRoot', () => {
  const root = 'D:\\r'

  it('joins relative paths and keeps the root itself', () => {
    expect(resolveWithinRoot(root, 'a/b')).toBe('D:\\r\\a\\b')
    expect(resolveWithinRoot(root, '')).toBe('D:\\r')
  })

  it('rejects escapes and absolute paths', () => {
    expect(resolveWithinRoot(root, '..')).toBeNull()
    expect(resolveWithinRoot(root, 'a/../../x')).toBeNull()
    expect(resolveWithinRoot(root, 'C:\\Windows')).toBeNull()
    expect(resolveWithinRoot(root, 'a\\..\\..\\x')).toBeNull()
  })
})

describe('toProjectRelative', () => {
  it('strips the project directory from absolute Windows paths', () => {
    expect(toProjectRelative('D:\\Projects\\foo', 'D:\\Projects\\foo\\src\\a.ts')).toBe('src/a.ts')
    expect(toProjectRelative('D:\\Projects\\foo', 'D:/Projects/foo/src/a.ts')).toBe('src/a.ts')
  })

  it('keeps already-relative paths', () => {
    expect(toProjectRelative('D:\\Projects\\foo', 'src/a.ts')).toBe('src/a.ts')
  })

  it('maps POSIX paths of a WSL project', () => {
    const unc = '\\\\wsl.localhost\\Ubuntu\\home\\u\\foo'
    expect(toProjectRelative(unc, '/home/u/foo/src/a.ts')).toBe('src/a.ts')
    expect(toProjectRelative(unc, '/etc/passwd')).toBeNull()
  })

  it('returns null for paths outside the project', () => {
    expect(toProjectRelative('D:\\Projects\\foo', 'D:\\Other\\a.ts')).toBeNull()
    expect(toProjectRelative('D:\\Projects\\foo', 'D:\\Projects\\foo')).toBeNull()
  })
})

describe('FileService watcher', () => {
  let watchDir: string
  let watchProject: ProjectEntry

  beforeAll(() => {
    watchDir = mkdtempSync(join(tmpdir(), 'piwright-files-watch-'))
    watchProject = { kind: 'native', dir: watchDir }
  })

  afterAll(() => {
    rmSync(watchDir, { recursive: true, force: true })
  })

  it('emits changes of watched files', async () => {
    const events: string[] = []
    const svc = new FileService({ onChanged: (_p, rel) => events.push(rel) })
    const file = join(watchDir, 'watched.txt')
    writeFileSync(file, 'v1')
    svc.setWatched(watchProject, ['watched.txt'])
    await new Promise((resolve) => setTimeout(resolve, 300))
    writeFileSync(file, 'v2')
    await vi.waitFor(() => expect(events).toContain('watched.txt'), { timeout: 5000 })
    svc.dispose()
  })

  it('ignores files that are not open', async () => {
    const events: string[] = []
    const svc = new FileService({ onChanged: (_p, rel) => events.push(rel) })
    writeFileSync(join(watchDir, 'open.txt'), 'v1')
    writeFileSync(join(watchDir, 'other.txt'), 'v1')
    svc.setWatched(watchProject, ['open.txt'])
    await new Promise((resolve) => setTimeout(resolve, 300))
    writeFileSync(join(watchDir, 'other.txt'), 'v2')
    await new Promise((resolve) => setTimeout(resolve, 800))
    expect(events).toEqual([])
    svc.dispose()
  })

  it('emits after delete and recreate', async () => {
    const events: string[] = []
    const svc = new FileService({ onChanged: (_p, rel) => events.push(rel) })
    const file = join(watchDir, 'recreated.txt')
    writeFileSync(file, 'v1')
    svc.setWatched(watchProject, ['recreated.txt'])
    await new Promise((resolve) => setTimeout(resolve, 300))
    unlinkSync(file)
    writeFileSync(file, 'v2')
    await vi.waitFor(() => expect(events.filter((e) => e === 'recreated.txt').length).toBeGreaterThanOrEqual(1), { timeout: 5000 })
    svc.dispose()
  })
})
