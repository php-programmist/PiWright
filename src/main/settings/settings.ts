/** Настройки: JSON в `%APPDATA%\PiWright\settings.json`. Атомарная запись (tmp + rename).
 *  Проекты добавляются в панели; настройки фаз 1–2 (backend/projectDir/piPath) мигтируются:
 *  projectDir → первый проект, piPath → поле соответствующего формата (native/wsl). */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { TERMINAL_PROFILE_IDS, type DbAuthType, type DbConnectionEntry, type DbKind, type DbSshTunnel, type NotificationSettings, type PersistedLoop, type ProjectEntry, type SessionToggles, type Settings, type SavedSessionTab, type SavedTerminalTab, type SshAuthType, type SshServerEntry, type TerminalTabsSnapshot } from '../../shared/ipc-contracts'
import { KANBAN_DEFAULT_THEME_ID } from '../../shared/kanban-theme'
import { mergeKanbanCardAttention } from '../../shared/kanban'
import { mergeProjectTabs } from '../../shared/project-tabs'
import { mergePinnedBranches } from '../../shared/pinned-branches'
import { isValidStaticPin } from '../remote/auth'
import { defaultSoundPaths } from '../sounds/defaults'

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

/** expandedProjects из файла/settings:set поверх дефолтов: только строковые ключи и boolean-значения. */
export function mergeExpandedProjects(value: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return out
  for (const [key, flag] of Object.entries(value as Record<string, unknown>)) {
    if (key.length > 0 && typeof flag === 'boolean') out[key] = flag
  }
  return out
}

/** Лимит вкладок терминала на проект (санитайзер). */
export const TERMINAL_TABS_MAX = 16

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

const SSH_ID_RE = /^[A-Za-z0-9._-]{1,64}$/
const SSH_AUTH_TYPES: SshAuthType[] = ['password', 'key', 'agent']

function sanitizeSshString(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

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

/** Лимит подключений БД в настройках. */
export const DB_CONNECTIONS_MAX = 20

const DB_KINDS: DbKind[] = ['postgres', 'mysql']
const DB_AUTH_TYPES: DbAuthType[] = ['password', 'none']

/** ssh-туннель подключения БД: белый список полей, порт 1–65535, auth из белого списка. */
function mergeDbSshTunnel(value: unknown): DbSshTunnel | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const host = sanitizeSshString(raw['host'], 253)
  const user = sanitizeSshString(raw['user'], 64)
  if (host.length === 0 || user.length === 0) return null
  const portRaw = raw['port']
  const port = typeof portRaw === 'number' && Number.isFinite(portRaw) ? Math.round(portRaw) : 22
  const authRaw = raw['auth']
  const auth: SshAuthType = SSH_AUTH_TYPES.includes(authRaw as SshAuthType) ? (authRaw as SshAuthType) : 'password'
  const tunnel: DbSshTunnel = { host, port: Math.min(65535, Math.max(1, port)), user, auth }
  const keyPath = sanitizeSshString(raw['keyPath'], 500)
  if (keyPath.length > 0) tunnel.keyPath = keyPath
  return tunnel
}

/** dbConnections из файла/settings:set: id по маске, порт 1–65535, kind/authType из белых списков,
 *  секреты (если их зачем-то сюда записали) выбрасываются. */
export function mergeDbConnections(value: unknown): DbConnectionEntry[] {
  const out: DbConnectionEntry[] = []
  if (!Array.isArray(value)) return out
  const seen = new Set<string>()
  for (const item of value) {
    if (out.length >= DB_CONNECTIONS_MAX) break
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const raw = item as Record<string, unknown>
    const id = sanitizeSshString(raw['id'], 64)
    if (!SSH_ID_RE.test(id) || seen.has(id)) continue
    const host = sanitizeSshString(raw['host'], 253)
    const user = sanitizeSshString(raw['user'], 64)
    const database = sanitizeSshString(raw['database'], 64)
    if (host.length === 0 || user.length === 0 || database.length === 0) continue
    const portRaw = raw['port']
    const port = typeof portRaw === 'number' && Number.isFinite(portRaw) ? Math.round(portRaw) : 5432
    const kindRaw = raw['kind']
    const kind: DbKind = DB_KINDS.includes(kindRaw as DbKind) ? (kindRaw as DbKind) : 'postgres'
    const authRaw = raw['authType']
    const authType: DbAuthType = DB_AUTH_TYPES.includes(authRaw as DbAuthType) ? (authRaw as DbAuthType) : 'password'
    const entry: DbConnectionEntry = {
      id,
      name: sanitizeSshString(raw['name'], 60) || database,
      kind,
      host,
      port: Math.min(65535, Math.max(1, port)),
      database,
      user,
      authType
    }
    const ssh = mergeDbSshTunnel(raw['ssh'])
    if (ssh !== null) entry.ssh = ssh
    const selected = raw['selectedSchemas']
    if (Array.isArray(selected)) {
      const schemas = selected.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length <= 64).slice(0, 50)
      if (schemas.length > 0) entry.selectedSchemas = schemas
    }
    seen.add(id)
    out.push(entry)
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

/** terminalTabs из файла/settings:set поверх дефолтов: строковые ключи, валидные profileId,
 *  опциональные строковые label, активный индекс в границах. */
export function mergeTerminalTabs(value: unknown): Record<string, TerminalTabsSnapshot> {
  const out: Record<string, TerminalTabsSnapshot> = {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return out
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (key.length === 0 || raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
    const rawTabs = (raw as Record<string, unknown>)['tabs']
    if (!Array.isArray(rawTabs)) continue
    const tabs: SavedTerminalTab[] = []
    for (const item of rawTabs) {
      if (tabs.length >= TERMINAL_TABS_MAX) break
      if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
      const profileId = (item as Record<string, unknown>)['profileId']
      if (typeof profileId !== 'string' || !TERMINAL_PROFILE_IDS.includes(profileId as never)) continue
      const label = (item as Record<string, unknown>)['label']
      const tab: SavedTerminalTab = { profileId: profileId as SavedTerminalTab['profileId'] }
      if (typeof label === 'string' && label.trim().length > 0) tab.label = label.trim().slice(0, 60)
      tabs.push(tab)
    }
    if (tabs.length === 0) continue
    const snapshot: TerminalTabsSnapshot = { tabs }
    const activeIndex = (raw as Record<string, unknown>)['activeIndex']
    if (typeof activeIndex === 'number' && Number.isInteger(activeIndex) && activeIndex >= 0 && activeIndex < tabs.length) {
      snapshot.activeIndex = activeIndex
    }
    out[key] = snapshot
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

export class SettingsService {
  private cache: Settings

  constructor(private readonly filePath: string) {
    this.cache = this.read()
  }

  get path(): string {
    return this.filePath
  }

  private read(): Settings {
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
    return this.cache
  }

  set(patch: Partial<Settings>): Settings {
    this.cache = { ...this.cache, ...patch }
    mkdirSync(dirname(this.filePath), { recursive: true })
    if (existsSync(this.filePath)) {
      copyFileSync(this.filePath, `${this.filePath}.bak`)
    }
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, JSON.stringify(this.cache, null, 2), 'utf8')
    renameSync(tmp, this.filePath)
    return this.cache
  }
}
