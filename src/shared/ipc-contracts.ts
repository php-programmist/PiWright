/** Типизированный IPC-контракт renderer ↔ main. Единственная точка — preload (`window.piwright`). */
import type { DialogAnswer, ExtensionDialog, UiEvent } from './agent-events'
import type { PiModelInfo } from './protocol-types'

/** Бэкенд проекта: нативный pi на Windows или pi в WSL-дистрибутиве. */
export type BackendMode = 'native' | 'wsl'

/** Тема оформления приложения. */
export type Theme = 'dark' | 'light'

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
  /** Доп. аргументы pi (оба бэкенда), сплит по пробелам, кавычки для путей с пробелами. */
  piExtraArgs: string
  /** URL фида обновлений (generic-провайдер electron-updater); пусто — проверка выключена. */
  updateUrl: string
  /** Где сидят выбор модели/thinking и Stop: в шапке чата или над полем ввода. */
  selectorPlacement: 'top' | 'bottom'
  /** Тема оформления: тёмная (по умолчанию) или светлая. */
  theme: Theme
  /** Размер шрифта ленты чата, px. */
  chatFontSize: number
  /** Однострочные тул-блоки: шапка с «…», в раскрытом — полная команда и вывод. */
  singleLineTools: boolean
  /** Состояние правых панелей — переживает перезапуск. */
  panels: { git?: PanelPrefs; files?: PanelPrefs; terminal?: PanelPrefs }
  /** Звуки, telegram и remote-мост (вкладка Notifications). */
  notifications: NotificationSettings
  projects: ProjectEntry[]
}

/** Путь к звуковому файлу (wav/aif/aiff/au); пусто — звук выключен. */
export interface NotificationSounds {
  completion: string
  await: string
  error: string
}

export interface NotificationSettings {
  sounds: NotificationSounds
  telegram: {
    chatId: string
    events: { turnEnd: boolean; permission: boolean; question: boolean; error: boolean }
  }
  remote: { enabled: boolean; port: number }
}

export interface PanelPrefs {
  open?: boolean
  width?: number
}

export type PanelName = 'git' | 'files' | 'terminal'

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

