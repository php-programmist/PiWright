/** GitService РїСЂРѕС‚РёРІ СЂРµР°Р»СЊРЅРѕРіРѕ РІСЂРµРјРµРЅРЅРѕРіРѕ СЂРµРїРѕР·РёС‚РѕСЂРёСЏ (native-Р±СЌРєРµРЅРґ, РЅР°СЃС‚РѕСЏС‰РёР№ git CLI). */
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GitService } from '../src/main/git/git-service'
import { DEFAULT_SETTINGS } from '../src/main/settings/settings'
import type { ProjectEntry } from '../src/shared/ipc-contracts'

const settings = { ...DEFAULT_SETTINGS }
let dir: string
let remote: string
let project: ProjectEntry
let git: GitService

function run(command: string): void {
  execSync(command, { cwd: dir, stdio: 'pipe' })
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'piwright-git-'))
  remote = mkdtempSync(join(tmpdir(), 'piwright-git-remote-'))
  project = { kind: 'native', dir }
  git = new GitService(() => settings)
  execSync('git init -q -b main', { cwd: dir, stdio: 'pipe' })
  run('git config user.email test@test')
  run('git config user.name test')
  writeFileSync(join(dir, 'a.txt'), 'hello')
  run('git add .')
  run('git commit -q -m init')
  execSync('git init -q --bare -b main', { cwd: remote, stdio: 'pipe' })
  run(`git remote add origin "${remote}"`)
  run('git push -q -u origin main')
}, 30_000)

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
  rmSync(remote, { recursive: true, force: true })
})

describe('GitService against a real repository', () => {
  it('status reports a clean tree', async () => {
    const result = await git.status(project)
    expect(result.ok).toBe(true)
    expect(result.status?.branch).toBe('main')
    expect(result.status?.upstream).toBe('origin/main')
    expect(result.status?.entries).toEqual([])
  })

  it('status reports modified and untracked files', async () => {
    writeFileSync(join(dir, 'a.txt'), 'world')
    writeFileSync(join(dir, 'b.txt'), 'new')
    const result = await git.status(project)
    const paths = result.status?.entries.map((e) => [e.path, e.index, e.worktree, e.untracked])
    expect(paths).toContainEqual(['a.txt', '.', 'M', false])
    expect(paths).toContainEqual(['b.txt', '.', '?', true])
  })

  it('fileDiff returns HEAD version and disk version', async () => {
    const result = await git.fileDiff(project, 'a.txt')
    expect(result.ok).toBe(true)
    expect(result.original).toBe('hello')
    expect(result.modified).toBe('world')
  })

  it('fileDiff of an untracked file has an empty original', async () => {
    const result = await git.fileDiff(project, 'b.txt')
    expect(result.ok).toBe(true)
    expect(result.original).toBe('')
    expect(result.modified).toBe('new')
  })

  it('stage and unstage move entries between index and worktree', async () => {
    expect((await git.stage(project, ['a.txt', 'b.txt'])).ok).toBe(true)
    let status = await git.status(project)
    expect(status.status?.entries.find((e) => e.path === 'a.txt')).toMatchObject({ index: 'M', worktree: '.' })
    expect(status.status?.entries.find((e) => e.path === 'b.txt')).toMatchObject({ index: 'A', worktree: '.' })

    expect((await git.unstage(project, ['b.txt'])).ok).toBe(true)
    status = await git.status(project)
    expect(status.status?.entries.find((e) => e.path === 'b.txt')).toMatchObject({ index: '.', untracked: true })
  })

  it('fileDiff of a staged new file has an empty original', async () => {
    const result = await git.fileDiff(project, 'b.txt')
    expect(result.original).toBe('')
  })

  it('commit records a log entry and clears staged files', async () => {
    expect((await git.commit(project, 'add b.txt\n\nbody line')).ok).toBe(true)
    const status = await git.status(project)
    expect(status.status?.entries.find((e) => e.path === 'a.txt')).toBeUndefined()
    const log = await git.log(project)
    expect(log.entries[0]?.subject).toBe('add b.txt')
    expect(log.entries.length).toBeGreaterThanOrEqual(2)
  })

  it('commit with empty staged area fails with a git error', async () => {
    const result = await git.commit(project, 'nothing to commit')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('nothing added to commit')
  })

  it('push sends commits to the remote', async () => {
    writeFileSync(join(dir, 'a.txt'), 'third')
    await git.stage(project, ['a.txt'])
    await git.commit(project, 'third')
    const before = await git.status(project)
    expect(before.status?.ahead).toBeGreaterThan(0)
    expect((await git.push(project)).ok).toBe(true)
    const after = await git.status(project)
    expect(after.status?.ahead).toBe(0)
  })

  it('branches lists local branches, checkout switches, create makes a branch', async () => {
    const listed = await git.branches(project)
    expect(listed.ok).toBe(true)
    expect(listed.branches).toContain('main')

    expect((await git.checkout(project, 'feature/x', true)).ok).toBe(true)
    let status = await git.status(project)
    expect(status.status?.branch).toBe('feature/x')
    expect((await git.branches(project)).branches).toContain('feature/x')

    expect((await git.checkout(project, 'main', false)).ok).toBe(true)
    status = await git.status(project)
    expect(status.status?.branch).toBe('main')

    expect((await git.checkout(project, 'missing-branch', false)).ok).toBe(false)
    expect((await git.checkout(project, 'bad name with spaces', true)).ok).toBe(false)
    expect((await git.checkout(project, '  ', true)).ok).toBe(false)
  })

  it('status fails outside a repository', async () => {
    const notARepo = mkdtempSync(join(tmpdir(), 'piwright-nogit-'))
    try {
      const result = await git.status({ kind: 'native', dir: notARepo })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('not a git repository')
    } finally {
      rmSync(notARepo, { recursive: true, force: true })
    }
  })
})
