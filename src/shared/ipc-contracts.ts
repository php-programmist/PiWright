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
  piPath: string
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

/** Диалог, ждущий ответа renderer'а (реплей при переподключении — те же объекты). */
export interface PendingDialog {
  hostId: string
  id: string
  dialog: ExtensionDialog
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
  onPiEvent(cb: (message: PiEventMessage) => void): () => void
  onPiStatus(cb: (status: PiStatus) => void): () => void
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
export const PI_EVENT_CHANNEL = 'pi:event'
export const PI_STATUS_CHANNEL = 'pi:status'
