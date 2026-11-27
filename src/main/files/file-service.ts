/** FileService: дерево и чтение файлов проекта — через ProjectFs (native/wsl — fs по хост-пути,
 *  ssh — SFTP). Автообновление открытых файлов — chokidar на набор путей; для WSL — polling
 *  (fs.watch по UNC ненадёжен); для ssh live-watch недоступен (без вотчеров). */
import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { posix, win32 } from 'node:path'
import * as chokidar from 'chokidar'
import { buildWslUncPath, parseWslUnc } from '../pi/backends/shell'
import { getProjectFs, type ProjectFs } from '../fs/project-fs'
import { imageMimeTypeForExtension } from '../../shared/attachments'
import type { FileListResult, FileReadImageResult, FileReadResult, FileRenameResult, FilesSearchResult, FileWriteResult, ProjectEntry, Settings } from '../../shared/ipc-contracts'
import { errorMessage } from '../../shared/errors'

const MAX_READ_BYTES = 2 * 1024 * 1024
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const BINARY_PLACEHOLDER = '(binary file)'
const LARGE_PLACEHOLDER = '(file too large to display)'
const WSL_POLL_INTERVAL_MS = 1500
const SEARCH_SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'build', 'coverage', 'venv', '.venv', '__pycache__'])
const MAX_SEARCH_FILES = 3000
const SYMLINK_MAX_DEPTH = 8
const WSL_READLINK_TIMEOUT_MS = 5000

/** `readlink -n` внутри дистрибутива; null — не symlink/ошибка. */
function wslReadlink(distro: string, linuxPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('wsl.exe', ['-d', distro, '--exec', 'readlink', '-n', '--', linuxPath], { timeout: WSL_READLINK_TIMEOUT_MS, encoding: 'utf8' }, (err, stdout) => {
      const target = typeof stdout === 'string' ? stdout.trim() : ''
      resolve(err !== null || target.length === 0 ? null : target)
    })
  })
}

/** Windows не резолвит Linux-symlinks через UNC `\\wsl.localhost` (stat/read → ENOENT,
 *  абсолютный POSIX-таргет выпадает на текущий диск). Цепочка таргетов резолвится через
 *  `wsl.exe readlink` и проверяется по UNC; не-symlink и неуспех — исходный путь. */
async function resolveHostPath(abs: string): Promise<string> {
  try {
    await fs.stat(abs)
    return abs
  } catch {
    // не stat-ится — возможно, symlink
  }
  const unc = parseWslUnc(abs)
  if (unc === null) return abs
  let current = unc.wslPath
  for (let i = 0; i < SYMLINK_MAX_DEPTH; i++) {
    const target = await wslReadlink(unc.distro, current)
    if (target === null) return abs
    current = target.startsWith('/') ? target : posix.join(posix.dirname(current), target)
    const host = win32.normalize(buildWslUncPath(unc.distro, current))
    try {
      await fs.stat(host)
      return host
    } catch {
      // цель тоже не видна — возможно, ещё один symlink
    }
  }
  return abs
}

/** relPath (`a/b/c`, слэши вперёд) → хост-путь внутри root; null — путь наружу корня. */
export function resolveWithinRoot(root: string, relPath: string): string | null {
  if (win32.isAbsolute(relPath)) return null
  const normalizedRoot = win32.normalize(root)
  const abs = win32.join(normalizedRoot, ...relPath.split('/'))
  const rel = win32.relative(normalizedRoot, abs)
  if (rel.startsWith('..') || win32.isAbsolute(rel)) return null
  return abs
}

/** POSIX-вариант для ssh-проектов (пути сервера). */
export function resolveWithinRootPosix(root: string, relPath: string): string | null {
  if (posix.isAbsolute(relPath)) return null
  const normalizedRoot = posix.normalize(root)
  const abs = posix.join(normalizedRoot, ...relPath.split('/'))
  const rel = posix.relative(normalizedRoot, abs)
  if (rel.startsWith('..') || posix.isAbsolute(rel)) return null
  return abs
}

