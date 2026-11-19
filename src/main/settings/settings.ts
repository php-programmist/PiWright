/** Настройки: JSON в `%APPDATA%\Piwright\settings.json`. Атомарная запись (tmp + rename).
 *  Проекты добавляются в панели; настройки фаз 1–2 (backend/projectDir) мигтируются в первый проект. */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ProjectEntry, Settings } from '../../shared/ipc-contracts'

export const DEFAULT_SETTINGS: Settings = {
  wslDistro: '',
  piPath: '',
  projects: []
}

/** Старые настройки (фазы 1–2) → один проект: backend native → native, иначе wsl. */
function migrateLegacy(raw: Record<string, unknown>, base: Settings): Settings {
  if (base.projects.length > 0) return base
  const dir = raw['projectDir']
  if (typeof dir !== 'string' || dir.trim().length === 0) return base
  const kind = raw['backend'] === 'native' ? 'native' : 'wsl'
  const project: ProjectEntry = { kind, dir }
  return { ...base, projects: [project] }
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
