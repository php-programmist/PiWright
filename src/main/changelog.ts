/** История изменений: GitHub Releases фида обновлений (owner/repo парсится из updateUrl).
 *  Основной источник — GitHub API; при отказе (rate limit 60/ч на IP, сеть) — Atom-фид
 *  releases.atom без лимитов (тела — готовый HTML, санитизируются). Кэш в userData —
 *  офлайн-фолбэк. Тела чистятся от хэшей коммитов. */
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

/** Убирает хэши коммитов из markdown-тела: « (1a2b3c4)», « (1a2b3c4, 829774b)»,
 *  «[1a2b3c4]», бэктик-хэши «`1a2b3c4`» (пустые скобки после них — тоже). */
export function stripCommitHashes(md: string): string {
  return md
    .replace(/\s*\((?:[0-9a-f]{7,40})(?:\s*,\s*[0-9a-f]{7,40})*\)/gi, '')
    .replace(/\s*\[(?:[0-9a-f]{7,40})(?:\s*,\s*[0-9a-f]{7,40})*\]/g, '')
    .replace(/\s*`(?:[0-9a-f]{7,40})`/g, '')
    .replace(/\s*\(\s*\)/g, '')
}

/** Санитизация HTML из Atom-фида: коммит-ссылки (с хэшами) целиком, пустые скобки
 *  после них, script/style/iframe и опасные атрибуты. */
export function sanitizeReleaseHtml(html: string): string {
  return stripCommitHashes(
    html
      .replace(/<a class="commit-link"[^>]*>[\s\S]*?<\/a>/gi, '')
      .replace(/<(code|tt)>\s*[0-9a-f]{7,40}\s*<\/\1>/gi, '')
      .replace(/\s*\(\s*\)/g, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
      .replace(/<(object|embed|link|meta|base)\b[^>]*>/gi, '')
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"')
  )
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

/** Релизы из Atom-XML: версия из link /releases/tag/<tag> (фолбэк — title),
 *  дата из <updated>, тело — санитизированный HTML. */
export function parseReleasesAtom(xml: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = []
  const entries = xml.split(/<entry[\s>]/).slice(1)
  for (const entry of entries) {
    const linkTag = /<link[^>]*href="([^"]+)"[^>]*\/?>/.exec(entry)
    const title = /<title>([\s\S]*?)<\/title>/.exec(entry)?.[1] ?? ''
    const updated = /<updated>([\s\S]*?)<\/updated>/.exec(entry)?.[1] ?? ''
    const content = /<content[^>]*>([\s\S]*?)<\/content>/.exec(entry)?.[1] ?? ''
    const tag = linkTag !== null ? /\/tag\/([^/?#]+)\/*$/.exec(linkTag[1])?.[1] : undefined
    const version = decodeEntities(tag ?? title).replace(/^v/, '')
    if (version.length === 0) continue
    const bodyHtml = sanitizeReleaseHtml(decodeEntities(content)).trim()
    releases.push({
      version,
      date: updated.slice(0, 10),
      body: '',
      bodyHtml: bodyHtml.length > 0 ? bodyHtml : undefined
    })
  }
  return releases.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
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

async function writeCache(userDataDir: string, releases: ChangelogRelease[]): Promise<void> {
  await mkdir(userDataDir, { recursive: true })
  await writeFile(cachePath(userDataDir), JSON.stringify({ fetchedAt: Date.now(), releases } satisfies ChangelogCache), 'utf8')
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

async function fetchViaApi(repo: string): Promise<ChangelogRelease[]> {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=30`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'PiWright' }
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { message?: unknown } | null
    const msg = err !== null && typeof err.message === 'string' ? err.message : `GitHub API ${res.status}`
    throw new Error(msg)
  }
  const list = (await res.json()) as GhRelease[]
  return list
    .filter((r) => r.draft !== true && r.prerelease !== true)
    .map(toRelease)
    .filter((r): r is ChangelogRelease => r !== null)
}

async function fetchViaAtom(repo: string): Promise<ChangelogRelease[]> {
  const res = await fetch(`https://github.com/${repo}/releases.atom`, {
    headers: { Accept: 'application/atom+xml', 'User-Agent': 'PiWright' }
  })
  if (!res.ok) throw new Error(`GitHub releases feed ${res.status}`)
  const xml = await res.text()
  const releases = parseReleasesAtom(xml)
  if (releases.length === 0) throw new Error('empty releases feed')
  return releases
}

/** Нормализация тел при выдаче: стрип хэшей идемпотентен — чинит и кэши старых версий. */
function normalizeReleases(releases: ChangelogRelease[]): ChangelogRelease[] {
  return releases.map((r) => ({
    ...r,
    body: stripCommitHashes(r.body),
    bodyHtml: r.bodyHtml !== undefined ? sanitizeReleaseHtml(r.bodyHtml) : undefined
  }))
}

/** Релизы: GitHub API → Atom-фид → кэш (stale). */
export async function fetchChangelog(updateUrl: string, userDataDir: string): Promise<ChangelogResult> {
  const repo = parseGitHubRepo(updateUrl)
  if (repo === null) {
    return { ok: false, releases: [], stale: false, error: 'update feed is not a GitHub repository' }
  }
  let releases: ChangelogRelease[] | null = null
  let lastError = ''
  try {
    releases = await fetchViaApi(repo)
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e)
  }
  if (releases === null) {
    try {
      releases = await fetchViaAtom(repo)
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
    }
  }
  if (releases !== null) {
    const normalized = normalizeReleases(releases)
    await writeCache(userDataDir, normalized).catch(() => {})
    return { ok: true, releases: normalized, stale: false, error: null }
  }
  const cached = await readCache(userDataDir)
  if (cached !== null) {
    return { ok: true, releases: normalizeReleases(cached.releases), stale: true, error: null }
  }
  return { ok: false, releases: [], stale: false, error: lastError }
}
