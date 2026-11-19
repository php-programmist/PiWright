/** Регистрация IPC-каналов: настройки, проекты, сессии (список/история/новая/открыть/закрыть/
 *  переименовать), prompt/abort/модель/thinking, диалоги расширений. */
import { dialog } from 'electron'
import { homedir } from 'node:os'
import { win32 } from 'node:path'
import type { IpcMain } from 'electron'
import {
  SESSION_ABORT_CHANNEL,
  SESSIONS_CHOOSE_DIR_CHANNEL,
  SESSIONS_CLOSE_CHANNEL,
  SESSIONS_HISTORY_CHANNEL,
  SESSIONS_LIST_CHANNEL,
  SESSIONS_NEW_CHANNEL,
  SESSIONS_OPEN_CHANNEL,
  SESSIONS_RENAME_CHANNEL,
  SESSION_PENDING_DIALOGS_CHANNEL,
  SESSION_PROMPT_CHANNEL,
  SESSION_RESPOND_DIALOG_CHANNEL,
  SESSION_SET_MODEL_CHANNEL,
  SESSION_SET_THINKING_CHANNEL,
  SETTINGS_GET_CHANNEL,
  SETTINGS_SET_CHANNEL
} from '../../shared/ipc-contracts'
import type { DialogAnswer } from '../../shared/agent-events'
import type { BackendMode, ProjectEntry, Settings } from '../../shared/ipc-contracts'
import type { PiHost } from '../pi/pi-host'
import type { SessionHost } from '../pi/session-host'
import type { SettingsService } from '../settings/settings'
import { listProjectHistory } from '../sessions/session-catalog'
import { listWslDistros, resolveWslHome } from '../pi/backends/wsl'

function isDialogAnswer(value: unknown): value is DialogAnswer {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const kind = (value as Record<string, unknown>)['kind']
  if (kind === 'confirmed') return typeof (value as Record<string, unknown>)['confirmed'] === 'boolean'
  if (kind === 'value') return typeof (value as Record<string, unknown>)['value'] === 'string'
  return kind === 'cancelled'
}

function isProjectEntry(value: unknown): value is ProjectEntry {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const entry = value as Record<string, unknown>
  return (entry['kind'] === 'native' || entry['kind'] === 'wsl') && typeof entry['dir'] === 'string'
}

function host(piHost: PiHost, hostId: unknown): SessionHost | null {
  if (typeof hostId !== 'string') return null
  return piHost.get(hostId)
}

export function registerIpc(ipcMain: IpcMain, settings: SettingsService, piHost: PiHost): void {
  ipcMain.handle(SETTINGS_GET_CHANNEL, () => settings.get())

  ipcMain.handle(SETTINGS_SET_CHANNEL, (_event, patch: unknown) => {
    const safe: Partial<Settings> = {}
    if (patch !== null && typeof patch === 'object' && !Array.isArray(patch)) {
      const raw = patch as Record<string, unknown>
      for (const key of ['wslDistro', 'piPath'] as const) {
        if (typeof raw[key] === 'string') safe[key] = raw[key]
      }
      if (Array.isArray(raw['projects'])) {
        const projects = raw['projects'].filter(isProjectEntry)
        safe.projects = projects
      }
    }
    return settings.set(safe)
  })

  ipcMain.handle(SESSIONS_LIST_CHANNEL, () => ({ active: piHost.statuses() }))

  ipcMain.handle(SESSIONS_HISTORY_CHANNEL, async (_event, project: unknown) => {
    if (!isProjectEntry(project)) return []
    return listProjectHistory(project, settings.get())
  })

  ipcMain.handle(SESSIONS_NEW_CHANNEL, (_event, project: unknown) => {
    if (!isProjectEntry(project)) throw new Error('Invalid project')
    return { hostId: piHost.create(project).id }
  })

  ipcMain.handle(SESSIONS_OPEN_CHANNEL, (_event, project: unknown, sessionFile: unknown) => {
    if (!isProjectEntry(project) || typeof sessionFile !== 'string' || sessionFile.length === 0) {
      throw new Error('Invalid session request')
    }
    const created = piHost.create(project, sessionFile)
    void created.ensureStarted().catch(() => {})
    return { hostId: created.id }
  })

  ipcMain.handle(SESSIONS_CLOSE_CHANNEL, (_event, hostId: unknown) => {
    piHost.close(typeof hostId === 'string' ? hostId : '')
    return { ok: true, error: null }
  })

  ipcMain.handle(SESSIONS_RENAME_CHANNEL, async (_event, hostId: unknown, name: unknown) => {
    const h = host(piHost, hostId)
    if (h === null) return { ok: false, error: 'Session not found' }
    if (typeof name !== 'string') return { ok: false, error: 'Session name is empty' }
    return h.rename(name)
  })

  ipcMain.handle(SESSIONS_CHOOSE_DIR_CHANNEL, async (_event, kind: unknown) => {
    if (kind !== 'native' && kind !== 'wsl') return { ok: false, dir: null }
    const defaultPath = await chooseDefaultPath(kind, settings.get())
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      defaultPath
    })
    if (result.canceled || result.filePaths.length === 0) return { ok: false, dir: null }
    return { ok: true, dir: result.filePaths[0] }
  })

  ipcMain.handle(SESSION_PROMPT_CHANNEL, async (_event, hostId: unknown, text: unknown) => {
    const h = host(piHost, hostId)
    if (h === null) return { ok: false, error: 'Session not found' }
    if (typeof text !== 'string' || text.trim().length === 0) {
      return { ok: false, error: 'Message is empty' }
    }
    return h.prompt(text)
  })

  ipcMain.handle(SESSION_ABORT_CHANNEL, (_event, hostId: unknown) => {
    const h = host(piHost, hostId)
    if (h === null) return { ok: false, error: 'Session not found' }
    return h.abort()
  })

  ipcMain.handle(SESSION_SET_MODEL_CHANNEL, (_event, hostId: unknown, key: unknown) => {
    const h = host(piHost, hostId)
    if (h === null) return { ok: false, error: 'Session not found' }
    if (typeof key !== 'string' || key.trim().length === 0) {
      return { ok: false, error: 'Model key is empty' }
    }
    return h.setModel(key)
  })

  ipcMain.handle(SESSION_SET_THINKING_CHANNEL, (_event, hostId: unknown, level: unknown) => {
    const h = host(piHost, hostId)
    if (h === null) return { ok: false, error: 'Session not found' }
    if (typeof level !== 'string' || level.trim().length === 0) {
      return { ok: false, error: 'Thinking level is empty' }
    }
    return h.setThinkingLevel(level)
  })

  ipcMain.handle(SESSION_RESPOND_DIALOG_CHANNEL, (_event, hostId: unknown, id: unknown, answer: unknown) => {
    const h = host(piHost, hostId)
    if (h === null) return { ok: false, error: 'Session not found' }
    if (typeof id !== 'string' || id.length === 0) return { ok: false, error: 'Dialog id is empty' }
    if (!isDialogAnswer(answer)) return { ok: false, error: 'Invalid dialog answer' }
    return h.respondDialog(id, answer)
  })

  ipcMain.handle(SESSION_PENDING_DIALOGS_CHANNEL, () => piHost.pendingDialogs())
}

async function chooseDefaultPath(kind: BackendMode, settings: Settings): Promise<string | undefined> {
  if (kind === 'native') return homedir()
  const distro = settings.wslDistro.trim() || (await listWslDistros())[0]
  if (distro === undefined) return undefined
  const home = await resolveWslHome(distro)
  return win32.join(`\\\\wsl.localhost\\${distro}`, home ?? '\\')
}
