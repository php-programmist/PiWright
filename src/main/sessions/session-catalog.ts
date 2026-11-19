/** Каталог сессий pi: `~/.pi/agent/sessions/--<cwd>--/*.jsonl`. Порт `core/SessionCatalog.kt`:
 *  заголовок `type:"session"` — первая строка; имя — последний `session_info`, иначе первое
 *  сообщение пользователя; JSON разбираются только строки-кандидаты — файлы бывают большими. */
import { createReadStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join, win32 } from 'node:path'
import { createInterface } from 'node:readline'
import type { Dirent } from 'node:fs'
import type { ProjectEntry, SessionSummary, Settings } from '../../shared/ipc-contracts'
import type { PiJsonObject } from '../../shared/protocol-types'
import { contentText, str } from '../pi/event-translator'
import { listWslDistros, resolveWslHome, wslPathFor } from '../pi/backends/wsl'

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
  const title = name ?? firstUserText
  if (id === null || title === null) return null
  return { id, title, lastActivityEpochMs: lastModifiedMs, cwd: str(header, 'cwd') ?? '', path }
}

/** Читает файл сессии построчно (файлы бывают большими) и возвращает сводку. */
export async function summarizeSessionFile(filePath: string, lastModifiedMs: number): Promise<SessionSummary | null> {
  const stream = createReadStream(filePath, { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    return await parseSessionSummary(filePath, lines, lastModifiedMs)
  } catch {
    return null
  } finally {
    lines.close()
    stream.close()
  }
}

/** Сессии проекта (+ его worktrees) из корня каталога сессий, новые сверху. */
export async function listProjectSessions(sessionsRoot: string, projectCwd: string): Promise<SessionSummary[]> {
  let dirs: Dirent[]
  try {
    dirs = await fs.readdir(sessionsRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const summaries: SessionSummary[] = []
  for (const dir of dirs) {
    if (!dir.isDirectory() || !isProjectSessionDir(dir.name, projectCwd)) continue
    let files: Dirent[]
    try {
      files = await fs.readdir(join(sessionsRoot, dir.name), { withFileTypes: true })
    } catch {
      continue
    }
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.jsonl')) continue
      const filePath = join(sessionsRoot, dir.name, file.name)
      try {
        const stats = await fs.stat(filePath)
        const summary = await summarizeSessionFile(filePath, stats.mtimeMs)
        if (summary !== null) summaries.push(summary)
      } catch {
        continue
      }
    }
  }
  return summaries.sort((a, b) => b.lastActivityEpochMs - a.lastActivityEpochMs)
}

/** Корень каталога сессий выбранного бэкенда: `%USERPROFILE%\.pi\…` или `\\wsl.localhost\<distro>\…`. */
export async function resolveSessionsRoot(project: ProjectEntry, settings: Settings): Promise<string | null> {
  if (project.kind === 'native') return join(homedir(), '.pi', 'agent', 'sessions')
  const distros = await listWslDistros()
  const distro = settings.wslDistro.trim() || distros[0]
  if (distro === undefined) return null
  const home = await resolveWslHome(distro)
  if (home === null) return null
  return win32.join(`\\\\wsl.localhost\\${distro}`, home, '.pi', 'agent', 'sessions')
}

/** cwd проекта на стороне бэкенда: у WSL — путь внутри дистрибутива. */
export async function projectBackendCwd(project: ProjectEntry, settings: Settings): Promise<string> {
  if (project.kind === 'native') return project.dir
  const distros = await listWslDistros()
  const distro = settings.wslDistro.trim() || distros[0]
  return distro === undefined ? project.dir : ((await wslPathFor(distro, project.dir)) ?? project.dir)
}

/** История проекта: сводки файлов сессий, новые сверху. */
export async function listProjectHistory(project: ProjectEntry, settings: Settings): Promise<SessionSummary[]> {
  const root = await resolveSessionsRoot(project, settings)
  if (root === null) return []
  const cwd = await projectBackendCwd(project, settings)
  return listProjectSessions(root, cwd)
}
