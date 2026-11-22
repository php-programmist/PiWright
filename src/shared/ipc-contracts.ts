/** Типизированный IPC-контракт renderer ↔ main. Единственная точка — preload (`window.piwright`). */
import type { DialogAnswer, ExtensionDialog, LoopInfo, UiEvent } from './agent-events'
import type { PiModelInfo } from './protocol-types'
import type { ProjectTabsSnapshot } from './project-tabs'

/** Бэкенд проекта: нативный pi на Windows или pi в WSL-дистрибутиве. */
export type BackendMode = 'native' | 'wsl'

/** Язык интерфейса. */
export type UiLanguage = 'en' | 'ru'

/** Тема оформления приложения. */
export type Theme = 'dark' | 'light'

export interface ProjectEntry {
  kind: BackendMode
  /** native — каталог Windows; wsl — UNC `\\wsl.localhost\<distro>\…` или путь внутри WSL. */
  dir: string
  /** Отображаемое имя (алиас); пусто/undefined — имя каталога. */
  name?: string
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
  /** Отправка по Enter (иначе Ctrl+Enter, дефолт как в jb-pi). */
  sendOnEnter: boolean
  /** Петли (авто-продолжение промпта в новых сессиях): чекбокс у поля промпта, Remote-петля, loop-stop расширение. */
  loopsEnabled: boolean
  /** Язык интерфейса (дефолт English). */
  language: UiLanguage
  /** Состояние правых панелей — переживает перезапуск. */
  panels: { git?: PanelPrefs; files?: PanelPrefs; terminal?: PanelPrefs }
  /** Развернутые проекты в панели слева (ключ projectKey) — переживает перезапуск. */
  expandedProjects: Record<string, boolean>
  /** Вкладки терминала на проект (ключ projectKey) — переименованные вкладки переоткрываются после перезапуска. */
  terminalTabs: Record<string, TerminalTabsSnapshot>
  /** Вкладки проекта (файлы/диффы/MCP/навыки; ключ projectKey) — переживают перезапуск, сессии не сохраняются. */
  projectTabs: Record<string, ProjectTabsSnapshot>
  /** Последний активный проект (ключ projectKey) — восстанавливается при старте. */
  lastProjectKey: string | null
  /** Звуки, telegram и remote-мост (вкладка Notifications). */
  notifications: NotificationSettings
  /** Последняя выбранная модель (provider/id) — подставляется в новые сессии; пишет только main. */
  lastModel: string | null
  /** Последний выбранный уровень thinking — подставляется в новые сессии; пишет только main. */
  lastThinkingLevel: string | null
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
  /** Высота терминального дока (горизонтальная область внизу). */
  height?: number
}

export type PanelName = 'git' | 'files' | 'terminal'

/** Сохранённая вкладка терминала: профиль + юзерское имя (пусто/undefined — имя профиля). */
export interface SavedTerminalTab {
  profileId: TerminalProfileId
  label?: string
}

/** Снимок вкладок терминала проекта: порядок + активная вкладка (индекс в tabs). */
export interface TerminalTabsSnapshot {
  tabs: SavedTerminalTab[]
  activeIndex?: number
}

/** Кружок статуса сессии: разрешение важнее вопроса, вопрос — важнее идущего хода,
 *  ожидание фоновых субагентов — важнее простоя. */
export type SessionDot = 'confirm' | 'question' | 'busy' | 'waiting' | 'idle'

export type PiStatusState = 'idle' | 'starting' | 'ready' | 'streaming' | 'waiting' | 'disconnected' | 'error'

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
  /** Кружок статуса: confirm > question > busy > waiting > idle. */
  dot: SessionDot
  /** Telegram-флаг сессии (RemoteBridge, в памяти; включается иконкой в шапке чата). */
  telegram?: boolean
  /** Сессия расшарена на телефон глобусом (RemoteBridge, в памяти). */
  shared?: boolean
}

/** Событие сессии: renderer маршрутизирует по hostId, сырые кадры pi наружу не идут. */
export interface PiEventMessage {
  hostId: string
  event: UiEvent
}

