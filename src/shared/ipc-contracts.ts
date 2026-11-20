/** Типизированный IPC-контракт renderer ↔ main. Единственная точка — preload (`window.piwright`). */
import type { DialogAnswer, ExtensionDialog, UiEvent } from './agent-events'
import type { PiModelInfo } from './protocol-types'

/** Бэкенд проекта: нативный pi на Windows или pi в WSL-дистрибутиве. */
export type BackendMode = 'native' | 'wsl'

export interface ProjectEntry {
  kind: BackendMode
  /** native — каталог Windows; wsl — UNC `\\wsl.localhost\<distro>\…` или путь внутри WSL. */
  dir: string
}

export interface Settings {
  wslDistro: string
  /** Путь к pi для нативных (Windows) проектов. */
  piPathNative: string
  /** Путь к pi для WSL-проектов (POSIX внутри дистрибутива). */
  piPathWsl: string
  projects: ProjectEntry[]
}

/** Кружок статуса сессии: разрешение важнее вопроса, вопрос — важнее идущего хода. */
export type SessionDot = 'confirm' | 'question' | 'busy' | 'idle'

export type PiStatusState = 'idle' | 'starting' | 'ready' | 'streaming' | 'disconnected' | 'error'

export interface PiStatus {
  hostId: string
  state: PiStatusState
  backend: string | null
  model: string | null
  sessionId: string | null
  sessionFile: string | null
  error: string | null
  /** Каталог моделей и thinking — из хендшейка; кнопки в шапке чата. */
  models: PiModelInfo[]
  thinkingLevels: string[]
  thinkingLevel: string | null
  /** Проект сессии — группировка строк панели. */
  project: ProjectEntry
  /** Заголовок: имя сессии → первый текст пользователя → «New Chat». */
  title: string
  /** Кружок статуса: confirm > question > busy > idle. */
  dot: SessionDot
}

/** Событие сессии: renderer маршрутизирует по hostId, сырые кадры pi наружу не идут. */
export interface PiEventMessage {
  hostId: string
  event: UiEvent
}

export interface PromptResult {
  ok: boolean
  error: string | null
}

export interface DialogResult {
  ok: boolean
  error: string | null
}

export interface HostRef {
  hostId: string
}

/** Сводка файла сессии из каталога истории (порт `SessionSummary`). */
export interface SessionSummary {
  id: string
  title: string
  lastActivityEpochMs: number
  cwd: string
  path: string
}

/** Активные сессии — статусы всех хостов; renderer строит из них панель. */
export interface SessionsSnapshot {
  active: PiStatus[]
}

/** Файл в `git status --porcelain=v2`: index — статус в индексе, worktree — в рабочем дереве
 *  ('.' — без изменений, '?' — untracked). Путь относительно корня репо, слэши вперёд. */
export interface GitFileEntry {
  path: string
  origPath: string | null
  index: string
  worktree: string
  untracked: boolean
}

export interface GitStatus {
  branch: string | null
  upstream: string | null
  ahead: number | null
  behind: number | null
  detached: boolean
  entries: GitFileEntry[]
}

export interface GitLogEntry {
  hash: string
  subject: string
}

export interface GitOpResult {
  ok: boolean
  error: string | null
}

export interface GitStatusResult extends GitOpResult {
  status: GitStatus | null
}

/** Содержимое для DiffEditor: original = `git show HEAD:<path>` (untracked — пусто),
 *  modified = файл на диске (удалён — пусто). */
export interface GitFileDiffResult extends GitOpResult {
  original: string
  modified: string
}

export interface GitLogResult extends GitOpResult {
  entries: GitLogEntry[]
}

export interface GitMessageResult extends GitOpResult {
  message: string
}

/** Запись каталога в дереве файлов проекта (`.git` скрыт). */
export interface FileEntry {
  name: string
  kind: 'dir' | 'file'
}

export interface FileListResult {
  ok: boolean
  error: string | null
  entries: FileEntry[]
}

export interface FileReadResult {
  ok: boolean
  error: string | null
  content: string
}

/** Файл из набора открытых изменился на диске (chokidar в main). */
export interface FileChangedMessage {
  project: ProjectEntry
  /** Путь относительно корня проекта, слэши вперёд. */
  path: string
}

/** Диалог, ждущий ответа renderer'а (реплей при переподключении — те же объекты). */
export interface PendingDialog {
  hostId: string
  id: string
  dialog: ExtensionDialog
}

export type TerminalProfileId = 'powershell' | 'gitbash' | 'wsl'

export interface TerminalProfile {
  id: TerminalProfileId
  label: string
}

export interface TerminalProfilesResult {
  ok: boolean
  error: string | null
  profiles: TerminalProfile[]
  defaultProfileId: TerminalProfileId | null
}

export interface TerminalInfo {
  id: string
  profileId: TerminalProfileId
  label: string
}

export interface TerminalCreateResult {
  ok: boolean
  error: string | null
  terminal: TerminalInfo | null
}

export interface TerminalOpResult {
  ok: boolean
  error: string | null
}

/** Байты из pty (node-pty декодирует UTF-8 сам). */
export interface TermDataMessage {
  id: string
  data: string
}

export interface TermExitMessage {
  id: string
  code: number
}

