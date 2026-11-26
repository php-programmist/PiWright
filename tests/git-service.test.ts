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

describe('GitService log filters and commit actions', () => {
  function revParse(ref = 'HEAD'): string {
    return execSync(`git rev-parse ${ref}`, { cwd: dir, encoding: 'utf8' }).trim()
  }

  function commitFile(name: string, content: string, message: string): void {
    writeFileSync(join(dir, name), content)
    run('git add .')
    run(`git commit -q -m "${message}"`)
  }

  it('log filters by message substring, case-insensitive', async () => {
    commitFile('needle.txt', 'x', 'UniqueNeedle in message')
    const result = await git.log(project, 0, { query: 'uniqueneedle' })
    expect(result.entries.length).toBe(1)
    expect(result.entries[0]?.subject).toContain('UniqueNeedle')
  })

  it('log resolves a hash prefix into the commit', async () => {
    const hash = revParse()
    const result = await git.log(project, 0, { query: hash.slice(0, 8) })
    expect(result.entries[0]?.hash).toBe(hash)
  })

  it('log with an unknown hash prefix returns grep results only', async () => {
    const result = await git.log(project, 0, { query: 'deadbeef' })
    expect(result.entries.every((e) => !e.hash.startsWith('deadbeef'))).toBe(true)
  })

  it('log filters by branch', async () => {
    run('git checkout -q -b filter-branch')
    run('git commit -q --allow-empty -m only-on-filter-branch')
    run('git checkout -q main')
    const filtered = await git.log(project, 0, { branch: 'filter-branch' })
    expect(filtered.entries[0]?.subject).toBe('only-on-filter-branch')
    const main = await git.log(project, 0, { branch: 'main' })
    expect(main.entries.some((e) => e.subject === 'only-on-filter-branch')).toBe(false)
  })

  it('log with all shows side branches and skips stash', async () => {
    run('git checkout -q -b side-branch')
    run('git commit -q --allow-empty -m only-on-side-branch')
    run('git checkout -q main')
    const headOnly = await git.log(project, 0)
    expect(headOnly.entries.some((e) => e.subject === 'only-on-side-branch')).toBe(false)
    const all = await git.log(project, 0, { all: true })
    expect(all.entries.some((e) => e.subject === 'only-on-side-branch')).toBe(true)
    writeFileSync(join(dir, 'a.txt'), 'stashed')
    run('git stash -q')
    const noStash = await git.log(project, 0, { all: true })
    expect(noStash.entries.some((e) => e.subject.startsWith('WIP on'))).toBe(false)
    run('git stash pop -q')
    run('git checkout -q -- a.txt')
  })

  it('branches with all includes remote-tracking refs', async () => {
    const all = await git.branches(project, true)
    expect(all.branches).toContain('origin/main')
    const local = await git.branches(project)
    expect(local.branches).not.toContain('origin/main')
  })

  it('cherry-pick copies a commit onto the current branch', async () => {
    run('git checkout -q -b cherry-src')
    writeFileSync(join(dir, 'cherry.txt'), 'picked')
    run('git add .')
    run('git commit -q -m cherry-me')
    const picked = revParse()
    run('git checkout -q main')
    writeFileSync(join(dir, 'main-move.txt'), 'm')
    run('git add .')
    run('git commit -q -m main-moved')
    expect((await git.cherryPick(project, picked)).ok).toBe(true)
    const log = await git.log(project)
    expect(log.entries[0]?.subject).toBe('cherry-me')
    expect(log.entries[0]?.hash).not.toBe(picked)
  })

  it('cherry-pick rejects an invalid hash', async () => {
    expect((await git.cherryPick(project, 'drop table;')).ok).toBe(false)
  })

  it('revert creates an inverse commit', async () => {
    commitFile('revert.txt', 'data', 'add-revert-file')
    const target = revParse()
    expect((await git.revertCommit(project, target)).ok).toBe(true)
    const log = await git.log(project)
    expect(log.entries[0]?.subject).toContain('Revert')
    expect(log.entries[0]?.subject).toContain('add-revert-file')
  })

  it('reset moves the branch with soft/mixed/hard modes', async () => {
    commitFile('r1.txt', '1', 'reset-base')
    const base = revParse()
    commitFile('r2.txt', '2', 'reset-target')
    const target = revParse()

    expect((await git.resetBranch(project, base, 'soft')).ok).toBe(true)
    let status = await git.status(project)
    expect(status.status?.entries.find((e) => e.path === 'r2.txt')).toMatchObject({ index: 'A' })

    expect((await git.resetBranch(project, base, 'mixed')).ok).toBe(true)
    status = await git.status(project)
    expect(status.status?.entries.find((e) => e.path === 'r2.txt')).toMatchObject({ index: '.', untracked: true })

    expect((await git.resetBranch(project, target, 'hard')).ok).toBe(true)
    status = await git.status(project)
    expect(status.status?.entries).toEqual([])
    expect(revParse()).toBe(target)
  })

  it('reset rejects an invalid mode and hash', async () => {
    expect((await git.resetBranch(project, 'zz', 'hard')).ok).toBe(false)
    expect((await git.resetBranch(project, revParse(), 'weird' as 'hard')).ok).toBe(false)
  })

  it('tagCreate makes a tag and rejects bad names', async () => {
    const head = revParse()
    expect((await git.tagCreate(project, 'v-test-tag', head)).ok).toBe(true)
    const tags = execSync('git tag --list', { cwd: dir, encoding: 'utf8' })
    expect(tags).toContain('v-test-tag')
    expect((await git.tagCreate(project, 'bad name', head)).ok).toBe(false)
    expect((await git.tagCreate(project, '-dash', head)).ok).toBe(false)
  })

  it('dropCommit removes a middle commit from the branch', async () => {
    commitFile('d1.txt', '1', 'drop-a')
    commitFile('d2.txt', '2', 'drop-b')
    const victim = revParse()
    commitFile('d3.txt', '3', 'drop-c')
    expect((await git.dropCommit(project, victim)).ok).toBe(true)
    const subjects = (await git.log(project, 0)).entries.slice(0, 3).map((e) => e.subject)
    expect(subjects).toContain('drop-c')
    expect(subjects).not.toContain('drop-b')
    expect(subjects).toContain('drop-a')
  }, 30_000)

  it('dropCommit refuses the root commit', async () => {
    const root = execSync('git rev-list --max-parents=0 HEAD', { cwd: dir, encoding: 'utf8' }).trim()
    expect((await git.dropCommit(project, root)).ok).toBe(false)
  })

  it('editCommitMessage amends HEAD without touching the index', async () => {
    writeFileSync(join(dir, 'staged.txt'), 's')
    run('git add .')
    const head = revParse()
    expect((await git.editCommitMessage(project, head, 'amended-head-message')).ok).toBe(true)
    const log = await git.log(project)
    expect(log.entries[0]?.subject).toBe('amended-head-message')
    const status = await git.status(project)
    expect(status.status?.entries.find((e) => e.path === 'staged.txt')).toMatchObject({ index: 'A' })
    run('git reset -q')
    rmSync(join(dir, 'staged.txt'), { force: true })
  })

  it('editCommitMessage rejects an empty message', async () => {
    expect((await git.editCommitMessage(project, revParse(), '   ')).ok).toBe(false)
  })

  it('editCommitMessage rewords a non-HEAD commit via rebase', async () => {
    commitFile('w1.txt', '1', 'reword-base')
    const base = revParse()
    commitFile('w2.txt', '2', 'reword-top')
    expect((await git.editCommitMessage(project, base, 'reworded-base')).ok).toBe(true)
    const subjects = (await git.log(project, 0)).entries.slice(0, 2).map((e) => e.subject)
    expect(subjects).toEqual(['reword-top', 'reworded-base'])
  }, 30_000)

  it('squashInto merges a commit into its parent with a new message', async () => {
    commitFile('s1.txt', '1', 'squash-parent')
    commitFile('s2.txt', '2', 'squash-child')
    const child = revParse()
    expect((await git.squashInto(project, child, 'squashed-combined')).ok).toBe(true)
    const subjects = (await git.log(project, 0)).entries.slice(0, 2).map((e) => e.subject)
    expect(subjects[0]).toBe('squashed-combined')
    expect(subjects).not.toContain('squash-parent')
    expect(subjects).not.toContain('squash-child')
  }, 30_000)

  it('squashInto refuses the root commit', async () => {
    const root = execSync('git rev-list --max-parents=0 HEAD', { cwd: dir, encoding: 'utf8' }).trim()
    expect((await git.squashInto(project, root, 'x')).ok).toBe(false)
  })

  it('fetch picks up remote commits into behind', async () => {
    const clone = mkdtempSync(join(tmpdir(), 'piwright-git-clone-'))
    try {
      execSync(`git clone -q "${remote}" "${clone}"`, { stdio: 'pipe' })
      execSync('git config user.email test@test', { cwd: clone, stdio: 'pipe' })
      execSync('git config user.name test', { cwd: clone, stdio: 'pipe' })
      writeFileSync(join(clone, 'remote.txt'), 'x')
      execSync('git add .', { cwd: clone, stdio: 'pipe' })
      execSync('git commit -q -m from-clone', { cwd: clone, stdio: 'pipe' })
      execSync('git push -q origin main', { cwd: clone, stdio: 'pipe' })
      const before = await git.status(project)
      expect(before.status?.behind).toBe(0)
      expect((await git.fetch(project)).ok).toBe(true)
      const after = await git.status(project)
      expect(after.status?.behind).toBe(1)
    } finally {
      rmSync(clone, { recursive: true, force: true })
    }
  })

  it('branchSync reports upstream, ahead and behind per branch', async () => {
    // ветка на origin/main^ — строго позади upstream на 1 коммит (история main переписана
    // предыдущими тестами — от неё счётчики не контролируются)
    run('git branch sync-behind origin/main~1')
    run('git config branch.sync-behind.remote origin')
    run('git config branch.sync-behind.merge refs/heads/main')
    let sync = await git.branchSync(project)
    expect(sync.ok).toBe(true)
    expect(sync.branches.find((b) => b.name === 'sync-behind')).toMatchObject({ upstream: 'origin/main', ahead: 0, behind: 1, gone: false })

    // ветка без upstream — нулевые счётчики
    run('git branch sync-free')
    sync = await git.branchSync(project)
    expect(sync.branches.find((b) => b.name === 'sync-free')).toMatchObject({ upstream: null, ahead: 0, behind: 0, gone: false })

    // upstream задан через config, но ветки на remote нет — gone
    run('git branch ghost')
    run('git config branch.ghost.remote origin')
    run('git config branch.ghost.merge refs/heads/ghost')
    sync = await git.branchSync(project)
    expect(sync.branches.find((b) => b.name === 'ghost')).toMatchObject({ upstream: 'origin/ghost', gone: true })

    run('git branch -D sync-behind sync-free ghost')
  })

  it('pushBranch creates upstream when missing and pushes the current branch', async () => {
    run('git branch sync-a')
    run('git checkout -q sync-a')
    expect((await git.pushBranch(project, 'sync-a', false)).ok).toBe(true)
    let sync = await git.branchSync(project)
    expect(sync.branches.find((b) => b.name === 'sync-a')).toMatchObject({ upstream: 'origin/sync-a', ahead: 0 })

    writeFileSync(join(dir, 'sync-a.txt'), 'y')
    run('git add .')
    run('git commit -q -m sync-a-local-2')
    sync = await git.branchSync(project)
    expect(sync.branches.find((b) => b.name === 'sync-a')?.ahead).toBe(1)
    expect((await git.pushBranch(project, 'sync-a', true)).ok).toBe(true)
    sync = await git.branchSync(project)
    expect(sync.branches.find((b) => b.name === 'sync-a')?.ahead).toBe(0)
  })

  it('pushBranch pushes a non-current branch', async () => {
    run('git checkout -q sync-a')
    writeFileSync(join(dir, 'sync-a.txt'), 'z')
    run('git add .')
    run('git commit -q -m sync-a-local-3')
    run('git checkout -q main')
    expect((await git.pushBranch(project, 'sync-a', false)).ok).toBe(true)
    const sync = await git.branchSync(project)
    expect(sync.branches.find((b) => b.name === 'sync-a')?.ahead).toBe(0)
    run('git branch -D sync-a')
  })

  it('pullBranch fast-forwards a non-current branch from its upstream', async () => {
    // ветка строго позади upstream (origin/main^) — иначе ff невозможен
    run('git branch stale origin/main~1')
    run('git config branch.stale.remote origin')
    run('git config branch.stale.merge refs/heads/main')
    let sync = await git.branchSync(project)
    expect(sync.branches.find((b) => b.name === 'stale')).toMatchObject({ upstream: 'origin/main', behind: 1 })
    expect((await git.pullBranch(project, 'stale', 'ff')).ok).toBe(true)
    sync = await git.branchSync(project)
    expect(sync.branches.find((b) => b.name === 'stale')).toMatchObject({ behind: 0 })
    expect(execSync('git rev-parse stale', { cwd: dir, encoding: 'utf8' }).trim()).toBe(
      execSync('git rev-parse origin/main', { cwd: dir, encoding: 'utf8' }).trim()
    )
    run('git branch -D stale')
  })

  it('pullBranch rebases and merges the current branch', async () => {
    const clone = mkdtempSync(join(tmpdir(), 'piwright-git-clone-'))
    try {
      execSync(`git clone -q "${remote}" "${clone}"`, { stdio: 'pipe' })
      execSync('git config user.email test@test', { cwd: clone, stdio: 'pipe' })
      execSync('git config user.name test', { cwd: clone, stdio: 'pipe' })

      // ветка от origin/main с upstream; расходимся: локальный коммит + коммит из клона
      run('git checkout -q -b rb origin/main')
      run('git config branch.rb.remote origin')
      run('git config branch.rb.merge refs/heads/main')
      writeFileSync(join(dir, 'diverge.txt'), 'local')
      run('git add .')
      run('git commit -q -m diverge-local')
      writeFileSync(join(clone, 'diverge-remote.txt'), 'remote')
      execSync('git add .', { cwd: clone, stdio: 'pipe' })
      execSync('git commit -q -m diverge-remote', { cwd: clone, stdio: 'pipe' })
      execSync('git push -q origin main', { cwd: clone, stdio: 'pipe' })
      run('git fetch -q')
      let sync = await git.branchSync(project)
      expect(sync.branches.find((b) => b.name === 'rb')).toMatchObject({ ahead: 1, behind: 1 })

      expect((await git.pullBranch(project, 'rb', 'rebase')).ok).toBe(true)
      sync = await git.branchSync(project)
      expect(sync.branches.find((b) => b.name === 'rb')).toMatchObject({ ahead: 1, behind: 0 })
      run('git push -q origin rb')

      // расходимся ещё раз — merge создаёт merge-коммит
      writeFileSync(join(dir, 'diverge2.txt'), 'local')
      run('git add .')
      run('git commit -q -m diverge2-local')
      writeFileSync(join(clone, 'diverge2-remote.txt'), 'remote')
      execSync('git add .', { cwd: clone, stdio: 'pipe' })
      execSync('git commit -q -m diverge2-remote', { cwd: clone, stdio: 'pipe' })
      execSync('git push -q origin main', { cwd: clone, stdio: 'pipe' })
      run('git fetch -q')
      expect((await git.pullBranch(project, 'rb', 'merge')).ok).toBe(true)
      sync = await git.branchSync(project)
      expect(sync.branches.find((b) => b.name === 'rb')).toMatchObject({ ahead: 3, behind: 0 })
    } finally {
      rmSync(clone, { recursive: true, force: true })
      run('git checkout -q main')
      run('git branch -D rb')
    }
  })
})