/** Как доставить сообщение во время хода: steer — до следующего шага агента, followUp — после хода. */
export type PromptBehavior = 'steer' | 'followUp'

/** Тексты очереди (steering + followUp) — ответ clear_queue и восстановление в поле ввода. */
export interface QueueTexts {
  steering: string[]
  followUp: string[]
}

export interface PromptResult {
  ok: boolean
  error: string | null
  /** Тексты, не попавшие обратно в очередь (abort/clear/remove) — renderer возвращает их в поле ввода. */
  cleared?: QueueTexts
}

export interface DialogResult {
  ok: boolean
  error: string | null
}

export interface HostRef {
  hostId: string
}

/** Открытие исторической сессии: с ошибкой (например, worktree не пересоздался) — без hostId. */
export interface SessionOpenResult {
  ok: boolean
  error: string | null
  hostId: string | null
}

/** Сводка файла сессии из каталога истории (порт `SessionSummary`).
 *  parentSession — абсолютный путь к .jsonl родителя (субагент), null у обычных сессий. */
export interface SessionSummary {
  id: string
  title: string
  lastActivityEpochMs: number
  cwd: string
  path: string
  parentSession: string | null
}

/** Активные сессии — статусы всех хостов; renderer строит из них панель. */
export interface SessionsSnapshot {
  active: PiStatus[]
}

/** Транскрипт исторической сессии: события для ленты (реплей без pi). */
export interface SessionTranscriptResult {
  ok: boolean
  error: string | null
  events: UiEvent[]
}

/** Файл в `git status --porcelain=v2`: index — статус в индексе, worktree — в рабочем дереве
 *  ('.' — без изменений, '?' — untracked). Путь относительно корня репо, слэши вперёд.
 *  repoRoot — корень вложенного репозитория (баг 8); undefined — сам каталог проекта. */
