/** Настройки: глобальный JSON в `%APPDATA%\PiWright\settings.json` + per-project файлы
 *  `<проект>/.piwright/settings.json` (native/wsl; ssh — только глобальный файл). get()
 *  возвращает объединение, set() роутит per-project map'ы по файлам проектов; при первом
 *  старте мигратор переносит записи из глобального файла. Атомарная запись (tmp + rename)
 *  + .bak везде. Настройки фаз 1–2 (backend/projectDir/piPath) мигтируются: projectDir →
 *  первый проект, piPath → поле соответствующего формата (native/wsl). */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { type DbConnectionEntry, type NotificationSettings, type PersistedLoop, type ProjectEntry, type SessionToggles, type Settings, type SavedSessionTab, type SshAuthType, type SshServerEntry } from '../../shared/ipc-contracts'
import { KANBAN_DEFAULT_THEME_ID } from '../../shared/kanban-theme'
import { mergeKanbanCardAttention } from '../../shared/kanban'
import { mergeProjectTabs } from '../../shared/project-tabs'
import { mergePinnedBranches } from '../../shared/pinned-branches'
import { isValidStaticPin } from '../remote/auth'
import { defaultSoundPaths } from '../sounds/defaults'
import { SSH_AUTH_TYPES, SSH_ID_RE, mergeDbConnections, mergeExpandedProjects, mergeTerminalTabs, sanitizeSshString } from './settings-sanitize'
import { ProjectSettingsStore, projectKeyOf, supportsProjectFile, type ProjectSettingsFile } from './project-settings'

// Санитайзеры, общие с файлами проектов, доступны по старому пути (register.ts, тесты).
export { DB_CONNECTIONS_MAX, TERMINAL_TABS_MAX, mergeDbConnections, mergeExpandedProjects, mergeTerminalTabs } from './settings-sanitize'

/** Дефолтные звуки: системные wav Windows или свои wav из ресурсов (см. sounds/defaults.ts);
 *  пустая строка = выключено. */
export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  sounds: defaultSoundPaths(),
  telegram: { chatId: '', events: { turnEnd: true, permission: true, question: true, error: true, loopEnd: false } },
  remote: { enabled: false, port: 7690, staticPin: '' },
  backgroundGraceMinutes: 10
}

export const DEFAULT_SETTINGS: Settings = {
  wslDistro: '',
  piPathNative: '',
  piPathWsl: '',
  piPathSsh: '',
  piExtraArgs: '',
  updateUrl: 'https://github.com/php-programmist/PiWright/releases/latest/download/',
  selectorPlacement: 'top',
  theme: 'dark',
  chatFontSize: 14,
  sendOnEnter: true,
  loopsEnabled: false,
  loopCloseSession: false,
  kanbanEnabled: false,
  backgroundSessions: false,
  kanbanTheme: KANBAN_DEFAULT_THEME_ID,
  language: 'en',
  panels: {},
  expandedProjects: {},
  kanbanBoardsExpanded: {},
  kanbanColumnsCollapsed: {},
  kanbanCardAttention: {},
  terminalTabs: {},
  projectTabs: {},
  openSessionTabs: [],
  sessionToggles: {},
  loops: [],
  pinnedBranches: {},
  dismissedUpdateVersion: null,
  lastProjectKey: null,
  notifications: DEFAULT_NOTIFICATIONS,
  lastModel: null,
  lastThinkingLevel: null,
  thinkingLevelByModel: {},
  projects: [],
  sshServers: [],
  projectDbConnections: {}
}

/** Границы размера шрифта чата (санитайзер settings:set). */
export const CHAT_FONT_SIZE_MIN = 10
export const CHAT_FONT_SIZE_MAX = 24

