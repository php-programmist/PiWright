/** Регистрация IPC-каналов: настройки, prompt, abort/модель/thinking, диалоги расширений. */
import type { IpcMain } from 'electron'
import {
  SESSION_ABORT_CHANNEL,
  SESSION_PENDING_DIALOGS_CHANNEL,
  SESSION_PROMPT_CHANNEL,
  SESSION_RESPOND_DIALOG_CHANNEL,
  SESSION_SET_MODEL_CHANNEL,
  SESSION_SET_THINKING_CHANNEL,
  SETTINGS_GET_CHANNEL,
  SETTINGS_SET_CHANNEL
} from '../../shared/ipc-contracts'
import type { DialogAnswer } from '../../shared/agent-events'
import type { Settings } from '../../shared/ipc-contracts'
import type { SessionHost } from '../pi/session-host'
import type { SettingsService } from '../settings/settings'

function isDialogAnswer(value: unknown): value is DialogAnswer {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const kind = (value as Record<string, unknown>)['kind']
  if (kind === 'confirmed') return typeof (value as Record<string, unknown>)['confirmed'] === 'boolean'
  if (kind === 'value') return typeof (value as Record<string, unknown>)['value'] === 'string'
  return kind === 'cancelled'
}

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

  ipcMain.handle(SESSION_ABORT_CHANNEL, () => host.abort())

  ipcMain.handle(SESSION_SET_MODEL_CHANNEL, (_event, key: unknown) => {
    if (typeof key !== 'string' || key.trim().length === 0) {
      return { ok: false, error: 'Model key is empty' }
    }
    return host.setModel(key)
  })

  ipcMain.handle(SESSION_SET_THINKING_CHANNEL, (_event, level: unknown) => {
    if (typeof level !== 'string' || level.trim().length === 0) {
      return { ok: false, error: 'Thinking level is empty' }
    }
    return host.setThinkingLevel(level)
  })

  ipcMain.handle(SESSION_RESPOND_DIALOG_CHANNEL, (_event, id: unknown, answer: unknown) => {
    if (typeof id !== 'string' || id.length === 0) return { ok: false, error: 'Dialog id is empty' }
    if (!isDialogAnswer(answer)) return { ok: false, error: 'Invalid dialog answer' }
    return host.respondDialog(id, answer)
  })

  ipcMain.handle(SESSION_PENDING_DIALOGS_CHANNEL, () => host.getPendingDialogs())
}
