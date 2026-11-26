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
 FILES_SEARCH_CHANNEL,
  FILES_READ_CHANNEL,
  FILES_READ_IMAGE_CHANNEL,
  FILES_RENAME_CHANNEL,
  FILES_DELETE_CHANNEL,
  FILES_MKDIR_CHANNEL,
  FILES_WATCH_CHANNEL,
  FILES_REVEAL_CHANNEL,
  SHELL_OPEN_EXTERNAL_CHANNEL,
  FILES_WRITE_CHANNEL,
  GIT_BRANCHES_CHANNEL,
  GIT_BRANCH_DELETE_CHANNEL,
  GIT_CHERRY_PICK_CHANNEL,
  GIT_REVERT_CHANNEL,
  GIT_RESET_CHANNEL,
  GIT_TAG_CREATE_CHANNEL,
  GIT_DROP_COMMIT_CHANNEL,
  GIT_EDIT_MESSAGE_CHANNEL,
  GIT_SQUASH_INTO_CHANNEL,
  GIT_CONFLICT_STATE_CHANNEL,
  GIT_CONFLICT_RESOLVE_CHANNEL,
  GIT_CONFLICT_CONTINUE_CHANNEL,
  GIT_CONFLICT_ABORT_CHANNEL,
  GIT_REBASE_CHANNEL,
  GIT_CHECKOUT_REBASE_CHANNEL,
  GIT_BRANCH_RENAME_CHANNEL,
  GIT_CHECKOUT_CHANNEL,
  GIT_COMMIT_CHANNEL,
  GIT_FILE_DIFF_CHANNEL,
  GIT_GENERATE_MESSAGE_CHANNEL,
  GIT_LOG_CHANNEL,
  GIT_COMMIT_FILES_CHANNEL,
  GIT_COMMIT_FILE_DIFF_CHANNEL,
  GIT_PUSH_CHANNEL,
  GIT_PUSH_BRANCH_CHANNEL,
  GIT_PULL_BRANCH_CHANNEL,
  GIT_BRANCH_SYNC_CHANNEL,
  GIT_FETCH_CHANNEL,
  GIT_STAGE_CHANNEL,
  GIT_STATUS_CHANNEL,
  GIT_UNSTAGE_CHANNEL,
  KANBAN_BOARDS_CHANNEL,
  KANBAN_BOARD_CREATE_CHANNEL,
  KANBAN_BOARD_DELETE_CHANNEL,
  KANBAN_BOARD_GET_CHANNEL,
  KANBAN_BOARD_RENAME_CHANNEL,
  KANBAN_CARD_COMMENT_CHANNEL,
  KANBAN_CARD_CREATE_CHANNEL,
  KANBAN_CARD_DELETE_CHANNEL,
  KANBAN_CARD_MOVE_CHANNEL,
  KANBAN_CARD_UPDATE_CHANNEL,
  KANBAN_COMMENT_DELETE_CHANNEL,
  KANBAN_COMMENT_UPDATE_CHANNEL,
  KANBAN_COLUMN_CREATE_CHANNEL,
  KANBAN_COLUMN_CARDS_MOVE_CHANNEL,
  KANBAN_COLUMN_CLEAR_CHANNEL,
  KANBAN_COLUMN_DELETE_CHANNEL,
  KANBAN_COLUMN_MOVE_CHANNEL,
  KANBAN_COLUMN_RENAME_CHANNEL,
  KANBAN_ATTACHMENT_PUT_CHANNEL,
  KANBAN_ATTACHMENT_GET_CHANNEL,
  KANBAN_THEME_DELETE_CHANNEL,
  KANBAN_THEME_EXPORT_CHANNEL,
  KANBAN_THEME_IMPORT_CHANNEL,
  KANBAN_THEME_LIST_CHANNEL,
  KANBAN_WORKFLOW_SET_CHANNEL,
  MCP_LIST_CHANNEL,
  MCP_PROBE_CHANNEL,
  MCP_REVEAL_CHANNEL,
  MCP_SAVE_CHANNEL,
  MODELS_LIST_CHANNEL,
  MODELS_REVEAL_CHANNEL,
  MODELS_REFRESH_CHANNEL,
  MODELS_SAVE_CHANNEL,
  REMOTE_CHECK_PORT_CHANNEL,
  REMOTE_RETRY_CHANNEL,
  REMOTE_SHARE_SESSION_CHANNEL,
  REMOTE_STATUS_CHANNEL,
  SESSION_ABORT_CHANNEL,
  SESSION_QUEUE_CLEAR_CHANNEL,
  SESSION_QUEUE_REMOVE_CHANNEL,
  SESSION_QUEUE_TAKE_CHANNEL,
  SESSION_QUEUE_CONVERT_CHANNEL,
  SESSION_SCHEDULE_CHANNEL,
  SESSION_SCHEDULED_CANCEL_CHANNEL,
  SESSION_SCHEDULED_LIST_CHANNEL,
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
  SESSION_REWIND_CHANNEL,
  SESSION_FORK_CHANNEL,
  LOOP_START_CHANNEL,
  LOOP_STOP_CHANNEL,
  LOOP_SET_REMAINING_CHANNEL,
  LOOP_GET_CHANNEL,
  LOOPS_SNAPSHOT_CHANNEL,
  SESSION_RESPOND_DIALOG_CHANNEL,
  SESSION_SET_MODEL_CHANNEL,
  SESSION_COMMANDS_CHANNEL,
  SESSION_CONTEXT_BREAKDOWN_CHANNEL,
  SESSION_SET_THINKING_CHANNEL,
  APP_VERSION_CHANNEL,
  APP_CHANGELOG_CHANNEL,
  APP_UPDATE_INFO_CHANNEL,
  APP_UPDATE_STATUS_CHANNEL,
  APP_UPDATE_DOWNLOAD_CHANNEL,
  APP_UPDATE_DISMISS_CHANNEL,
  APP_UPDATE_DEV_EMIT_CHANNEL,
  SETTINGS_GET_CHANNEL,
  SETTINGS_SET_CHANNEL,
  SETTINGS_REVEAL_CHANNEL,
  SSH_FORGET_HOST_KEY_CHANNEL,
  SSH_LIST_DIR_CHANNEL,
  SSH_SECRET_STATUS_CHANNEL,
  SSH_SET_SECRET_CHANNEL,
  SSH_TEST_CHANNEL,
  STATS_QUERY_CHANNEL,
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
import type { BackendMode, ChangelogResult, GitLogFilter, KanbanCardCreateInput, KanbanCardMoveInput, KanbanCardUpdateInput, KanbanColumnCardsMoveInput, KanbanCommentInput, KanbanCommentUpdateInput, PanelPrefs, ProjectEntry, SchedulePromptInput, ScheduledTrigger, Settings, StatsQuery, TerminalProfileId, UpdateInfo, UpdateStatus } from '../../shared/ipc-contracts'
import { fetchChangelog } from '../changelog'
import { getUpdateStatus, downloadUpdate, dismissUpdate, emitDevUpdate } from '../updater'
import type { GitService } from '../git/git-service'
import type { FileService } from '../files/file-service'
import { resolveWithinRoot } from '../files/file-service'
import type { KanbanService } from '../kanban/kanban-service'
import type { KanbanThemeService } from '../kanban/kanban-theme-service'
import { KANBAN_DEFAULT_THEME_ID } from '../../shared/kanban-theme'
import type { TerminalService } from '../terminal/terminal-service'
import { profileAvailability } from '../terminal/profiles'
import type { PiHost } from '../pi/pi-host'
import type { LoopController } from '../pi/loop-controller'
import type { SessionHost } from '../pi/session-host'
import type { ScheduleService } from '../schedule/schedule-service'
import type { TokenStatsService } from '../stats/stats-service'
import type { SettingsService } from '../settings/settings'
import { CHAT_FONT_SIZE_MAX, CHAT_FONT_SIZE_MIN, mergeExpandedProjects, mergeLoops, mergeNotifications, mergeOpenSessionTabs, mergeSessionToggles, mergeSshServers, mergeTerminalTabs, SESSION_TOGGLES_MAX } from '../settings/settings'
import { mergeProjectTabs } from '../../shared/project-tabs'
import { mergePinnedBranches } from '../../shared/pinned-branches'
import { mergeKanbanCardAttention } from '../../shared/kanban'
import { chooseAttachment, putAttachment } from '../attachments/attachments'
import { getSshService } from '../ssh/ssh-service'
import { SshProjectFs } from '../fs/project-fs'
import type { SshSecretInput, SshSecretStatus, SshServerEntry, SshListDirResult, SshOpResult, SshTestResult } from '../../shared/ipc-contracts'
import { chooseSoundFile, readSoundFile } from '../sounds/sounds'
import { sendTestTelegram } from '../notifications/telegram'
import type { TelegramTokenStore } from '../notifications/token-store'
import type { RemoteBridge } from '../remote/bridge'
import { isPortBusy } from '../remote/server'
import { listMcpServers, probeMcpServer, revealMcpFile, saveMcpServers } from '../mcp/mcp-config'
import { listModels, revealModelsFile, saveModels } from '../models/models-service'
import { listSkills, revealSkillsFolder, toggleSkill } from '../skills/skills-service'
import { deleteSessionFile, listProjectHistory, projectBackendCwd, resolveSessionsRoot, sessionsFs, toBackendPath, checkSessionPath, readSessionHeader } from '../sessions/session-catalog'
import { readSessionTranscript } from '../sessions/transcript'
import { worktreeNameFromCwd } from '../../shared/worktree'
import { getDaemonClient } from '../daemon/client'
import { buildWslUncPath, stripWslUncPrefix } from '../pi/backends/shell'
import { listWslDistros, resolveWslHome } from '../pi/backends/wsl'
import type { SessionToggles } from '../../shared/ipc-contracts'

