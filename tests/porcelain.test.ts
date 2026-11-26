import { describe, expect, it } from 'vitest'
import { parseLogOneline, parseLogRich, parseNameStatus, parseStatusOutput, unquoteGitPath } from '../src/main/git/porcelain'

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

  it('parses unmerged (conflict) entries with spaces in paths', () => {
    const status = parseStatusOutput(
      [
        '# branch.head main',
        'u UU N... 100644 100644 100644 100644 aaa bbb ccc src/a b.txt',
        'u AA N... 100644 100644 100644 100644 aaa bbb ccc both-new.txt',
        ''
      ].join('\n')
    )
    expect(status.entries).toEqual([
      { path: 'src/a b.txt', origPath: null, index: 'U', worktree: 'U', untracked: false },
      { path: 'both-new.txt', origPath: null, index: 'A', worktree: 'A', untracked: false }
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

describe('parseLogRich', () => {
  const record = (hash: string, author: string, date: string, subject: string, parents: string, refs: string): string =>
    [hash, author, date, subject, parents, refs].join('\x1f') + '\x1e'

  it('parses records separated by \x1e with fields by \x1f', () => {
    const output =
      record('a1', 'Ann', '100', 'first commit', 'b2', 'HEAD -> main') +
      '\n' +
      record('b2', 'Bob', '200', 'second', '', 'origin/main, v1')
    expect(parseLogRich(output)).toEqual([
      { hash: 'a1', author: 'Ann', date: 100, subject: 'first commit', parents: ['b2'], refs: ['HEAD -> main'] },
      { hash: 'b2', author: 'Bob', date: 200, subject: 'second', parents: [], refs: ['origin/main', 'v1'] }
    ])
  })

  it('skips empty records and records with missing fields', () => {
    expect(parseLogRich('\x1e\n')).toEqual([])
    expect(parseLogRich('onlyonefield\x1e')).toEqual([])
  })
})

describe('parseNameStatus', () => {
  it('parses status and path', () => {
    expect(parseNameStatus('M\tsrc/a.ts\nA\tnew.ts\n')).toEqual([
      { status: 'M', path: 'src/a.ts', origPath: null },
      { status: 'A', path: 'new.ts', origPath: null }
    ])
  })

  it('swaps rename columns: old path first, new path second', () => {
    expect(parseNameStatus('R100\told.ts\tnew.ts\n')).toEqual([{ status: 'R', path: 'new.ts', origPath: 'old.ts' }])
  })

  it('returns empty for empty output', () => {
    expect(parseNameStatus('')).toEqual([])
  })
})