export interface GitFileEntry {
  path: string
  origPath: string | null
  index: string
  worktree: string
  untracked: boolean
  repoRoot?: string
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

/** Создание worktree: dir — хост-каталог для сессий (native — путь Windows, wsl — UNC). */
export interface WorktreeCreateResult {
  ok: boolean
  error: string | null
  dir: string | null
  name: string
  branch: string | null
}

/** Удаление worktree; uncommitted — отказ из-за незакоммиченных (UI предложит force). */
export interface WorktreeRemoveResult {
  ok: boolean
  error: string | null
  uncommitted: boolean
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

export interface FileReadImageResult {
  ok: boolean
  error: string | null
  dataUrl: string
}

export interface FileWriteResult {
  ok: boolean
  error: string | null
}

export interface FileRenameResult {
  ok: boolean
  error: string | null
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

export const TERMINAL_PROFILE_IDS: readonly TerminalProfileId[] = ['powershell', 'gitbash', 'wsl']

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

/** Вложение промпта: сохранено в `.pi/attachments/`. ref — ссылка для текста промпта.
 *  dataUrl — превью для чипа вложения (только картинки, иначе пустая строка). */
export interface AttachmentResult {
  ok: boolean
  error: string | null
  name: string
  isImage: boolean
  ref: string
  dataUrl: string
}

/** Звуковой файл для проигрывания в renderer (Audio + data URL). */
export interface SoundReadResult {
  ok: boolean
  error: string | null
  mime: string
  base64: string
}

/** Содержимое models.json бэкенда (raw JSON; схема — docs pi). */
export interface ModelsListResult {
  ok: boolean
  error: string | null
  file: string
  exists: boolean
  doc: unknown
}

export interface ModelsOpResult {
  ok: boolean
  error: string | null
}

/** Состояние remote-моста (вкладка General). */
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

export interface PiWrightApi {
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  revealSettings(): Promise<{ ok: boolean; error: string | null }>
  appVersion(): Promise<string>
  listSessions(): Promise<SessionsSnapshot>
  sessionHistory(project: ProjectEntry): Promise<SessionSummary[]>
  /** Транскрипт сессии без запуска pi: UiEvent-ы из JSONL (для просмотра сессии субагента). */
  sessionTranscript(project: ProjectEntry, sessionPath: string): Promise<SessionTranscriptResult>
  newSession(project: ProjectEntry): Promise<HostRef>
  openSession(project: ProjectEntry, sessionFile: string): Promise<SessionOpenResult>
  closeSession(hostId: string): Promise<PromptResult>
  renameSession(hostId: string, name: string): Promise<PromptResult>
  deleteHistorySession(project: ProjectEntry, sessionPath: string): Promise<PromptResult>
  chooseProjectDir(kind: BackendMode): Promise<{ ok: boolean; dir: string | null }>
  /** Показать каталог проекта в проводнике (WSL POSIX-путь конвертируется в UNC). */
  revealProject(project: ProjectEntry): Promise<{ ok: boolean; error: string | null }>
  prompt(hostId: string, text: string, images?: string[], behavior?: PromptBehavior): Promise<PromptResult>
  /** Стартовать петлю на сессии: промпт повторяется в новых сессиях, пока ход содержит вызовы инструментов; exitCondition дописывается в каждую итерацию. */
  loopStart(hostId: string, prompt: string, maxIterations: number, exitCondition: string): Promise<PromptResult>
  /** Остановить петлю: следующая итерация не начнётся, текущий ход не прерывается. */
  loopStop(hostId: string): Promise<PromptResult>
  /** Изменить оставшееся число итераций активной петли. */
  loopSetRemaining(hostId: string, remaining: number): Promise<PromptResult>
  /** Состояние петли сессии (после перезагрузки renderer'а); null — петли нет. */
  loopGet(hostId: string): Promise<LoopInfo | null>
  abort(hostId: string): Promise<PromptResult>
  /** Очистить очередь целиком, тексты вернутся в cleared. */
  queueClear(hostId: string): Promise<PromptResult>
  /** Убрать один элемент очереди: clear_queue + повторная постановка остальных (при ходе). */
  queueRemove(hostId: string, kind: keyof QueueTexts, index: number): Promise<PromptResult>
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
  /** create — `git checkout -b <name> [startPoint]` (создать и переключиться), иначе `git checkout <name>`. */
  gitCheckout(project: ProjectEntry, name: string, create: boolean, startPoint?: string): Promise<GitOpResult>
  /** `git branch -m <oldName> <newName>`. */
  gitBranchRename(project: ProjectEntry, oldName: string, newName: string): Promise<GitOpResult>
  /** `git branch -d <name>` (безопасное удаление; неслитая ветка — ошибка git). */
  gitBranchDelete(project: ProjectEntry, name: string): Promise<GitOpResult>
  gitGenerateMessage(project: ProjectEntry): Promise<GitMessageResult>
  /** `git worktree add` (существующий worktree/ветка переиспользуются); dir — для новой сессии. */
  worktreeCreate(project: ProjectEntry, name: string): Promise<WorktreeCreateResult>
  /** `git worktree remove [--force]`; ветку не трогает. */
  worktreeRemove(project: ProjectEntry, name: string, force: boolean): Promise<WorktreeRemoveResult>
  filesList(project: ProjectEntry, dir: string): Promise<FileListResult>
  filesRead(project: ProjectEntry, path: string): Promise<FileReadResult>
  filesReadImage(project: ProjectEntry, path: string): Promise<FileReadImageResult>
  filesWrite(project: ProjectEntry, path: string, content: string): Promise<FileWriteResult>
  filesRename(project: ProjectEntry, path: string, newName: string): Promise<FileRenameResult>
  filesDelete(project: ProjectEntry, path: string): Promise<FileWriteResult>
  filesMkdir(project: ProjectEntry, path: string): Promise<FileWriteResult>
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
  /** Тоггл telegram-уведомлений сессии (иконка в шапке чата, флаг в RemoteBridge). */
  setSessionTelegram(hostId: string, enabled: boolean): Promise<{ ok: boolean; error: string | null }>
  /** Тоггл шаринга сессии на телефон (глобус в шапке чата, jb-pi). */
  shareSession(hostId: string, shared: boolean): Promise<{ ok: boolean; error: string | null }>
  remoteStatus(): Promise<RemoteStatus>
  /** Занят ли TCP-порт на 0.0.0.0 (как его биндит remote-мост). */
  remoteCheckPort(port: number): Promise<{ busy: boolean }>
  modelsList(backend: BackendMode): Promise<ModelsListResult>
  modelsSave(backend: BackendMode, doc: unknown): Promise<ModelsOpResult>
  modelsReveal(backend: BackendMode): Promise<ModelsOpResult>
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
export const SETTINGS_REVEAL_CHANNEL = 'settings:reveal'
export const APP_VERSION_CHANNEL = 'app:version'
export const SESSIONS_LIST_CHANNEL = 'sessions:list'
export const SESSIONS_HISTORY_CHANNEL = 'sessions:history'
export const SESSIONS_TRANSCRIPT_CHANNEL = 'sessions:transcript'
export const SESSIONS_NEW_CHANNEL = 'sessions:new'
export const SESSIONS_OPEN_CHANNEL = 'sessions:open'
export const SESSIONS_CLOSE_CHANNEL = 'sessions:close'
export const SESSIONS_RENAME_CHANNEL = 'sessions:rename'
export const SESSIONS_DELETE_HISTORY_CHANNEL = 'sessions:delete-history'
export const SESSIONS_CHOOSE_DIR_CHANNEL = 'sessions:choose-dir'
export const PROJECTS_REVEAL_CHANNEL = 'projects:reveal'
export const SESSION_PROMPT_CHANNEL = 'session:prompt'
export const LOOP_START_CHANNEL = 'loop:start'
export const LOOP_STOP_CHANNEL = 'loop:stop'
export const LOOP_SET_REMAINING_CHANNEL = 'loop:set-remaining'
export const LOOP_GET_CHANNEL = 'loop:get'
export const SESSION_ABORT_CHANNEL = 'session:abort'
export const SESSION_QUEUE_CLEAR_CHANNEL = 'session:queue-clear'
export const SESSION_QUEUE_REMOVE_CHANNEL = 'session:queue-remove'
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
export const GIT_BRANCH_RENAME_CHANNEL = 'git:branch-rename'
export const GIT_BRANCH_DELETE_CHANNEL = 'git:branch-delete'
export const GIT_GENERATE_MESSAGE_CHANNEL = 'git:generate-message'
export const WORKTREE_CREATE_CHANNEL = 'worktree:create'
export const WORKTREE_REMOVE_CHANNEL = 'worktree:remove'
export const FILES_LIST_CHANNEL = 'files:list'
export const FILES_READ_CHANNEL = 'files:read'
export const FILES_READ_IMAGE_CHANNEL = 'files:read-image'
export const FILES_WRITE_CHANNEL = 'files:write'
export const FILES_RENAME_CHANNEL = 'files:rename'
export const FILES_DELETE_CHANNEL = 'files:delete'
export const FILES_MKDIR_CHANNEL = 'files:mkdir'
export const FILES_WATCH_CHANNEL = 'files:watch'
export const FILES_CHANGED_CHANNEL = 'files:changed'
export const ATTACHMENTS_PUT_CHANNEL = 'attachments:put'
export const ATTACHMENTS_CHOOSE_CHANNEL = 'attachments:choose'
export const SOUNDS_READ_CHANNEL = 'sounds:read'
export const SOUNDS_CHOOSE_CHANNEL = 'sounds:choose'
export const TELEGRAM_SET_TOKEN_CHANNEL = 'telegram:set-token'
export const TELEGRAM_TOKEN_STATUS_CHANNEL = 'telegram:token-status'
export const TELEGRAM_TEST_CHANNEL = 'telegram:test'
export const TELEGRAM_TOGGLE_SESSION_CHANNEL = 'telegram:toggle-session'
export const REMOTE_STATUS_CHANNEL = 'remote:status'
export const REMOTE_CHECK_PORT_CHANNEL = 'remote:check-port'
export const REMOTE_SHARE_SESSION_CHANNEL = 'remote:share-session'
export const MODELS_LIST_CHANNEL = 'models:list'
export const MODELS_SAVE_CHANNEL = 'models:save'
export const MODELS_REVEAL_CHANNEL = 'models:reveal'
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