/** Запомнить тоггл сессии (settings.sessionToggles по файлу сессии) — восстановится при
 *  повторном открытии из истории. Оба тоггла false — запись удаляется. */
function persistSessionToggles(
  settings: SettingsService,
  piHost: PiHost,
  hostId: string,
  patch: Partial<SessionToggles>
): void {
  const host = piHost.get(hostId)
  const sessionFile = host?.sessionFilePath ?? null
  if (sessionFile === null) return
  const current = settings.get().sessionToggles
  const merged = { ...(current[sessionFile] ?? { telegram: false, shared: false }), ...patch }
  const next: Record<string, SessionToggles> = {}
  if (merged.telegram || merged.shared) next[sessionFile] = { telegram: merged.telegram, shared: merged.shared }
  for (const [key, value] of Object.entries(current)) {
    if (key === sessionFile) continue
    if (Object.keys(next).length >= SESSION_TOGGLES_MAX) break
    next[key] = value
  }
  settings.set({ sessionToggles: next })
}

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
  if (!(typeof entry['dir'] === 'string' && (entry['kind'] === 'native' || entry['kind'] === 'wsl' || entry['kind'] === 'ssh'))) return false
  if (entry['kind'] === 'ssh' && typeof entry['serverId'] !== 'string') return false
  return entry['name'] === undefined || typeof entry['name'] === 'string'
}

function isSshServerEntry(value: unknown): value is SshServerEntry {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const raw = value as Record<string, unknown>
  if (typeof raw['id'] !== 'string' || typeof raw['host'] !== 'string' || typeof raw['user'] !== 'string') return false
  if (raw['host'].length === 0 || raw['user'].length === 0) return false
  if (typeof raw['port'] !== 'number' || !Number.isFinite(raw['port'])) return false
  if (raw['auth'] !== 'password' && raw['auth'] !== 'key' && raw['auth'] !== 'agent') return false
  if (raw['name'] !== undefined && typeof raw['name'] !== 'string') return false
  if (raw['keyPath'] !== undefined && typeof raw['keyPath'] !== 'string') return false
  return true
}

function isSshSecretInput(value: unknown): value is SshSecretInput {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const raw = value as Record<string, unknown>
  return (raw['password'] === undefined || typeof raw['password'] === 'string') &&
    (raw['keyPassphrase'] === undefined || typeof raw['keyPassphrase'] === 'string')
}

function host(piHost: PiHost, hostId: unknown): SessionHost | null {
  if (typeof hostId !== 'string') return null
  return piHost.get(hostId)
}

function isPathList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((p) => typeof p === 'string' && p.length > 0)
}

function parseLogFilter(value: unknown): GitLogFilter | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const filter: GitLogFilter = {}
  if (typeof raw['query'] === 'string' && raw['query'].length > 0) filter.query = raw['query']
  if (typeof raw['branch'] === 'string' && raw['branch'].length > 0) filter.branch = raw['branch']
  if (raw['all'] === true) filter.all = true
  return Object.keys(filter).length > 0 ? filter : undefined
}

function isProfileId(value: unknown): value is TerminalProfileId {
  return value === 'powershell' || value === 'cmd' || value === 'gitbash' || value === 'wsl'
}

