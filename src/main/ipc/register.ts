/** Регистрация IPC-каналов: настройки, проекты, сессии (список/история/новая/открыть/закрыть/
 *  переименовать), prompt/abort/модель/thinking, диалоги расширений. */
import { app, dialog, shell } from 'electron'
import { homedir } from 'node:os'
import { win32 } from 'node:path'
import type { IpcMain } from 'electron'
import {
  ATTACHMENTS_CHOOSE_CHANNEL,
  ATTACHMENTS_PUT_CHANNEL,
  FILES_LIST_CHANNEL,
  FILES_READ_CHANNEL,
  FILES_READ_IMAGE_CHANNEL,
  FILES_RENAME_CHANNEL,
  FILES_DELETE_CHANNEL,
  FILES_MKDIR_CHANNEL,
  FILES_WATCH_CHANNEL,
  FILES_WRITE_CHANNEL,
  GIT_BRANCHES_CHANNEL,
  GIT_BRANCH_DELETE_CHANNEL,
  GIT_BRANCH_RENAME_CHANNEL,
  GIT_CHECKOUT_CHANNEL,
  GIT_COMMIT_CHANNEL,
  GIT_FILE_DIFF_CHANNEL,
  GIT_GENERATE_MESSAGE_CHANNEL,
  GIT_LOG_CHANNEL,
  GIT_PUSH_CHANNEL,
  GIT_STAGE_CHANNEL,
  GIT_STATUS_CHANNEL,
  GIT_UNSTAGE_CHANNEL,
  MCP_LIST_CHANNEL,
  MCP_PROBE_CHANNEL,
  MCP_REVEAL_CHANNEL,
  MCP_SAVE_CHANNEL,
  MODELS_LIST_CHANNEL,
  MODELS_REVEAL_CHANNEL,
  MODELS_SAVE_CHANNEL,
  REMOTE_CHECK_PORT_CHANNEL,
  REMOTE_SHARE_SESSION_CHANNEL,
  REMOTE_STATUS_CHANNEL,
  SESSION_ABORT_CHANNEL,
  SESSION_QUEUE_CLEAR_CHANNEL,
  SESSION_QUEUE_REMOVE_CHANNEL,
  SESSIONS_CHOOSE_DIR_CHANNEL,
  PROJECTS_REVEAL_CHANNEL,
  SESSIONS_CLOSE_CHANNEL,
  SESSIONS_DELETE_HISTORY_CHANNEL,
  SESSIONS_HISTORY_CHANNEL,
  SESSIONS_LIST_CHANNEL,
  SESSIONS_NEW_CHANNEL,
  SESSIONS_OPEN_CHANNEL,
  SESSIONS_RENAME_CHANNEL,
  SESSIONS_TRANSCRIPT_CHANNEL,
  SESSION_PENDING_DIALOGS_CHANNEL,
  SESSION_PROMPT_CHANNEL,
  SESSION_EDIT_PROMPT_CHANNEL,
  SESSION_FORK_CHANNEL,
  LOOP_START_CHANNEL,
  LOOP_STOP_CHANNEL,
  LOOP_SET_REMAINING_CHANNEL,
  LOOP_GET_CHANNEL,
  SESSION_RESPOND_DIALOG_CHANNEL,
  SESSION_SET_MODEL_CHANNEL,
  SESSION_COMMANDS_CHANNEL,
  SESSION_SET_THINKING_CHANNEL,
  APP_VERSION_CHANNEL,
  SETTINGS_GET_CHANNEL,
  SETTINGS_SET_CHANNEL,
  SETTINGS_REVEAL_CHANNEL,
  SKILLS_LIST_CHANNEL,
  SKILLS_REVEAL_CHANNEL,
  SKILLS_TOGGLE_CHANNEL,
  SOUNDS_CHOOSE_CHANNEL,
  SOUNDS_READ_CHANNEL,
  TELEGRAM_SET_TOKEN_CHANNEL,
  TELEGRAM_TEST_CHANNEL,
  TELEGRAM_TOKEN_STATUS_CHANNEL,
  TELEGRAM_TOGGLE_SESSION_CHANNEL,
  TERM_CLOSE_CHANNEL,
  TERM_CREATE_CHANNEL,
  TERM_INPUT_CHANNEL,
  TERM_PROFILES_CHANNEL,
  TERM_RESIZE_CHANNEL,
  WORKTREE_CREATE_CHANNEL,
  WORKTREE_REMOVE_CHANNEL
} from '../../shared/ipc-contracts'
import type { DialogAnswer } from '../../shared/agent-events'
import type { BackendMode, PanelPrefs, ProjectEntry, Settings, TerminalProfileId } from '../../shared/ipc-contracts'
import type { GitService } from '../git/git-service'
import type { FileService } from '../files/file-service'
import type { TerminalService } from '../terminal/terminal-service'
import { profileAvailability } from '../terminal/profiles'
import type { PiHost } from '../pi/pi-host'
import type { LoopController } from '../pi/loop-controller'
import type { SessionHost } from '../pi/session-host'
import type { SettingsService } from '../settings/settings'
import { CHAT_FONT_SIZE_MAX, CHAT_FONT_SIZE_MIN, mergeExpandedProjects, mergeNotifications, mergeTerminalTabs } from '../settings/settings'
import { mergeProjectTabs } from '../../shared/project-tabs'
import { chooseAttachment, putAttachment } from '../attachments/attachments'
import { chooseSoundFile, readSoundFile } from '../sounds/sounds'
import { sendTestTelegram } from '../notifications/telegram'
import type { TelegramTokenStore } from '../notifications/token-store'
import type { RemoteBridge } from '../remote/bridge'
import { isPortBusy } from '../remote/server'
import { listMcpServers, probeMcpServer, revealMcpFile, saveMcpServers } from '../mcp/mcp-config'
import { listModels, revealModelsFile, saveModels } from '../models/models-service'
import { listSkills, revealSkillsFolder, toggleSkill } from '../skills/skills-service'
import { deleteSessionFile, listProjectHistory, projectBackendCwd, resolveSessionsRoot, toBackendPath, checkSessionPath, readSessionHeader } from '../sessions/session-catalog'
import { readSessionTranscript } from '../sessions/transcript'
import { worktreeNameFromCwd } from '../../shared/worktree'
import { buildWslUncPath, stripWslUncPrefix } from '../pi/backends/shell'
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
  if (!((entry['kind'] === 'native' || entry['kind'] === 'wsl') && typeof entry['dir'] === 'string')) return false
  return entry['name'] === undefined || typeof entry['name'] === 'string'
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

