/** История изменений: GitHub Releases фида обновлений (owner/repo парсится из updateUrl).
 *  Тела релизов чистятся от хэшей коммитов, кэш в userData — офлайн-фолбэк. */
import { join } from 'path'
import { readFile, writeFile, mkdir } from 'fs/promises'
import type { ChangelogRelease, ChangelogResult } from '../shared/ipc-contracts'

/** owner/repo из generic-фида вида https://github.com/<owner>/<repo>/releases/latest/download/ */
export function parseGitHubRepo(updateUrl: string): string | null {
  const m = /github\.com\/([^/\s]+)\/([^/\s#?]+)/.exec(updateUrl.trim())
  if (m === null) return null
  const repo = m[2].replace(/\.git$/, '')
  return `${m[1]}/${repo}`
}

/** Убирает хэши коммитов из markdown-тела: « (1a2b3c4)» и «[1a2b3c4]». */
export function stripCommitHashes(md: string): string {
  return md
    .replace(/\s*\((?:[0-9a-f]{7,40})\)/gi, '')
    .replace(/\s*\[(?:[0-9a-f]{7,40})\]/g, '')
}

interface ChangelogCache {
  fetchedAt: number
  releases: ChangelogRelease[]
}

function cachePath(userDataDir: string): string {
  return join(userDataDir, 'changelog-cache.json')
}

async function readCache(userDataDir: string): Promise<ChangelogCache | null> {
  try {
    const raw = await readFile(cachePath(userDataDir), 'utf8')
    const parsed = JSON.parse(raw) as Partial<ChangelogCache>
    if (!Array.isArray(parsed.releases)) return null
    return { fetchedAt: typeof parsed.fetchedAt === 'number' ? parsed.fetchedAt : 0, releases: parsed.releases }
  } catch {
    return null
  }
}

interface GhRelease {
  tag_name?: unknown
  published_at?: unknown
  draft?: unknown
  prerelease?: unknown
  body?: unknown
}

function toRelease(r: GhRelease): ChangelogRelease | null {
  if (typeof r.tag_name !== 'string' || r.tag_name.length === 0) return null
  const version = r.tag_name.replace(/^v/, '')
  const date = typeof r.published_at === 'string' ? r.published_at.slice(0, 10) : ''
  const body = typeof r.body === 'string' ? stripCommitHashes(r.body).trim() : ''
  return { version, date, body }
}

/** Релизы с GitHub API; при неудаче — кэш (stale). Ок — кэш обновляется. */
export async function fetchChangelog(updateUrl: string, userDataDir: string): Promise<ChangelogResult> {
  const repo = parseGitHubRepo(updateUrl)
  if (repo === null) {
    return { ok: false, releases: [], stale: false, error: 'update feed is not a GitHub repository' }
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=30`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'PiWright' }
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { message?: unknown } | null
      const msg = err !== null && typeof err.message === 'string' ? err.message : `GitHub API ${res.status}`
      throw new Error(msg)
    }
    const list = (await res.json()) as GhRelease[]
    const releases = list
      .filter((r) => r.draft !== true && r.prerelease !== true)
      .map(toRelease)
      .filter((r): r is ChangelogRelease => r !== null)
    const cache: ChangelogCache = { fetchedAt: Date.now(), releases }
    await mkdir(userDataDir, { recursive: true })
    await writeFile(cachePath(userDataDir), JSON.stringify(cache), 'utf8')
    return { ok: true, releases, stale: false, error: null }
  } catch (e) {
    const cached = await readCache(userDataDir)
    if (cached !== null) {
      const releases = cached.releases.map((r) => ({ ...r, body: stripCommitHashes(r.body) }))
      return { ok: true, releases, stale: true, error: null }
    }
    return { ok: false, releases: [], stale: false, error: e instanceof Error ? e.message : String(e) }
  }
}