export interface PiwrightApi {
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  listSessions(): Promise<SessionsSnapshot>
  sessionHistory(project: ProjectEntry): Promise<SessionSummary[]>
  newSession(project: ProjectEntry): Promise<HostRef>
  openSession(project: ProjectEntry, sessionFile: string): Promise<HostRef>
  closeSession(hostId: string): Promise<PromptResult>
  renameSession(hostId: string, name: string): Promise<PromptResult>
  deleteHistorySession(project: ProjectEntry, sessionPath: string): Promise<PromptResult>
  chooseProjectDir(kind: BackendMode): Promise<{ ok: boolean; dir: string | null }>
  prompt(hostId: string, text: string): Promise<PromptResult>
  abort(hostId: string): Promise<PromptResult>
  setModel(hostId: string, key: string): Promise<PromptResult>
  setThinkingLevel(hostId: string, level: string): Promise<PromptResult>
  respondDialog(hostId: string, id: string, answer: DialogAnswer): Promise<DialogResult>
  getPendingDialogs(): Promise<PendingDialog[]>
  gitStatus(project: ProjectEntry): Promise<GitStatusResult>
  gitFileDiff(project: ProjectEntry, path: string): Promise<GitFileDiffResult>
  gitStage(project: ProjectEntry, paths: string[]): Promise<GitOpResult>
  gitUnstage(project: ProjectEntry, paths: string[]): Promise<GitOpResult>
  gitCommit(project: ProjectEntry, message: string): Promise<GitOpResult>
  gitPush(project: ProjectEntry): Promise<GitOpResult>
  gitLog(project: ProjectEntry): Promise<GitLogResult>
  gitGenerateMessage(project: ProjectEntry): Promise<GitMessageResult>
  filesList(project: ProjectEntry, dir: string): Promise<FileListResult>
  filesRead(project: ProjectEntry, path: string): Promise<FileReadResult>
  filesWatch(project: ProjectEntry, paths: string[]): Promise<GitOpResult>
  termProfiles(project: ProjectEntry): Promise<TerminalProfilesResult>
  termCreate(project: ProjectEntry, profileId: TerminalProfileId | null): Promise<TerminalCreateResult>
  termClose(id: string): Promise<TerminalOpResult>
  termInput(id: string, data: string): void
  termResize(id: string, cols: number, rows: number): void
  onPiEvent(cb: (message: PiEventMessage) => void): () => void
  onPiStatus(cb: (status: PiStatus) => void): () => void
  onFilesChanged(cb: (message: FileChangedMessage) => void): () => void
  onTermData(cb: (message: TermDataMessage) => void): () => void
  onTermExit(cb: (message: TermExitMessage) => void): () => void
}

export const SETTINGS_GET_CHANNEL = 'settings:get'
export const SETTINGS_SET_CHANNEL = 'settings:set'
export const SESSIONS_LIST_CHANNEL = 'sessions:list'
export const SESSIONS_HISTORY_CHANNEL = 'sessions:history'
export const SESSIONS_NEW_CHANNEL = 'sessions:new'
export const SESSIONS_OPEN_CHANNEL = 'sessions:open'
export const SESSIONS_CLOSE_CHANNEL = 'sessions:close'
export const SESSIONS_RENAME_CHANNEL = 'sessions:rename'
export const SESSIONS_DELETE_HISTORY_CHANNEL = 'sessions:delete-history'
export const SESSIONS_CHOOSE_DIR_CHANNEL = 'sessions:choose-dir'
export const SESSION_PROMPT_CHANNEL = 'session:prompt'
export const SESSION_ABORT_CHANNEL = 'session:abort'
export const SESSION_SET_MODEL_CHANNEL = 'session:set-model'
export const SESSION_SET_THINKING_CHANNEL = 'session:set-thinking'
export const SESSION_RESPOND_DIALOG_CHANNEL = 'session:respond-dialog'
export const SESSION_PENDING_DIALOGS_CHANNEL = 'session:pending-dialogs'
export const GIT_STATUS_CHANNEL = 'git:status'
export const GIT_FILE_DIFF_CHANNEL = 'git:file-diff'
export const GIT_STAGE_CHANNEL = 'git:stage'
export const GIT_UNSTAGE_CHANNEL = 'git:unstage'
export const GIT_COMMIT_CHANNEL = 'git:commit'
export const GIT_PUSH_CHANNEL = 'git:push'
export const GIT_LOG_CHANNEL = 'git:log'
export const GIT_GENERATE_MESSAGE_CHANNEL = 'git:generate-message'
export const FILES_LIST_CHANNEL = 'files:list'
export const FILES_READ_CHANNEL = 'files:read'
export const FILES_WATCH_CHANNEL = 'files:watch'
export const FILES_CHANGED_CHANNEL = 'files:changed'
export const TERM_PROFILES_CHANNEL = 'term:profiles'
export const TERM_CREATE_CHANNEL = 'term:create'
export const TERM_CLOSE_CHANNEL = 'term:close'
export const TERM_INPUT_CHANNEL = 'term:input'
export const TERM_RESIZE_CHANNEL = 'term:resize'
export const TERM_DATA_CHANNEL = 'term:data'
export const TERM_EXIT_CHANNEL = 'term:exit'
export const PI_EVENT_CHANNEL = 'pi:event'
export const PI_STATUS_CHANNEL = 'pi:status'
