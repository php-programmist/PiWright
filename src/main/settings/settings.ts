/** Настройки: JSON в `%APPDATA%\Piwright\settings.json`. Атомарная запись (tmp + rename).
 *  Проекты добавляются в панели; настройки фаз 1–2 (backend/projectDir/piPath) мигтируются:
 *  projectDir → первый проект, piPath → поле соответствующего формата (native/wsl). */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { NotificationSettings, ProjectEntry, Settings } from '../../shared/ipc-contracts'

/** Дефолтные звуки — системные wav Windows; пустая строка = выключено. */
export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  sounds: {
    completion: 'C:\\Windows\\Media\\Windows Notify System Generic.wav',
    await: 'C:\\Windows\\Media\\Windows Notify.wav',
    error: 'C:\\Windows\\Media\\Windows Exclamation.wav'
  },
  telegram: { chatId: '', events: { turnEnd: true, permission: true, question: true, error: true } },
  remote: { enabled: false, port: 7690 }
}

export const DEFAULT_SETTINGS: Settings = {
  wslDistro: '',
  piPathNative: '',
  piPathWsl: '',
  piExtraArgs: '',
  updateUrl: '',
  selectorPlacement: 'top',
  theme: 'dark',
  chatFontSize: 14,
  singleLineTools: false,
  sendOnEnter: false,
  language: 'en',
  panels: {},
  expandedProjects: {},
  notifications: DEFAULT_NOTIFICATIONS,
  projects: []
}

/** Границы размера шрифта чата (санитайзер settings:set). */
export const CHAT_FONT_SIZE_MIN = 10
export const CHAT_FONT_SIZE_MAX = 24

/** notifications из файла/settings:set поверх дефолтов; битые ветки заменяются дефолтом целиком. */
export function mergeNotifications(value: unknown): NotificationSettings {
  const out: NotificationSettings = {
    sounds: { ...DEFAULT_NOTIFICATIONS.sounds },
    telegram: { chatId: '', events: { ...DEFAULT_NOTIFICATIONS.telegram.events } },
    remote: { ...DEFAULT_NOTIFICATIONS.remote }
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
      for (const key of ['turnEnd', 'permission', 'question', 'error'] as const) {
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

  private read(): Settings {
    if (!existsSync(this.filePath)) return { ...DEFAULT_SETTINGS }
    try {
      const raw: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'))
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_SETTINGS }
      const merged = { ...DEFAULT_SETTINGS, ...(raw as Partial<Settings>) }
      merged.notifications = mergeNotifications((raw as Partial<Settings>)['notifications'])
      merged.expandedProjects = mergeExpandedProjects((raw as Partial<Settings>)['expandedProjects'])
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
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, JSON.stringify(this.cache, null, 2), 'utf8')
    renameSync(tmp, this.filePath)
    return this.cache
  }
}