/** Локальные ветки репозитория (`git branch --list`). */
export interface GitBranchesResult extends GitOpResult {
  branches: string[]
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

/** Вложение промпта: сохранено в `.pi/attachments/`. ref — ссылка для текста промпта. */
export interface AttachmentResult {
  ok: boolean
  error: string | null
  name: string
  isImage: boolean
  ref: string
}

/** Звуковой файл для проигрывания в renderer (Audio + data URL). */
export interface SoundReadResult {
  ok: boolean
  error: string | null
  mime: string
  base64: string
}

/** Состояние remote-моста (вкладка Notifications). */
export interface RemoteStatus {
  running: boolean
  port: number
  pin: string
  lanAddresses: string[]
}

/** Скоуп mcp.json: юзерский каталог агента бэкенда или `.pi/mcp.json` проекта. */
export type McpScope = 'user' | 'project'

export interface McpServerEntry {
  name: string
  config: Record<string, unknown>
}

export interface McpListResult {
  ok: boolean
  error: string | null
  file: string
  exists: boolean
  servers: McpServerEntry[]
}

export interface McpOpResult {
  ok: boolean
  error: string | null
}

/** Живая проверка MCP-сервера: initialize + tools/list. */
export interface McpProbeResult {
  ok: boolean
  error: string | null
  toolCount: number
  serverError: string | null
}

export interface SkillEntry {
  name: string
  description: string
  /** Хост-путь SKILL.md (Windows/UNC). */
  path: string
  source: 'user' | 'project'
  enabled: boolean
}

export interface SkillsListResult {
  ok: boolean
  error: string | null
  skills: SkillEntry[]
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
  prompt(hostId: string, text: string, images?: string[]): Promise<PromptResult>
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
  gitBranches(project: ProjectEntry): Promise<GitBranchesResult>
  /** create — `git checkout -b <name>` (создать и переключиться), иначе `git checkout <name>`. */
  gitCheckout(project: ProjectEntry, name: string, create: boolean): Promise<GitOpResult>
  gitGenerateMessage(project: ProjectEntry): Promise<GitMessageResult>
  filesList(project: ProjectEntry, dir: string): Promise<FileListResult>
  filesRead(project: ProjectEntry, path: string): Promise<FileReadResult>
  filesWatch(project: ProjectEntry, paths: string[]): Promise<GitOpResult>
  /** base64 → файл в `.pi/attachments/` (paste); name — желаемое, возвращается фактическое. */
  putAttachment(project: ProjectEntry, name: string, base64: string): Promise<AttachmentResult>
  /** Диалог выбора файла → копия в `.pi/attachments/`. */
  chooseAttachment(project: ProjectEntry): Promise<AttachmentResult>
  soundsRead(path: string): Promise<SoundReadResult>
  soundsChoose(): Promise<{ ok: boolean; error: string | null; path: string }>
  setTelegramToken(token: string): Promise<{ ok: boolean; error: string | null }>
  telegramTokenStatus(): Promise<{ configured: boolean }>
  telegramTest(chatId: string, token: string): Promise<{ error: string | null }>
  remoteStatus(): Promise<RemoteStatus>
  mcpList(project: ProjectEntry, scope: McpScope): Promise<McpListResult>
  mcpSave(project: ProjectEntry, scope: McpScope, servers: McpServerEntry[]): Promise<McpOpResult>
  mcpProbe(project: ProjectEntry, scope: McpScope, name: string): Promise<McpProbeResult>
  mcpReveal(project: ProjectEntry, scope: McpScope): Promise<McpOpResult>
  skillsList(project: ProjectEntry): Promise<SkillsListResult>
  skillsToggle(project: ProjectEntry, path: string, enabled: boolean): Promise<McpOpResult>
  skillsReveal(project: ProjectEntry, source: 'user' | 'project'): Promise<McpOpResult>
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
export const GIT_BRANCHES_CHANNEL = 'git:branches'
export const GIT_CHECKOUT_CHANNEL = 'git:checkout'
export const GIT_GENERATE_MESSAGE_CHANNEL = 'git:generate-message'
export const FILES_LIST_CHANNEL = 'files:list'
export const FILES_READ_CHANNEL = 'files:read'
export const FILES_WATCH_CHANNEL = 'files:watch'
export const FILES_CHANGED_CHANNEL = 'files:changed'
export const ATTACHMENTS_PUT_CHANNEL = 'attachments:put'
export const ATTACHMENTS_CHOOSE_CHANNEL = 'attachments:choose'
export const SOUNDS_READ_CHANNEL = 'sounds:read'
export const SOUNDS_CHOOSE_CHANNEL = 'sounds:choose'
export const TELEGRAM_SET_TOKEN_CHANNEL = 'telegram:set-token'
export const TELEGRAM_TOKEN_STATUS_CHANNEL = 'telegram:token-status'
export const TELEGRAM_TEST_CHANNEL = 'telegram:test'
export const REMOTE_STATUS_CHANNEL = 'remote:status'
export const MCP_LIST_CHANNEL = 'mcp:list'
export const MCP_SAVE_CHANNEL = 'mcp:save'
export const MCP_PROBE_CHANNEL = 'mcp:probe'
export const MCP_REVEAL_CHANNEL = 'mcp:reveal'
export const SKILLS_LIST_CHANNEL = 'skills:list'
export const SKILLS_TOGGLE_CHANNEL = 'skills:toggle'
export const SKILLS_REVEAL_CHANNEL = 'skills:reveal'
export const TERM_PROFILES_CHANNEL = 'term:profiles'
export const TERM_CREATE_CHANNEL = 'term:create'
export const TERM_CLOSE_CHANNEL = 'term:close'
export const TERM_INPUT_CHANNEL = 'term:input'
export const TERM_RESIZE_CHANNEL = 'term:resize'
export const TERM_DATA_CHANNEL = 'term:data'
export const TERM_EXIT_CHANNEL = 'term:exit'
export const PI_EVENT_CHANNEL = 'pi:event'
export const PI_STATUS_CHANNEL = 'pi:status'
