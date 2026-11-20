/** FileService: дерево и чтение файлов проекта — fs по хост-пути (native — Windows-каталог,
 *  wsl — UNC `\\wsl.localhost\…`, читается из Windows напрямую). Автообновление открытых
 *  файлов — chokidar на набор путей; для WSL — polling (fs.watch по UNC ненадёжен). */
import { promises as fs } from 'node:fs'
import { win32 } from 'node:path'
import * as chokidar from 'chokidar'
import type { FileListResult, FileReadResult, FileWriteResult, ProjectEntry } from '../../shared/ipc-contracts'

const MAX_READ_BYTES = 2 * 1024 * 1024
const BINARY_PLACEHOLDER = '(binary file)'
const LARGE_PLACEHOLDER = '(file too large to display)'
const WSL_POLL_INTERVAL_MS = 1500

/** relPath (`a/b/c`, слэши вперёд) → хост-путь внутри root; null — путь наружу корня. */
export function resolveWithinRoot(root: string, relPath: string): string | null {
  if (win32.isAbsolute(relPath)) return null
  const normalizedRoot = win32.normalize(root)
  const abs = win32.join(normalizedRoot, ...relPath.split('/'))
  const rel = win32.relative(normalizedRoot, abs)
  if (rel.startsWith('..') || win32.isAbsolute(rel)) return null
  return abs
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((v) => b.has(v))
}

export interface FileServiceEvents {
  onChanged: (project: ProjectEntry, relPath: string) => void
}

export class FileService {
  private readonly openPaths = new Map<string, Set<string>>()
  private readonly watchers = new Map<string, chokidar.FSWatcher>()

  constructor(private readonly events: FileServiceEvents) {}

  async listDir(project: ProjectEntry, relDir: string): Promise<FileListResult> {
    const abs = resolveWithinRoot(project.dir, relDir)
    if (abs === null) return { ok: false, error: 'Path is outside the project', entries: [] }
    try {
      const dirents = await fs.readdir(abs, { withFileTypes: true })
      const entries = dirents
        .filter((d) => d.name !== '.git')
        .map((d) => ({ name: d.name, kind: d.isDirectory() ? ('dir' as const) : ('file' as const) }))
      entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1))
      return { ok: true, error: null, entries }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), entries: [] }
    }
  }

  async read(project: ProjectEntry, relPath: string): Promise<FileReadResult> {
    const abs = resolveWithinRoot(project.dir, relPath)
    if (abs === null) return { ok: false, error: 'Path is outside the project', content: '' }
    try {
      const stat = await fs.stat(abs)
      if (!stat.isFile()) return { ok: false, error: 'Not a regular file', content: '' }
      if (stat.size > MAX_READ_BYTES) return { ok: true, error: null, content: LARGE_PLACEHOLDER }
      const buffer = await fs.readFile(abs)
      return { ok: true, error: null, content: buffer.includes(0) ? BINARY_PLACEHOLDER : buffer.toString('utf8') }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), content: '' }
    }
  }

  async write(project: ProjectEntry, relPath: string, content: string): Promise<FileWriteResult> {
    const abs = resolveWithinRoot(project.dir, relPath)
    if (abs === null) return { ok: false, error: 'Path is outside the project' }
    try {
      await fs.mkdir(win32.dirname(abs), { recursive: true })
      await fs.writeFile(abs, content, 'utf8')
      return { ok: true, error: null }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** Набор открытых файлов проекта → вотчеры; вызывается renderer'ом при каждом изменении набора. */
  setWatched(project: ProjectEntry, relPaths: string[]): void {
    const key = `${project.kind}\u0000${project.dir}`
    const next = new Set(relPaths)
    const current = this.openPaths.get(key)
    if (current !== undefined && sameSet(current, next)) return
    this.openPaths.set(key, next)
    void this.watchers.get(key)?.close().catch(() => {})
    this.watchers.delete(key)
    const hostPaths = [...next]
      .map((p) => resolveWithinRoot(project.dir, p))
      .filter((p): p is string => p !== null)
    if (hostPaths.length === 0) return
    const watcher = chokidar.watch(hostPaths, {
      ignoreInitial: true,
      ...(project.kind === 'wsl' ? { usePolling: true, interval: WSL_POLL_INTERVAL_MS } : {})
    })
    watcher.on('all', (_event, hostPath) => {
      const rel = win32.relative(win32.normalize(project.dir), hostPath).replace(/\\/g, '/')
      if (this.openPaths.get(key)?.has(rel) === true) this.events.onChanged(project, rel)
    })
    this.watchers.set(key, watcher)
  }

  dispose(): void {
    for (const watcher of this.watchers.values()) void watcher.close().catch(() => {})
    this.watchers.clear()
    this.openPaths.clear()
  }
}
