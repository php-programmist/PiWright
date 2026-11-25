import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchChangelog, parseGitHubRepo, parseReleasesAtom, sanitizeReleaseHtml, stripCommitHashes } from '../src/main/changelog'
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

  it('removes hash lists inside one pair of parens', () => {
    expect(stripCommitHashes('kanban system (abe382a, 27bc4db, f02d450)')).toBe('kanban system')
    expect(stripCommitHashes('fixes (b342b16,5c04ed4) and (9f91e3e)')).toBe('fixes and')
  })

  it('removes backtick hashes and empty parens after them', () => {
    expect(stripCommitHashes('Project tabs (`2fefa4d`)')).toBe('Project tabs')
    expect(stripCommitHashes('keeps `session:<sessionId>` token')).toBe('keeps `session:<sessionId>` token')
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

describe('sanitizeReleaseHtml', () => {
  it('removes commit-link anchors and empty parens after them', () => {
    const html = '<li>New tab (<a class="commit-link" data-hovercard-url="https://github.com/o/r/commit/032e4af9a4911be12a93cfdf97cec87f3a155bea/hovercard" href="https://github.com/o/r/commit/032e4af9a4911be12a93cfdf97cec87f3a155bea"><tt>032e4af</tt></a>)</li>'
    expect(sanitizeReleaseHtml(html)).toBe('<li>New tab</li>')
  })

  it('strips scripts, styles, iframes, event handlers and javascript urls', () => {
    const html = '<p onclick="evil()">x</p><script>evil()</script><style>.x{}</style><iframe src="https://evil"></iframe><a href="javascript:evil()">y</a>'
    const out = sanitizeReleaseHtml(html)
    expect(out).not.toContain('script')
    expect(out).not.toContain('onclick')
    expect(out).not.toContain('iframe')
    expect(out).not.toContain('javascript:')
    expect(out).toContain('<p>x</p>')
  })

  it('strips plain-text hashes but keeps versions', () => {
    expect(sanitizeReleaseHtml('<p>fixed (fa99926)</p>')).toBe('<p>fixed</p>')
    expect(sanitizeReleaseHtml('<p>v0.4.1 (2026-11-25)</p>')).toBe('<p>v0.4.1 (2026-11-25)</p>')
  })

  it('removes code/tt elements holding a bare hash', () => {
    expect(sanitizeReleaseHtml('<li>tabs (<code>2fefa4d</code>)</li>')).toBe('<li>tabs</li>')
    expect(sanitizeReleaseHtml('<li>tabs (<tt>2fefa4d</tt>)</li>')).toBe('<li>tabs</li>')
    expect(sanitizeReleaseHtml('<code>session:&lt;sessionId&gt;</code>')).toBe('<code>session:&lt;sessionId&gt;</code>')
  })
})

describe('parseReleasesAtom', () => {
  const entry = (tag: string, date: string, contentHtml: string): string =>
    `<entry><id>tag:github.com,2008:Repository/1/${tag}</id><updated>${date}T07:30:05Z</updated>` +
    `<link rel="alternate" type="text/html" href="https://github.com/o/r/releases/tag/${tag}"/>` +
    `<title>${tag}</title><content type="html">${contentHtml
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')}</content></entry>`

  it('parses version from link tag, date from updated, decodes and sanitizes content', () => {
    const content = '<h2>Added</h2><ul><li>new tab (<a class="commit-link" href="https://github.com/o/r/commit/032e4af9a491"><tt>032e4af</tt></a>)</li><li>token <code>session:&lt;sessionId&gt;</code> works</li></ul>'
    const xml = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Release notes</title>${entry('v0.4.1', '2026-11-25', content)}${entry('v0.4.0', '2026-11-24', '<p>old (1111111)</p>')}</feed>`
    const releases = parseReleasesAtom(xml)
    expect(releases.map((r) => r.version)).toEqual(['0.4.1', '0.4.0'])
    expect(releases[0].date).toBe('2026-11-25')
    expect(releases[0].bodyHtml).toContain('<h2>Added</h2>')
    expect(releases[0].bodyHtml).toContain('<li>new tab</li>')
    expect(releases[0].bodyHtml).toContain('<code>session:&lt;sessionId&gt;</code>')
    expect(releases[0].bodyHtml).not.toContain('032e4af')
    expect(releases[1].bodyHtml).toBe('<p>old</p>')
  })

  it('falls back to title when link is missing, sorts newest first', () => {
    const xml = '<feed><entry><title>v0.3.0</title><updated>2026-11-20T10:00:00Z</updated><content type="html">&lt;p&gt;x&lt;/p&gt;</content></entry><entry><title>v0.4.0</title><updated>2026-11-24T10:00:00Z</updated><content type="html">&lt;p&gt;y&lt;/p&gt;</content></entry></feed>'
    const releases = parseReleasesAtom(xml)
    expect(releases.map((r) => r.version)).toEqual(['0.4.0', '0.3.0'])
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

  it('api rate limit falls back to atom feed with html bodies', async () => {
    const atomXml =
      '<feed><entry><id>tag:x</id><updated>2026-11-25T07:30:05Z</updated>' +
      '<link href="https://github.com/foo/bar/releases/tag/v0.4.1"/><title>v0.4.1</title>' +
      '<content type="html">&lt;h2&gt;Added&lt;/h2&gt;&lt;ul&gt;&lt;li&gt;stuff (&lt;a class="commit-link" href="https://github.com/foo/bar/commit/032e4af"&gt;&lt;tt&gt;032e4af&lt;/tt&gt;&lt;/a&gt;)&lt;/li&gt;&lt;/ul&gt;</content></entry></feed>'
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('api.github.com')) return { ok: false, status: 403, json: async () => ({ message: 'API rate limit exceeded' }) }
        return { ok: true, text: async () => atomXml }
      })
    )
    const result = await fetchChangelog('https://github.com/foo/bar/releases/latest/download/', dir)
    expect(result.ok).toBe(true)
    expect(result.stale).toBe(false)
    expect(result.releases).toHaveLength(1)
    expect(result.releases[0].version).toBe('0.4.1')
    expect(result.releases[0].bodyHtml).toContain('<li>stuff</li>')
    expect(result.releases[0].bodyHtml).not.toContain('032e4af')
  })

  it('api and atom both failing falls back to cache', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [ghRelease] })))
    await fetchChangelog('https://github.com/foo/bar/releases/latest/download/', dir)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('api.github.com')) throw new Error('offline')
      return { ok: false, status: 500, text: async () => '' }
    }))
    const result = await fetchChangelog('https://github.com/foo/bar/releases/latest/download/', dir)
    expect(result.ok).toBe(true)
    expect(result.stale).toBe(true)
    expect(result.releases).toHaveLength(1)
  })
})
