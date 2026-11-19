/** Настройки: JSON в `%APPDATA%\Piwright\settings.json`. Атомарная запись (tmp + rename). */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Settings } from '../../shared/ipc-contracts'

export const DEFAULT_SETTINGS: Settings = {
  backend: 'auto',
  wslDistro: '',
  piPath: '',
  projectDir: ''
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
      return { ...DEFAULT_SETTINGS, ...(raw as Partial<Settings>) }
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
