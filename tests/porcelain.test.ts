import { describe, expect, it } from 'vitest'
import { parseLogOneline, parseStatusOutput, unquoteGitPath } from '../src/main/git/porcelain'

describe('unquoteGitPath', () => {
  it('leaves plain paths as is', () => {
    expect(unquoteGitPath('src/a b.txt')).toBe('src/a b.txt')
  })

  it('unquotes backslashes, tabs and quotes', () => {
    expect(unquoteGitPath('"a\\\\b\\tc\\"d"')).toBe('a\\b\tc"d')
  })

  it('decodes octal UTF-8 escapes', () => {
    expect(unquoteGitPath('"\\321\\200\\321\\203"')).toBe('ру')
  })
})

describe('parseStatusOutput', () => {
  it('parses branch headers', () => {
    const status = parseStatusOutput(
      ['# branch.oid abc123', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -1', ''].join('\n')
    )
    expect(status.branch).toBe('main')
    expect(status.upstream).toBe('origin/main')
    expect(status.ahead).toBe(2)
    expect(status.behind).toBe(1)
    expect(status.detached).toBe(false)
    expect(status.entries).toEqual([])
  })

  it('parses changed, untracked and ignored entries', () => {
    const status = parseStatusOutput(
      ['# branch.head main', '1 .M N... 100644 100644 100644 abc def src/mod.ts', '? new.txt', '! ignored.log', ''].join('\n')
    )
    expect(status.entries).toEqual([
      { path: 'src/mod.ts', origPath: null, index: '.', worktree: 'M', untracked: false },
      { path: 'new.txt', origPath: null, index: '.', worktree: '?', untracked: true }
    ])
  })

  it('parses staged-only and both-side entries', () => {
    const status = parseStatusOutput(
      ['# branch.head main', '1 M. N... 100644 100644 100644 abc def staged.ts', '1 MM N... 100644 100644 100644 abc def both.ts', ''].join('\n')
    )
    expect(status.entries[0]).toMatchObject({ index: 'M', worktree: '.' })
    expect(status.entries[1]).toMatchObject({ index: 'M', worktree: 'M' })
  })

  it('parses renames with tab-separated paths', () => {
    const status = parseStatusOutput(
      ['# branch.head main', '2 R. N... 100644 100644 100644 abc def R100 new name.ts\told name.ts', ''].join('\n')
    )
    expect(status.entries[0]).toEqual({ path: 'new name.ts', origPath: 'old name.ts', index: 'R', worktree: '.', untracked: false })
  })

  it('parses detached head', () => {
    const status = parseStatusOutput('# branch.head (detached)\n')
    expect(status.branch).toBeNull()
    expect(status.detached).toBe(true)
  })
})

describe('parseLogOneline', () => {
  it('splits hash and subject on first space', () => {
    expect(parseLogOneline('abc1234 fix: handle spaces in paths\nfeed123 add tests\r\n')).toEqual([
      { hash: 'abc1234', subject: 'fix: handle spaces in paths' },
      { hash: 'feed123', subject: 'add tests' }
    ])
  })

  it('returns empty for empty output', () => {
    expect(parseLogOneline('')).toEqual([])
  })
})
