/** Регистрация IPC-каналов: настройки, проекты, сессии (список/история/новая/открыть/закрыть/
 *  переименовать), prompt/abort/модель/thinking, диалоги расширений. */
import { dialog } from 'electron'
import { homedir } from 'node:os'
import { win32 } from 'node:path'
import type { IpcMain } from 'electron'
import {
  FILES_LIST_CHANNEL,
  FILES_READ_CHANNEL,
  FILES_WATCH_CHANNEL,
  GIT_COMMIT_CHANNEL,
  GIT_FILE_DIFF_CHANNEL,
  GIT_GENERATE_MESSAGE_CHANNEL,
  GIT_LOG_CHANNEL,
  GIT_PUSH_CHANNEL,
  GIT_STAGE_CHANNEL,
  GIT_STATUS_CHANNEL,
  GIT_UNSTAGE_CHANNEL,
  SESSION_ABORT_CHANNEL,
  SESSIONS_CHOOSE_DIR_CHANNEL,
  SESSIONS_CLOSE_CHANNEL,
  SESSIONS_DELETE_HISTORY_CHANNEL,
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
  SETTINGS_SET_CHANNEL,
  TERM_CLOSE_CHANNEL,
  TERM_CREATE_CHANNEL,
  TERM_INPUT_CHANNEL,
  TERM_PROFILES_CHANNEL,
  TERM_RESIZE_CHANNEL
} from '../../shared/ipc-contracts'
import type { DialogAnswer } from '../../shared/agent-events'
import type { BackendMode, PanelPrefs, ProjectEntry, Settings, TerminalProfileId } from '../../shared/ipc-contracts'
import type { GitService } from '../git/git-service'
import type { FileService } from '../files/file-service'
import type { TerminalService } from '../terminal/terminal-service'
import { profileAvailability } from '../terminal/profiles'
import type { PiHost } from '../pi/pi-host'
import type { SessionHost } from '../pi/session-host'
import type { SettingsService } from '../settings/settings'
import { deleteSessionFile, listProjectHistory, projectBackendCwd, resolveSessionsRoot, toBackendPath } from '../sessions/session-catalog'
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

function isPathList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((p) => typeof p === 'string' && p.length > 0)
}

function isProfileId(value: unknown): value is TerminalProfileId {
  return value === 'powershell' || value === 'gitbash' || value === 'wsl'
}