/** notifications из файла/settings:set поверх дефолтов; битые ветки заменяются дефолтом целиком. */
export function mergeNotifications(value: unknown): NotificationSettings {
  const out: NotificationSettings = {
    sounds: { ...DEFAULT_NOTIFICATIONS.sounds },
    telegram: { chatId: '', events: { ...DEFAULT_NOTIFICATIONS.telegram.events } },
    remote: { ...DEFAULT_NOTIFICATIONS.remote },
    backgroundGraceMinutes: DEFAULT_NOTIFICATIONS.backgroundGraceMinutes
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return out
  const raw = value as Record<string, unknown>
  if (raw['sounds'] !== null && typeof raw['sounds'] === 'object' && !Array.isArray(raw['sounds'])) {
    const sounds = raw['sounds'] as Record<string, unknown>
    for (const key of ['completion', 'await', 'error'] as const) {
      if (typeof sounds[key] === 'string') out.sounds[key] = sounds[key]
    }
  }
  if (raw['telegram'] !== null && typeof raw['telegram'] === 'object' && !Array.isArray(raw['telegram'])) {
    const tg = raw['telegram'] as Record<string, unknown>
    if (typeof tg['chatId'] === 'string') out.telegram.chatId = tg['chatId']
    if (tg['events'] !== null && typeof tg['events'] === 'object' && !Array.isArray(tg['events'])) {
      const events = tg['events'] as Record<string, unknown>
      for (const key of ['turnEnd', 'permission', 'question', 'error', 'loopEnd'] as const) {
        if (typeof events[key] === 'boolean') out.telegram.events[key] = events[key]
      }
    }
  }
  if (raw['remote'] !== null && typeof raw['remote'] === 'object' && !Array.isArray(raw['remote'])) {
    const remote = raw['remote'] as Record<string, unknown>
    if (typeof remote['enabled'] === 'boolean') out.remote.enabled = remote['enabled']
    if (typeof remote['port'] === 'number' && Number.isFinite(remote['port'])) {
      out.remote.port = Math.min(65535, Math.max(1, Math.round(remote['port'])))
    }
    if (typeof remote['staticPin'] === 'string' && isValidStaticPin(remote['staticPin'])) {
      out.remote.staticPin = remote['staticPin']
    }
  }
  if (typeof raw['backgroundGraceMinutes'] === 'number' && Number.isFinite(raw['backgroundGraceMinutes'])) {
    out.backgroundGraceMinutes = Math.min(1440, Math.max(0, Math.round(raw['backgroundGraceMinutes'])))
  }
  return out
}

/** Лимит восстанавливаемых вкладок сессий (санитайзер). */
export const OPEN_SESSION_TABS_MAX = 32

/** Лимит запомненных тогглов сессий (санитайзер). */
export const SESSION_TOGGLES_MAX = 200

const PROJECT_KINDS = ['native', 'wsl', 'ssh'] as const

/** openSessionTabs из файла/settings:set: валидный проект + непустой файл, дедуп по ключу. */
export function mergeOpenSessionTabs(value: unknown): SavedSessionTab[] {
  const out: SavedSessionTab[] = []
  if (!Array.isArray(value)) return out
  const seen = new Set<string>()
  for (const item of value) {
    if (out.length >= OPEN_SESSION_TABS_MAX) break
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const raw = item as Record<string, unknown>
    const project = raw['project']
    if (project === null || typeof project !== 'object' || Array.isArray(project)) continue
    const p = project as Record<string, unknown>
    const kind = p['kind']
    const dir = p['dir']
    if (typeof kind !== 'string' || typeof dir !== 'string' || dir.length === 0) continue
    if (!PROJECT_KINDS.includes(kind as (typeof PROJECT_KINDS)[number])) continue
    const sessionFile = raw['sessionFile']
    if (typeof sessionFile !== 'string' || sessionFile.length === 0 || sessionFile.length > 2000) continue
    const entry: SavedSessionTab = { project: { kind: kind as ProjectEntry['kind'], dir }, sessionFile }
    if (typeof p['name'] === 'string' && p['name'].length > 0) entry.project = { ...entry.project, name: p['name'] }
    if (kind === 'ssh' && typeof p['serverId'] === 'string' && p['serverId'].length > 0) {
      entry.project = { ...entry.project, serverId: p['serverId'] }
    }
    const key = `${kind}\u0000${dir}\u0000${sessionFile}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(entry)
  }
  return out
}

/** sessionToggles из файла/settings:set: непустой ключ файла, boolean-значения, лимит 200. */
export function mergeSessionToggles(value: unknown): Record<string, SessionToggles> {
  const out: Record<string, SessionToggles> = {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return out
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(out).length >= SESSION_TOGGLES_MAX) break
    if (key.length === 0 || key.length > 2000) continue
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
    const record = raw as Record<string, unknown>
    const telegram = record['telegram']
    const shared = record['shared']
    if (typeof telegram !== 'boolean' || typeof shared !== 'boolean') continue
    if (!telegram && !shared) continue
    out[key] = { telegram, shared }
  }
  return out
}

/** Лимит активных петель в настройках (санитайзер). */
export const LOOPS_MAX = 50

/** loops из файла/settings:set: валидный проект, непустые prompt/baseName, целые remaining/iteration. */
export function mergeLoops(value: unknown): PersistedLoop[] {
  const out: PersistedLoop[] = []
  if (!Array.isArray(value)) return out
  for (const item of value) {
    if (out.length >= LOOPS_MAX) break
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const raw = item as Record<string, unknown>
    const project = raw['project']
    if (project === null || typeof project !== 'object' || Array.isArray(project)) continue
    const p = project as Record<string, unknown>
    const kind = p['kind']
    const dir = p['dir']
    if (typeof kind !== 'string' || typeof dir !== 'string' || dir.length === 0) continue
    if (!PROJECT_KINDS.includes(kind as (typeof PROJECT_KINDS)[number])) continue
    const entry: PersistedLoop = {
      sessionFile: typeof raw['sessionFile'] === 'string' && raw['sessionFile'].length > 0 ? raw['sessionFile'] : null,
      project: { kind: kind as ProjectEntry['kind'], dir },
      prompt: typeof raw['prompt'] === 'string' ? raw['prompt'] : '',
      exitCondition: typeof raw['exitCondition'] === 'string' ? raw['exitCondition'] : '',
      remaining: typeof raw['remaining'] === 'number' && Number.isInteger(raw['remaining']) ? Math.min(999, Math.max(0, raw['remaining'])) : 0,
      iteration: typeof raw['iteration'] === 'number' && Number.isInteger(raw['iteration']) && raw['iteration'] >= 1 ? raw['iteration'] : 1,
      baseName: typeof raw['baseName'] === 'string' && raw['baseName'].trim().length > 0 ? raw['baseName'] : ''
    }
    if (typeof p['name'] === 'string' && p['name'].length > 0) entry.project = { ...entry.project, name: p['name'] }
    if (kind === 'ssh' && typeof p['serverId'] === 'string' && p['serverId'].length > 0) {
      entry.project = { ...entry.project, serverId: p['serverId'] }
    }
    if (entry.prompt.length === 0 || entry.baseName.length === 0) continue
    out.push(entry)
  }
  return out
}

/** Лимит SSH-серверов в настройках. */
export const SSH_SERVERS_MAX = 20

/** sshServers из файла/settings:set: id по маске, порт 1–65535, auth из белого списка. */
export function mergeSshServers(value: unknown): SshServerEntry[] {
  const out: SshServerEntry[] = []
  if (!Array.isArray(value)) return out
  const seen = new Set<string>()
  for (const item of value) {
    if (out.length >= SSH_SERVERS_MAX) break
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const raw = item as Record<string, unknown>
    const id = sanitizeSshString(raw['id'], 64)
    if (!SSH_ID_RE.test(id) || seen.has(id)) continue
    const host = sanitizeSshString(raw['host'], 253)
    const user = sanitizeSshString(raw['user'], 64)
    if (host.length === 0 || user.length === 0) continue
    const portRaw = raw['port']
    const port = typeof portRaw === 'number' && Number.isFinite(portRaw) ? Math.round(portRaw) : 22
    const authRaw = raw['auth']
    const auth: SshAuthType = SSH_AUTH_TYPES.includes(authRaw as SshAuthType) ? (authRaw as SshAuthType) : 'password'
    const entry: SshServerEntry = { id, name: sanitizeSshString(raw['name'], 60) || host, host, port: Math.min(65535, Math.max(1, port)), user, auth }
    const keyPath = sanitizeSshString(raw['keyPath'], 500)
    if (keyPath.length > 0) entry.keyPath = keyPath
    seen.add(id)
    out.push(entry)
  }
  return out
}

/** thinkingLevelByModel из файла/settings:set: строковые ключи (provider/id) и непустые строковые уровни. */
export function mergeThinkingLevelByModel(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return out
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (key.length === 0 || typeof raw !== 'string' || raw.length === 0) continue
    out[key] = raw
  }
  return out
}

/** projectDbConnections из файла/settings:set: непустые строковые ключи, значения — mergeDbConnections
 *  (пустые списки не храним). */
export function mergeProjectDbConnections(value: unknown): Record<string, DbConnectionEntry[]> {
  const out: Record<string, DbConnectionEntry[]> = {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return out
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (key.length === 0 || key.length > 512) continue
    const list = mergeDbConnections(raw)
    if (list.length > 0) out[key] = list
  }
  return out
}

function isPosixPath(path: string): boolean {
  return path.startsWith('/') || path.startsWith('~/')
}

/** Старые настройки (фазы 1–2) → один проект + piPath в поле своего формата. */
function migrateLegacy(raw: Record<string, unknown>, base: Settings): Settings {
  let migrated = base
  if (base.projects.length === 0) {
    const dir = raw['projectDir']
    if (typeof dir === 'string' && dir.trim().length > 0) {
      const kind = raw['backend'] === 'native' ? 'native' : 'wsl'
      const project: ProjectEntry = { kind, dir }
      migrated = { ...migrated, projects: [project] }
    }
  }
  const legacyPiPath = typeof raw['piPath'] === 'string' ? raw['piPath'].trim() : ''
  if (legacyPiPath.length > 0) {
    migrated = isPosixPath(legacyPiPath)
      ? { ...migrated, piPathWsl: migrated.piPathWsl.length > 0 ? migrated.piPathWsl : legacyPiPath }
      : { ...migrated, piPathNative: migrated.piPathNative.length > 0 ? migrated.piPathNative : legacyPiPath }
  }
  return migrated
}

/** Per-project map'ы настроек: поле Settings → поле плоского файла проекта.
 *  prefixed — ключи map'а вида `projectKey\u0000хвост` (остальные — ровно projectKey). */
const PROJECT_SETTING_SPECS = [
  { settings: 'expandedProjects', flat: 'expanded', prefixed: false },
  { settings: 'kanbanBoardsExpanded', flat: 'kanbanBoardsExpanded', prefixed: true },
  { settings: 'kanbanColumnsCollapsed', flat: 'kanbanColumnsCollapsed', prefixed: true },
  { settings: 'kanbanCardAttention', flat: 'kanbanCardAttention', prefixed: false },
  { settings: 'terminalTabs', flat: 'terminalTabs', prefixed: false },
  { settings: 'projectTabs', flat: 'projectTabs', prefixed: false },
  { settings: 'pinnedBranches', flat: 'pinnedBranches', prefixed: false },
  { settings: 'projectDbConnections', flat: 'dbConnections', prefixed: false }
] as const

type FileProject = { key: string; project: ProjectEntry }

function fileProjectsOf(projects: ProjectEntry[]): FileProject[] {
  const out: FileProject[] = []
  for (const project of projects) {
    if (supportsProjectFile(project)) out.push({ key: projectKeyOf(project), project })
  }
  return out
}

export class SettingsService {
  private global: Settings
  private merged: Settings
  private readonly projectStore = new ProjectSettingsStore()

  constructor(private readonly filePath: string) {
    this.global = this.readGlobal()
    this.migratePerProject()
    this.merged = this.buildMerged()
  }

  get path(): string {
    return this.filePath
  }

  private readGlobal(): Settings {
    if (!existsSync(this.filePath)) return { ...DEFAULT_SETTINGS }
    try {
      const raw: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'))
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_SETTINGS }
      const merged = { ...DEFAULT_SETTINGS, ...(raw as Partial<Settings>) }
      merged.notifications = mergeNotifications((raw as Partial<Settings>)['notifications'])
      merged.expandedProjects = mergeExpandedProjects((raw as Partial<Settings>)['expandedProjects'])
      merged.kanbanBoardsExpanded = mergeExpandedProjects((raw as Partial<Settings>)['kanbanBoardsExpanded'])
      merged.kanbanColumnsCollapsed = mergeExpandedProjects((raw as Partial<Settings>)['kanbanColumnsCollapsed'])
      merged.kanbanCardAttention = mergeKanbanCardAttention((raw as Partial<Settings>)['kanbanCardAttention'])
      merged.terminalTabs = mergeTerminalTabs((raw as Partial<Settings>)['terminalTabs'])
      merged.projectTabs = mergeProjectTabs((raw as Partial<Settings>)['projectTabs'])
      merged.openSessionTabs = mergeOpenSessionTabs((raw as Partial<Settings>)['openSessionTabs'])
      merged.sessionToggles = mergeSessionToggles((raw as Partial<Settings>)['sessionToggles'])
      merged.loops = mergeLoops((raw as Partial<Settings>)['loops'])
  merged.pinnedBranches = mergePinnedBranches((raw as Partial<Settings>)['pinnedBranches'])
      merged.thinkingLevelByModel = mergeThinkingLevelByModel((raw as Partial<Settings>)['thinkingLevelByModel'])
      merged.sshServers = mergeSshServers((raw as Partial<Settings>)['sshServers'])
      merged.projectDbConnections = mergeProjectDbConnections((raw as Partial<Settings>)['projectDbConnections'])
      // Глобальные dbConnections (до per-project) больше не поддерживаются — выбрасываем.
      delete (merged as Record<string, unknown>)['dbConnections']
      if (typeof merged.lastModel !== 'string') merged.lastModel = null
      if (typeof merged.kanbanTheme !== 'string' || merged.kanbanTheme.trim().length === 0) merged.kanbanTheme = KANBAN_DEFAULT_THEME_ID
      if (typeof merged.lastThinkingLevel !== 'string') merged.lastThinkingLevel = null
      if (typeof merged.lastProjectKey !== 'string') merged.lastProjectKey = null
      if (typeof merged.dismissedUpdateVersion !== 'string') merged.dismissedUpdateVersion = null
      return migrateLegacy(raw as Record<string, unknown>, merged)
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  get(): Settings {
    return this.merged
  }

  set(patch: Partial<Settings>): Settings {
    let next: Settings = { ...this.global, ...patch }
    next = this.splitProjectMaps(next, patch)
    this.global = next
    this.writeGlobalFile()
    this.merged = this.buildMerged()
    return this.merged
  }

  private writeGlobalFile(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    if (existsSync(this.filePath)) {
      copyFileSync(this.filePath, `${this.filePath}.bak`)
    }
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, JSON.stringify(this.global, null, 2), 'utf8')
    renameSync(tmp, this.filePath)
  }

  /** Роутит per-project map'ы из patch в файлы проектов (patch содержит полную map —
   *  renderer шлёт зеркало целиком): срез известного native/wsl-проекта — в его файл
 *  (отсутствие записей = очистка поля), остальные ключи — в глобальный файл. */
  private splitProjectMaps(next: Settings, patch: Partial<Settings>): Settings {
    const projects = fileProjectsOf(next.projects)
    if (projects.length === 0) return next
    const result: Settings = { ...next }
    for (const spec of PROJECT_SETTING_SPECS) {
      const map = patch[spec.settings]
      if (map === undefined || map === null || typeof map !== 'object' || Array.isArray(map)) continue
      const globalPart: Record<string, unknown> = {}
      const slices = new Map<string, Record<string, unknown>>()
      const seen = new Set<string>()
      for (const [key, value] of Object.entries(map as Record<string, unknown>)) {
        const hit = spec.prefixed
          ? projects.find((p) => key.startsWith(`${p.key}\u0000`)) ?? null
          : projects.find((p) => p.key === key) ?? null
        if (hit === null) {
          globalPart[key] = value
          continue
        }
        seen.add(hit.key)
        const slice = slices.get(hit.key) ?? {}
        if (spec.prefixed) {
          const flatKey = key.slice(hit.key.length + 1)
          slice[spec.flat] = { ...((slice[spec.flat] as Record<string, unknown> | undefined) ?? {}), [flatKey]: value }
        } else {
          slice[spec.flat] = value
        }
        slices.set(hit.key, slice)
      }
      for (const p of projects) {
        if (seen.has(p.key)) continue
        const slice = slices.get(p.key) ?? {}
        slice[spec.flat] = null
        slices.set(p.key, slice)
      }
      result[spec.settings] = globalPart as never
      for (const [key, slice] of slices) {
        const project = projects.find((p) => p.key === key)?.project
        if (project === undefined) continue
        try {
          this.projectStore.write(key, project.dir, slice as ProjectSettingsFile)
        } catch {
          // Каталог недоступен — данные остаются в глобальной map (overlay их покажет).
          const value = (slice as Record<string, unknown>)[spec.flat]
          if (spec.prefixed && value !== null && typeof value === 'object') {
            for (const [flatKey, v] of Object.entries(value as Record<string, unknown>)) {
              globalPart[`${key}\u0000${flatKey}`] = v
            }
          } else if (value !== null) {
            globalPart[key] = value
          }
        }
      }
    }
    return result
  }

  /** Объединение глобального файла и файлов проектов (файл проекта перекрывает
   *  одноимённые записи глобала — так видны данные, чья запись в файл не удалась). */
  private buildMerged(): Settings {
    const merged: Settings = { ...this.global }
    merged.expandedProjects = { ...this.global.expandedProjects }
    merged.kanbanBoardsExpanded = { ...this.global.kanbanBoardsExpanded }
    merged.kanbanColumnsCollapsed = { ...this.global.kanbanColumnsCollapsed }
    merged.kanbanCardAttention = { ...this.global.kanbanCardAttention }
    merged.terminalTabs = { ...this.global.terminalTabs }
    merged.projectTabs = { ...this.global.projectTabs }
    merged.pinnedBranches = { ...this.global.pinnedBranches }
    merged.projectDbConnections = { ...this.global.projectDbConnections }
    for (const { key, project } of fileProjectsOf(this.global.projects)) {
      const ps = this.projectStore.read(key, project.dir)
      if (ps.expanded !== undefined) merged.expandedProjects[key] = ps.expanded
      for (const [boardId, flag] of Object.entries(ps.kanbanBoardsExpanded ?? {})) {
        merged.kanbanBoardsExpanded[`${key}\u0000${boardId}`] = flag
      }
      for (const [columnKey, flag] of Object.entries(ps.kanbanColumnsCollapsed ?? {})) {
        merged.kanbanColumnsCollapsed[`${key}\u0000${columnKey}`] = flag
      }
      if (ps.kanbanCardAttention !== undefined) merged.kanbanCardAttention[key] = ps.kanbanCardAttention
      if (ps.terminalTabs !== undefined) merged.terminalTabs[key] = ps.terminalTabs
      if (ps.projectTabs !== undefined) merged.projectTabs[key] = ps.projectTabs
      if (ps.pinnedBranches !== undefined) merged.pinnedBranches[key] = ps.pinnedBranches
      if (ps.dbConnections !== undefined) merged.projectDbConnections[key] = ps.dbConnections
    }
    return merged
  }

  /** Мигратор: переносит per-project записи глобального файла в файлы проектов.
   *  Записи, перекрытые уже существующим файлом проекта, просто удаляются из глобала;
   *  при неудачной записи (каталог недоступен) всё остаётся в глобале. */
  private migratePerProject(): void {
    let dirty = false
    for (const { key, project } of fileProjectsOf(this.global.projects)) {
      if (!existsSync(project.dir)) continue
      const file = this.projectStore.read(key, project.dir)
      const adopted: ProjectSettingsFile = {}
      const deletions: Array<{ spec: (typeof PROJECT_SETTING_SPECS)[number]; keys: string[] }> = []
      let adoptedAny = false
      for (const spec of PROJECT_SETTING_SPECS) {
        const map = this.global[spec.settings] as Record<string, unknown>
        const keys = Object.keys(map).filter((k) => (spec.prefixed ? k.startsWith(`${key}\u0000`) : k === key))
        if (keys.length === 0) continue
        const hasFileField = spec.prefixed
          ? Object.keys((file[spec.flat] as Record<string, unknown> | undefined) ?? {}).length > 0
          : file[spec.flat] !== undefined
        if (!hasFileField) {
          if (spec.prefixed) {
            const flat: Record<string, unknown> = {}
            for (const k of keys) flat[k.slice(key.length + 1)] = map[k]
            adopted[spec.flat] = flat as never
          } else {
            adopted[spec.flat] = map[key] as never
          }
          adoptedAny = true
        }
        deletions.push({ spec, keys })
      }
      if (adoptedAny) {
        try {
          this.projectStore.write(key, project.dir, adopted)
        } catch {
          continue
        }
      }
      for (const { spec, keys } of deletions) {
        const map = this.global[spec.settings] as Record<string, unknown>
        for (const k of keys) delete map[k]
        dirty = true
      }
    }
    if (dirty) this.writeGlobalFile()
  }
}
