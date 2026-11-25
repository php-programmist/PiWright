import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchChangelog, parseGitHubRepo, stripCommitHashes } from '../src/main/changelog'
import { consumeUpdateInfo } from '../src/main/update-state'

describe('parseGitHubRepo', () => {
  it('parses owner/repo from generic feed url', () => {
    expect(parseGitHubRepo('https://github.com/php-programmist/PiWright/releases/latest/download/')).toBe(
      'php-programmist/PiWright'
    )
  })

  it('strips .git suffix and tolerates missing trailing slash', () => {
    expect(parseGitHubRepo('https://github.com/foo/bar.git')).toBe('foo/bar')
    expect(parseGitHubRepo('  https://github.com/foo/bar/releases/latest/download')).toBe('foo/bar')
  })

  it('returns null for non-github feeds', () => {
    expect(parseGitHubRepo('https://updates.example.com/feed/')).toBeNull()
    expect(parseGitHubRepo('')).toBeNull()
  })
})

describe('stripCommitHashes', () => {
  it('removes parenthesized short and long hashes', () => {
    expect(stripCommitHashes('opens the card (3344b1a)')).toBe('opens the card')
    expect(stripCommitHashes('fixes crash (fa99926abcdef0123456789abcdef0123456789a)')).toBe('fixes crash')
  })

  it('removes bracketed hashes and keeps non-hash parens', () => {
    expect(stripCommitHashes('see [a1b2c3d] notes')).toBe('see notes')
    expect(stripCommitHashes('call foo(bar) and v0.4.1 (2026-11-25)')).toBe('call foo(bar) and v0.4.1 (2026-11-25)')
  })

  it('keeps session tokens and hex-looking words inside backticks', () => {
    const md = 'token is now `session:<sessionId>` instead of `kanban:session:<sessionId>`'
    expect(stripCommitHashes(md)).toBe(md)
  })
})

describe('consumeUpdateInfo', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'piwright-update-state-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('first run: no updatedFrom, writes current version', async () => {
    const info = await consumeUpdateInfo(dir, '0.4.1')
    expect(info.updatedFrom).toBeNull()
    expect(JSON.parse(readFileSync(join(dir, 'update-state.json'), 'utf8'))).toEqual({ lastVersion: '0.4.1' })
  })

  it('same version: no updatedFrom', async () => {
    await consumeUpdateInfo(dir, '0.4.1')
    const info = await consumeUpdateInfo(dir, '0.4.1')
    expect(info.updatedFrom).toBeNull()
  })

  it('version change: reports previous version', async () => {
    await consumeUpdateInfo(dir, '0.4.0')
    const info = await consumeUpdateInfo(dir, '0.4.1')
    expect(info.updatedFrom).toBe('0.4.0')
    expect(JSON.parse(readFileSync(join(dir, 'update-state.json'), 'utf8'))).toEqual({ lastVersion: '0.4.1' })
  })

  it('corrupt state file behaves like first run', async () => {
    writeFileSync(join(dir, 'update-state.json'), 'not json', 'utf8')
    const info = await consumeUpdateInfo(dir, '0.4.1')
    expect(info.updatedFrom).toBeNull()
  })
})

describe('fetchChangelog', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'piwright-changelog-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.unstubAllGlobals()
  })

  const ghRelease = {
    tag_name: 'v0.4.1',
    published_at: '2026-11-25T07:30:05Z',
    draft: false,
    prerelease: false,
    body: '## Added\n- New tab (032e4af)\n- Another (a972283)'
  }

  it('fetches releases, strips hashes, sorts newest first, writes cache', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => [ghRelease, { ...ghRelease, tag_name: 'v0.4.0', published_at: '2026-11-24T10:00:00Z', body: 'old (1111111)' }]
      }))
    )
    const result = await fetchChangelog('https://github.com/foo/bar/releases/latest/download/', dir)
    expect(result.ok).toBe(true)
    expect(result.stale).toBe(false)
    expect(result.releases.map((r) => r.version)).toEqual(['0.4.1', '0.4.0'])
    expect(result.releases[0].date).toBe('2026-11-25')
    expect(result.releases[0].body).toBe('## Added\n- New tab\n- Another')
    const cache = JSON.parse(readFileSync(join(dir, 'changelog-cache.json'), 'utf8'))
    expect(cache.releases).toHaveLength(2)
  })

  it('skips drafts and prereleases', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => [ghRelease, { ...ghRelease, tag_name: 'v0.5.0-beta.1', prerelease: true }, { ...ghRelease, tag_name: 'v0.5.0', draft: true }]
      }))
    )
    const result = await fetchChangelog('https://github.com/foo/bar/releases/latest/download/', dir)
    expect(result.releases.map((r) => r.version)).toEqual(['0.4.1'])
  })

  it('network failure falls back to cache with stale flag', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [ghRelease] })))
    await fetchChangelog('https://github.com/foo/bar/releases/latest/download/', dir)
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline')
    }))
    const result = await fetchChangelog('https://github.com/foo/bar/releases/latest/download/', dir)
    expect(result.ok).toBe(true)
    expect(result.stale).toBe(true)
    expect(result.releases.map((r) => r.version)).toEqual(['0.4.1'])
  })

  it('network failure without cache returns error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline')
    }))
    const result = await fetchChangelog('https://github.com/foo/bar/releases/latest/download/', dir)
    expect(result.ok).toBe(false)
    expect(result.releases).toEqual([])
    expect(result.error).toBe('offline')
  })

  it('non-github feed returns error without fetching', async () => {
    const result = await fetchChangelog('https://updates.example.com/feed/', dir)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('not a GitHub repository')
  })

  it('http error status falls back to cache', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [ghRelease] })))
    await fetchChangelog('https://github.com/foo/bar/releases/latest/download/', dir)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => [] })))
    const result = await fetchChangelog('https://github.com/foo/bar/releases/latest/download/', dir)
    expect(result.stale).toBe(true)
    expect(result.releases).toHaveLength(1)
  })
})