export interface NotificationServices {
  tokenStore: TelegramTokenStore
  bridge: RemoteBridge
  onSettingsChanged: (settings: Settings) => void
}

export function registerIpc(
  ipcMain: IpcMain,
  settings: SettingsService,
  piHost: PiHost,
  git: GitService,
  files: FileService,
  terminals: TerminalService,
  loops: LoopController,
  notifications?: NotificationServices
): void {
  ipcMain.handle(SETTINGS_GET_CHANNEL, () => settings.get())

  ipcMain.handle(SETTINGS_REVEAL_CHANNEL, () => {
    shell.showItemInFolder(settings.path)
    return { ok: true, error: null }
  })

  ipcMain.handle(APP_VERSION_CHANNEL, () => app.getVersion())

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
      if (raw['theme'] === 'dark' || raw['theme'] === 'light') {
        safe.theme = raw['theme']
      }
      if (typeof raw['chatFontSize'] === 'number' && Number.isFinite(raw['chatFontSize'])) {
        safe.chatFontSize = Math.min(
          CHAT_FONT_SIZE_MAX,
          Math.max(CHAT_FONT_SIZE_MIN, Math.round(raw['chatFontSize']))
        )
      }
      if (typeof raw['singleLineTools'] === 'boolean') {
        safe.singleLineTools = raw['singleLineTools']
      }
      if (typeof raw['sendOnEnter'] === 'boolean') {
        safe.sendOnEnter = raw['sendOnEnter']
      }
      if (typeof raw['loopsEnabled'] === 'boolean') {
        safe.loopsEnabled = raw['loopsEnabled']
      }
      if (raw['language'] === 'en' || raw['language'] === 'ru') {
        safe.language = raw['language']
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
          if (typeof rec['height'] === 'number' && Number.isFinite(rec['height'])) entry.height = rec['height']
          panels[name] = entry
        }
        safe.panels = panels
      }
      if (Array.isArray(raw['projects'])) {
        const projects = raw['projects'].filter(isProjectEntry)
        safe.projects = projects
      }
      if (raw['notifications'] !== null && typeof raw['notifications'] === 'object' && !Array.isArray(raw['notifications'])) {
        safe.notifications = mergeNotifications(raw['notifications'])
      }
      if (raw['expandedProjects'] !== null && typeof raw['expandedProjects'] === 'object' && !Array.isArray(raw['expandedProjects'])) {
        safe.expandedProjects = mergeExpandedProjects(raw['expandedProjects'])
      }
      if (raw['terminalTabs'] !== null && typeof raw['terminalTabs'] === 'object' && !Array.isArray(raw['terminalTabs'])) {
        safe.terminalTabs = mergeTerminalTabs(raw['terminalTabs'])
      }
      if (raw['projectTabs'] !== null && typeof raw['projectTabs'] === 'object' && !Array.isArray(raw['projectTabs'])) {
        safe.projectTabs = mergeProjectTabs(raw['projectTabs'])
      }
      if (typeof raw['lastProjectKey'] === 'string' || raw['lastProjectKey'] === null) {
        safe.lastProjectKey = raw['lastProjectKey'] as string | null
      }
    }
    const next = settings.set(safe)
    if (!next.loopsEnabled) loops.stopAll()
    notifications?.onSettingsChanged(next)
    return next
  })

  ipcMain.handle(SESSIONS_LIST_CHANNEL, () => {
    notifications?.bridge.syncSessions()
    return {
      active: piHost.statuses().map((s) => ({
        ...s,
        telegram: notifications?.bridge.telegramEnabledFor(s.hostId) ?? false,
        shared: notifications?.bridge.sharedFor(s.hostId) ?? false
      }))
    }
  })

  ipcMain.handle(SESSIONS_HISTORY_CHANNEL, async (_event, project: unknown) => {
    if (!isProjectEntry(project)) return []
    return listProjectHistory(project, settings.get())
  })

  ipcMain.handle(SESSIONS_NEW_CHANNEL, (_event, project: unknown) => {
    if (!isProjectEntry(project)) throw new Error('Invalid project')
    const created = piHost.create(project)
    // Кэша каталога ещё нет — поднимаем сессию сразу, чтобы модель/thinking были видны до первого промпта.
    if (!piHost.hasCatalog(project.kind)) void created.ensureStarted().catch(() => {})
    return { hostId: created.id }
  })

  ipcMain.handle(PROJECTS_REVEAL_CHANNEL, async (_event, project: unknown) => {
    if (!isProjectEntry(project)) return { ok: false, error: 'Invalid project' }
    let target = project.dir
    if (project.kind === 'wsl' && stripWslUncPrefix(target) !== null) {
      const distro = settings.get().wslDistro.trim() || (await listWslDistros())[0]
      if (distro === undefined) return { ok: false, error: 'WSL distro not found' }
      target = buildWslUncPath(distro, stripWslUncPrefix(target)!)
    }
    shell.showItemInFolder(target)
    return { ok: true, error: null }
  })

  ipcMain.handle(SESSIONS_OPEN_CHANNEL, async (_event, project: unknown, sessionFile: unknown) => {
    if (!isProjectEntry(project) || typeof sessionFile !== 'string' || sessionFile.length === 0) {
      return { ok: false, error: 'Invalid session request', hostId: null }
    }
    const current = settings.get()
    const root = await resolveSessionsRoot(project, current)
    if (root === null) return { ok: false, error: 'Sessions directory not found', hostId: null }
    const cwd = await projectBackendCwd(project, current)
    const checked = checkSessionPath(root, cwd, sessionFile)
    if ('error' in checked) return { ok: false, error: checked.error, hostId: null }
    const backendPath = await toBackendPath(project, current, sessionFile)
    // Сессия worktree: пересоздать worktree по имени из cwd заголовка (порт openSessionTab jb-pi).
    let hostProject = project
    const header = await readSessionHeader(checked.path)
    const wtName = header !== null ? worktreeNameFromCwd(header.cwd) : null
    if (wtName !== null) {
      const wt = await git.worktreeCreate(project, wtName)
      if (!wt.ok || wt.dir === null) return { ok: false, error: wt.error, hostId: null }
      hostProject = { kind: project.kind, dir: wt.dir }
    }
    const created = piHost.create(hostProject, backendPath)
    void created.ensureStarted().catch(() => {})
    return { ok: true, error: null, hostId: created.id }
  })

  ipcMain.handle(WORKTREE_CREATE_CHANNEL, async (_event, project: unknown, name: unknown) => {
    if (!isProjectEntry(project) || typeof name !== 'string') {
      return { ok: false, error: 'Invalid request', dir: null, name: '', branch: null }
    }
    return git.worktreeCreate(project, name)
  })

  ipcMain.handle(WORKTREE_REMOVE_CHANNEL, async (_event, project: unknown, name: unknown, force: unknown) => {
    if (!isProjectEntry(project) || typeof name !== 'string' || typeof force !== 'boolean') {
      return { ok: false, error: 'Invalid request', uncommitted: false }
    }
    return git.worktreeRemove(project, name, force)
  })

  ipcMain.handle(SESSIONS_TRANSCRIPT_CHANNEL, async (_event, project: unknown, sessionPath: unknown) => {
    if (!isProjectEntry(project) || typeof sessionPath !== 'string' || sessionPath.length === 0) {
      return { ok: false, error: 'Invalid request', events: [] }
    }
    const current = settings.get()
    const root = await resolveSessionsRoot(project, current)
    if (root === null) return { ok: false, error: 'Sessions directory not found', events: [] }
    const cwd = await projectBackendCwd(project, current)
    const checked = checkSessionPath(root, cwd, sessionPath)
    if ('error' in checked) return { ok: false, error: checked.error, events: [] }
    try {
      return { ok: true, error: null, events: await readSessionTranscript(checked.path) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), events: [] }
    }
  })

  ipcMain.handle(SESSIONS_CLOSE_CHANNEL, (_event, hostId: unknown) => {
    if (typeof hostId === 'string') loops.forget(hostId)
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

  ipcMain.handle(SESSION_PROMPT_CHANNEL, async (_event, hostId: unknown, text: unknown, images: unknown, behavior: unknown) => {
    const h = host(piHost, hostId)
    if (h === null) return { ok: false, error: 'Session not found' }
    if (typeof text !== 'string' || text.trim().length === 0) {
      return { ok: false, error: 'Message is empty' }
    }
    const promptBehavior = behavior === 'steer' || behavior === 'followUp' ? behavior : undefined
    return h.prompt(text, isPathList(images) ? images : [], promptBehavior)
  })

  ipcMain.handle(SESSION_EDIT_PROMPT_CHANNEL, async (_event, hostId: unknown, text: unknown, occurrence: unknown, newText: unknown) => {
    const h = host(piHost, hostId)
    if (h === null) return { ok: false, error: 'Session not found' }
    if (typeof text !== 'string' || text.trim().length === 0 || typeof newText !== 'string' || newText.trim().length === 0) {
      return { ok: false, error: 'Message is empty' }
    }
    if (typeof occurrence !== 'number' || !Number.isInteger(occurrence) || occurrence < 0) {
      return { ok: false, error: 'Invalid prompt occurrence' }
    }
    return h.editPrompt(text, occurrence, newText)
  })

  ipcMain.handle(SESSION_FORK_CHANNEL, async (_event, hostId: unknown, userText: unknown, occurrence: unknown) => {
    const parent = host(piHost, hostId)
    if (parent === null) return { ok: false, error: 'Session not found' }
    if (parent.streaming) return { ok: false, error: 'Session is busy — wait for the current turn to finish' }
    if (userText !== null && (typeof userText !== 'string' || userText.trim().length === 0)) {
      return { ok: false, error: 'Invalid fork point' }
    }
    if (typeof occurrence !== 'number' || !Number.isInteger(occurrence) || occurrence < 0) {
      return { ok: false, error: 'Invalid prompt occurrence' }
    }
    const forked = piHost.createFork(parent.id, { userText: typeof userText === 'string' ? userText : null, occurrence })
    if (forked === null) return { ok: false, error: 'Session file is not available for forking' }
    try {
      await forked.ensureStarted()
    } catch (err) {
      piHost.close(forked.id)
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
    return { ok: true, error: null, hostId: forked.id }
  })

  ipcMain.handle(SESSION_ABORT_CHANNEL, (_event, hostId: unknown) => {
    const h = host(piHost, hostId)
    if (h === null) return { ok: false, error: 'Session not found' }
    return h.abort()
  })

  ipcMain.handle(LOOP_START_CHANNEL, (_event, hostId: unknown, prompt: unknown, maxIterations: unknown, exitCondition: unknown) => {
    if (!settings.get().loopsEnabled) return { ok: false, error: 'Loops are disabled in settings' }
    if (typeof hostId !== 'string' || typeof prompt !== 'string' || prompt.trim().length === 0 || typeof maxIterations !== 'number') {
      return { ok: false, error: 'Invalid loop request' }
    }
    if (typeof exitCondition !== 'string' || exitCondition.trim().length === 0) {
      return { ok: false, error: 'Loop exit condition is required' }
    }
    const info = loops.start(hostId, prompt, maxIterations, exitCondition.trim())
    return info === null ? { ok: false, error: 'Session not found' } : { ok: true, error: null }
  })

  ipcMain.handle(LOOP_STOP_CHANNEL, (_event, hostId: unknown) => {
    if (typeof hostId !== 'string') return { ok: false, error: 'Invalid loop request' }
    const info = loops.stop(hostId)
    return info === null ? { ok: false, error: 'Loop is not active' } : { ok: true, error: null }
  })

  ipcMain.handle(LOOP_SET_REMAINING_CHANNEL, (_event, hostId: unknown, remaining: unknown) => {
    if (typeof hostId !== 'string' || typeof remaining !== 'number') return { ok: false, error: 'Invalid loop request' }
    const info = loops.setRemaining(hostId, remaining)
    return info === null ? { ok: false, error: 'Loop is not active' } : { ok: true, error: null }
  })

  ipcMain.handle(LOOP_GET_CHANNEL, (_event, hostId: unknown) => {
    return typeof hostId === 'string' ? loops.get(hostId) : null
  })

  ipcMain.handle(SESSION_QUEUE_CLEAR_CHANNEL, (_event, hostId: unknown) => {
    const h = host(piHost, hostId)
    if (h === null) return { ok: false, error: 'Session not found' }
    return h.queueClear()
  })

  ipcMain.handle(SESSION_QUEUE_REMOVE_CHANNEL, (_event, hostId: unknown, kind: unknown, index: unknown) => {
    const h = host(piHost, hostId)
    if (h === null) return { ok: false, error: 'Session not found' }
    if (kind !== 'steering' && kind !== 'followUp') return { ok: false, error: 'Unknown queue kind' }
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
      return { ok: false, error: 'Invalid queue index' }
    }
    return h.queueRemove(kind, index)
  })

  ipcMain.handle(SESSION_COMMANDS_CHANNEL, (_event, hostId: unknown) => {
    const h = host(piHost, hostId)
    if (h === null) return { ok: false, error: 'Session not found', commands: [] }
    return h.commands().then((commands) => ({ ok: true, error: null, commands }))
  })

  ipcMain.handle(SESSION_SET_MODEL_CHANNEL, (_event, hostId: unknown, key: unknown) => {
    const h = host(piHost, hostId)
    if (h === null) return { ok: false, error: 'Session not found' }
    if (typeof key !== 'string' || key.trim().length === 0) {
      return { ok: false, error: 'Model key is empty' }
    }
    const result = h.setModel(key)
    return result.then((r) => {
      if (r.ok) settings.set({ lastModel: key })
      return r
    })
  })

  ipcMain.handle(SESSION_SET_THINKING_CHANNEL, (_event, hostId: unknown, level: unknown) => {
    const h = host(piHost, hostId)
    if (h === null) return { ok: false, error: 'Session not found' }
    if (typeof level !== 'string' || level.trim().length === 0) {
      return { ok: false, error: 'Thinking level is empty' }
    }
    const result = h.setThinkingLevel(level)
    return result.then((r) => {
      if (r.ok) settings.set({ lastThinkingLevel: level })
      return r
    })
  })

  ipcMain.handle(SESSION_RESPOND_DIALOG_CHANNEL, (_event, hostId: unknown, id: unknown, answer: unknown) => {
    const h = host(piHost, hostId)
    if (h === null) return { ok: false, error: 'Session not found' }
    if (typeof id !== 'string' || id.length === 0) return { ok: false, error: 'Dialog id is empty' }
    if (!isDialogAnswer(answer)) return { ok: false, error: 'Invalid dialog answer' }
    const result = h.respondDialog(id, answer)
    if (result.ok && typeof hostId === 'string') notifications?.bridge.answerUiFromPc(hostId, id)
    return result
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

  ipcMain.handle(GIT_BRANCHES_CHANNEL, async (_event, project: unknown) => {
    if (!isProjectEntry(project)) return { ok: false, error: 'Invalid project', branches: [] }
    return git.branches(project)
  })

  ipcMain.handle(GIT_CHECKOUT_CHANNEL, async (_event, project: unknown, name: unknown, create: unknown, startPoint: unknown) => {
    if (!isProjectEntry(project) || typeof name !== 'string' || typeof create !== 'boolean') {
      return { ok: false, error: 'Invalid request' }
    }
    return git.checkout(project, name, create, typeof startPoint === 'string' ? startPoint : undefined)
  })

  ipcMain.handle(GIT_BRANCH_RENAME_CHANNEL, async (_event, project: unknown, oldName: unknown, newName: unknown) => {
    if (!isProjectEntry(project) || typeof oldName !== 'string' || typeof newName !== 'string') {
      return { ok: false, error: 'Invalid request' }
    }
    return git.renameBranch(project, oldName, newName)
  })

  ipcMain.handle(GIT_BRANCH_DELETE_CHANNEL, async (_event, project: unknown, name: unknown) => {
    if (!isProjectEntry(project) || typeof name !== 'string') return { ok: false, error: 'Invalid request' }
    return git.deleteBranch(project, name)
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

  ipcMain.handle(FILES_READ_IMAGE_CHANNEL, async (_event, project: unknown, path: unknown) => {
    if (!isProjectEntry(project) || typeof path !== 'string') {
      return { ok: false, error: 'Invalid request', dataUrl: '' }
    }
    return files.readImage(project, path)
  })

  ipcMain.handle(FILES_WRITE_CHANNEL, async (_event, project: unknown, path: unknown, content: unknown) => {
    if (!isProjectEntry(project) || typeof path !== 'string' || typeof content !== 'string') {
      return { ok: false, error: 'Invalid request' }
    }
    return files.write(project, path, content)
  })

  ipcMain.handle(FILES_RENAME_CHANNEL, async (_event, project: unknown, path: unknown, newName: unknown) => {
    if (!isProjectEntry(project) || typeof path !== 'string' || typeof newName !== 'string') {
      return { ok: false, error: 'Invalid request' }
    }
    return files.rename(project, path, newName)
  })

  ipcMain.handle(FILES_DELETE_CHANNEL, async (_event, project: unknown, path: unknown) => {
    if (!isProjectEntry(project) || typeof path !== 'string') {
      return { ok: false, error: 'Invalid request' }
    }
    return files.delete(project, path)
  })

  ipcMain.handle(FILES_MKDIR_CHANNEL, async (_event, project: unknown, path: unknown) => {
    if (!isProjectEntry(project) || typeof path !== 'string') {
      return { ok: false, error: 'Invalid request' }
    }
    return files.mkdir(project, path)
  })

  ipcMain.handle(FILES_WATCH_CHANNEL, (_event, project: unknown, paths: unknown) => {
    if (!isProjectEntry(project) || !isPathList(paths)) return { ok: false, error: 'Invalid request' }
    files.setWatched(project, paths)
    return { ok: true, error: null }
  })

  ipcMain.handle(ATTACHMENTS_PUT_CHANNEL, async (_event, project: unknown, name: unknown, base64: unknown) => {
    if (!isProjectEntry(project) || typeof name !== 'string' || typeof base64 !== 'string') {
      return { ok: false, error: 'Invalid request', name: '', isImage: false, ref: '', dataUrl: '' }
    }
    return putAttachment(project, name, base64)
  })

  ipcMain.handle(ATTACHMENTS_CHOOSE_CHANNEL, async (_event, project: unknown) => {
    if (!isProjectEntry(project)) return { ok: false, error: 'Invalid project', name: '', isImage: false, ref: '', dataUrl: '' }
    return chooseAttachment(project)
  })

  ipcMain.handle(SOUNDS_READ_CHANNEL, (_event, path: unknown) => {
    return readSoundFile(typeof path === 'string' ? path : '')
  })

  ipcMain.handle(SOUNDS_CHOOSE_CHANNEL, () => chooseSoundFile())

  ipcMain.handle(TELEGRAM_SET_TOKEN_CHANNEL, (_event, token: unknown) => {
    if (typeof token !== 'string') return { ok: false, error: 'Invalid token' }
    notifications?.tokenStore.write(token)
    return { ok: true, error: null }
  })

  ipcMain.handle(TELEGRAM_TOKEN_STATUS_CHANNEL, () => ({ configured: (notifications?.tokenStore.read() ?? null) !== null }))

  ipcMain.handle(TELEGRAM_TEST_CHANNEL, async (_event, chatId: unknown, token: unknown) => {
    const id = typeof chatId === 'string' ? chatId : ''
    const key = typeof token === 'string' && token.trim().length > 0 ? token : (notifications?.tokenStore.read() ?? '')
    return { error: await sendTestTelegram(id, key) }
  })

  ipcMain.handle(TELEGRAM_TOGGLE_SESSION_CHANNEL, (_event, hostId: unknown, enabled: unknown) => {
    if (typeof hostId !== 'string' || typeof enabled !== 'boolean') return { ok: false, error: 'Invalid arguments' }
    const done = notifications?.bridge.setTelegramEnabledByHost(hostId, enabled) ?? false
    return done ? { ok: true, error: null } : { ok: false, error: 'Session not found' }
  })

  ipcMain.handle(REMOTE_SHARE_SESSION_CHANNEL, (_event, hostId: unknown, shared: unknown) => {
    if (typeof hostId !== 'string' || typeof shared !== 'boolean') return { ok: false, error: 'Invalid arguments' }
    const done = notifications?.bridge.setSharedByHost(hostId, shared) ?? false
    return done ? { ok: true, error: null } : { ok: false, error: 'Session not found' }
  })

  ipcMain.handle(REMOTE_STATUS_CHANNEL, () => notifications?.bridge.connectionInfo() ?? { running: false, port: 0, pin: '', lanAddresses: [] })

  ipcMain.handle(REMOTE_CHECK_PORT_CHANNEL, async (_event, port: unknown) => {
    const p = typeof port === 'number' && Number.isFinite(port) ? Math.round(port) : NaN
    if (p < 1 || p > 65535) return { busy: true }
    // Порт, который уже слушает собственный мост PiWright, для проверки НЕ занят (баг 7):
    // внешний конфликт исключён — сокет держим мы сами.
    const info = notifications?.bridge.connectionInfo()
    if (info !== undefined && info.running && info.port === p) return { busy: false }
    return { busy: await isPortBusy(p) }
  })

  ipcMain.handle(MODELS_LIST_CHANNEL, async (_event, backend: unknown) => {
    if (backend !== 'native' && backend !== 'wsl') {
      return { ok: false, error: 'Invalid request', file: '', exists: false, doc: null }
    }
    return listModels(backend, settings.get())
  })

  ipcMain.handle(MODELS_SAVE_CHANNEL, async (_event, backend: unknown, doc: unknown) => {
    if (backend !== 'native' && backend !== 'wsl') return { ok: false, error: 'Invalid request' }
    return saveModels(backend, settings.get(), doc)
  })

  ipcMain.handle(MODELS_REVEAL_CHANNEL, async (_event, backend: unknown) => {
    if (backend !== 'native' && backend !== 'wsl') return { ok: false, error: 'Invalid request' }
    return revealModelsFile(backend, settings.get())
  })

  ipcMain.handle(MCP_LIST_CHANNEL, async (_event, project: unknown, scope: unknown) => {
    if (!isProjectEntry(project) || (scope !== 'user' && scope !== 'project')) {
      return { ok: false, error: 'Invalid request', file: '', exists: false, servers: [] }
    }
    return listMcpServers(project, scope, settings.get())
  })

  ipcMain.handle(MCP_SAVE_CHANNEL, async (_event, project: unknown, scope: unknown, servers: unknown) => {
    if (!isProjectEntry(project) || (scope !== 'user' && scope !== 'project') || !Array.isArray(servers)) {
      return { ok: false, error: 'Invalid request' }
    }
    return saveMcpServers(project, scope, settings.get(), servers)
  })

  ipcMain.handle(MCP_PROBE_CHANNEL, async (_event, project: unknown, scope: unknown, name: unknown) => {
    if (!isProjectEntry(project) || (scope !== 'user' && scope !== 'project') || typeof name !== 'string') {
      return { ok: false, error: 'Invalid request', toolCount: 0, serverError: null }
    }
    return probeMcpServer(project, scope, settings.get(), name)
  })

  ipcMain.handle(MCP_REVEAL_CHANNEL, async (_event, project: unknown, scope: unknown) => {
    if (!isProjectEntry(project) || (scope !== 'user' && scope !== 'project')) return { ok: false, error: 'Invalid request' }
    return revealMcpFile(project, scope, settings.get())
  })

  ipcMain.handle(SKILLS_LIST_CHANNEL, async (_event, project: unknown) => {
    if (!isProjectEntry(project)) return { ok: false, error: 'Invalid project', skills: [] }
    return listSkills(project, settings.get())
  })

  ipcMain.handle(SKILLS_TOGGLE_CHANNEL, async (_event, project: unknown, path: unknown, enabled: unknown) => {
    if (!isProjectEntry(project) || typeof path !== 'string' || typeof enabled !== 'boolean') {
      return { ok: false, error: 'Invalid request' }
    }
    return toggleSkill(project, settings.get(), path, enabled)
  })

  ipcMain.handle(SKILLS_REVEAL_CHANNEL, async (_event, project: unknown, source: unknown) => {
    if (!isProjectEntry(project) || (source !== 'user' && source !== 'project')) return { ok: false, error: 'Invalid request' }
    return revealSkillsFolder(project, settings.get(), source)
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
