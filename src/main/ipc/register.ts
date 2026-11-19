/** Регистрация IPC-каналов: настройки и prompt. Стрим событий/статуса идёт мимо IPC-хендлеров —
 *  main шлёт в webContents напрямую из SessionHost-listener (см. index.ts). */
import type { IpcMain } from 'electron'
import {
  SESSION_PROMPT_CHANNEL,
  SETTINGS_GET_CHANNEL,
  SETTINGS_SET_CHANNEL
} from '../../shared/ipc-contracts'
import type { Settings } from '../../shared/ipc-contracts'
import type { SessionHost } from '../pi/session-host'
import type { SettingsService } from '../settings/settings'

export function registerIpc(ipcMain: IpcMain, settings: SettingsService, host: SessionHost): void {
  ipcMain.handle(SETTINGS_GET_CHANNEL, () => settings.get())

  ipcMain.handle(SETTINGS_SET_CHANNEL, (_event, patch: unknown) => {
    const safe: Partial<Settings> = {}
    if (patch !== null && typeof patch === 'object' && !Array.isArray(patch)) {
      const raw = patch as Record<string, unknown>
      if (raw['backend'] === 'native' || raw['backend'] === 'wsl' || raw['backend'] === 'auto') {
        safe.backend = raw['backend']
      }
      for (const key of ['wslDistro', 'piPath', 'projectDir'] as const) {
        if (typeof raw[key] === 'string') safe[key] = raw[key]
      }
    }
    return settings.set(safe)
  })

  ipcMain.handle(SESSION_PROMPT_CHANNEL, (_event, text: unknown) => {
    if (typeof text !== 'string' || text.trim().length === 0) {
      return { ok: false, error: 'Message is empty' }
    }
    return host.prompt(text)
  })
}