/** Хост-бэкенд: win32 на Windows (в т.ч. UNC WSL), posix на Linux/macOS. */
export function resolveWithinRootHost(root: string, relPath: string, platform: NodeJS.Platform = process.platform): string | null {
  return platform === 'win32' ? resolveWithinRoot(root, relPath) : resolveWithinRootPosix(root, relPath)
}

function resolveRootPath(pfs: ProjectFs, root: string, relPath: string): string | null {
  return pfs.backend === 'host' ? resolveWithinRootHost(root, relPath) : resolveWithinRootPosix(root, relPath)
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

  constructor(
    private readonly events: FileServiceEvents,
    private readonly getSettings: () => Settings
  ) {}

  private pfs(project: ProjectEntry): ProjectFs {
    return getProjectFs(project, this.getSettings())
  }

  async listDir(project: ProjectEntry, relDir: string): Promise<FileListResult> {
    const pfs = this.pfs(project)
    const resolved = resolveRootPath(pfs, project.dir, relDir)
    if (resolved === null) return { ok: false, error: 'Path is outside the project', entries: [] }
    const abs = pfs.backend === 'host' ? await resolveHostPath(resolved) : resolved
    try {
      const dirents = await pfs.readdir(abs)
      const entries = dirents
        .filter((d) => d.name !== '.git')
        .map((d) => ({ name: d.name, kind: d.isDir ? ('dir' as const) : ('file' as const) }))
      entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1))
      return { ok: true, error: null, entries }
    } catch (err) {
      return { ok: false, error: errorMessage(err), entries: [] }
    }
  }

  /** Плоский обход проекта для «поиска везде»: файлы, скрытые и тяжёлые каталоги пропускаются. */
  async searchFiles(project: ProjectEntry): Promise<FilesSearchResult> {
    const pfs = this.pfs(project)
    const root = pfs.backend === 'host' ? (process.platform === 'win32' ? win32.normalize(project.dir) : posix.normalize(project.dir)) : posix.normalize(project.dir)
    const files: string[] = []
    const walk = async (rel: string): Promise<void> => {
      if (files.length >= MAX_SEARCH_FILES) return
      const abs = rel === '' ? root : pfs.join(root, ...rel.split('/'))
      let dirents
      try {
        dirents = await pfs.readdir(abs)
      } catch {
        return
      }
      for (const d of dirents) {
        if (d.isDir) {
          if (d.name.startsWith('.') || SEARCH_SKIP_DIRS.has(d.name)) continue
          await walk(rel === '' ? d.name : `${rel}/${d.name}`)
          if (files.length >= MAX_SEARCH_FILES) return
        } else {
          files.push(rel === '' ? d.name : `${rel}/${d.name}`)
          if (files.length >= MAX_SEARCH_FILES) return
        }
      }
    }
    await walk('')
    files.sort((a, b) => a.localeCompare(b))
    return { ok: true, error: null, files }
  }

  async read(project: ProjectEntry, relPath: string): Promise<FileReadResult> {
    const pfs = this.pfs(project)
    const resolved = resolveRootPath(pfs, project.dir, relPath)
    if (resolved === null) return { ok: false, error: 'Path is outside the project', content: '' }
    const abs = pfs.backend === 'host' ? await resolveHostPath(resolved) : resolved
    try {
      const st = await pfs.stat(abs)
      if (st === null) return { ok: false, error: 'Not a regular file', content: '' }
      if (st.isDir) return { ok: false, error: 'Not a regular file', content: '' }
      if (st.size > MAX_READ_BYTES) return { ok: true, error: null, content: LARGE_PLACEHOLDER }
      const buffer = await pfs.readFile(abs)
      return { ok: true, error: null, content: buffer.includes(0) ? BINARY_PLACEHOLDER : buffer.toString('utf8') }
    } catch (err) {
      return { ok: false, error: errorMessage(err), content: '' }
    }
  }

  async readImage(project: ProjectEntry, relPath: string): Promise<FileReadImageResult> {
    const pfs = this.pfs(project)
    const resolved = resolveRootPath(pfs, project.dir, relPath)
    if (resolved === null) return { ok: false, error: 'Path is outside the project', dataUrl: '' }
    const abs = pfs.backend === 'host' ? await resolveHostPath(resolved) : resolved
    const ext = relPath.slice(relPath.lastIndexOf('.') + 1)
    const mime = imageMimeTypeForExtension(ext)
    if (mime === null) return { ok: false, error: 'Not an image file', dataUrl: '' }
    try {
      const st = await pfs.stat(abs)
      if (st === null || st.isDir) return { ok: false, error: 'Not a regular file', dataUrl: '' }
      if (st.size > MAX_IMAGE_BYTES) return { ok: false, error: 'Image too large to display', dataUrl: '' }
      const buffer = await pfs.readFile(abs)
      return { ok: true, error: null, dataUrl: `data:${mime};base64,${buffer.toString('base64')}` }
    } catch (err) {
      return { ok: false, error: errorMessage(err), dataUrl: '' }
    }
  }

  async write(project: ProjectEntry, relPath: string, content: string): Promise<FileWriteResult> {
    const pfs = this.pfs(project)
    const abs = resolveRootPath(pfs, project.dir, relPath)
    if (abs === null) return { ok: false, error: 'Path is outside the project' }
    try {
      await pfs.mkdir(pfs.dirname(abs), { recursive: true })
      await pfs.writeFile(abs, content)
      return { ok: true, error: null }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  }

  async rename(project: ProjectEntry, relPath: string, newName: string): Promise<FileRenameResult> {
    if (newName.length === 0 || newName === '.' || newName === '..' || /[\\/]/.test(newName)) {
      return { ok: false, error: 'Invalid name' }
    }
    const pfs = this.pfs(project)
    const abs = resolveRootPath(pfs, project.dir, relPath)
    if (abs === null) return { ok: false, error: 'Path is outside the project' }
    const target = pfs.join(pfs.dirname(abs), newName)
    if (target !== abs) {
      if (await pfs.exists(target)) return { ok: false, error: 'Target already exists' }
    }
    try {
      await pfs.rename(abs, target)
      return { ok: true, error: null }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  }

  async delete(project: ProjectEntry, relPath: string): Promise<FileWriteResult> {
    if (relPath.length === 0 || relPath === '.' || relPath === '..') return { ok: false, error: 'Invalid path' }
    const pfs = this.pfs(project)
    const abs = resolveRootPath(pfs, project.dir, relPath)
    if (abs === null) return { ok: false, error: 'Path is outside the project' }
    try {
      await pfs.rm(abs)
      return { ok: true, error: null }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  }

  async mkdir(project: ProjectEntry, relPath: string): Promise<FileWriteResult> {
    const segments = relPath.split('/')
    if (relPath.length === 0 || segments.some((s) => s.length === 0 || s === '.' || s === '..' || s.includes('\\'))) {
      return { ok: false, error: 'Invalid name' }
    }
    const pfs = this.pfs(project)
    const abs = resolveRootPath(pfs, project.dir, relPath)
    if (abs === null) return { ok: false, error: 'Path is outside the project' }
    try {
      await pfs.mkdir(abs, { recursive: true })
      return { ok: true, error: null }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  }

  /** Набор открытых файлов проекта → вотчеры; вызывается renderer'ом при каждом изменении набора.
   *  ssh — live-watch недоступен: набор запоминается, вотчеры не создаются. */
  setWatched(project: ProjectEntry, relPaths: string[]): void {
    const key = `${project.kind}\u0000${project.dir}`
    const next = new Set(relPaths)
    const current = this.openPaths.get(key)
    if (current !== undefined && sameSet(current, next)) return
    this.openPaths.set(key, next)
    if (project.kind === 'ssh') return
    void this.watchers.get(key)?.close().catch(() => {})
    this.watchers.delete(key)
    const hostPaths = [...next]
      .map((p) => resolveWithinRootHost(project.dir, p))
      .filter((p): p is string => p !== null)
    if (hostPaths.length === 0) return
    const watcher = chokidar.watch(hostPaths, {
      ignoreInitial: true,
      ...(project.kind === 'wsl' ? { usePolling: true, interval: WSL_POLL_INTERVAL_MS } : {})
    })
    watcher.on('all', (_event, hostPath) => {
      const rel =
        process.platform === 'win32'
          ? win32.relative(win32.normalize(project.dir), hostPath).replace(/\\/g, '/')
          : posix.relative(posix.normalize(project.dir), hostPath)
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
