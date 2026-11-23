/** Чистые функции worktree (shared/worktree) + GitService.worktreeCreate/worktreeRemove
 *  против реального временного репозитория. */
import { execSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GitService } from '../src/main/git/git-service'
import { DEFAULT_SETTINGS } from '../src/main/settings/settings'
import {
  hasWorktreeNamed,
  isUncommittedChangesError,
  sameProjectDir,
  splitWorktreeHostDir,
  validateWorktreeName,
  worktreeBranchFor,
  worktreeNameFromCwd,
  worktreePathFor
} from '../src/shared/worktree'
import type { ProjectEntry } from '../src/shared/ipc-contracts'

describe('worktree pure functions', () => {
  it('validateWorktreeName: латиница/цифры/дефис, не с дефиса', () => {
    expect(validateWorktreeName('feat-1')).toBe(true)
    expect(validateWorktreeName('A9')).toBe(true)
    expect(validateWorktreeName('-x')).toBe(false)
    expect(validateWorktreeName('')).toBe(false)
    expect(validateWorktreeName('a b')).toBe(false)
    expect(validateWorktreeName('a/b')).toBe(false)
    expect(validateWorktreeName('a_b')).toBe(false)
  })

  it('worktreeBranchFor / worktreePathFor', () => {
    expect(worktreeBranchFor('feat')).toBe('worktree-feat')
    expect(worktreePathFor('/home/u/proj', 'feat')).toBe('/home/u/proj/.pi/worktrees/feat')
    expect(worktreePathFor('D:/repo/', 'feat')).toBe('D:/repo/.pi/worktrees/feat')
  })

  it('worktreeNameFromCwd: имя только для прямых детей .pi/worktrees', () => {
    expect(worktreeNameFromCwd('/home/u/proj/.pi/worktrees/feat')).toBe('feat')
    expect(worktreeNameFromCwd('D:\\repo\\.pi\\worktrees\\feat')).toBe('feat')
    expect(worktreeNameFromCwd('/home/u/proj/.pi/worktrees/feat/')).toBe('feat')
    expect(worktreeNameFromCwd('/home/u/proj/.pi/worktrees/feat/sub')).toBeNull()
    expect(worktreeNameFromCwd('/home/u/proj')).toBeNull()
    expect(worktreeNameFromCwd('/home/u/proj/.pi/worktrees/')).toBeNull()
  })

  it('hasWorktreeNamed по porcelain-выводу', () => {
    const porcelain = [
      'worktree /home/u/proj',
      'HEAD abc',
      'branch refs/heads/main',
      '',
      'worktree /home/u/proj/.pi/worktrees/feat',
      'HEAD def',
      'branch refs/heads/worktree-feat'
    ].join('\n')
    expect(hasWorktreeNamed(porcelain, 'feat')).toBe(true)
    expect(hasWorktreeNamed(porcelain, 'feat2')).toBe(false)
    expect(hasWorktreeNamed('', 'feat')).toBe(false)
  })

  it('isUncommittedChangesError по stderr', () => {
    expect(isUncommittedChangesError('fatal: "x" contains modified or untracked files, use --force to delete it')).toBe(true)
    expect(isUncommittedChangesError('error: untracked working tree files would be overwritten')).toBe(false)
    expect(isUncommittedChangesError('fatal: not a working tree')).toBe(false)
  })

  it('splitWorktreeHostDir / sameProjectDir: UNC WSL и слэши', () => {
    expect(splitWorktreeHostDir('D:\\repo\\.pi\\worktrees\\feat')).toEqual({ root: 'D:/repo', name: 'feat' })
    expect(splitWorktreeHostDir('/home/u/proj/.pi/worktrees/feat')).toEqual({ root: '/home/u/proj', name: 'feat' })
    expect(splitWorktreeHostDir('D:\\repo')).toBeNull()
    expect(sameProjectDir('\\\\wsl.localhost\\Ubuntu\\home\\u\\proj', '/home/u/proj')).toBe(true)
    expect(sameProjectDir('//wsl$/Ubuntu/home/u/proj/', '/home/u/proj')).toBe(true)
    expect(sameProjectDir('D:\\repo', 'D:/repo')).toBe(true)
    expect(sameProjectDir('/home/u/proj', '/home/u/other')).toBe(false)
  })
})

