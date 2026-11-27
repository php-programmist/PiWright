/** Per-project настройки: JSON в `<проект>/.piwright/settings.json`. Атомарная запись
 *  (tmp + rename) + .bak, как у глобального файла. Файл плоский (без ключа projectKey —
 *  он и так определён расположением). SSH-проекты сюда не пишутся (удалённый POSIX-путь):
 *  их данные остаются в глобальном settings.json. */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { DbConnectionEntry, ProjectEntry } from '../../shared/ipc-contracts'
import { normalizeDir } from '../../shared/worktree'
import { mergeKanbanCardAttention } from '../../shared/kanban'
import { mergeProjectTabs, type ProjectTabsSnapshot } from '../../shared/project-tabs'
import { mergePinnedBranches } from '../../shared/pinned-branches'
import { mergeDbConnections, mergeExpandedProjects, mergeTerminalTabs, type TerminalTabsSnapshot } from './settings-sanitize'

/** Плоский файл настроек проекта; version — на будущие миграции формата. */
export interface ProjectSettingsFile {
  version?: number
  expanded?: boolean
  projectTabs?: ProjectTabsSnapshot
  terminalTabs?: TerminalTabsSnapshot
  kanbanBoardsExpanded?: Record<string, boolean>
  kanbanColumnsCollapsed?: Record<string, boolean>
  kanbanCardAttention?: { sessions: string[]; dismissed: string[] }
  pinnedBranches?: string[]
  dbConnections?: DbConnectionEntry[]
}

const PROJECT_DIR_NAME = '.piwright'
const PROJECT_FILE_NAME = 'settings.json'
const PROJECT_SETTINGS_VERSION = 1

/** Ключ проекта — та же формула, что в renderer'е (stores/sessions.ts). */
export function projectKeyOf(project: ProjectEntry): string {
  return `${project.kind}\u0000${normalizeDir(project.dir)}`
}

/** Каталог настроек внутри проекта. */
export function projectSettingsPath(projectDir: string): string {
  return join(projectDir, PROJECT_DIR_NAME, PROJECT_FILE_NAME)
}

/** Проект доступен для файла настроек: native/wsl (ssh — глобальный файл). */
export function supportsProjectFile(project: ProjectEntry): boolean {
  return project.kind === 'native' || project.kind === 'wsl'
}

/** Санитайзер плоского файла: каждое поле валидируется теми же merge*-функциями, что и
 *  глобальная map (обёртка с фиктивным ключом), битые поля выбрасываются. */
export function mergeProjectSettingsFile(raw: unknown): ProjectSettingsFile {
  const out: ProjectSettingsFile = {}
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out
  const value = raw as Record<string, unknown>
  if (typeof value['expanded'] === 'boolean') out.expanded = value['expanded']
  const tabs = mergeProjectTabs({ p: value['projectTabs'] })['p']
  if (tabs !== undefined) out.projectTabs = tabs
  const terminal = mergeTerminalTabs({ p: value['terminalTabs'] })['p']
  if (terminal !== undefined) out.terminalTabs = terminal
  const boards = mergeExpandedProjects(value['kanbanBoardsExpanded'])
  if (Object.keys(boards).length > 0) out.kanbanBoardsExpanded = boards
  const columns = mergeExpandedProjects(value['kanbanColumnsCollapsed'])
  if (Object.keys(columns).length > 0) out.kanbanColumnsCollapsed = columns
  const attention = mergeKanbanCardAttention({ p: value['kanbanCardAttention'] })['p']
  if (attention !== undefined) out.kanbanCardAttention = attention
  const pins = mergePinnedBranches({ p: value['pinnedBranches'] })['p']
  if (pins !== undefined) out.pinnedBranches = pins
  const db = mergeDbConnections(value['dbConnections'])
  if (db.length > 0) out.dbConnections = db
  return out
}

/** `.piwright/` не должен попадать в git проекта: добавляем строку в локальный
 *  .git/info/exclude (файлы репо не трогаем, в клон не попадает). Ошибки глотаем —
 *  настройка не должна ломать запись. */
export function ensureGitExclude(projectDir: string): void {
  try {
    const gitDir = join(projectDir, '.git')
    if (!existsSync(gitDir) || !statSync(gitDir).isDirectory()) return
    const excludePath = join(gitDir, 'info', 'exclude')
    let content = ''
    if (existsSync(excludePath)) {
      content = readFileSync(excludePath, 'utf8')
      if (content.split(/\r?\n/).some((line) => line.trim() === '.piwright/')) return
    }
    mkdirSync(dirname(excludePath), { recursive: true })
    const prefix = content.length > 0 && !content.endsWith('\n') ? '\n' : ''
    writeFileSync(excludePath, `${content}${prefix}.piwright/\n`, 'utf8')
  } catch {
    // нет .git, read-only и т.п. — не критично
  }
}

/** Хранилище файлов настроек проектов с кэшем по projectKey. */
export class ProjectSettingsStore {
  private readonly cache = new Map<string, ProjectSettingsFile>()

  /** Читает (и кэширует) файл проекта; нет файла/битый JSON — пустые настройки. */
  read(projectKey: string, projectDir: string): ProjectSettingsFile {
    const cached = this.cache.get(projectKey)
    if (cached !== undefined) return cached
    const filePath = projectSettingsPath(projectDir)
    let parsed: unknown = null
    if (existsSync(filePath)) {
      try {
        parsed = JSON.parse(readFileSync(filePath, 'utf8'))
      } catch {
        parsed = null
      }
    }
    const merged = mergeProjectSettingsFile(parsed)
    this.cache.set(projectKey, merged)
    return merged
  }

  /** Патчит файл проекта (null/undefined в patch — удалить поле); создаёт .piwright/,
   *  .bak и exclude-строку. Кэш обновляется только после успешной записи на диск. */
  write(projectKey: string, projectDir: string, patch: ProjectSettingsFile): ProjectSettingsFile {
    const base = this.read(projectKey, projectDir)
    const next: Record<string, unknown> = { ...base }
    for (const [field, value] of Object.entries(patch)) {
      if (value === null || value === undefined) delete next[field]
      else next[field] = value
    }
    const merged = mergeProjectSettingsFile(next)
    const filePath = projectSettingsPath(projectDir)
    mkdirSync(dirname(filePath), { recursive: true })
    ensureGitExclude(projectDir)
    if (existsSync(filePath)) copyFileSync(filePath, `${filePath}.bak`)
    const payload = Object.keys(merged).length > 0 ? { version: PROJECT_SETTINGS_VERSION, ...merged } : merged
    const tmp = `${filePath}.tmp`
    writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
    renameSync(tmp, filePath)
    this.cache.set(projectKey, merged)
    return merged
  }
}
