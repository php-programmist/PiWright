import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { CodeCheckpoints } from '../src/main/git/code-checkpoints'
import { GitService } from '../src/main/git/git-service'
import { DEFAULT_SETTINGS } from '../src/main/settings/settings'

const SETTINGS = { ...DEFAULT_SETTINGS }

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' })
}

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'piwright-ckpt-'))
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.email', 't@t')
  git(dir, 'config', 'user.name', 't')
  await writeFile(join(dir, 'a.txt'), 'base\n', 'utf8')
  await writeFile(join(dir, 'b.txt'), 'base\n', 'utf8')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'init')
  return dir
}

describe('CodeCheckpoints capture/restore', () => {
  it('captures the full worktree and restores it, sending current changes to stash', async () => {
    const dir = await makeRepo()
    const service = new CodeCheckpoints(new GitService(() => SETTINGS), null)
    const project = { kind: 'native' as const, dir }

    await writeFile(join(dir, 'a.txt'), 'checkpoint state\n', 'utf8')
    await writeFile(join(dir, 'new.txt'), 'untracked at checkpoint\n', 'utf8')
    const capture = await service.capture(project)
    expect(capture.ok).toBe(true)
    expect(capture.sha).toMatch(/^[0-9a-f]{40}$/)

    // Изменения после чекпоинта: правка tracked, удаление new.txt, новый untracked.
    await writeFile(join(dir, 'a.txt'), 'changed after\n', 'utf8')
    await rm(join(dir, 'new.txt'))
    await writeFile(join(dir, 'other.txt'), 'created after\n', 'utf8')

    const restore = await service.restore(project, capture.sha as string)
    expect(restore.ok).toBe(true)

    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('checkpoint state\n')
    expect(await readFile(join(dir, 'new.txt'), 'utf8')).toBe('untracked at checkpoint\n')
    await expect(readFile(join(dir, 'other.txt'), 'utf8')).rejects.toThrow()
    // Страховка текущего состояния — в stash.
    const stashList = execFileSync('git', ['stash', 'list'], { cwd: dir, encoding: 'utf8' })
    expect(stashList).toContain('PiWright rewind backup')
    // Индекс возвращён к HEAD — изменения незастейдженные.
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' })
    expect(status).toContain(' M a.txt')
    expect(status).toContain('?? new.txt')
    await rm(dir, { recursive: true, force: true })
  })

  it('restores cleanly when the worktree is clean (empty stash is not an error)', async () => {
    const dir = await makeRepo()
    const service = new CodeCheckpoints(new GitService(() => SETTINGS), null)
    const project = { kind: 'native' as const, dir }

    await writeFile(join(dir, 'a.txt'), 'checkpoint state\n', 'utf8')
    const capture = await service.capture(project)
    expect(capture.ok).toBe(true)
    git(dir, 'checkout', '-q', '--', 'a.txt')

    const restore = await service.restore(project, capture.sha as string)
    expect(restore.ok).toBe(true)
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('checkpoint state\n')
    await rm(dir, { recursive: true, force: true })
  })

  it('fails outside a git repository and on invalid sha', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwright-nogit-'))
    const service = new CodeCheckpoints(new GitService(() => SETTINGS), null)
    const project = { kind: 'native' as const, dir }

    const capture = await service.capture(project)
    expect(capture.ok).toBe(false)
    expect(capture.error).toBe('Not a git repository')

    const repo = await makeRepo()
    const restore = await service.restore({ kind: 'native' as const, dir: repo }, 'zzzz')
    expect(restore.ok).toBe(false)
    expect(restore.error).toBe('Invalid checkpoint sha')
    await rm(dir, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  })

  it('persists the slot map per session file and survives a reload', async () => {
    const dir = await makeRepo()
    const storeDir = join(dir, 'ckpt-store')
    const service = new CodeCheckpoints(new GitService(() => SETTINGS), storeDir)
    const map = new Map([
      [0, { sha: 'a'.repeat(40), ts: 1 }],
      [2, { sha: 'b'.repeat(40), ts: 2 }]
    ])
    const sessionFile = '/home/user/.pi/agent/sessions/--dir--/2026-01-01.jsonl'
    await service.save(sessionFile, map)
    const loaded = await service.load(sessionFile)
    expect(loaded.size).toBe(2)
    expect(loaded.get(0)).toEqual({ sha: 'a'.repeat(40), ts: 1 })
    expect(loaded.get(2)).toEqual({ sha: 'b'.repeat(40), ts: 2 })

    await service.drop(sessionFile)
    expect((await service.load(sessionFile)).size).toBe(0)
    await rm(dir, { recursive: true, force: true })
  })

  it('keeps the user index untouched by capture', async () => {
    const dir = await makeRepo()
    const service = new CodeCheckpoints(new GitService(() => SETTINGS), null)
    const project = { kind: 'native' as const, dir }

    await writeFile(join(dir, 'a.txt'), 'staged work\n', 'utf8')
    git(dir, 'add', 'a.txt')
    const capture = await service.capture(project)
    expect(capture.ok).toBe(true)
    // Пользовательский индекс не тронут: a.txt остаётся застейдженным, снапшот — dangling tree.
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' })
    expect(status).toContain('M  a.txt')
    await rm(dir, { recursive: true, force: true })
  })
})

describe('CodeCheckpoints directories', () => {
  it('creates the store directory on save', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwright-ckpt-store-'))
    const storeDir = join(dir, 'nested', 'checkpoints')
    const service = new CodeCheckpoints(new GitService(() => SETTINGS), storeDir)
    await service.save('s.json', new Map([[0, { sha: 'c'.repeat(40), ts: 3 }]]))
    const loaded = await service.load('s.json')
    expect(loaded.get(0)?.sha).toBe('c'.repeat(40))
    await mkdir(storeDir, { recursive: true })
    await rm(dir, { recursive: true, force: true })
  })
})