describe('GitService worktrees against a real repository', () => {
  let dir: string
  let project: ProjectEntry
  let git: GitService

  beforeAll(() => {
    // TEMP на CI может быть 8.3-путём (RUNNER~1); git rev-parse возвращает канонический long path.
    dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'piwright-wt-')))
    project = { kind: 'native', dir }
    git = new GitService(() => ({ ...DEFAULT_SETTINGS }))
    execSync('git init -q -b main', { cwd: dir, stdio: 'pipe' })
    execSync('git config user.email test@test', { cwd: dir, stdio: 'pipe' })
    execSync('git config user.name test', { cwd: dir, stdio: 'pipe' })
    writeFileSync(join(dir, 'a.txt'), 'hello')
    execSync('git add .', { cwd: dir, stdio: 'pipe' })
    execSync('git commit -q -m init', { cwd: dir, stdio: 'pipe' })
  }, 30_000)

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('create makes .pi/worktrees/<name> with branch worktree-<name>; repeat is a no-op', async () => {
    const created = await git.worktreeCreate(project, 'feat')
    expect(created.ok).toBe(true)
    expect(created.dir).toBe(worktreePathFor(dir.replace(/\\/g, '/'), 'feat'))
    expect(created.branch).toBe('worktree-feat')
    expect(existsSync(join(dir, '.pi', 'worktrees', 'feat', 'a.txt'))).toBe(true)

    const again = await git.worktreeCreate(project, 'feat')
    expect(again.ok).toBe(true)
    expect(again.dir).toBe(created.dir)
  })

  it('invalid name and non-repo fail cleanly', async () => {
    const bad = await git.worktreeCreate(project, '-x')
    expect(bad.ok).toBe(false)
    expect(bad.error).toBe('Invalid worktree name')
    const nope = await git.worktreeRemove({ kind: 'native', dir: join(tmpdir(), 'piwright-wt-missing-xyz') }, 'feat', false)
    expect(nope.ok).toBe(false)
    expect(nope.error).toBe('Not a git repository')
  })

  it('remove refuses uncommitted changes, force removes; branch survives', async () => {
    writeFileSync(join(dir, '.pi', 'worktrees', 'feat', 'dirty.txt'), 'x')
    const refused = await git.worktreeRemove(project, 'feat', false)
    expect(refused.ok).toBe(false)
    expect(refused.uncommitted).toBe(true)
    expect(existsSync(join(dir, '.pi', 'worktrees', 'feat'))).toBe(true)

    const forced = await git.worktreeRemove(project, 'feat', true)
    expect(forced.ok).toBe(true)
    expect(existsSync(join(dir, '.pi', 'worktrees', 'feat'))).toBe(false)
    const branches = await git.branches(project)
    expect(branches.branches).toContain('worktree-feat')
  })

  it('re-create after remove reuses the leftover branch (add without -b)', async () => {
    const created = await git.worktreeCreate(project, 'feat')
    expect(created.ok).toBe(true)
    const clean = await git.worktreeRemove(project, 'feat', false)
    expect(clean.ok).toBe(true)
  })

  it('mergeBase merges the root checkout branch into the worktree branch', async () => {
    const created = await git.worktreeCreate(project, 'feat')
    expect(created.ok).toBe(true)
    writeFileSync(join(dir, 'base.txt'), 'base')
    execSync('git add .', { cwd: dir, stdio: 'pipe' })
    execSync('git commit -q -m base-change', { cwd: dir, stdio: 'pipe' })
    const synced = await git.worktreeMergeBase({ kind: 'native', dir: created.dir! })
    expect(synced).toEqual({ ok: true, error: null })
    expect(existsSync(join(dir, '.pi', 'worktrees', 'feat', 'base.txt'))).toBe(true)
  })

  it('mergeBase is a no-op ok for a non-worktree project', async () => {
    const synced = await git.worktreeMergeBase(project)
    expect(synced).toEqual({ ok: true, error: null })
  })

  it('mergeBase aborts on conflict and leaves the worktree clean', async () => {
    const wtDir = join(dir, '.pi', 'worktrees', 'feat')
    writeFileSync(join(wtDir, 'conflict.txt'), 'from worktree')
    execSync('git add .', { cwd: wtDir, stdio: 'pipe' })
    execSync('git commit -q -m wt-change', { cwd: wtDir, stdio: 'pipe' })
    writeFileSync(join(dir, 'conflict.txt'), 'from base')
    execSync('git add .', { cwd: dir, stdio: 'pipe' })
    execSync('git commit -q -m base-change-2', { cwd: dir, stdio: 'pipe' })
    const synced = await git.worktreeMergeBase({ kind: 'native', dir: wtDir })
    expect(synced.ok).toBe(false)
    expect(synced.error).toBeTruthy()
    expect(readFileSync(join(wtDir, 'conflict.txt'), 'utf8')).toBe('from worktree')
    expect(execSync('git status --porcelain', { cwd: wtDir, stdio: 'pipe' }).toString().trim()).toBe('')
  })
})