function parseScheduleInput(value: unknown): SchedulePromptInput | null {
  if (value === null || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v['targetHostId'] !== 'string' || v['targetHostId'].length === 0) return null
  if (typeof v['text'] !== 'string' || v['text'].trim().length === 0) return null
  const rawTrigger = v['trigger']
  if (rawTrigger === null || typeof rawTrigger !== 'object') return null
  const t = rawTrigger as Record<string, unknown>
  let trigger: ScheduledTrigger
  if (t['kind'] === 'after') {
    if (typeof t['sourceHostId'] !== 'string' || t['sourceHostId'].length === 0) return null
    trigger = {
      kind: 'after',
      sourceHostId: t['sourceHostId'],
      sourceTitle: typeof t['sourceTitle'] === 'string' ? t['sourceTitle'] : 'Session'
    }
  } else if (t['kind'] === 'at') {
    if (typeof t['atEpochMs'] !== 'number' || !Number.isFinite(t['atEpochMs'])) return null
    trigger = { kind: 'at', atEpochMs: t['atEpochMs'] }
  } else {
    return null
  }
  let loop: { maxIterations: number; exitCondition: string } | null = null
  const rawLoop = v['loop']
  if (rawLoop !== null && rawLoop !== undefined) {
    if (typeof rawLoop !== 'object' || Array.isArray(rawLoop)) return null
    const l = rawLoop as Record<string, unknown>
    if (typeof l['maxIterations'] !== 'number' || !Number.isInteger(l['maxIterations']) || l['maxIterations'] < 1 || l['maxIterations'] > 999) return null
    if (typeof l['exitCondition'] !== 'string') return null
    loop = { maxIterations: l['maxIterations'], exitCondition: l['exitCondition'] }
  }
  return {
    targetHostId: v['targetHostId'],
    text: v['text'],
    images: isPathList(v['images']) ? v['images'] : [],
    model: typeof v['model'] === 'string' ? v['model'] : null,
    thinkingLevel: typeof v['thinkingLevel'] === 'string' ? v['thinkingLevel'] : null,
    trigger,
    loop
  }
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
  kanban: KanbanService,
  kanbanThemes: KanbanThemeService,
  notifications?: NotificationServices,
  scheduled?: ScheduleService,
  stats?: TokenStatsService,
  updateInfo: UpdateInfo = { updatedFrom: null }
): void {
  ipcMain.handle(SETTINGS_GET_CHANNEL, () => settings.get())

  ipcMain.handle(STATS_QUERY_CHANNEL, (_event, query: unknown) => {
    const q = query as Partial<StatsQuery> | null
    const kind = q?.kind === 'day' || q?.kind === 'month' || q?.kind === 'year' || q?.kind === 'custom' ? q.kind : 'day'
    const month = typeof q?.month === 'number' && q.month >= 1 && q.month <= 12 ? Math.floor(q.month) : undefined
    const year = typeof q?.year === 'number' && q.year >= 1970 && q.year <= 2999 ? Math.floor(q.year) : undefined
    const project = typeof q?.project === 'string' && q.project.length > 0 ? q.project : null
    const model = typeof q?.model === 'string' && q.model.length > 0 ? q.model : null
    return stats
      ? stats.ensureScanned().then(() => stats.query({ kind, month, year, project, model }))
      : Promise.resolve({ granularity: 'day' as const, points: [], projects: [], models: [], updatedAt: Date.now() })
  })

  ipcMain.handle(SETTINGS_REVEAL_CHANNEL, () => {
    shell.showItemInFolder(settings.path)
    return { ok: true, error: null }
  })

  ipcMain.handle(APP_VERSION_CHANNEL, () => app.getVersion())

  ipcMain.handle(APP_CHANGELOG_CHANNEL, async (): Promise<ChangelogResult> =>
    fetchChangelog(settings.get().updateUrl, app.getPath('userData'))
  )

  ipcMain.handle(APP_UPDATE_INFO_CHANNEL, (): UpdateInfo => updateInfo)

  ipcMain.handle(APP_UPDATE_STATUS_CHANNEL, (): UpdateStatus => getUpdateStatus())

  ipcMain.handle(APP_UPDATE_DOWNLOAD_CHANNEL, (): UpdateStatus => downloadUpdate())

  ipcMain.handle(APP_UPDATE_DISMISS_CHANNEL, (): UpdateStatus => dismissUpdate(settings))

  // Только dev (smoke): эмуляция найденного обновления; в упакованном приложении emitDevUpdate — no-op
  ipcMain.handle(APP_UPDATE_DEV_EMIT_CHANNEL, (_event, version: unknown): UpdateStatus =>
    emitDevUpdate(typeof version === 'string' && version.length > 0 ? version : null, settings)
  )

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
      if (typeof raw['sendOnEnter'] === 'boolean') {
        safe.sendOnEnter = raw['sendOnEnter']
      }
      if (typeof raw['loopsEnabled'] === 'boolean') {
        safe.loopsEnabled = raw['loopsEnabled']
      }
      if (typeof raw['loopCloseSession'] === 'boolean') {
        safe.loopCloseSession = raw['loopCloseSession']
      }
      if (typeof raw['kanbanEnabled'] === 'boolean') {
        safe.kanbanEnabled = raw['kanbanEnabled']
      }
      if (typeof raw['kanbanTheme'] === 'string' && raw['kanbanTheme'].trim().length > 0) {
        safe.kanbanTheme = raw['kanbanTheme'].trim().slice(0, 32)
      }
      if (raw['language'] === 'en' || raw['language'] === 'ru') {
        safe.language = raw['language']
      }
      if (raw['panels'] !== null && typeof raw['panels'] === 'object' && !Array.isArray(raw['panels'])) {
        const src = raw['panels'] as Record<string, unknown>
        const panels: Settings['panels'] = {}
        for (const name of ['git', 'files', 'terminal', 'kanban', 'gitlog', 'sessions'] as const) {
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
      if (typeof raw['piPathSsh'] === 'string') {
        safe.piPathSsh = raw['piPathSsh']
      }
      if (raw['sshServers'] !== undefined) {
        safe.sshServers = mergeSshServers(raw['sshServers'])
      }
      if (raw['notifications'] !== null && typeof raw['notifications'] === 'object' && !Array.isArray(raw['notifications'])) {
        safe.notifications = mergeNotifications(raw['notifications'])
      }
      if (raw['expandedProjects'] !== null && typeof raw['expandedProjects'] === 'object' && !Array.isArray(raw['expandedProjects'])) {
        safe.expandedProjects = mergeExpandedProjects(raw['expandedProjects'])
      }
      if (raw['kanbanBoardsExpanded'] !== null && typeof raw['kanbanBoardsExpanded'] === 'object' && !Array.isArray(raw['kanbanBoardsExpanded'])) {
        safe.kanbanBoardsExpanded = mergeExpandedProjects(raw['kanbanBoardsExpanded'])
      }
      if (raw['kanbanColumnsCollapsed'] !== null && typeof raw['kanbanColumnsCollapsed'] === 'object' && !Array.isArray(raw['kanbanColumnsCollapsed'])) {
        safe.kanbanColumnsCollapsed = mergeExpandedProjects(raw['kanbanColumnsCollapsed'])
      }
      if (raw['kanbanCardAttention'] !== null && typeof raw['kanbanCardAttention'] === 'object' && !Array.isArray(raw['kanbanCardAttention'])) {
        safe.kanbanCardAttention = mergeKanbanCardAttention(raw['kanbanCardAttention'])
      }
      if (raw['terminalTabs'] !== null && typeof raw['terminalTabs'] === 'object' && !Array.isArray(raw['terminalTabs'])) {
        safe.terminalTabs = mergeTerminalTabs(raw['terminalTabs'])
      }
      if (raw['projectTabs'] !== null && typeof raw['projectTabs'] === 'object' && !Array.isArray(raw['projectTabs'])) {
        safe.projectTabs = mergeProjectTabs(raw['projectTabs'])
      }
      if (raw['openSessionTabs'] !== undefined) {
        safe.openSessionTabs = mergeOpenSessionTabs(raw['openSessionTabs'])
      }
      if (raw['sessionToggles'] !== undefined) {
        safe.sessionToggles = mergeSessionToggles(raw['sessionToggles'])
      }
      if (raw['loops'] !== undefined) {
        safe.loops = mergeLoops(raw['loops'])
      }
      if (raw['pinnedBranches'] !== null && typeof raw['pinnedBranches'] === 'object' && !Array.isArray(raw['pinnedBranches'])) {
        safe.pinnedBranches = mergePinnedBranches(raw['pinnedBranches'])
      }
      if (typeof raw['lastProjectKey'] === 'string' || raw['lastProjectKey'] === null) {
        safe.lastProjectKey = raw['lastProjectKey'] as string | null
      }
    }
    const next = settings.set(safe)
    if (!next.loopsEnabled) loops.stopAll()
    notifications?.onSettingsChanged(next)
    // Секреты удалённых SSH-серверов чистим (id больше нет в списке).
    try {
      const ssh = getSshService()
      const known = new Set(next.sshServers.map((s) => s.id))
      for (const id of ssh.removedServerIds(known)) ssh.deleteSecret(id)
    } catch {
      // ssh-сервис мог не инициализироваться
    }
    return next
  })

  ipcMain.handle(SSH_TEST_CHANNEL, async (_event, server: unknown, secret: unknown): Promise<SshTestResult> => {
    if (!isSshServerEntry(server)) return { ok: false, error: 'Invalid server', fingerprint: null, home: null, piPath: null }
    if (!isSshSecretInput(secret)) secret = null
    try {
      return await getSshService().test(server, secret as SshSecretInput | null)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), fingerprint: null, home: null, piPath: null }
    }
  })

  ipcMain.handle(SSH_LIST_DIR_CHANNEL, async (_event, server: unknown, path: unknown, secret: unknown): Promise<SshListDirResult> => {
    if (!isSshServerEntry(server) || typeof path !== 'string') return { ok: false, error: 'Invalid request', path: '', entries: [] }
    if (!isSshSecretInput(secret)) secret = null
    try {
      const ssh = getSshService()
      const pfs = new SshProjectFs(() => ssh.sftp(server, secret as SshSecretInput | null))
      const entries = await pfs.readdir(path)
      const sorted = entries
        .map((item) => ({ name: item.name, isDir: item.isDir }))
        .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
      return { ok: true, error: null, path, entries: sorted }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), path, entries: [] }
    }
  })

  ipcMain.handle(SSH_SECRET_STATUS_CHANNEL, (_event, serverId: unknown): SshSecretStatus => {
    if (typeof serverId !== 'string' || serverId.length === 0) return { hasPassword: false, hasKeyPassphrase: false }
    try {
      const ssh = getSshService()
      return { hasPassword: ssh.hasPassword(serverId), hasKeyPassphrase: ssh.hasKeyPassphrase(serverId) }
    } catch {
      return { hasPassword: false, hasKeyPassphrase: false }
    }
  })

  ipcMain.handle(SSH_SET_SECRET_CHANNEL, async (_event, serverId: unknown, patch: unknown): Promise<SshOpResult> => {
    if (typeof serverId !== 'string' || serverId.length === 0 || patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
      return { ok: false, error: 'Invalid request' }
    }
    try {
      const raw = patch as Record<string, unknown>
      const clean: { password?: string | null; keyPassphrase?: string | null } = {}
      if (raw['password'] === null || typeof raw['password'] === 'string') clean.password = raw['password'] as string | null
      if (raw['keyPassphrase'] === null || typeof raw['keyPassphrase'] === 'string') clean.keyPassphrase = raw['keyPassphrase'] as string | null
      getSshService().setSecret(serverId, clean)
      return { ok: true, error: null }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(SSH_FORGET_HOST_KEY_CHANNEL, (_event, server: unknown): SshOpResult => {
    if (!isSshServerEntry(server)) return { ok: false, error: 'Invalid server' }
    try {
      getSshService().forgetHostKey(server)
      return { ok: true, error: null }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(SESSIONS_LIST_CHANNEL, () => {
    // Восстановленные вкладки поднимаем при первом списке — окно уже готово получать реплей транскрипта.
    piHost.ensureAllStarted()
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
    const pfs = sessionsFs(project, current)
    const checked = checkSessionPath(pfs, root, cwd, sessionFile)
    if ('error' in checked) return { ok: false, error: checked.error, hostId: null }
    const backendPath = await toBackendPath(project, current, sessionFile)
    // Сессия worktree: пересоздать worktree по имени из cwd заголовка (порт openSessionTab jb-pi).
    let hostProject = project
    const header = await readSessionHeader(pfs, checked.path)
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

  ipcMain.handle(WORKTREE_REMOVE_CHANNEL, async (_event, project: unknown, name: unknown, force: unknown, closeHostIds: unknown) => {
    if (!isProjectEntry(project) || typeof name !== 'string' || typeof force !== 'boolean') {
      return { ok: false, error: 'Invalid request', uncommitted: false }
    }
    // Запущенная сессия держит cwd внутри worktree — процесс блокирует каталог, git снимает его.
    if (Array.isArray(closeHostIds)) {
      for (const id of closeHostIds) {
        if (typeof id !== 'string') continue
        loops.forget(id)
        await piHost.closeAndWait(id)
      }
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
    const pfs = sessionsFs(project, current)
    const checked = checkSessionPath(pfs, root, cwd, sessionPath)
    if ('error' in checked) return { ok: false, error: checked.error, events: [] }
    try {
      return { ok: true, error: null, events: await readSessionTranscript(pfs, checked.path) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), events: [] }
    }
  })

  ipcMain.handle(SESSIONS_CLOSE_CHANNEL, (_event, hostId: unknown, keepAlive: unknown) => {
    if (typeof hostId === 'string') {
      // keepAlive — крестик вкладки: активную петлю не выбрасываем, а отвязываем — она
      // вернётся при переоткрытии вкладки (или после рестарта — из настроек).
      if (keepAlive === true) loops.detach(hostId)
      else loops.forget(hostId)
      scheduled?.forgetHost(hostId)
    }
    // keepAlive=true — крестик вкладки: отключиться, ребёнок демона живёт. Иначе — остановить процесс.
    piHost.close(typeof hostId === 'string' ? hostId : '', { keepAlive: keepAlive === true })
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
    return deleteSessionFile(sessionsFs(project, current), root, cwd, sessionPath)
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

  ipcMain.handle(SESSION_REWIND_CHANNEL, async (_event, hostId: unknown, text: unknown, occurrence: unknown) => {
    const h = host(piHost, hostId)
    if (h === null) return { ok: false, error: 'Session not found', codeRestored: null }
    if (typeof text !== 'string' || text.trim().length === 0) {
      return { ok: false, error: 'Message is empty', codeRestored: null }
    }
    if (typeof occurrence !== 'number' || !Number.isInteger(occurrence) || occurrence < 0) {
      return { ok: false, error: 'Invalid prompt occurrence', codeRestored: null }
    }
    return h.rewind(text, occurrence)
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
    if (typeof exitCondition !== 'string') {
      return { ok: false, error: 'Invalid loop request' }
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

  ipcMain.handle(LOOPS_SNAPSHOT_CHANNEL, () => loops.snapshot())

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

  ipcMain.handle(SESSION_QUEUE_TAKE_CHANNEL, (_event, hostId: unknown, kind: unknown, index: unknown) => {
    const h = host(piHost, hostId)
    if (h === null) return { ok: false, error: 'Session not found' }
    if (kind !== 'steering' && kind !== 'followUp') return { ok: false, error: 'Unknown queue kind' }
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
      return { ok: false, error: 'Invalid queue index' }
    }
    return h.queueTake(kind, index)
  })

  ipcMain.handle(SESSION_QUEUE_CONVERT_CHANNEL, (_event, hostId: unknown, kind: unknown, index: unknown, toKind: unknown) => {
    const h = host(piHost, hostId)
    if (h === null) return { ok: false, error: 'Session not found' }
    if ((kind !== 'steering' && kind !== 'followUp') || (toKind !== 'steering' && toKind !== 'followUp')) {
      return { ok: false, error: 'Unknown queue kind' }
    }
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
      return { ok: false, error: 'Invalid queue index' }
    }
    return h.queueConvert(kind, index, toKind)
  })

  ipcMain.handle(SESSION_SCHEDULE_CHANNEL, (_event, input: unknown) => {
    if (scheduled === undefined) return { ok: false, error: 'Scheduler is not available' }
    const parsed = parseScheduleInput(input)
    if (parsed === null) return { ok: false, error: 'Invalid schedule request' }
    return scheduled.schedule(parsed)
  })

  ipcMain.handle(SESSION_SCHEDULED_LIST_CHANNEL, () =>
    scheduled === undefined
      ? { ok: false, error: 'Scheduler is not available', items: [] }
      : { ok: true, error: null, items: scheduled.list() }
  )

  ipcMain.handle(SESSION_SCHEDULED_CANCEL_CHANNEL, (_event, id: unknown) => {
    if (scheduled === undefined) return { ok: false, error: 'Scheduler is not available' }
    if (typeof id !== 'string' || id.length === 0) return { ok: false, error: 'Invalid schedule request' }
    return scheduled.cancel(id)
  })

  ipcMain.handle(SESSION_COMMANDS_CHANNEL, (_event, hostId: unknown) => {
    const h = host(piHost, hostId)
    if (h === null) return { ok: false, error: 'Session not found', commands: [] }
    return h.commands().then((commands) => ({ ok: true, error: null, commands }))
  })

  ipcMain.handle(SESSION_CONTEXT_BREAKDOWN_CHANNEL, async (_event, hostId: unknown) => {
    const h = host(piHost, hostId)
    if (h === null) return { ok: false, error: 'Session not found', breakdown: null }
    return h.contextBreakdown()
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

  ipcMain.handle(GIT_PUSH_BRANCH_CHANNEL, async (_event, project: unknown, branch: unknown, forceWithLease: unknown) => {
    if (!isProjectEntry(project) || typeof branch !== 'string' || typeof forceWithLease !== 'boolean') {
      return { ok: false, error: 'Invalid request' }
    }
    return git.pushBranch(project, branch, forceWithLease)
  })

  ipcMain.handle(GIT_PULL_BRANCH_CHANNEL, async (_event, project: unknown, branch: unknown, mode: unknown) => {
    if (!isProjectEntry(project) || typeof branch !== 'string' || (mode !== 'rebase' && mode !== 'merge' && mode !== 'ff')) {
      return { ok: false, error: 'Invalid request' }
    }
    return git.pullBranch(project, branch, mode)
  })

  ipcMain.handle(GIT_BRANCH_SYNC_CHANNEL, async (_event, project: unknown) => {
    if (!isProjectEntry(project)) return { ok: false, error: 'Invalid project', branches: [] }
    return git.branchSync(project)
  })

  ipcMain.handle(GIT_FETCH_CHANNEL, async (_event, project: unknown) => {
    if (!isProjectEntry(project)) return { ok: false, error: 'Invalid project' }
    return git.fetch(project)
  })

  ipcMain.handle(GIT_LOG_CHANNEL, async (_event, project: unknown, page: unknown, filter: unknown) => {
    if (!isProjectEntry(project)) return { ok: false, error: 'Invalid project', entries: [], hasMore: false }
    const parsed = parseLogFilter(filter)
    return git.log(project, typeof page === 'number' && Number.isInteger(page) && page >= 0 ? page : 0, parsed)
  })

  ipcMain.handle(GIT_COMMIT_FILES_CHANNEL, async (_event, project: unknown, hash: unknown) => {
    if (!isProjectEntry(project) || typeof hash !== 'string' || hash.length === 0) {
      return { ok: false, error: 'Invalid request', files: [] }
    }
    return git.commitFiles(project, hash)
  })

  ipcMain.handle(GIT_COMMIT_FILE_DIFF_CHANNEL, async (_event, project: unknown, hash: unknown, path: unknown) => {
    if (!isProjectEntry(project) || typeof hash !== 'string' || typeof path !== 'string' || path.length === 0) {
      return { ok: false, error: 'Invalid request', original: '', modified: '' }
    }
    return git.commitFileDiff(project, hash, path)
  })

  ipcMain.handle(GIT_GENERATE_MESSAGE_CHANNEL, async (_event, project: unknown) => {
    if (!isProjectEntry(project)) return { ok: false, error: 'Invalid project', message: '' }
    return git.generateCommitMessage(project)
  })

  ipcMain.handle(GIT_BRANCHES_CHANNEL, async (_event, project: unknown, all: unknown) => {
    if (!isProjectEntry(project)) return { ok: false, error: 'Invalid project', branches: [] }
    return git.branches(project, all === true)
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

  ipcMain.handle(GIT_CHERRY_PICK_CHANNEL, async (_event, project: unknown, hash: unknown) => {
    if (!isProjectEntry(project) || typeof hash !== 'string') return { ok: false, error: 'Invalid request' }
    return git.cherryPick(project, hash)
  })

  ipcMain.handle(GIT_REVERT_CHANNEL, async (_event, project: unknown, hash: unknown) => {
    if (!isProjectEntry(project) || typeof hash !== 'string') return { ok: false, error: 'Invalid request' }
    return git.revertCommit(project, hash)
  })

  ipcMain.handle(GIT_RESET_CHANNEL, async (_event, project: unknown, hash: unknown, mode: unknown) => {
    if (!isProjectEntry(project) || typeof hash !== 'string') return { ok: false, error: 'Invalid request' }
    if (mode !== 'soft' && mode !== 'mixed' && mode !== 'hard') return { ok: false, error: 'Invalid request' }
    return git.resetBranch(project, hash, mode)
  })

  ipcMain.handle(GIT_TAG_CREATE_CHANNEL, async (_event, project: unknown, name: unknown, hash: unknown) => {
    if (!isProjectEntry(project) || typeof name !== 'string' || typeof hash !== 'string') {
      return { ok: false, error: 'Invalid request' }
    }
    return git.tagCreate(project, name, hash)
  })

  ipcMain.handle(GIT_DROP_COMMIT_CHANNEL, async (_event, project: unknown, hash: unknown) => {
    if (!isProjectEntry(project) || typeof hash !== 'string') return { ok: false, error: 'Invalid request' }
    return git.dropCommit(project, hash)
  })

  ipcMain.handle(GIT_EDIT_MESSAGE_CHANNEL, async (_event, project: unknown, hash: unknown, message: unknown) => {
    if (!isProjectEntry(project) || typeof hash !== 'string' || typeof message !== 'string') {
      return { ok: false, error: 'Invalid request' }
    }
    return git.editCommitMessage(project, hash, message)
  })

  ipcMain.handle(GIT_SQUASH_INTO_CHANNEL, async (_event, project: unknown, hash: unknown, message: unknown) => {
    if (!isProjectEntry(project) || typeof hash !== 'string' || typeof message !== 'string') {
      return { ok: false, error: 'Invalid request' }
    }
    return git.squashInto(project, hash, message)
  })

  ipcMain.handle(GIT_CONFLICT_STATE_CHANNEL, async (_event, project: unknown) => {
    if (!isProjectEntry(project)) return { ok: false, error: 'Invalid project', state: 'none', repoRoot: null }
    return git.conflictState(project)
  })

  ipcMain.handle(GIT_CONFLICT_RESOLVE_CHANNEL, async (_event, project: unknown, path: unknown, side: unknown) => {
    if (!isProjectEntry(project) || typeof path !== 'string' || path.length === 0 || (side !== 'ours' && side !== 'theirs')) {
      return { ok: false, error: 'Invalid request' }
    }
    return git.conflictResolve(project, path, side)
  })

  ipcMain.handle(GIT_CONFLICT_CONTINUE_CHANNEL, async (_event, project: unknown) => {
    if (!isProjectEntry(project)) return { ok: false, error: 'Invalid project' }
    return git.conflictContinue(project)
  })

  ipcMain.handle(GIT_CONFLICT_ABORT_CHANNEL, async (_event, project: unknown) => {
    if (!isProjectEntry(project)) return { ok: false, error: 'Invalid project' }
    return git.conflictAbort(project)
  })

  ipcMain.handle(GIT_REBASE_CHANNEL, async (_event, project: unknown, onto: unknown) => {
    if (!isProjectEntry(project) || typeof onto !== 'string') return { ok: false, error: 'Invalid request' }
    return git.rebaseBranch(project, onto)
  })

  ipcMain.handle(GIT_CHECKOUT_REBASE_CHANNEL, async (_event, project: unknown, branch: unknown, onto: unknown) => {
    if (!isProjectEntry(project) || typeof branch !== 'string' || typeof onto !== 'string') {
      return { ok: false, error: 'Invalid request' }
    }
    return git.checkoutAndRebase(project, branch, onto)
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

  ipcMain.handle(FILES_SEARCH_CHANNEL, async (_event, project: unknown) => {
   if (!isProjectEntry(project)) return { ok: false, error: 'Invalid request', files: [] }
   return files.searchFiles(project)
 })

 ipcMain.handle(FILES_WATCH_CHANNEL, (_event, project: unknown, paths: unknown) => {
    if (!isProjectEntry(project) || !isPathList(paths)) return { ok: false, error: 'Invalid request' }
    files.setWatched(project, paths)
    return { ok: true, error: null }
  })

  ipcMain.handle(FILES_REVEAL_CHANNEL, async (_event, project: unknown, path: unknown) => {
    if (!isProjectEntry(project) || typeof path !== 'string') {
      return { ok: false, error: 'Invalid request' }
    }
    if (project.kind === 'ssh') return { ok: false, error: 'Not available for SSH projects' }
    const abs = resolveWithinRoot(project.dir, path)
    if (abs === null) return { ok: false, error: 'Path is outside the project' }
    let target = abs
    if (project.kind === 'wsl' && stripWslUncPrefix(target) !== null) {
      const distro = settings.get().wslDistro.trim() || (await listWslDistros())[0]
      if (distro === undefined) return { ok: false, error: 'WSL distro not found' }
      target = buildWslUncPath(distro, stripWslUncPrefix(target)!)
    }
    shell.showItemInFolder(target)
    return { ok: true, error: null }
  })

  ipcMain.handle(SHELL_OPEN_EXTERNAL_CHANNEL, async (_event, url: unknown) => {
    if (typeof url !== 'string' || !/^(https?:\/\/|mailto:)/i.test(url.trim())) {
      return { ok: false, error: 'Invalid url' }
    }
    try {
      await shell.openExternal(url.trim())
      return { ok: true, error: null }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(ATTACHMENTS_PUT_CHANNEL, async (_event, project: unknown, name: unknown, base64: unknown) => {
    if (!isProjectEntry(project) || typeof name !== 'string' || typeof base64 !== 'string') {
      return { ok: false, error: 'Invalid request', name: '', isImage: false, ref: '', dataUrl: '' }
    }
    return putAttachment(project, settings.get(), name, base64)
  })

  ipcMain.handle(ATTACHMENTS_CHOOSE_CHANNEL, async (_event, project: unknown) => {
    if (!isProjectEntry(project)) return { ok: false, error: 'Invalid project', name: '', isImage: false, ref: '', dataUrl: '' }
    return chooseAttachment(project, settings.get())
  })

  ipcMain.handle(KANBAN_BOARDS_CHANNEL, async (_event, project: unknown) => {
    if (!isProjectEntry(project)) return { ok: false, error: 'Invalid project', boards: [] }
    return kanban.listBoards(project)
  })

  ipcMain.handle(KANBAN_BOARD_GET_CHANNEL, async (_event, project: unknown, boardId: unknown) => {
    if (!isProjectEntry(project) || typeof boardId !== 'string') return { ok: false, error: 'Invalid request', board: null }
    return kanban.getBoard(project, boardId)
  })

  ipcMain.handle(KANBAN_BOARD_CREATE_CHANNEL, async (_event, project: unknown, name: unknown) => {
    if (!isProjectEntry(project) || typeof name !== 'string') return { ok: false, error: 'Invalid request', board: null }
    return kanban.createBoard(project, name)
  })

  ipcMain.handle(KANBAN_BOARD_RENAME_CHANNEL, async (_event, project: unknown, boardId: unknown, name: unknown) => {
    if (!isProjectEntry(project) || typeof boardId !== 'string' || typeof name !== 'string') {
      return { ok: false, error: 'Invalid request', board: null }
    }
    return kanban.renameBoard(project, boardId, name)
  })

  ipcMain.handle(KANBAN_BOARD_DELETE_CHANNEL, async (_event, project: unknown, boardId: unknown) => {
    if (!isProjectEntry(project) || typeof boardId !== 'string') return { ok: false, error: 'Invalid request' }
    return kanban.deleteBoard(project, boardId)
  })

  ipcMain.handle(KANBAN_CARD_CREATE_CHANNEL, async (_event, project: unknown, boardId: unknown, input: unknown) => {
    if (!isProjectEntry(project) || typeof boardId !== 'string' || input === null || typeof input !== 'object' || Array.isArray(input)) {
      return { ok: false, error: 'Invalid request', board: null }
    }
    return kanban.cardCreate(project, boardId, input as KanbanCardCreateInput)
  })

  ipcMain.handle(KANBAN_CARD_UPDATE_CHANNEL, async (_event, project: unknown, boardId: unknown, input: unknown) => {
    if (!isProjectEntry(project) || typeof boardId !== 'string' || input === null || typeof input !== 'object' || Array.isArray(input)) {
      return { ok: false, error: 'Invalid request', board: null }
    }
    return kanban.cardUpdate(project, boardId, input as KanbanCardUpdateInput)
  })

  ipcMain.handle(KANBAN_CARD_DELETE_CHANNEL, async (_event, project: unknown, boardId: unknown, cardId: unknown) => {
    if (!isProjectEntry(project) || typeof boardId !== 'string' || typeof cardId !== 'string') {
      return { ok: false, error: 'Invalid request', board: null }
    }
    return kanban.cardDelete(project, boardId, cardId)
  })

  ipcMain.handle(KANBAN_CARD_MOVE_CHANNEL, async (_event, project: unknown, boardId: unknown, input: unknown) => {
    if (!isProjectEntry(project) || typeof boardId !== 'string' || input === null || typeof input !== 'object' || Array.isArray(input)) {
      return { ok: false, error: 'Invalid request', board: null }
    }
    return kanban.cardMove(project, boardId, input as KanbanCardMoveInput)
  })

  ipcMain.handle(KANBAN_CARD_COMMENT_CHANNEL, async (_event, project: unknown, boardId: unknown, input: unknown) => {
    if (!isProjectEntry(project) || typeof boardId !== 'string' || input === null || typeof input !== 'object' || Array.isArray(input)) {
      return { ok: false, error: 'Invalid request', board: null }
    }
    return kanban.cardComment(project, boardId, input as KanbanCommentInput)
  })

  ipcMain.handle(KANBAN_COMMENT_UPDATE_CHANNEL, async (_event, project: unknown, boardId: unknown, input: unknown) => {
    if (!isProjectEntry(project) || typeof boardId !== 'string' || input === null || typeof input !== 'object' || Array.isArray(input)) {
      return { ok: false, error: 'Invalid request', board: null }
    }
    return kanban.commentUpdate(project, boardId, input as KanbanCommentUpdateInput)
  })

  ipcMain.handle(
    KANBAN_COMMENT_DELETE_CHANNEL,
    async (_event, project: unknown, boardId: unknown, cardId: unknown, commentId: unknown) => {
      if (!isProjectEntry(project) || typeof boardId !== 'string' || typeof cardId !== 'string' || typeof commentId !== 'string') {
        return { ok: false, error: 'Invalid request', board: null }
      }
      return kanban.commentDelete(project, boardId, cardId, commentId)
    }
  )

  ipcMain.handle(KANBAN_COLUMN_CREATE_CHANNEL, async (_event, project: unknown, boardId: unknown, name: unknown) => {
    if (!isProjectEntry(project) || typeof boardId !== 'string' || typeof name !== 'string') {
      return { ok: false, error: 'Invalid request', board: null }
    }
    return kanban.columnCreate(project, boardId, name)
  })

  ipcMain.handle(KANBAN_COLUMN_RENAME_CHANNEL, async (_event, project: unknown, boardId: unknown, columnId: unknown, name: unknown) => {
    if (!isProjectEntry(project) || typeof boardId !== 'string' || typeof columnId !== 'string' || typeof name !== 'string') {
      return { ok: false, error: 'Invalid request', board: null }
    }
    return kanban.columnRename(project, boardId, columnId, name)
  })

  ipcMain.handle(KANBAN_COLUMN_DELETE_CHANNEL, async (_event, project: unknown, boardId: unknown, columnId: unknown) => {
    if (!isProjectEntry(project) || typeof boardId !== 'string' || typeof columnId !== 'string') {
      return { ok: false, error: 'Invalid request', board: null }
    }
    return kanban.columnDelete(project, boardId, columnId)
  })

  ipcMain.handle(KANBAN_COLUMN_MOVE_CHANNEL, async (_event, project: unknown, boardId: unknown, columnId: unknown, index: unknown) => {
    if (!isProjectEntry(project) || typeof boardId !== 'string' || typeof columnId !== 'string' || typeof index !== 'number') {
      return { ok: false, error: 'Invalid request', board: null }
    }
    return kanban.columnMove(project, boardId, columnId, index)
  })

  ipcMain.handle(KANBAN_COLUMN_CLEAR_CHANNEL, async (_event, project: unknown, boardId: unknown, columnId: unknown) => {
    if (!isProjectEntry(project) || typeof boardId !== 'string' || typeof columnId !== 'string') {
      return { ok: false, error: 'Invalid request', board: null }
    }
    return kanban.columnClear(project, boardId, columnId)
  })

  ipcMain.handle(KANBAN_COLUMN_CARDS_MOVE_CHANNEL, async (_event, project: unknown, boardId: unknown, input: unknown) => {
    if (!isProjectEntry(project) || typeof boardId !== 'string' || input === null || typeof input !== 'object') {
      return { ok: false, error: 'Invalid request', board: null }
    }
    return kanban.columnCardsMove(project, boardId, input as KanbanColumnCardsMoveInput)
  })

  ipcMain.handle(KANBAN_WORKFLOW_SET_CHANNEL, async (_event, project: unknown, boardId: unknown, text: unknown) => {
    if (!isProjectEntry(project) || typeof boardId !== 'string' || typeof text !== 'string') {
      return { ok: false, error: 'Invalid request', board: null }
    }
    return kanban.workflowSet(project, boardId, text)
  })

  ipcMain.handle(KANBAN_ATTACHMENT_PUT_CHANNEL, async (_event, project: unknown, name: unknown, base64: unknown) => {
    if (!isProjectEntry(project) || typeof name !== 'string' || typeof base64 !== 'string') {
      return { ok: false, error: 'Invalid request', name: '', path: '' }
    }
    return kanban.putAttachment(project, name, base64)
  })

  ipcMain.handle(KANBAN_ATTACHMENT_GET_CHANNEL, async (_event, project: unknown, path: unknown) => {
    if (!isProjectEntry(project) || typeof path !== 'string') {
      return { ok: false, error: 'Invalid request', dataUrl: '' }
    }
    return kanban.getAttachment(project, path)
  })

  ipcMain.handle(KANBAN_THEME_LIST_CHANNEL, () => kanbanThemes.list())

  ipcMain.handle(KANBAN_THEME_IMPORT_CHANNEL, async () => kanbanThemes.importWithDialog())

  ipcMain.handle(KANBAN_THEME_EXPORT_CHANNEL, async (_event, id: unknown) => {
    if (typeof id !== 'string' || id.trim().length === 0) return { ok: false, error: 'Invalid request', path: '' }
    return kanbanThemes.exportWithDialog(id.trim())
  })

  ipcMain.handle(KANBAN_THEME_DELETE_CHANNEL, (_event, id: unknown) => {
    if (typeof id !== 'string' || id.trim().length === 0) return { ok: false, error: 'Invalid request', themes: [] }
    const result = kanbanThemes.remove(id.trim())
    if (result.ok && settings.get().kanbanTheme === id.trim()) settings.set({ kanbanTheme: KANBAN_DEFAULT_THEME_ID })
    return result
  })

  ipcMain.handle(SOUNDS_READ_CHANNEL, (_event, path: unknown) => {
    return readSoundFile(typeof path === 'string' ? path : '')
  })

  ipcMain.handle(SOUNDS_CHOOSE_CHANNEL, () => chooseSoundFile())

  ipcMain.handle(TELEGRAM_SET_TOKEN_CHANNEL, (_event, token: unknown) => {
    if (typeof token !== 'string') return { ok: false, error: 'Invalid token' }
    notifications?.tokenStore.write(token)
    // Демон получил hello до сохранения токена — обновить на живом канале (фоновые уведомления).
    if (token.trim().length > 0) getDaemonClient()?.sendTelegramToken(token)
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
    if (done) persistSessionToggles(settings, piHost, hostId, { telegram: enabled })
    return done ? { ok: true, error: null } : { ok: false, error: 'Session not found' }
  })

  ipcMain.handle(REMOTE_SHARE_SESSION_CHANNEL, (_event, hostId: unknown, shared: unknown) => {
    if (typeof hostId !== 'string' || typeof shared !== 'boolean') return { ok: false, error: 'Invalid arguments' }
    const done = notifications?.bridge.setSharedByHost(hostId, shared) ?? false
    if (done) persistSessionToggles(settings, piHost, hostId, { shared })
    return done ? { ok: true, error: null } : { ok: false, error: 'Session not found' }
  })

  ipcMain.handle(
    REMOTE_STATUS_CHANNEL,
    () => notifications?.bridge.connectionInfo() ?? { running: false, port: 0, pin: '', lanAddresses: [], error: null }
  )

  ipcMain.handle(REMOTE_RETRY_CHANNEL, () => notifications?.bridge.retryNow() ?? false)

  ipcMain.handle(REMOTE_CHECK_PORT_CHANNEL, async (_event, port: unknown) => {
    const p = typeof port === 'number' && Number.isFinite(port) ? Math.round(port) : NaN
    if (p < 1 || p > 65535) return { busy: true }
    // Порт, который уже слушает собственный мост PiWright, для проверки НЕ занят (баг 7):
    // внешний конфликт исключён — сокет держим мы сами.
    const info = notifications?.bridge.connectionInfo()
    if (info !== undefined && info.running && info.port === p) return { busy: false }
    return { busy: await isPortBusy(p) }
  })

  ipcMain.handle(MODELS_LIST_CHANNEL, async (_event, backend: unknown, serverId: unknown) => {
    if (backend !== 'native' && backend !== 'wsl' && backend !== 'ssh') {
      return { ok: false, error: 'Invalid request', file: '', exists: false, doc: null }
    }
    if (backend === 'ssh' && typeof serverId !== 'string') {
      return { ok: false, error: 'Invalid request', file: '', exists: false, doc: null }
    }
    return listModels(backend, settings.get(), undefined, typeof serverId === 'string' ? serverId : undefined)
  })

  ipcMain.handle(MODELS_SAVE_CHANNEL, async (_event, backend: unknown, doc: unknown, serverId: unknown) => {
    if (backend !== 'native' && backend !== 'wsl' && backend !== 'ssh') return { ok: false, error: 'Invalid request' }
    if (backend === 'ssh' && typeof serverId !== 'string') return { ok: false, error: 'Invalid request' }
    return saveModels(backend, settings.get(), doc, undefined, typeof serverId === 'string' ? serverId : undefined)
  })

  ipcMain.handle(MODELS_REVEAL_CHANNEL, async (_event, backend: unknown, serverId: unknown) => {
    if (backend !== 'native' && backend !== 'wsl' && backend !== 'ssh') return { ok: false, error: 'Invalid request' }
    return revealModelsFile(backend, settings.get(), undefined, typeof serverId === 'string' ? serverId : undefined)
  })

  ipcMain.handle(MODELS_REFRESH_CHANNEL, () => piHost.refreshCatalogs())

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
    const avail = await profileAvailability(settings.get(), project)
    return { ok: true, error: null, ...terminals.profiles(project, avail) }
  })

  ipcMain.handle(TERM_CREATE_CHANNEL, async (_event, project: unknown, profileId: unknown) => {
    if (!isProjectEntry(project)) return { ok: false, error: 'Invalid project', terminal: null }
    const avail = await profileAvailability(settings.get(), project)
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
