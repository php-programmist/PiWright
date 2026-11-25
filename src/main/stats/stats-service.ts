/** Статистика использования токенов: агрегаты in/out/cacheRead из JSONL-сессий всех проектов.
 *  Хранилище — JSON в userData (атомарная запись tmp+rename): по каждому файлу сессии —
 *  размер/mtime для инкрементального пересканирования и её вклад в часовые и дневные бакеты.
 *  Часовые бакеты храним только за последние 48 ч (детализация почасовая — последние сутки),
 *  дневные — без ограничения. Запрос строит непрерывный ряд бакетов окна (нули включительно). */
import { createReadStream, existsSync, mkdirSync, promises as fs, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'
import type { Dirent } from 'node:fs'
import type { StatsGranularity, StatsPoint, StatsProjectOption, StatsQuery, StatsResult, Settings } from '../../shared/ipc-contracts'
import { resolveSessionsRoot } from '../sessions/session-catalog'

const HOUR_MS = 3_600_000
/** Часовые бакеты старше этого горизонта удаляются при сохранении. */
const HOURLY_RETENTION_MS = 48 * HOUR_MS

/** [input, output, cacheRead]. */
export type Counts = [number, number, number]

export interface StatsFileEntry {
  size: number
  mtimeMs: number
  cwd: string
  /** Ключ `${начало часа (epoch ms)}|${model}` → счётчики. */
  hourly: Record<string, Counts>
  /** Ключ `${начало суток (epoch ms)}|${model}` → счётчики. */
  daily: Record<string, Counts>
}

interface StatsStoreFile {
  version: 1
  files: Record<string, StatsFileEntry>
}

export function hourStart(ts: number): number {
  const d = new Date(ts)
  d.setMinutes(0, 0, 0)
  return d.getTime()
}

export function dayStart(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function monthStart(ts: number): number {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}

/** Проект для группировки: worktree (`<проект>/.pi/worktrees/<имя>`) сворачивается в основной
 *  проект, разделители — к «/», Windows-пути — в нижний регистр. */
export function canonicalProject(cwd: string): string {
  const unified = cwd.replace(/\\/g, '/')
  const wt = unified.search(/\/\.pi\/worktrees\//i)
  const collapsed = wt >= 0 ? unified.slice(0, wt) : unified
  return /^[a-z]:\//i.test(collapsed) ? collapsed.toLowerCase() : collapsed
}

export function projectName(key: string): string {
  return key.slice(key.lastIndexOf('/') + 1) || key
}

function toCounts(value: unknown): Counts | null {
  if (!Array.isArray(value) || value.length !== 3) return null
  const ok = value.every((n) => typeof n === 'number' && Number.isFinite(n))
  return ok ? [value[0], value[1], value[2]] : null
}

function parseCountsMap(value: unknown): Record<string, Counts> | null {
  if (value === undefined) return {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const map: Record<string, Counts> = {}
  for (const [k, counts] of Object.entries(value)) {
    const c = toCounts(counts)
    if (c === null) return null
    map[k] = c
  }
  return map
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function addCounts(map: Record<string, Counts>, key: string, counts: Counts): void {
  const existing = map[key]
  if (existing === undefined) {
    map[key] = [counts[0], counts[1], counts[2]]
  } else {
    existing[0] += counts[0]
    existing[1] += counts[1]
    existing[2] += counts[2]
  }
}

function parseJsonObject(line: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(line)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function messageTimestamp(record: Record<string, unknown>, message: Record<string, unknown>): number | null {
  if (typeof message['timestamp'] === 'number' && Number.isFinite(message['timestamp'])) return message['timestamp']
  if (typeof record['timestamp'] === 'string') {
    const parsed = Date.parse(record['timestamp'])
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

/** Разбор JSONL-сессии: первая строка — заголовок `type:"session"` (cwd), дальше ассистентские
 *  сообщения с usage попадают в часовые и дневные бакеты по модели. Не-сессия → null. */
export async function scanSessionLines(
  lines: Iterable<string> | AsyncIterable<string>
): Promise<{ cwd: string; hourly: Record<string, Counts>; daily: Record<string, Counts> } | null> {
  let cwd: string | null = null
  const hourly: Record<string, Counts> = {}
  const daily: Record<string, Counts> = {}
  for await (const line of lines) {
    if (cwd === null) {
      const header = parseJsonObject(line)
      if (header === null || header['type'] !== 'session') return null
      cwd = typeof header['cwd'] === 'string' ? header['cwd'] : ''
      continue
    }
    if (!line.includes('"type":"message"') || !line.includes('"usage"') || !line.includes('"role":"assistant"')) continue
    const record = parseJsonObject(line)
    if (record === null || record['type'] !== 'message') continue
    const message = record['message']
    if (message === null || typeof message !== 'object' || Array.isArray(message)) continue
    const m = message as Record<string, unknown>
    if (m['role'] !== 'assistant') continue
    const usage = m['usage']
    if (usage === null || typeof usage !== 'object' || Array.isArray(usage)) continue
    const u = usage as Record<string, unknown>
    const counts: Counts = [num(u['input']), num(u['output']), num(u['cacheRead'])]
    if (counts[0] === 0 && counts[1] === 0 && counts[2] === 0) continue
    const ts = messageTimestamp(record, m)
    if (ts === null) continue
    const model = typeof m['model'] === 'string' && m['model'].length > 0 ? m['model'] : 'unknown'
    addCounts(hourly, `${hourStart(ts)}|${model}`, counts)
    addCounts(daily, `${dayStart(ts)}|${model}`, counts)
  }
  if (cwd === null) return null
  return { cwd, hourly, daily }
}

/** Бакеты окна: day = последние 24 часа почасово, month = текущий месяц по дням,
 *  year = текущий год по месяцам, custom = выбранный месяц по дням. */
export function buildBuckets(
  kind: StatsQuery['kind'],
  month: number | undefined,
  year: number | undefined,
  now: number
): { granularity: StatsGranularity; starts: number[] } {
  if (kind === 'day') {
    const d = new Date(now)
    d.setMinutes(0, 0, 0)
    const starts: number[] = []
    for (let i = 0; i < 24; i++) {
      starts.push(d.getTime())
      d.setHours(d.getHours() - 1)
    }
    starts.reverse()
    return { granularity: 'hour', starts }
  }
  if (kind === 'year') {
    const y = new Date(now).getFullYear()
    const starts: number[] = []
    for (let m = 0; m < 12; m++) starts.push(new Date(y, m, 1).getTime())
    return { granularity: 'month', starts }
  }
  const today = new Date(now)
  const y = kind === 'custom' && typeof year === 'number' ? year : today.getFullYear()
  const m = kind === 'custom' && typeof month === 'number' ? month : today.getMonth() + 1
  const cursor = new Date(y, m - 1, 1)
  const starts: number[] = []
  while (cursor.getMonth() === m - 1) {
    starts.push(cursor.getTime())
    cursor.setDate(cursor.getDate() + 1)
  }
  return { granularity: 'day', starts }
}

export function aggregate(
  files: Record<string, StatsFileEntry>,
  starts: number[],
  granularity: StatsGranularity,
  project: string | null,
  model: string | null
): { points: StatsPoint[]; projects: StatsProjectOption[]; models: string[] } {
  const index = new Map<number, number>(starts.map((t, i) => [t, i]))
  // Месячные бакеты не хранятся — роллап дневных: ключ дня → начало его месяца.
  const bucketIndex = granularity === 'month' ? (bucket: number) => index.get(monthStart(bucket)) : (bucket: number) => index.get(bucket)
  const points: StatsPoint[] = starts.map((t) => ({ t, input: 0, output: 0, cacheRead: 0 }))
  const projects = new Map<string, string>()
  const models = new Set<string>()
  for (const entry of Object.values(files)) {
    const key = canonicalProject(entry.cwd)
    if (!projects.has(key)) projects.set(key, projectName(key))
    const passProject = project === null || key === project
    for (const [map, mapGranularity] of [
      [entry.hourly, 'hour'],
      [entry.daily, 'day']
    ] as const) {
      for (const [k, counts] of Object.entries(map)) {
        const sep = k.lastIndexOf('|')
        models.add(k.slice(sep + 1))
        if (!passProject) continue
        if (mapGranularity !== granularity && !(mapGranularity === 'day' && granularity === 'month')) continue
        const bucket = Number(k.slice(0, sep))
        if (model !== null && k.slice(sep + 1) !== model) continue
        const i = bucketIndex(bucket)
        if (i === undefined) continue
        points[i].input += counts[0]
        points[i].output += counts[1]
        points[i].cacheRead += counts[2]
      }
    }
  }
  return {
    points,
    projects: [...projects.entries()].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name)),
    models: [...models].sort()
  }
}

function createEmptyStore(): StatsStoreFile {
  return { version: 1, files: {} }
}

export class TokenStatsService {
  private store: StatsStoreFile = createEmptyStore()
  private current: Promise<void> | null = null

  constructor(
    private readonly filePath: string,
    private readonly getSettings: () => Settings
  ) {
    this.load()
  }

  /** Инкрементальное пересканирование (stat всех файлов + перечтение изменённых). */
  async ensureScanned(): Promise<void> {
    if (this.current !== null) return this.current
    this.current = this.scan().finally(() => {
      this.current = null
    })
    return this.current
  }

  query(q: StatsQuery): StatsResult {
    const { granularity, starts } = buildBuckets(q.kind, q.month, q.year, Date.now())
    const { points, projects, models } = aggregate(this.store.files, starts, granularity, q.project, q.model)
    return { granularity, points, projects, models, updatedAt: Date.now() }
  }

  private async scan(): Promise<void> {
    const roots = await this.resolveRoots()
    const seen = new Set<string>()
    let changed = false
    for (const root of roots) {
      let dirs: Dirent[]
      try {
        dirs = await fs.readdir(root, { withFileTypes: true })
      } catch {
        continue
      }
      for (const dir of dirs) {
        if (!dir.isDirectory()) continue
        const dirPath = join(root, dir.name)
        let files: Dirent[]
        try {
          files = await fs.readdir(dirPath, { withFileTypes: true })
        } catch {
          continue
        }
        for (const file of files) {
          if (!file.isFile() || !file.name.endsWith('.jsonl')) continue
          const path = join(dirPath, file.name)
          seen.add(path)
          let st
          try {
            st = await fs.stat(path)
          } catch {
            continue
          }
          const prev = this.store.files[path]
          if (prev !== undefined && prev.size === st.size && prev.mtimeMs === st.mtimeMs) continue
          const entry = await this.processFile(path, st.size, st.mtimeMs)
          if (entry !== null) this.store.files[path] = entry
          else delete this.store.files[path]
          changed = true
        }
      }
    }
    for (const path of Object.keys(this.store.files)) {
      if (!seen.has(path)) {
        delete this.store.files[path]
        changed = true
      }
    }
    if (this.pruneHourly()) changed = true
    if (changed) this.persist()
  }

  private async resolveRoots(): Promise<string[]> {
    const projects = this.getSettings().projects
    const roots: string[] = []
    for (const project of projects) {
      // SSH-корни не сканируем: инкрементальный обход по сети на каждый скан слишком тяжёл.
      if (project.kind === 'ssh') continue
      const root = await resolveSessionsRoot(project, this.getSettings())
      if (root !== null && !roots.includes(root)) roots.push(root)
    }
    // Без настроенных проектов сканируем нативный корень: сессии CLI-pi тоже считаются.
    if (roots.length === 0) roots.push(join(homedir(), '.pi', 'agent', 'sessions'))
    return roots
  }

  private async processFile(path: string, size: number, mtimeMs: number): Promise<StatsFileEntry | null> {
    const stream = createReadStream(path, { encoding: 'utf8' })
    const lines = createInterface({ input: stream, crlfDelay: Infinity })
    try {
      const scanned = await scanSessionLines(lines)
      if (scanned === null) return null
      return { size, mtimeMs, cwd: scanned.cwd, hourly: scanned.hourly, daily: scanned.daily }
    } catch {
      return null
    } finally {
      lines.close()
      stream.close()
    }
  }

  private pruneHourly(): boolean {
    const cutoff = hourStart(Date.now()) - HOURLY_RETENTION_MS
    let changed = false
    for (const entry of Object.values(this.store.files)) {
      for (const k of Object.keys(entry.hourly)) {
        if (Number(k.slice(0, k.lastIndexOf('|'))) < cutoff) {
          delete entry.hourly[k]
          changed = true
        }
      }
    }
    return changed
  }

  private load(): void {
    if (!existsSync(this.filePath)) return
    try {
      const raw: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'))
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return
      const files = (raw as StatsStoreFile).files
      if (files === null || typeof files !== 'object' || Array.isArray(files)) return
      const store = createEmptyStore()
      for (const [path, entry] of Object.entries(files)) {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
        const e = entry as Partial<StatsFileEntry>
        if (typeof e['size'] !== 'number' || typeof e['mtimeMs'] !== 'number' || typeof e['cwd'] !== 'string') continue
        const hourly = parseCountsMap(e['hourly'])
        const daily = parseCountsMap(e['daily'])
        if (hourly === null || daily === null) continue
        store.files[path] = { size: e['size'], mtimeMs: e['mtimeMs'], cwd: e['cwd'], hourly, daily }
      }
      this.store = store
    } catch {
      this.store = createEmptyStore()
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, JSON.stringify(this.store), 'utf8')
    renameSync(tmp, this.filePath)
  }
}
