/** Каталог сессий pi: `~/.pi/agent/sessions/--<cwd>--/*.jsonl`. Порт `core/SessionCatalog.kt`:
 *  заголовок `type:"session"` — первая строка; имя — последний `session_info`, иначе первое
 *  сообщение пользователя; JSON разбираются только строки-кандидаты — файлы бывают большими.
 *  Чтение — через ProjectFs (host fs или SFTP удалённого сервера). */
import { homedir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import type { ProjectEntry, SessionSummary, Settings } from '../../shared/ipc-contracts'
import type { PiJsonObject } from '../../shared/protocol-types'
import { contentText, str } from '../pi/event-translator'
import { listWslDistros, resolveWslHome, wslPathFor } from '../pi/backends/wsl'
import { getProjectFs, hostProjectFs, resolveBackendHome, type ProjectFs } from '../fs/project-fs'
import { errorMessage } from '../../shared/errors'

const MAX_SUMMARY_TITLE_CHARS = 120
const SESSION_FILE_MAX_BYTES = 64 * 1024 * 1024

/** Имя каталога сессий pi для cwd — как в `session-manager.js`: `--<cwd без ведущего слеша, / \ : → ->--`. */
export function sessionDirName(cwd: string): string {
  return '--' + cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-') + '--'
}

/** Каталог сессий относится к проекту: сам проект или его worktree (`<проект>/.pi/worktrees/<имя>`). */
export function isProjectSessionDir(dirName: string, projectCwd: string): boolean {
  const own = sessionDirName(projectCwd)
  return dirName === own || dirName.startsWith(own.slice(0, -2) + '-.pi-worktrees-')
}

function parseJsonObject(line: string): PiJsonObject | null {
  try {
    const parsed: unknown = JSON.parse(line)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as PiJsonObject) : null
  } catch {
    return null
  }
}

export async function parseSessionSummary(
  path: string,
  lines: Iterable<string> | AsyncIterable<string>,
  lastModifiedMs: number
): Promise<SessionSummary | null> {
  let header: PiJsonObject | null = null
  let name: string | null = null
  let firstUserText: string | null = null
  for await (const line of lines) {
    if (header === null) {
      const parsed = parseJsonObject(line)
      if (parsed === null || parsed['type'] !== 'session') return null
      header = parsed
      continue
    }
    if (line.includes('"type":"session_info"')) {
      const candidate = str(parseJsonObject(line), 'name')
      if (candidate !== null && candidate.trim().length > 0) name = candidate
    } else if (firstUserText === null && line.includes('"role":"user"')) {
      const message = parseJsonObject(line)?.['message']
      if (message !== null && typeof message === 'object' && !Array.isArray(message)) {
        const m = message as PiJsonObject
        if (m['role'] === 'user') {
          const text = contentText(m).trim()
          if (text.length > 0) firstUserText = text
        }
      }
    }
  }
  const id = header === null ? null : str(header, 'id')
  const rawTitle = name ?? firstUserText
  if (id === null || rawTitle === null) return null
  const title = rawTitle.length > MAX_SUMMARY_TITLE_CHARS ? rawTitle.slice(0, MAX_SUMMARY_TITLE_CHARS - 1) + '…' : rawTitle
  return {
    id,
    title,
    lastActivityEpochMs: lastModifiedMs,
    cwd: str(header, 'cwd') ?? '',
    path,
    parentSession: str(header, 'parentSession')
  }
}

/** Заголовок сессии (первая строка .jsonl): cwd и parentSession без чтения всего файла. */
export async function readSessionHeader(pfs: ProjectFs, filePath: string): Promise<{ cwd: string; parentSession: string | null } | null> {
  try {
    const head = await pfs.readHead(filePath, 64 * 1024)
    const firstLine = head.split('\n')[0] ?? ''
    const parsed = parseJsonObject(firstLine)
    if (parsed === null || parsed['type'] !== 'session') return null
    return { cwd: str(parsed, 'cwd') ?? '', parentSession: str(parsed, 'parentSession') }
  } catch {
    return null
  }
}

/** Читает файл сессии построчно и возвращает сводку. */
export async function summarizeSessionFile(pfs: ProjectFs, filePath: string, lastModifiedMs: number): Promise<SessionSummary | null> {
  try {
    return await parseSessionSummary(filePath, pfs.lines(filePath, SESSION_FILE_MAX_BYTES), lastModifiedMs)
  } catch {
    return null
  }
}

