import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  isProjectSessionDir,
  listProjectSessions,
  parseSessionSummary,
  sessionDirName,
  summarizeSessionFile
} from '../src/main/sessions/session-catalog'

const HEADER = '{"type":"session","version":3,"id":"s1","timestamp":"2026-09-26T10:29:47.527Z","cwd":"/tmp/p"}'
const USER = '{"type":"message","id":"m1","parentId":null,"message":{"role":"user","content":[{"type":"text","text":"say hi"}]}}'

describe('sessionDirName', () => {
  it('matches pi encoding', () => {
    expect(sessionDirName('/tmp/pi-probe')).toBe('--tmp-pi-probe--')
    expect(sessionDirName('C:\\Users\\x\\proj')).toBe('--C--Users-x-proj--')
  })
})

describe('isProjectSessionDir', () => {
  it('project and its worktrees belong to the project, siblings do not', () => {
    expect(isProjectSessionDir('--home-a-proj--', '/home/a/proj')).toBe(true)
    expect(isProjectSessionDir('--home-a-proj-.pi-worktrees-feat--', '/home/a/proj')).toBe(true)
    expect(isProjectSessionDir('--home-a-proj2--', '/home/a/proj')).toBe(false)
    expect(isProjectSessionDir('--home-a-proj-sub--', '/home/a/proj')).toBe(false)
  })
})

describe('parseSessionSummary', () => {
  it('title is the first user message, id and cwd from the header', async () => {
    const s = await parseSessionSummary('/s/f.jsonl', [HEADER, USER], 42)
    expect(s).toEqual({ id: 's1', title: 'say hi', lastActivityEpochMs: 42, cwd: '/tmp/p', path: '/s/f.jsonl', parentSession: null })
  })

  it('session name wins over first message, last one wins', async () => {
    const info1 = '{"type":"session_info","id":"i1","parentId":"m1","name":"Refactor auth"}'
    const info2 = '{"type":"session_info","id":"i2","parentId":"m2","name":"Final name"}'
    const s = await parseSessionSummary('p', [HEADER, USER, info1, info2], 0)
    expect(s?.title).toBe('Final name')
  })

  it('blank names are ignored', async () => {
    const info = '{"type":"session_info","id":"i1","parentId":"m1","name":"  "}'
    const s = await parseSessionSummary('p', [HEADER, USER, info], 0)
    expect(s?.title).toBe('say hi')
  })

  it('overlong titles are truncated with ellipsis', async () => {
    const long = 'x'.repeat(200)
    const s = await parseSessionSummary('p', [HEADER, USER.replace('say hi', long)], 0)
    expect(s?.title.length).toBe(120)
    expect(s?.title.endsWith('…')).toBe(true)
  })

  it('empty session and non-session file are skipped', async () => {
    expect(await parseSessionSummary('p', [HEADER], 0)).toBeNull()
    expect(await parseSessionSummary('p', [USER], 0)).toBeNull()
    expect(await parseSessionSummary('p', [], 0)).toBeNull()
  })

  it('user content as plain string works', async () => {
    const user = '{"type":"message","id":"m1","message":{"role":"user","content":"plain text"}}'
    const s = await parseSessionSummary('p', [HEADER, user], 0)
    expect(s?.title).toBe('plain text')
  })

  it('candidate scan: jsonl without session_info markers is not parsed as JSON', async () => {
    const noise = '{"type":"message","id":"m2","message":{"role":"user","content":[{"type":"text","text":"second"}]}}'
    const s = await parseSessionSummary('p', [HEADER, USER, noise], 0)
    expect(s?.title).toBe('say hi')
  })
})

describe('summarizeSessionFile / listProjectSessions', () => {
  it('reads a real file and lists project dirs only, newest first', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'piwright-catalog-'))
    try {
      const own = join(root, '--tmp-p--')
      const worktree = join(root, '--tmp-p-.pi-worktrees-feat--')
      const other = join(root, '--tmp-q--')
      for (const dir of [own, worktree, other]) await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(join(own, 'old.jsonl'), `${HEADER}\n${USER}\n`, 'utf8')
      await fs.writeFile(join(own, 'not-a-session.jsonl'), '{"type":"message"}\n', 'utf8')
      await fs.writeFile(join(own, 'empty.jsonl'), '', 'utf8')
      await fs.writeFile(join(worktree, 'wt.jsonl'), `${HEADER}\n${USER}\n`, 'utf8')
      await fs.writeFile(join(other, 'foreign.jsonl'), `${HEADER}\n${USER}\n`, 'utf8')
      const future = new Date('2030-01-01T00:00:00Z')
      await fs.utimes(join(own, 'old.jsonl'), future, future)

      const single = await summarizeSessionFile(join(own, 'old.jsonl'), 7)
      expect(single?.id).toBe('s1')

      const list = await listProjectSessions(root, '/tmp/p')
      expect(list.map((s) => s.path.endsWith('old.jsonl') || s.path.endsWith('wt.jsonl') ? s.path.split(/[\\/]/).pop() : '')).toContain('old.jsonl')
      expect(list.some((s) => s.path.includes('foreign'))).toBe(false)
      expect(list).toHaveLength(2)
      expect(list[0].path.endsWith('old.jsonl')).toBe(true)
      expect(list[0].lastActivityEpochMs).toBeGreaterThan(list[1].lastActivityEpochMs)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('missing root yields empty list', async () => {
    expect(await listProjectSessions(join(tmpdir(), 'piwright-nope-xyz'), '/tmp/p')).toEqual([])
  })
})