export function registerIpc(ipcMain: IpcMain, settings: SettingsService, piHost: PiHost, git: GitService, files: FileService, terminals: TerminalService): void {
  ipcMain.handle(SETTINGS_GET_CHANNEL, () => settings.get())

  ipcMain.handle(SETTINGS_SET_CHANNEL, (_event, patch: unknown) => {
    const safe: Partial<Settings> = {}
    if (patch !== null && typeof patch === 'object' && !Array.isArray(patch)) {
      const raw = patch as Record<string, unknown>
      for (const key of ['wslDistro', 'piPathNative', 'piPathWsl', 'piExtraArgs', 'updateUrl'] as const) {
        if (typeof raw[key] === 'string') safe[key] = raw[key]
      }
      if (raw['selectorPlacement'] === 'top' || raw['selectorPlacement'] === 'bottom') {
        safe.selectorPlacement = raw['selectorPlacement']
      }
      if (raw['panels'] !== null && typeof raw['panels'] === 'object' && !Array.isArray(raw['panels'])) {
        const src = raw['panels'] as Record<string, unknown>
        const panels: Settings['panels'] = {}
        for (const name of ['git', 'files', 'terminal'] as const) {
          const p = src[name]
          if (p === null || typeof p !== 'object' || Array.isArray(p)) continue
          const entry: PanelPrefs = {}
          const rec = p as Record<string, unknown>
          if (typeof rec['open'] === 'boolean') entry.open = rec['open']
          if (typeof rec['width'] === 'number' && Number.isFinite(rec['width'])) entry.width = rec['width']
          panels[name] = entry
        }
        safe.panels = panels
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

  ipcMain.handle(SESSIONS_OPEN_CHANNEL, async (_event, project: unknown, sessionFile: unknown) => {
    if (!isProjectEntry(project) || typeof sessionFile !== 'string' || sessionFile.length === 0) {
      throw new Error('Invalid session request')
    }
    const backendPath = await toBackendPath(project, settings.get(), sessionFile)
    const created = piHost.create(project, backendPath)
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

  ipcMain.handle(SESSIONS_DELETE_HISTORY_CHANNEL, async (_event, project: unknown, sessionPath: unknown) => {
    if (!isProjectEntry(project) || typeof sessionPath !== 'string' || sessionPath.length === 0) {
      return { ok: false, error: 'Invalid request' }
    }
    const current = settings.get()
    const root = await resolveSessionsRoot(project, current)
    if (root === null) return { ok: false, error: 'Sessions directory not found' }
    const backendPath = await toBackendPath(project, current, sessionPath)
    if (piHost.statuses().some((s) => s.sessionFile !== null && s.sessionFile === backendPath)) {
      return { ok: false, error: 'Session is active — close it first' }
    }
    const cwd = await projectBackendCwd(project, current)
    return deleteSessionFile(root, cwd, sessionPath)
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

  ipcMain.handle(GIT_STATUS_CHANNEL, async (_event, project: unknown) => {
    if (!isProjectEntry(project)) return { ok: false, error: 'Invalid project', status: null }
    return git.status(project)
  })

  ipcMain.handle(GIT_FILE_DIFF_CHANNEL, async (_event, project: unknown, path: unknown) => {
    if (!isProjectEntry(project) || typeof path !== 'string' || path.length === 0) {
      return { ok: false, error: 'Invalid request', original: '', modified: '' }
    }
    return git.fileDiff(project, path)
  })

  ipcMain.handle(GIT_STAGE_CHANNEL, async (_event, project: unknown, paths: unknown) => {
    if (!isProjectEntry(project) || !isPathList(paths)) return { ok: false, error: 'Invalid request' }
    return git.stage(project, paths)
  })

  ipcMain.handle(GIT_UNSTAGE_CHANNEL, async (_event, project: unknown, paths: unknown) => {
    if (!isProjectEntry(project) || !isPathList(paths)) return { ok: false, error: 'Invalid request' }
    return git.unstage(project, paths)
  })

  ipcMain.handle(GIT_COMMIT_CHANNEL, async (_event, project: unknown, message: unknown) => {
    if (!isProjectEntry(project)) return { ok: false, error: 'Invalid project' }
    if (typeof message !== 'string' || message.trim().length === 0) {
      return { ok: false, error: 'Commit message is empty' }
    }
    return git.commit(project, message)
  })

  ipcMain.handle(GIT_PUSH_CHANNEL, async (_event, project: unknown) => {
    if (!isProjectEntry(project)) return { ok: false, error: 'Invalid project' }
    return git.push(project)
  })

  ipcMain.handle(GIT_LOG_CHANNEL, async (_event, project: unknown) => {
    if (!isProjectEntry(project)) return { ok: false, error: 'Invalid project', entries: [] }
    return git.log(project)
  })

  ipcMain.handle(GIT_GENERATE_MESSAGE_CHANNEL, async (_event, project: unknown) => {
    if (!isProjectEntry(project)) return { ok: false, error: 'Invalid project', message: '' }
    return git.generateCommitMessage(project)
  })

  ipcMain.handle(FILES_LIST_CHANNEL, async (_event, project: unknown, dir: unknown) => {
    if (!isProjectEntry(project) || typeof dir !== 'string') {
      return { ok: false, error: 'Invalid request', entries: [] }
    }
    return files.listDir(project, dir)
  })

  ipcMain.handle(FILES_READ_CHANNEL, async (_event, project: unknown, path: unknown) => {
    if (!isProjectEntry(project) || typeof path !== 'string') {
      return { ok: false, error: 'Invalid request', content: '' }
    }
    return files.read(project, path)
  })

  ipcMain.handle(FILES_WATCH_CHANNEL, (_event, project: unknown, paths: unknown) => {
    if (!isProjectEntry(project) || !isPathList(paths)) return { ok: false, error: 'Invalid request' }
    files.setWatched(project, paths)
    return { ok: true, error: null }
  })

  ipcMain.handle(TERM_PROFILES_CHANNEL, async (_event, project: unknown) => {
    if (!isProjectEntry(project)) {
      return { ok: false, error: 'Invalid project', profiles: [], defaultProfileId: null }
    }
    const avail = await profileAvailability(settings.get())
    return { ok: true, error: null, ...terminals.profiles(project, avail) }
  })

  ipcMain.handle(TERM_CREATE_CHANNEL, async (_event, project: unknown, profileId: unknown) => {
    if (!isProjectEntry(project)) return { ok: false, error: 'Invalid project', terminal: null }
    const avail = await profileAvailability(settings.get())
    const terminal = await terminals.create(project, isProfileId(profileId) ? profileId : null, avail)
    if (terminal === null) return { ok: false, error: 'Profile is not available', terminal: null }
    return { ok: true, error: null, terminal }
  })

  ipcMain.handle(TERM_CLOSE_CHANNEL, (_event, id: unknown) => {
    if (typeof id !== 'string' || id.length === 0) return { ok: false, error: 'Invalid request' }
    terminals.close(id)
    return { ok: true, error: null }
  })

  ipcMain.on(TERM_INPUT_CHANNEL, (_event, id: unknown, data: unknown) => {
    if (typeof id !== 'string' || typeof data !== 'string') return
    terminals.input(id, data)
  })

  ipcMain.on(TERM_RESIZE_CHANNEL, (_event, id: unknown, cols: unknown, rows: unknown) => {
    if (typeof id !== 'string' || typeof cols !== 'number' || typeof rows !== 'number') return
    terminals.resize(id, cols, rows)
  })
}

async function chooseDefaultPath(kind: BackendMode, settings: Settings): Promise<string | undefined> {
  if (kind === 'native') return homedir()
  const distro = settings.wslDistro.trim() || (await listWslDistros())[0]
  if (distro === undefined) return undefined
  const home = await resolveWslHome(distro)
  return win32.join(`\\\\wsl.localhost\\${distro}`, home ?? '\\')
}
