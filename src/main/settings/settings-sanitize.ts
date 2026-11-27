/** Санитайзеры полей настроек, общие для глобального settings.json и плоского
 *  файла проекта (.piwright/settings.json). Вынесены из settings.ts, чтобы
 *  project-settings.ts не циклился с SettingsService. */
import { TERMINAL_PROFILE_IDS, type DbAuthType, type DbConnectionEntry, type DbKind, type DbSshTunnel, type SavedTerminalTab, type SshAuthType, type TerminalTabsSnapshot } from '../../shared/ipc-contracts'

export type { TerminalTabsSnapshot } from '../../shared/ipc-contracts'

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

/** Лимит подключений БД в настройках. */
export const DB_CONNECTIONS_MAX = 20

export const SSH_ID_RE = /^[A-Za-z0-9._-]{1,64}$/
export const SSH_AUTH_TYPES: SshAuthType[] = ['password', 'key', 'agent']

export function sanitizeSshString(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

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
      // Пустой массив валиден — «ни одной схемы» (панель скрывает все); отсутствует/undefined — все схемы.
      const schemas = selected.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length <= 64).slice(0, 50)
      entry.selectedSchemas = schemas
    }
    seen.add(id)
    out.push(entry)
  }
  return out
}