/** Сессии проекта (+ его worktrees) из корня каталога сессий, новые сверху. */
export async function listProjectSessions(pfs: ProjectFs, sessionsRoot: string, projectCwd: string): Promise<SessionSummary[]> {
  let dirs: Awaited<ReturnType<ProjectFs['readdir']>>
  try {
    dirs = await pfs.readdir(sessionsRoot)
  } catch {
    return []
  }
  const summaries: SessionSummary[] = []
  for (const dir of dirs) {
    if (!dir.isDir || !isProjectSessionDir(dir.name, projectCwd)) continue
    const dirPath = pfs.join(sessionsRoot, dir.name)
    let files: Awaited<ReturnType<ProjectFs['readdir']>>
    try {
      files = await pfs.readdir(dirPath)
    } catch {
      continue
    }
    for (const file of files) {
      if (file.isDir || !file.name.endsWith('.jsonl')) continue
      const filePath = pfs.join(dirPath, file.name)
      try {
        const summary = await summarizeSessionFile(pfs, filePath, file.mtimeMs)
        if (summary !== null) summaries.push(summary)
      } catch {
        continue
      }
    }
  }
  return summaries.sort((a, b) => b.lastActivityEpochMs - a.lastActivityEpochMs)
}

/** Корень каталога сессий выбранного бэкенда: `%USERPROFILE%\.pi\…`, `\\wsl.localhost\<distro>\…`
 *  или POSIX-путь на SSH-сервере. */
export async function resolveSessionsRoot(project: ProjectEntry, settings: Settings): Promise<string | null> {
  if (project.kind === 'native') return join(homedir(), '.pi', 'agent', 'sessions')
  if (project.kind === 'ssh') {
    const home = await resolveBackendHome(project, settings)
    return home === null ? null : posix.join(home, '.pi', 'agent', 'sessions')
  }
  const distros = await listWslDistros()
  const distro = settings.wslDistro.trim() || distros[0]
  if (distro === undefined) return null
  const home = await resolveWslHome(distro)
  if (home === null) return null
  return win32.join(`\\\\wsl.localhost\\${distro}`, home, '.pi', 'agent', 'sessions')
}

/** cwd проекта на стороне бэкенда: у WSL — путь внутри дистрибутива. */
export async function projectBackendCwd(project: ProjectEntry, settings: Settings): Promise<string> {
  return toBackendPath(project, settings, project.dir)
}

/** Путь на стороне бэкенда: WSL UNC (`\\wsl.localhost\…`) → путь внутри дистрибутива, иначе как есть.
 *  Нужен для всего, что уходит в процесс pi: cwd, `--session <путь>`. */
export async function toBackendPath(project: ProjectEntry, settings: Settings, path: string): Promise<string> {
  if (project.kind === 'native') return path
  if (project.kind === 'ssh') return path
  const distro = settings.wslDistro.trim() || (await listWslDistros())[0]
  return distro === undefined ? path : ((await wslPathFor(distro, path)) ?? path)
}

/** История проекта: сводки файлов сессий, новые сверху. */
export async function listProjectHistory(project: ProjectEntry, settings: Settings): Promise<SessionSummary[]> {
  const root = await resolveSessionsRoot(project, settings)
  if (root === null) return []
  const cwd = await projectBackendCwd(project, settings)
  return listProjectSessions(getProjectFs(project, settings), root, cwd)
}

/** Нормализованный путь файла сессии внутри корня и в каталогах проекта/его worktrees; иначе null. */
function validatedSessionPath(pfs: ProjectFs, root: string, projectCwd: string, filePath: string): string | null {
  const isWin = pfs.backend === 'host' && process.platform === 'win32'
  const normalize = isWin ? win32.normalize : posix.normalize
  const relative = isWin ? win32.relative : posix.relative
  const isAbsolute = isWin ? win32.isAbsolute : posix.isAbsolute
  const normalized = normalize(filePath)
  const rel = relative(normalize(root), normalized)
  if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel)) return null
  const dirName = pfs.basename(pfs.dirname(normalized))
  if (!isProjectSessionDir(dirName, projectCwd)) return null
  return normalized
}

/** Удаление файла сессии. Разрешено только внутри корня каталога сессий и только
 *  в каталогах самого проекта/его worktrees — защита от удаления чужих файлов по пути из UI. */
export async function deleteSessionFile(
  pfs: ProjectFs,
  root: string,
  projectCwd: string,
  filePath: string
): Promise<{ ok: boolean; error: string | null }> {
  const normalized = validatedSessionPath(pfs, root, projectCwd, filePath)
  if (normalized === null) return { ok: false, error: 'Path is outside the sessions directory' }
  try {
    await pfs.rm(normalized)
    return { ok: true, error: null }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

/** Проверка пути для чтения (транскрипт/открытие) — те же гарантии, что у удаления. */
export function checkSessionPath(pfs: ProjectFs, root: string, projectCwd: string, filePath: string): { path: string } | { error: string } {
  const normalized = validatedSessionPath(pfs, root, projectCwd, filePath)
  return normalized === null ? { error: 'Path is outside the sessions directory' } : { path: normalized }
}

/** ProjectFs каталога сессий: ssh — SFTP сервера, иначе локальный fs. */
export function sessionsFs(project: ProjectEntry, settings: Settings): ProjectFs {
  return project.kind === 'ssh' ? getProjectFs(project, settings) : hostProjectFs
}
