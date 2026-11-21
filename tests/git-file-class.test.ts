import { describe, expect, it } from 'vitest'
import { BADGE_CLASS, fileStatusClass } from '../src/renderer/src/lib/git-file-class'
import type { GitFileEntry } from '../src/shared/ipc-contracts'

function entry(partial: Partial<GitFileEntry>): GitFileEntry {
  return { path: 'a.txt', origPath: null, index: '.', worktree: '.', untracked: false, ...partial }
}

describe('fileStatusClass', () => {
  it('untracked → unt regardless of index/worktree', () => {
    expect(fileStatusClass(entry({ untracked: true, worktree: '?' }))).toBe('unt')
  })

  it('worktree change wins over index', () => {
    expect(fileStatusClass(entry({ index: 'M', worktree: 'D' }))).toBe('del')
  })

  it('staged-only change uses index', () => {
    expect(fileStatusClass(entry({ index: 'A' }))).toBe('add')
    expect(fileStatusClass(entry({ index: 'M' }))).toBe('mod')
  })

  it('rename/typechange/conflict map like the git panel badges', () => {
    expect(fileStatusClass(entry({ index: 'R' }))).toBe('ren')
    expect(fileStatusClass(entry({ worktree: 'T' }))).toBe('mod')
    expect(fileStatusClass(entry({ index: 'U' }))).toBe('conflict')
  })

  it('clean entry has no class', () => {
    expect(fileStatusClass(entry({}))).toBe('')
  })

  it('BADGE_CLASS covers every porcelain letter', () => {
    for (const badge of ['M', 'A', 'D', 'R', 'C', 'T', 'U', '?']) {
      expect(BADGE_CLASS[badge]).toBeTruthy()
    }
  })
})
