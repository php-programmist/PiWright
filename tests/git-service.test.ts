/** GitService против реального временного репозитория (native-бэкенд, настоящий git CLI). */
import { execSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
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

  it('branch rename, delete and checkout with start point', async () => {
    expect((await git.checkout(project, 'tmp', true)).ok).toBe(true)
    run('git commit -q --allow-empty -m base-commit')
    expect((await git.renameBranch(project, 'no-such', 'x')).ok).toBe(false)
    expect((await git.renameBranch(project, 'tmp', 'renamed')).ok).toBe(true)
    expect((await git.branches(project)).branches).toContain('renamed')
    expect((await git.checkout(project, 'main', false)).ok).toBe(true)

    expect((await git.checkout(project, 'from-base', true, 'renamed')).ok).toBe(true)
    const log = await git.log(project)
    expect(log.entries[0]?.subject).toBe('base-commit')
    expect((await git.checkout(project, 'main', false)).ok).toBe(true)

    expect((await git.deleteBranch(project, 'main')).ok).toBe(false)
    expect((await git.deleteBranch(project, 'from-base')).ok).toBe(false)
    expect((await git.checkout(project, 'merged-b', true)).ok).toBe(true)
    expect((await git.checkout(project, 'main', false)).ok).toBe(true)
    expect((await git.deleteBranch(project, 'merged-b')).ok).toBe(true)
    expect((await git.branches(project)).branches).not.toContain('merged-b')
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

describe('GitService commit history', () => {
  let commit: string
  let rootCommit: string

  beforeAll(() => {
    writeFileSync(join(dir, 'a.txt'), 'fourth')
    writeFileSync(join(dir, 'c.txt'), 'added')
    run('git add .')
    run('git commit -q -m history-commit')
    commit = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim()
    rootCommit = execSync('git rev-list --max-parents=0 HEAD', { cwd: dir, encoding: 'utf8' }).trim()
  })

  it('log returns author, date, parents and refs', async () => {
    const log = await git.log(project)
    const head = log.entries[0]
    expect(head?.subject).toBe('history-commit')
    expect(head?.author).toBe('test')
    expect(head?.date).toBeGreaterThan(0)
    expect(head?.parents.length).toBe(1)
    expect(head?.refs).toContain('HEAD -> main')
  })

  it('commitFiles lists changed files of a commit', async () => {
    const result = await git.commitFiles(project, commit)
    expect(result.ok).toBe(true)
    expect(result.files).toContainEqual({ status: 'M', path: 'a.txt', origPath: null })
    expect(result.files).toContainEqual({ status: 'A', path: 'c.txt', origPath: null })
  })

  it('commitFiles rejects an invalid hash', async () => {
    expect((await git.commitFiles(project, 'drop table;')).ok).toBe(false)
  })

  it('commitFileDiff returns parent and commit versions', async () => {
    const result = await git.commitFileDiff(project, commit, 'a.txt')
    expect(result.ok).toBe(true)
    expect(result.original).toBe('third')
    expect(result.modified).toBe('fourth')
  })

  it('commitFileDiff of an added file has an empty original, of a deleted file — empty modified', async () => {
    const added = await git.commitFileDiff(project, commit, 'c.txt')
    expect(added.ok).toBe(true)
    expect(added.original).toBe('')
    expect(added.modified).toBe('added')

    run('git rm -q c.txt')
    run('git commit -q -m remove-c')
    const remove = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim()
    const deleted = await git.commitFileDiff(project, remove, 'c.txt')
    expect(deleted.ok).toBe(true)
    expect(deleted.original).toBe('added')
    expect(deleted.modified).toBe('')
  })

  it('commitFileDiff of the root commit has an empty original', async () => {
    const result = await git.commitFileDiff(project, rootCommit, 'a.txt')
    expect(result.ok).toBe(true)
    expect(result.original).toBe('')
    expect(result.modified).toBe('hello')
  })

  it('commitFileDiff rejects invalid input', async () => {
    expect((await git.commitFileDiff(project, 'zz', 'a.txt')).ok).toBe(false)
    expect((await git.commitFileDiff(project, commit, '')).ok).toBe(false)
  })

  it('log paginates: 50 per page, hasMore, skip works', async () => {
    const total = 55
    for (let i = 0; i < total; i++) run('git commit -q --allow-empty -m bulk-' + i)
    const page0 = await git.log(project, 0)
    expect(page0.entries.length).toBe(50)
    expect(page0.hasMore).toBe(true)
    expect(page0.entries[0]?.subject).toBe('bulk-54')
    const page1 = await git.log(project, 1)
    expect(page1.entries.length).toBeGreaterThanOrEqual(5)
    expect(page1.hasMore).toBe(false)
    expect(page1.entries[0]?.subject).toBe('bulk-4')
    // Страницы не пересекаются
    const hashes0 = new Set(page0.entries.map((e) => e.hash))
    expect(page1.entries.every((e) => !hashes0.has(e.hash))).toBe(true)
  }, 30000)
})

describe('GitService with a nested repository (bug 8)', () => {
  let outer: string
  let project: ProjectEntry

  function gitIn(dir: string, command: string): void {
    execSync(command, { cwd: dir, stdio: 'pipe' })
  }

  beforeAll(() => {
    outer = mkdtempSync(join(tmpdir(), 'piwright-git-nested-'))
    project = { kind: 'native', dir: outer }
    gitIn(outer, 'git init -q -b main')
    gitIn(outer, 'git config user.email test@test')
    gitIn(outer, 'git config user.name test')
    writeFileSync(join(outer, 'root.txt'), 'root')
    gitIn(outer, 'git add .')
    gitIn(outer, 'git commit -q -m init')
    const nested = join(outer, 'spec')
    mkdirSync(nested)
    gitIn(nested, 'git init -q -b main')
    gitIn(nested, 'git config user.email test@test')
    gitIn(nested, 'git config user.name test')
    writeFileSync(join(nested, 'inner.txt'), 'inner')
    gitIn(nested, 'git add .')
    gitIn(nested, 'git commit -q -m init')
  }, 30_000)

  afterAll(() => {
    rmSync(outer, { recursive: true, force: true })
  })

  it('status merges entries of the nested repository with prefixed paths', async () => {
    writeFileSync(join(outer, 'root.txt'), 'changed')
    writeFileSync(join(outer, 'spec', 'inner.txt'), 'changed')
    writeFileSync(join(outer, 'spec', 'new.txt'), 'new')
    const result = await git.status(project)
    expect(result.ok).toBe(true)
    const paths = result.status?.entries.map((e) => [e.path, e.repoRoot])
    expect(paths).toContainEqual(['root.txt', undefined])
    expect(paths).toContainEqual(['spec/inner.txt', join(outer, 'spec')])
    expect(paths).toContainEqual(['spec/new.txt', join(outer, 'spec')])
    // схлопнутая untracked-запись внешнего git на вложенный репо отфильтрована
    expect(paths?.some(([path]) => path === 'spec')).toBe(false)
  })

  it('fileDiff routes to the nested repository', async () => {
    const result = await git.fileDiff(project, 'spec/inner.txt')
    expect(result.ok).toBe(true)
    expect(result.original).toBe('inner')
    expect(result.modified).toBe('changed')
  })

  it('stage, unstage and commit route to the nested repository', async () => {
    expect((await git.stage(project, ['spec/new.txt', 'root.txt'])).ok).toBe(true)
    let status = await git.status(project)
    expect(status.status?.entries.find((e) => e.path === 'spec/new.txt')).toMatchObject({ index: 'A' })
    expect(status.status?.entries.find((e) => e.path === 'root.txt')).toMatchObject({ index: 'M' })

    expect((await git.unstage(project, ['root.txt'])).ok).toBe(true)
    status = await git.status(project)
    expect(status.status?.entries.find((e) => e.path === 'root.txt')).toMatchObject({ index: '.' })

    expect((await git.commit(project, 'nested commit')).ok).toBe(true)
    status = await git.status(project)
    expect(status.status?.entries.find((e) => e.path === 'spec/new.txt')).toBeUndefined()
    const log = execSync('git log --oneline -n 1', { cwd: join(outer, 'spec'), encoding: 'utf8' })
    expect(log).toContain('nested commit')
  })
})
