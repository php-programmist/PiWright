/** Типизированный IPC-контракт renderer ↔ main. Единственная точка — preload (`window.piwright`). */
import type { DialogAnswer, ExtensionDialog, LoopInfo, UiEvent } from './agent-events'
import type { PiModelInfo, PiSlashCommand } from './protocol-types'
import type { ProjectTabsSnapshot } from './project-tabs'
import type { KanbanBoard, KanbanCommitRef, KanbanSessionRef } from './kanban'
import type { KanbanTheme } from './kanban-theme'

/** Бэкенд проекта: нативный pi на Windows, pi в WSL-дистрибутиве или pi на удалённом сервере по SSH. */
export type BackendMode = 'native' | 'wsl' | 'ssh'

/** Язык интерфейса. */
export type UiLanguage = 'en' | 'ru'

/** Тема оформления приложения. */
export type Theme = 'dark' | 'light'

/** Способ аутентификации на SSH-сервере. */
export type SshAuthType = 'password' | 'key' | 'agent'

/** SSH-сервер из настроек; секреты (пароль/passphrase) — в зашифрованном хранилище, не здесь. */
export interface SshServerEntry {
  id: string
  /** Отображаемое имя. */
  name: string
  host: string
  port: number
  user: string
  auth: SshAuthType
  /** Путь к приватному ключу (auth = 'key'). */
  keyPath?: string
}

/** Тип СУБД подключения панели DB. */
export type DbKind = 'postgres' | 'mysql'

/** Способ аутентификации подключения БД: пароль (в db-secrets.json) или без пароля (trust/сокет). */
export type DbAuthType = 'password' | 'none'

/** SSH-туннель конкретного подключения БД (per-connection, как дата-сорсы в PHPStorm);
 *  секреты туннеля — в db-secrets.json рядом с паролем БД. */
export interface DbSshTunnel {
  host: string
  port: number
  user: string
  auth: SshAuthType
  /** Путь к приватному ключу (auth = 'key'). */
  keyPath?: string
}

/** Подключение БД из настроек; пароли (БД и SSH) — в зашифрованном db-secrets.json, не здесь. */
export interface DbConnectionEntry {
  id: string
  /** Отображаемое имя. */
  name: string
  kind: DbKind
  host: string
  port: number
  database: string
  user: string
  authType: DbAuthType
  /** Не задан/undefined — прямое соединение. */
  ssh?: DbSshTunnel | null
  /** Выбранные схемы: undefined — все; непустой массив — только они; пустой массив — ни одной
   *  (панель показывает подключение с подсказкой). */
  selectedSchemas?: string[]
}

export interface ProjectEntry {
  kind: BackendMode
  /** native — каталог Windows; wsl — UNC `\\wsl.localhost\<distro>\…`; ssh — POSIX-путь на сервере. */
  dir: string
  /** Отображаемое имя (алиас); пусто/undefined — имя каталога. */
  name?: string
  /** SSH-сервер (kind = 'ssh'): id записи из settings.sshServers. */
  serverId?: string
}

export interface Settings {
  wslDistro: string
  /** Путь к pi для нативных (Windows) проектов. */
  piPathNative: string
  /** Путь к pi для WSL-проектов (POSIX внутри дистрибутива). */
  piPathWsl: string
  /** Путь к pi для SSH-проектов (POSIX на сервере); пусто — автопоиск. */
  piPathSsh: string
  /** SSH-серверы для удалённых проектов (секреты — в ssh-secrets.json). */
  sshServers: SshServerEntry[]
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
  /** Отправка по Enter (иначе Ctrl+Enter, дефолт как в jb-pi). */
  sendOnEnter: boolean
  /** Петли (авто-продолжение промпта в новых сессиях): чекбокс у поля промпта, Remote-петля, loop-stop расширение. */
  loopsEnabled: boolean
  /** Закрывать родительскую сессию после того, как петля открыла новую вкладку. */
  loopCloseSession: boolean
  /** Канбан-доски проекта: бандл-расширение resources/kanban (туы агента) + UI-панель. */
  kanbanEnabled: boolean
  /** Фоновые сессии: демон-хост (сессии переживают закрытие приложения) + кнопки остановки в UI. */
  backgroundSessions: boolean
  /** Id темы оформления досок (дефолт 'slate'); id пользовательской темы — из kanban-themes.json. */
  kanbanTheme: string
  /** Язык интерфейса (дефолт English). */
  language: UiLanguage
  /** Состояние правых панелей — переживает перезапуск. */
  panels: { git?: PanelPrefs; files?: PanelPrefs; terminal?: PanelPrefs; gitlog?: PanelPrefs; kanban?: PanelPrefs; db?: PanelPrefs; sessions?: PanelPrefs }
  /** Развернутые проекты в панели слева (ключ projectKey) — переживает перезапуск. */
  expandedProjects: Record<string, boolean>
  /** Развернутые доски в панели канбана (ключ projectKey\0boardId). */
  kanbanBoardsExpanded: Record<string, boolean>
  /** Свёрнутые колонки дерева канбана (ключ projectKey\0boardId\0columnId, true = свёрнута). */
  kanbanColumnsCollapsed: Record<string, boolean>
  /** Непрочитанное внимание на задачах канбана (ключ projectKey). */
  kanbanCardAttention: Record<string, KanbanCardAttention>
  /** Вкладки терминала на проект (ключ projectKey) — переименованные вкладки переоткрываются после перезапуска. */
  terminalTabs: Record<string, TerminalTabsSnapshot>
  /** Вкладки проекта (файлы/диффы/MCP/навыки; ключ projectKey) — переживают перезапуск, сессии не сохраняются. */
  projectTabs: Record<string, ProjectTabsSnapshot>
  /** Открытые вкладки сессий — при старте восстанавливаются (живые дети демона аттачатся). Пишет только main. */
  openSessionTabs: SavedSessionTab[]
  /** Тогглы сессии по файлу (telegram/shared) — восстанавливаются при открытии сессии из истории. Пишет только main. */
  sessionToggles: Record<string, SessionToggles>
  /** Активные петли — переживают детач-аттач сессии и рестарт приложения. Пишет только main. */
  loops: PersistedLoop[]
  /** Закреплённые ветки проекта (ключ projectKey) — всегда вверху списка переключателя веток. */
  pinnedBranches: Record<string, string[]>
  /** Последний активный проект (ключ projectKey) — восстанавливается при старте. */
  lastProjectKey: string | null
  /** Звуки, telegram и remote-мост (вкладка Notifications). */
  notifications: NotificationSettings
  /** Версия обновления, скрытая кнопкой «Не предлагать эту версию»; баннер вернётся только для более новой версии. */
  dismissedUpdateVersion: string | null
  /** Последняя выбранная модель (provider/id) — подставляется в новые сессии; пишет только main. */
  lastModel: string | null
  /** Последний выбранный уровень thinking — подставляется в новые сессии; пишет только main. */
  lastThinkingLevel: string | null
  /** Запомненный уровень thinking по модели (ключ provider/id) — при переключении модели
   *  восстанавливается уровень, ранее выбранный для неё; пишет только main. */
  thinkingLevelByModel: Record<string, string>
  projects: ProjectEntry[]
  /** Подключения БД на проект (ключ projectKey; секреты — в db-secrets.json). */
  projectDbConnections: Record<string, DbConnectionEntry[]>
  /** Превью SQL перед применением правок таблицы БД (зелёная стрелка). */
  dbSqlPreview: boolean
}

/** Зелёная точка на задаче после закрытия сессии: sessions — pi session id с непрочитанным
 *  ходом, dismissed — ключи boardId\0cardId, где точку уже сняли открытием карточки. */
export interface KanbanCardAttention {
  sessions: string[]
  dismissed: string[]
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
    events: { turnEnd: boolean; permission: boolean; question: boolean; error: boolean; loopEnd: boolean }
  }
  remote: { enabled: boolean; port: number; staticPin: string }
  /** Минуты grace-периода фоновой сессии после уведомления, до kill процесса (0 — сразу). */
  backgroundGraceMinutes: number
}

export interface PanelPrefs {
  open?: boolean
  width?: number
  /** Высота терминального дока (горизонтальная область внизу). */
  height?: number
  /** Git-панель: группировать изменения по репозиториям (несколько репо в проекте). */
  groupByRepo?: boolean
}

export type PanelName = 'git' | 'files' | 'terminal' | 'gitlog' | 'kanban' | 'db' | 'sessions'

/** Сохранённая вкладка сессии для восстановления после рестарта (эффект Herdr): при старте
 *  хост пересоздаётся; живой ребёнок демона аттачится, мёртвый — обычный респавн с --session. */
export interface SavedSessionTab {
  project: ProjectEntry
  sessionFile: string
}

/** Активная петля для восстановления после детач-аттача сессии и рестарта приложения
 *  (пишет только main): настройки серии итераций, привязанные к файлу сессии. */
export interface PersistedLoop {
  /** Файл сессии текущей итерации; null — ещё не известен (хендшейк не дошёл), восстановлению не подлежит. */
  sessionFile: string | null
  project: ProjectEntry
  prompt: string
  exitCondition: string
  remaining: number
  iteration: number
  baseName: string
}

/** Тогглы сессии, переживают закрытие: telegram-уведомления и шаринг на телефон. */
export interface SessionToggles {
  telegram: boolean
  shared: boolean
}

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
 *  ожидание фоновых субагентов — важнее простоя, ошибка хода — красный. */
export type SessionDot = 'confirm' | 'question' | 'busy' | 'waiting' | 'idle' | 'error'

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
  /** Кружок статуса: confirm > question > busy > waiting > idle > error. */
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

/** Триггер отложенного промпта: после хода сессии-источника или в конкретное время. */
export type ScheduledTrigger =
  | { kind: 'after'; sourceHostId: string; sourceTitle: string }
  | { kind: 'at'; atEpochMs: number }

/** Отложенный промпт (очередь сессий): уйдет в целевую сессию по триггеру.
 *  loop != null — после отправки стартовать петлю (как обычная отправка с галкой «Петля»). */
export interface ScheduledPrompt {
  id: string
  targetHostId: string
  targetTitle: string
  project: ProjectEntry
  text: string
  images: string[]
  /** Настройки, зафиксированные при планировании; применяются перед отправкой (у занятой цели — пропускаются). */
  model: string | null
  thinkingLevel: string | null
  trigger: ScheduledTrigger
  loop: { maxIterations: number; exitCondition: string } | null
  createdAt: number
}

export interface SchedulePromptInput {
  targetHostId: string
  text: string
  images?: string[]
  model?: string | null
  thinkingLevel?: string | null
  trigger: ScheduledTrigger
  loop?: { maxIterations: number; exitCondition: string } | null
}

export interface ScheduledListResult {
  ok: boolean
  error: string | null
  items: ScheduledPrompt[]
}

export interface ForkSessionResult {
  ok: boolean
  error: string | null
  /** id нового хоста (форкнутой сессии) — при успехе. */
  hostId?: string
}

/** Разбивка токенов контекста сессии (оценка chars/4 по сообщениям; остаток — системный промпт и инструменты). */
export interface ContextBreakdownData {
  /** Токены контекста из последнего usage ассистента (totalTokens); null — ходов ещё не было. */
  contextTokens: number | null
  userMessages: number
  assistantText: number
  assistantToolCalls: number
  toolResults: number
  other: number
  /** Остаток: системный промпт, схемы инструментов, MCP, навыки. 0 — если contextTokens null. */
  systemAndTools: number
}

export interface ContextBreakdownResult {
  ok: boolean
  error: string | null
  breakdown: ContextBreakdownData | null
}

export interface SessionCommandsResult {
  ok: boolean
  error: string | null
  commands: PiSlashCommand[]
}

export interface PromptResult {
  ok: boolean
  error: string | null
  /** Тексты, не попавшие обратно в очередь (abort/clear/remove) — renderer возвращает их в поле ввода. */
  cleared?: QueueTexts
}

export interface RewindResult {
  ok: boolean
  error: string | null
  /** true — код восстановлен из чекпоинта; false — чекпоинта не было (откат только сессии);
   *  null — проверка не выполнялась (ошибка до неё). */
  codeRestored: boolean | null
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
  author: string
  /** Unix-время коммита (секунды). */
  date: number
  parents: string[]
  /** Имена ref'ов, указывающих на коммит (ветки/теги, без origin/ префикса удалений — как отдал git). */
  refs: string[]
}

/** Строка списка изменений коммита (`git diff-tree --name-status`). */
export interface GitCommitFileEntry {
  status: string
  path: string
  origPath: string | null
}

export interface GitCommitFilesResult extends GitOpResult {
  files: GitCommitFileEntry[]
}

export interface GitOpResult {
  ok: boolean
  error: string | null
}

/** Синк локальной ветки с upstream: количества коммитов на push/pull (из %(upstream:track)). */
export interface GitBranchSync {
  name: string
  upstream: string | null
  ahead: number
  behind: number
  /** upstream задан, но отсутствует на remote (удалён). */
  gone: boolean
}

export interface GitBranchSyncResult extends GitOpResult {
  branches: GitBranchSync[]
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
  /** false — следующей страницы нет (вернули меньше запрошенного). */
  hasMore: boolean
}

/** Фильтр страницы лога: подстрока сообщения (или префикс хэша), ветка и/или репозиторий. */
export interface GitLogFilter {
  /** Подстрока сообщения без регистра; 4+ hex-символа дополнительно ищутся как префикс хэша. */
  query?: string
  /** Имя ветки (локальной или origin/...); null/undefined — текущий HEAD. */
  branch?: string | null
  /** Все ветки (локальные, remote-tracking, теги); перекрывает branch. */
  all?: boolean
  /** Вложенный репозиторий: путь от корня проекта (один сегмент); undefined — сам проект. */
  repo?: string
}

export interface GitCommitFileDiffResult extends GitOpResult {
  original: string
  modified: string
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

/** Локальные ветки репозитория (`git branch --list`; all — плюс remote-tracking). */
export interface GitBranchesResult extends GitOpResult {
  branches: string[]
}

/** Репозиторий проекта: rel — путь от корня проекта ('' — сам проект), name — подпись в UI. */
export interface GitRepoInfo {
  rel: string
  name: string
}

/** Список репозиториев проекта: сам проект + вложенные (каталоги с собственным .git). */
export interface GitReposResult extends GitOpResult {
  repos: GitRepoInfo[]
}

/** Состояние sequencer'а git: rebase (REBASE_HEAD) или merge (MERGE_HEAD) в процессе. */
export type GitSequencerState = 'none' | 'rebase' | 'merge'

export interface GitConflictStateResult extends GitOpResult {
  state: GitSequencerState
  /** Корень репозитория в состоянии конфликта (вложенный репо); null — каталог проекта. */
  repoRoot: string | null
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

/** Плоский список файлов проекта для поиска (относительные пути, слэши вперёд, без тяжёлых каталогов). */
export interface FilesSearchResult {
  ok: boolean
  error: string | null
  files: string[]
}

export interface FileRenameResult {
  ok: boolean
  error: string | null
}

/** Канбан: сводка доски для списка. */
export interface KanbanBoardSummary {
  id: string
  name: string
  rev: number
  columns: number
  cards: number
}

export interface KanbanBoardsResult extends GitOpResult {
  boards: KanbanBoardSummary[]
}

export interface KanbanBoardResult extends GitOpResult {
  board: KanbanBoard | null
}

/** Мутация доски: возвращает обновлённую доску (renderer обновляет стор без перечитывания). */
export interface KanbanMutationResult extends GitOpResult {
  board: KanbanBoard | null
}

export interface KanbanCardCreateInput {
  title: string
  description?: string
  columnId?: string
}

export interface KanbanCardUpdateInput {
  id: string
  title?: string
  description?: string
  /** Полная замена списка картинок (пути из kanban:attachment-put); undefined — не трогать. */
  images?: string[]
  /** rev снимка UI; не совпадает с доской на диске → ошибка «обнови доску» вместо затирания правок агента. */
  rev?: number
}

export interface KanbanCardMoveInput {
  id: string
  columnId: string
  index?: number
}

export interface KanbanColumnCardsMoveInput {
  id: string
  targetColumnId: string
}

/** Правка своего комментария: только author === 'user'. */
export interface KanbanCommentUpdateInput {
  cardId: string
  commentId: string
  text: string
  images?: string[]
  /** rev снимка UI; не совпадает с доской на диске → ошибка «обнови доску» вместо затирания правок агента. */
  rev?: number
}

/** Комментарий от пользователя: id/author/at проставляет сервис. */
export interface KanbanCommentInput {
  cardId: string
  text: string
  session?: KanbanSessionRef
  commits?: KanbanCommitRef[]
  images?: string[]
}

/** base64 → `.pi/kanban/attachments/`; path — относительный путь внутри `.pi/kanban`. */
export interface KanbanAttachmentResult extends GitOpResult {
  name: string
  path: string
}

/** Чтение картинки вложения канбана: dataUrl для <img> (пустая строка при ошибке). */
export interface KanbanAttachmentGetResult extends GitOpResult {
  dataUrl: string
}

/** Список пользовательских тем канбана (дефолтные темы — в коде, shared/kanban-theme.ts). */
export interface KanbanThemeListResult extends GitOpResult {
  themes: KanbanTheme[]
}

/** Импорт тем диалогом: imported — новых id, skipped — перезаписанных; error 'cancelled' — отмена диалога. */
export interface KanbanThemeImportResult extends KanbanThemeListResult {
  imported: number
  skipped: number
}

/** Экспорт темы диалогом «Сохранить»: path — записанный файл. */
export interface KanbanThemeExportResult extends GitOpResult {
  path: string
}

/** Экспорт темы в веб-режим: json — содержимое файла, name — имя для скачивания. */
export interface KanbanThemeExportDataResult extends GitOpResult {
  name: string
  json: string
}

/** Обзор папок на машине сервера (веб-режим, выбор проекта без нативного диалога). */
export interface FsListDirResult {
  ok: boolean
  error: string | null
  path: string
  /** Родительский каталог или null (корень диска / «/"). */
  parent: string | null
  dirs: string[]
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

export type TerminalProfileId = 'powershell' | 'cmd' | 'gitbash' | 'wsl' | 'ssh' | 'bash' | 'zsh' | 'fish'

export const TERMINAL_PROFILE_IDS: readonly TerminalProfileId[] = [
  'powershell',
  'cmd',
  'gitbash',
  'wsl',
  'ssh',
  'bash',
  'zsh',
  'fish'
]

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

/** Явные секреты для проверки/браузера несохранённого сервера (черновик из UI). */
export interface SshSecretInput {
  password?: string
  keyPassphrase?: string
}

export interface SshTestResult {
  ok: boolean
  error: string | null
  fingerprint: string | null
  home: string | null
  piPath: string | null
}

export interface SshDirEntry {
  name: string
  isDir: boolean
}

export interface SshListDirResult {
  ok: boolean
  error: string | null
  path: string
  entries: SshDirEntry[]
}

export interface SshSecretStatus {
  hasPassword: boolean
  hasKeyPassphrase: boolean
}

export interface SshOpResult {
  ok: boolean
  error: string | null
}

/** Явные секреты подключения БД для test/save несохранённого черновика из UI. */
export interface DbSecretInput {
  password?: string
  sshPassword?: string
  sshKeyPassphrase?: string
}

export interface DbTestResult {
  ok: boolean
  error: string | null
  /** Строка version() сервера при успехе. */
  serverVersion: string | null
}

export interface DbColumn {
  name: string
  type: string | null
}

export interface DbSchemasResult {
  ok: boolean
  error: string | null
  schemas: string[]
}

export interface DbTablesResult {
  ok: boolean
  error: string | null
  tables: string[]
}

/** Фильтр колонки таблицы: значение уходит только параметром запроса. */
export interface DbTableFilter {
  column: string
  value: string
}

export interface DbTableOrder {
  column: string
  desc: boolean
}

export interface DbTableDataInput {
  connectionId: string
  schema: string
  table: string
  limit: number
  offset: number
  orderBy?: DbTableOrder | null
  filters?: DbTableFilter[]
}

export interface DbTableDataResult {
  ok: boolean
  error: string | null
  columns: DbColumn[]
  rows: unknown[][]
  /** count(*) с таймаутом; null — не успели посчитать (UI показывает «≥ N»). */
  total: number | null
  /** Колонки первичного ключа; пусто — таблица read-only (редактирование запрещено). */
  primaryKeys: string[]
}

/** Одна правка буфера таблицы: значения — строки из UI (null = NULL). */
export interface DbPendingChange {
  kind: 'insert' | 'update' | 'delete'
  /** Значения PK-колонок строки (для update/delete). */
  keys: Record<string, string | null>
  /** Новые значения колонок (update — изменённые, insert — все заданные). */
  values: Record<string, string | null>
}

export interface DbSubmitInput {
  connectionId: string
  schema: string
  table: string
  primaryKeys: string[]
  changes: DbPendingChange[]
}

export interface DbSubmitPreviewResult {
  ok: boolean
  error: string | null
  statements: string[]
}

export interface DbSubmitResult {
  ok: boolean
  error: string | null
  rowsAffected: number | null
}

export interface DbQueryResult {
  ok: boolean
  error: string | null
  columns: DbColumn[]
  rows: unknown[][]
  rowsAffected: number | null
  isSelect: boolean
}

export interface DbConnectionsResult {
  ok: boolean
  error: string | null
  connections: DbConnectionEntry[]
}

export interface DbOpResult {
  ok: boolean
  error: string | null
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

/** Расхождение версии протокола демона (пережил обновление): решить — остановить или продолжить. */
export interface DaemonSkewInfo {
  daemonProto: number
  appProto: number
  daemonAppVersion: string
}

/** Одна фоновая сессия демона (строка попапа счётчика «N в фоне»). */
export interface DaemonBgSession {
  sessionKey: string
  sessionFile: string | null
  mode: BackendMode
  /** Каталог проекта (cwd спавна). */
  projectDir: string
  /** Имя сессии; null — не задано (показываем имя файла сессии). */
  title: string | null
  /** Идёт ход агента. */
  streaming: boolean
}

/** Состояние демона фоновых сессий (индикатор в футере панели проектов). */
export interface DaemonStatus {
  /** Живой канал к демону (подключён прямо сейчас). */
  alive: boolean
  /** Дети демона без клиентов — фоновые сессии. */
  background: number
  /** Нерешённое расхождение версии протокола. */
  skew: DaemonSkewInfo | null
  /** Список фоновых сессий (для попапа по клику на счётчик). */
  sessions: DaemonBgSession[]
}

/** Результат «Остановить фоновые сессии». */
export interface DaemonStopResult {
  ok: boolean
  stopped: number
  error: string | null
}

/** Состояние remote-моста (вкладка General). */
export interface RemoteStatus {
  running: boolean
  port: number
  pin: string
  lanAddresses: string[]
  /** Код последней неудачи старта (EADDRINUSE, EACCES), null — сервер слушает или попыток не было. */
  error: string | null
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

export type StatsWindowKind = 'day' | 'month' | 'year' | 'custom'
export type StatsGranularity = 'hour' | 'day' | 'month'

/** Окно статистики: day = последние сутки (почасово), month/year = текущий календарный,
 *  custom = произвольный месяц (детализация по дням). project/model: null = без фильтра. */
export interface StatsQuery {
  kind: StatsWindowKind
  month?: number
  year?: number
  project: string | null
  model: string | null
}

export interface StatsPoint {
  /** Начало бакета (epoch ms, локальное время). */
  t: number
  input: number
  output: number
  cacheRead: number
}

export interface StatsProjectOption {
  /** Нормализованный cwd проекта (worktree свёрнут в основной проект). */
  key: string
  name: string
}

export interface StatsResult {
  granularity: StatsGranularity
  /** Непрерывные бакеты окна, включая пустые (нули). */
  points: StatsPoint[]
  projects: StatsProjectOption[]
  models: string[]
  updatedAt: number
}

/** Один релиз в истории изменений (тело без хэшей коммитов). */
export interface ChangelogRelease {
  /** Версия без ведущего 'v' (из тега). */
  version: string
  /** Дата публикации (YYYY-MM-DD). */
  date: string
  /** Markdown-тело релиза (пусто, если заполнено bodyHtml). */
  body: string
  /** Готовый санитизированный HTML (фолбэк Atom-фида); приоритетнее body. */
  bodyHtml?: string
}

export interface ChangelogResult {
  ok: boolean
  /** Новые сверху. */
  releases: ChangelogRelease[]
  /** true — сеть недоступна, показан кэш из прошлого успешного запроса. */
  stale: boolean
  error: string | null
}

/** Обновление установлено: с какой версии перезапустилось приложение (null — обновления не было). */
export interface UpdateInfo {
  updatedFrom: string | null
}

/** Живой статус проверки обновлений: найденная версия и фаза загрузки. */
export interface UpdateStatus {
  /** Доступная новая версия (null — обновления не найдено или версия скрыта пользователем). */
  availableVersion: string | null
  /** idle — ждёт решения пользователя; downloading — идёт загрузка; downloaded — скачано,
   *  ждёт «Перезапустить, чтобы обновить»; error — загрузка не удалась. */
  phase: 'idle' | 'downloading' | 'downloaded' | 'error'
}

export interface PiWrightApi {
  /** process.platform main-процесса: renderer платформо-слепой, UI-ветки (WSL и пр.) — отсюда. */
  readonly platform: 'win32' | 'darwin' | 'linux'
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  revealSettings(): Promise<{ ok: boolean; error: string | null }>
  /** Пункт «Настройки» в меню приложения (File): renderer открывает оверлей настроек. */
  onMenuSettings(cb: () => void): () => void
  /** Пункт «Статистика» в меню приложения (File): renderer открывает оверлей статистики. */
  onMenuStats(cb: () => void): () => void
  /** Агрегаты токенов по всем проектам за выбранное окно. */
  statsQuery(query: StatsQuery): Promise<StatsResult>
  appVersion(): Promise<string>
  /** История изменений с фида GitHub Releases (кэш в userData на случай офлайна). */
  changelog(): Promise<ChangelogResult>
  /** Обнаружение обновления: сравнение версии прошлого запуска с текущей. */
  updateInfo(): Promise<UpdateInfo>
  /** Текущий статус проверки обновлений (автозагрузка выключена — решение за пользователем). */
  updateStatus(): Promise<UpdateStatus>
  /** Push статуса обновлений (найдена новая версия, фазы загрузки). */
  onUpdateEvent(cb: (status: UpdateStatus) => void): () => void
  /** Скачать найденное обновление (после загрузки появится кнопка перезапуска). */
  downloadUpdate(): Promise<UpdateStatus>
  /** Перезапустить приложение и установить скачанное обновление (фаза downloaded). */
  installUpdate(): Promise<UpdateStatus>
  /** «Не предлагать эту версию»: скрыть баннер до выхода более новой версии. */
  dismissUpdate(): Promise<UpdateStatus>
  /** Только dev (smoke): эмулировать найденное обновление (null — сбросить; phase — эмуляция завершённой загрузки). */
  updateDevEmit(version: string | null, phase?: 'idle' | 'downloaded'): Promise<UpdateStatus>
  listSessions(): Promise<SessionsSnapshot>
  sessionHistory(project: ProjectEntry): Promise<SessionSummary[]>
  /** Транскрипт сессии без запуска pi: UiEvent-ы из JSONL (для просмотра сессии субагента). */
  sessionTranscript(project: ProjectEntry, sessionPath: string): Promise<SessionTranscriptResult>
  newSession(project: ProjectEntry): Promise<HostRef>
  openSession(project: ProjectEntry, sessionFile: string): Promise<SessionOpenResult>
  /** keepAlive=true (крестик вкладки) — отключиться от сессии, ребёнок демона живёт;
   *  false/undefined — остановить процесс («Остановить сессию», worktree-пути). */
  closeSession(hostId: string, keepAlive?: boolean): Promise<PromptResult>
  /** Сессия уходит в фон (крестик при идущем ходе): процесс не трогать, забыть вкладку
   *  восстановления — после рестарта она не откроется заново. */
  backgroundSession(hostId: string): Promise<PromptResult>
  renameSession(hostId: string, name: string): Promise<PromptResult>
  deleteHistorySession(project: ProjectEntry, sessionPath: string): Promise<PromptResult>
  chooseProjectDir(kind: BackendMode): Promise<{ ok: boolean; dir: string | null }>
  /** Проверка SSH-сервера (соединение, host key, $HOME, путь pi); secret — черновик из UI. */
  sshTest(server: SshServerEntry, secret?: SshSecretInput | null): Promise<SshTestResult>
  /** Листинг каталога на сервере (браузер папок). */
  sshListDir(server: SshServerEntry, path: string, secret?: SshSecretInput | null): Promise<SshListDirResult>
  sshSecretStatus(serverId: string): Promise<SshSecretStatus>
  /** Частичная запись секрета; null — удалить поле. */
  sshSetSecret(serverId: string, patch: { password?: string | null; keyPassphrase?: string | null }): Promise<SshOpResult>
  sshForgetHostKey(server: SshServerEntry): Promise<SshOpResult>
  /** Список подключений БД проекта (из settings.projectDbConnections[projectKey]). */
  dbConnectionsList(projectKey: string): Promise<DbConnectionsResult>
  /** Сохранить подключение проекта (секреты — отдельным аргументом, в settings не попадают). */
  dbConnectionSave(projectKey: string, entry: DbConnectionEntry, secrets?: DbSecretInput | null): Promise<DbConnectionsResult>
  /** Удалить подключение проекта и его секреты; открытые соединения закрываются. */
  dbConnectionDelete(projectKey: string, connectionId: string): Promise<DbConnectionsResult>
  /** Проверка подключения: коннект (+туннель), version(); secrets — черновик из UI. */
  dbConnectionTest(entry: DbConnectionEntry, secrets?: DbSecretInput | null): Promise<DbTestResult>
  dbSchemas(connectionId: string): Promise<DbSchemasResult>
  dbTables(connectionId: string, schema: string): Promise<DbTablesResult>
  dbTableData(input: DbTableDataInput): Promise<DbTableDataResult>
  /** Превью SQL для буфера правок таблицы (без выполнения). */
  dbSubmitPreview(input: DbSubmitInput): Promise<DbSubmitPreviewResult>
  /** Применить буфер правок таблицы одной транзакцией. */
  dbSubmit(input: DbSubmitInput): Promise<DbSubmitResult>
  /** SQL в консоли запросов; SELECT возвращает грид, прочее — rowsAffected. */
  dbQuery(connectionId: string, sql: string): Promise<DbQueryResult>
  /** Закрыть пул соединений подключения (после правки конфига или вручную). */
  dbDisconnect(connectionId: string): Promise<DbOpResult>
  /** Показать каталог проекта в проводнике (WSL POSIX-путь конвертируется в UNC). */
  revealProject(project: ProjectEntry): Promise<{ ok: boolean; error: string | null }>
  prompt(hostId: string, text: string, images?: string[], behavior?: PromptBehavior): Promise<PromptResult>
  /** Редактировать отправленный промпт: fork сессии на момент сообщения + новый prompt; вся история после сообщения стирается. occurrence — номер вхождения текста среди промптов с конца (0 = последнее). */
  editPrompt(hostId: string, text: string, occurrence: number, newText: string): Promise<PromptResult>
  /** Откат сессии и кода к чекпоинту: fork сессии к промпту, следующему за ответом агента (вся история после ответа стирается), и восстановление рабочего дерева из снапшота перед этим промптом (текущее состояние уходит в git stash). occurrence — как в editPrompt. */
  rewindSession(hostId: string, text: string, occurrence: number): Promise<RewindResult>
  /** Форк сессии после ответа агента в новую сессию (родитель не меняется): userText — следующий за ответом промпт (null — клон всей сессии), occurrence — номер вхождения текста среди промптов с конца. */
  forkSession(hostId: string, userText: string | null, occurrence: number): Promise<ForkSessionResult>
  /** Стартовать петлю на сессии: промпт повторяется в новых сессиях, пока ход содержит вызовы инструментов; exitCondition дописывается в каждую итерацию, пустая строка — петля без условия выхода (только лимит итераций). */
  loopStart(hostId: string, prompt: string, maxIterations: number, exitCondition: string): Promise<PromptResult>
  /** Остановить петлю: следующая итерация не начнётся, текущий ход не прерывается. */
  loopStop(hostId: string): Promise<PromptResult>
  /** Изменить оставшееся число итераций активной петли. */
  loopSetRemaining(hostId: string, remaining: number): Promise<PromptResult>
  /** Состояние петли сессии (после перезагрузки renderer'а); null — петли нет. */
  loopGet(hostId: string): Promise<LoopInfo | null>
  /** Снимок всех состояний петель — App дотягивает его на маунте: loop_state реаттачей до
   *  создания окна (recovery-вкладки при старте) до рендерера не доходят. */
  loopsSnapshot(): Promise<{ hostId: string; info: LoopInfo }[]>
  abort(hostId: string): Promise<PromptResult>
  /** Очистить очередь целиком, тексты вернутся в cleared. */
  queueClear(hostId: string): Promise<PromptResult>
  /** Убрать один элемент очереди: clear_queue + повторная постановка остальных (при ходе). */
  queueRemove(hostId: string, kind: keyof QueueTexts, index: number): Promise<PromptResult>
  /** Снять элемент очереди в поле ввода (редактирование): остальные остаются в очереди. */
  queueTake(hostId: string, kind: keyof QueueTexts, index: number): Promise<PromptResult>
  /** Перевести элемент в другую очередь (followUp ↔ steering). */
  queueConvert(hostId: string, kind: keyof QueueTexts, index: number, toKind: keyof QueueTexts): Promise<PromptResult>
  /** Отложенный промпт (очередь сессий): запланировать отправку в целевую сессию. */
  schedulePrompt(input: SchedulePromptInput): Promise<PromptResult>
  /** Список отложенных промптов (переживает перезапуск, JSON в userData). */
  scheduledList(): Promise<ScheduledListResult>
  /** Отменить отложенную отправку по id. */
  scheduledCancel(id: string): Promise<PromptResult>
  /** Изменения списка отложенных (срабатывание/отмена/планирование в любом месте). */
  onScheduledChanged(cb: () => void): () => void
  /** Живой список slash-команд агента (`get_commands`, включая навыки) для автодополнения; фолбэк — команды хендшейка. */
  sessionCommands(hostId: string): Promise<SessionCommandsResult>
  /** Разбивка токенов контекста активной сессии (ленивая оценка по get_messages). */
  contextBreakdown(hostId: string): Promise<ContextBreakdownResult>
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
  /** Push конкретной ветки в её upstream (нет upstream — `push -u origin <branch>`); forceWithLease — `--force-with-lease`. */
  gitPushBranch(project: ProjectEntry, branch: string, forceWithLease: boolean): Promise<GitOpResult>
  /** Pull ветки: rebase/merge — только для текущей (`git pull`), ff — fast-forward апдейт не текущей (`fetch . <upstream>:<branch>`). */
  gitPullBranch(project: ProjectEntry, branch: string, mode: 'rebase' | 'merge' | 'ff'): Promise<GitOpResult>
  /** Ahead/behind по всем локальным веткам (для стрелок в селекторе веток). */
  gitBranchSync(project: ProjectEntry): Promise<GitBranchSyncResult>
  /** `git fetch --quiet` — обновить remote-tracking ref'ы (ahead/behind в статусе). */
  gitFetch(project: ProjectEntry): Promise<GitOpResult>
  gitLog(project: ProjectEntry, page?: number, filter?: GitLogFilter): Promise<GitLogResult>
  /** Репозитории проекта: сам проект + вложенные (для фильтра истории и группировки изменений). */
  gitRepos(project: ProjectEntry): Promise<GitReposResult>
  /** Список изменённых файлов коммита (diff против первого родителя); repo — вложенный репозиторий. */
  gitCommitFiles(project: ProjectEntry, hash: string, repo?: string): Promise<GitCommitFilesResult>
  /** Дифф файла в коммите: original = <hash>^:<path>, modified = <hash>:<path>; repo — вложенный репозиторий. */
  gitCommitFileDiff(project: ProjectEntry, hash: string, path: string, repo?: string): Promise<GitCommitFileDiffResult>
  gitBranches(project: ProjectEntry, all?: boolean, repo?: string): Promise<GitBranchesResult>
  /** create — `git checkout -b <name> [startPoint]` (создать и переключиться), иначе `git checkout <name>`; repo — вложенный репозиторий. */
  gitCheckout(project: ProjectEntry, name: string, create: boolean, startPoint?: string, repo?: string): Promise<GitOpResult>
  /** `git branch -m <oldName> <newName>`. */
  gitBranchRename(project: ProjectEntry, oldName: string, newName: string): Promise<GitOpResult>
  /** `git branch -d <name>` (безопасное удаление; неслитая ветка — ошибка git). */
  gitBranchDelete(project: ProjectEntry, name: string): Promise<GitOpResult>
  /** `git cherry-pick <hash>` в текущую ветку; repo — вложенный репозиторий. */
  gitCherryPick(project: ProjectEntry, hash: string, repo?: string): Promise<GitOpResult>
  /** `git revert --no-edit <hash>` — обратный коммит поверх HEAD; repo — вложенный репозиторий. */
  gitRevert(project: ProjectEntry, hash: string, repo?: string): Promise<GitOpResult>
  /** `git reset --<mode> <hash>`; mode — soft|mixed|hard; repo — вложенный репозиторий. */
  gitReset(project: ProjectEntry, hash: string, mode: 'soft' | 'mixed' | 'hard', repo?: string): Promise<GitOpResult>
  /** `git tag <name> <hash>`; repo — вложенный репозиторий. */
  gitTagCreate(project: ProjectEntry, name: string, hash: string, repo?: string): Promise<GitOpResult>
  /** Выкинуть коммит из истории: `git rebase --autostash --onto <hash>^ <hash>`; repo — вложенный репозиторий. */
  gitDropCommit(project: ProjectEntry, hash: string, repo?: string): Promise<GitOpResult>
  /** Новое сообщение коммита: HEAD — `commit --amend --only`, глубже — rebase -i reword; repo — вложенный репозиторий. */
  gitEditCommitMessage(project: ProjectEntry, hash: string, message: string, repo?: string): Promise<GitOpResult>
  /** Уплотнить коммит в родительский с новым сообщением (rebase -i squash); repo — вложенный репозиторий. */
  gitSquashInto(project: ProjectEntry, hash: string, message: string, repo?: string): Promise<GitOpResult>
  /** Состояние sequencer'а (rebase/merge в процессе) — для диалога Resolve Conflicts. */
  gitConflictState(project: ProjectEntry): Promise<GitConflictStateResult>
  /** Разрешить конфликт одной стороной: `checkout --ours|--theirs -- <path>` + `add`. */
  gitConflictResolve(project: ProjectEntry, path: string, side: 'ours' | 'theirs'): Promise<GitOpResult>
  /** Завершить rebase/merge после разрешения конфликтов (`rebase|merge --continue`). */
  gitConflictContinue(project: ProjectEntry): Promise<GitOpResult>
  /** Отменить rebase/merge (`--abort`). */
  gitConflictAbort(project: ProjectEntry): Promise<GitOpResult>
  /** `git rebase <onto>` — перебазировать текущую ветку на onto. */
  gitRebase(project: ProjectEntry, onto: string): Promise<GitOpResult>
  /** `git checkout <branch>`, затем `git rebase <onto>`. */
  gitCheckoutRebase(project: ProjectEntry, branch: string, onto: string): Promise<GitOpResult>
  gitGenerateMessage(project: ProjectEntry): Promise<GitMessageResult>
  /** `git worktree add` (существующий worktree/ветка переиспользуются); dir — для новой сессии. */
  worktreeCreate(project: ProjectEntry, name: string): Promise<WorktreeCreateResult>
  /** `git worktree remove [--force]`; ветку не трогает. closeHostIds — перед удалением закрыть эти сессии и дождаться выхода процессов. */
  worktreeRemove(project: ProjectEntry, name: string, force: boolean, closeHostIds?: string[]): Promise<WorktreeRemoveResult>
  filesList(project: ProjectEntry, dir: string): Promise<FileListResult>
  filesSearch(project: ProjectEntry): Promise<FilesSearchResult>
  filesRead(project: ProjectEntry, path: string): Promise<FileReadResult>
  filesReadImage(project: ProjectEntry, path: string): Promise<FileReadImageResult>
  filesWrite(project: ProjectEntry, path: string, content: string): Promise<FileWriteResult>
  filesRename(project: ProjectEntry, path: string, newName: string): Promise<FileRenameResult>
  filesDelete(project: ProjectEntry, path: string): Promise<FileWriteResult>
  filesMkdir(project: ProjectEntry, path: string): Promise<FileWriteResult>
  filesWatch(project: ProjectEntry, paths: string[]): Promise<GitOpResult>
  /** Reveal a project file/folder in the OS file explorer (selects it in the containing folder). */
  filesReveal(project: ProjectEntry, path: string): Promise<FileWriteResult>
  /** Открыть внешнюю ссылку (http/https/mailto) в системном браузере. */
  shellOpenExternal(url: string): Promise<GitOpResult>
  /** base64 → файл в `.pi/attachments/` (paste); name — желаемое, возвращается фактическое. */
  putAttachment(project: ProjectEntry, name: string, base64: string): Promise<AttachmentResult>
  kanbanBoards(project: ProjectEntry): Promise<KanbanBoardsResult>
  kanbanBoardGet(project: ProjectEntry, boardId: string): Promise<KanbanBoardResult>
  kanbanBoardCreate(project: ProjectEntry, name: string): Promise<KanbanBoardResult>
  kanbanBoardRename(project: ProjectEntry, boardId: string, name: string): Promise<KanbanMutationResult>
  kanbanBoardDelete(project: ProjectEntry, boardId: string): Promise<GitOpResult>
  kanbanCardCreate(project: ProjectEntry, boardId: string, input: KanbanCardCreateInput): Promise<KanbanMutationResult>
  kanbanCardUpdate(project: ProjectEntry, boardId: string, input: KanbanCardUpdateInput): Promise<KanbanMutationResult>
  kanbanCardDelete(project: ProjectEntry, boardId: string, cardId: string): Promise<KanbanMutationResult>
  kanbanCardMove(project: ProjectEntry, boardId: string, input: KanbanCardMoveInput): Promise<KanbanMutationResult>
  kanbanCardComment(project: ProjectEntry, boardId: string, input: KanbanCommentInput): Promise<KanbanMutationResult>
  kanbanCommentUpdate(project: ProjectEntry, boardId: string, input: KanbanCommentUpdateInput): Promise<KanbanMutationResult>
  kanbanCommentDelete(project: ProjectEntry, boardId: string, cardId: string, commentId: string): Promise<KanbanMutationResult>
  kanbanColumnCreate(project: ProjectEntry, boardId: string, name: string): Promise<KanbanMutationResult>
  kanbanColumnRename(project: ProjectEntry, boardId: string, columnId: string, name: string): Promise<KanbanMutationResult>
  kanbanColumnDelete(project: ProjectEntry, boardId: string, columnId: string): Promise<KanbanMutationResult>
  kanbanColumnMove(project: ProjectEntry, boardId: string, columnId: string, index: number): Promise<KanbanMutationResult>
  kanbanColumnClear(project: ProjectEntry, boardId: string, columnId: string): Promise<KanbanMutationResult>
  kanbanColumnCardsMove(project: ProjectEntry, boardId: string, input: KanbanColumnCardsMoveInput): Promise<KanbanMutationResult>
  kanbanWorkflowSet(project: ProjectEntry, boardId: string, text: string): Promise<KanbanMutationResult>
  kanbanAttachmentPut(project: ProjectEntry, name: string, base64: string): Promise<KanbanAttachmentResult>
  kanbanAttachmentGet(project: ProjectEntry, path: string): Promise<KanbanAttachmentGetResult>
  /** Пользовательские темы досок (без дефолтных — они в коде). */
  kanbanThemeList(): Promise<KanbanThemeListResult>
  /** Диалог «Открыть» → импорт JSON-тем (одна тема, массив или { version, themes }). */
  kanbanThemeImport(): Promise<KanbanThemeImportResult>
  /** Диалог «Сохранить» → экспорт темы; id `*` — все пользовательские темы. */
  kanbanThemeExport(id: string): Promise<KanbanThemeExportResult>
  /** Веб-режим: импорт JSON-тем из строки (содержимое файла, выбранного в браузере). */
  kanbanThemeImportData(json: string): Promise<KanbanThemeImportResult>
  /** Веб-режим: экспорт темы строкой (браузер скачивает файл сам). */
  kanbanThemeExportData(id: string): Promise<KanbanThemeExportDataResult>
  kanbanThemeDelete(id: string): Promise<KanbanThemeListResult>
  /** Диалог выбора файла → копия в `.pi/attachments/`. */
  chooseAttachment(project: ProjectEntry): Promise<AttachmentResult>
  soundsRead(path: string): Promise<SoundReadResult>
  soundsChoose(): Promise<{ ok: boolean; error: string | null; path: string }>
  /** Веб-режим: загрузка звукового файла из браузера → копия в userData/sounds. */
  soundsUpload(name: string, base64: string): Promise<{ ok: boolean; error: string | null; path: string }>
  /** Веб-режим: обзор папок машины сервера (выбор проекта без нативного диалога). */
  fsListDir(path: string): Promise<FsListDirResult>
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
  /** Немедленная повторная попытка поднять remote-сервер (кнопка «Повторить»); false — нечего повторять. */
  remoteRetry(): Promise<boolean>
  /** Состояние демона фоновых сессий: жив ли канал и сколько детей без клиентов (фоновых). */
  daemonStatus(): Promise<DaemonStatus>
  /** «Остановить фоновые сессии»: kill детей демона без клиентов; stopped — сколько убито. */
  stopBackgroundSessions(): Promise<DaemonStopResult>
  /** Ответ на диалог version-skew: true — погасить старый демон, false — продолжить с ним. */
  resolveVersionSkew(stop: boolean): Promise<{ ok: boolean }>
  /** Push при расхождении protoVersion (демон от старой версии пережил обновление). */
  onDaemonSkew(cb: (info: DaemonSkewInfo) => void): () => void
  modelsList(backend: BackendMode, serverId?: string): Promise<ModelsListResult>
  modelsSave(backend: BackendMode, doc: unknown, serverId?: string): Promise<ModelsOpResult>
  modelsReveal(backend: BackendMode, serverId?: string): Promise<ModelsOpResult>
 modelsRefresh(): Promise<void>
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
export const APP_MENU_SETTINGS_CHANNEL = 'app:menu-settings'
export const APP_MENU_STATS_CHANNEL = 'app:menu-stats'
export const STATS_QUERY_CHANNEL = 'stats:query'
export const APP_VERSION_CHANNEL = 'app:version'
export const APP_CHANGELOG_CHANNEL = 'app:changelog'
export const APP_UPDATE_INFO_CHANNEL = 'app:update-info'
export const APP_UPDATE_STATUS_CHANNEL = 'app:update-status'
export const APP_UPDATE_EVENT_CHANNEL = 'app:update-event'
export const APP_UPDATE_DOWNLOAD_CHANNEL = 'app:update-download'
export const APP_UPDATE_INSTALL_CHANNEL = 'app:update-install'
export const APP_UPDATE_DISMISS_CHANNEL = 'app:update-dismiss'
export const APP_UPDATE_DEV_EMIT_CHANNEL = 'app:update-dev-emit'
export const SESSIONS_LIST_CHANNEL = 'sessions:list'
export const SESSIONS_HISTORY_CHANNEL = 'sessions:history'
export const SESSIONS_TRANSCRIPT_CHANNEL = 'sessions:transcript'
export const SESSIONS_NEW_CHANNEL = 'sessions:new'
export const SESSIONS_OPEN_CHANNEL = 'sessions:open'
export const SESSIONS_CLOSE_CHANNEL = 'sessions:close'
export const SESSIONS_BACKGROUND_CHANNEL = 'sessions:background'
export const SESSIONS_RENAME_CHANNEL = 'sessions:rename'
export const SESSIONS_DELETE_HISTORY_CHANNEL = 'sessions:delete-history'
export const SESSIONS_CHOOSE_DIR_CHANNEL = 'sessions:choose-dir'
export const SSH_TEST_CHANNEL = 'ssh:test'
export const SSH_LIST_DIR_CHANNEL = 'ssh:list-dir'
export const SSH_SECRET_STATUS_CHANNEL = 'ssh:secret-status'
export const SSH_SET_SECRET_CHANNEL = 'ssh:set-secret'
export const SSH_FORGET_HOST_KEY_CHANNEL = 'ssh:forget-host-key'
export const DB_CONNECTIONS_LIST_CHANNEL = 'db:connections-list'
export const DB_CONNECTION_SAVE_CHANNEL = 'db:connection-save'
export const DB_CONNECTION_DELETE_CHANNEL = 'db:connection-delete'
export const DB_CONNECTION_TEST_CHANNEL = 'db:connection-test'
export const DB_SCHEMAS_CHANNEL = 'db:schemas'
export const DB_TABLES_CHANNEL = 'db:tables'
export const DB_TABLE_DATA_CHANNEL = 'db:table-data'
export const DB_SUBMIT_PREVIEW_CHANNEL = 'db:submit-preview'
export const DB_SUBMIT_CHANNEL = 'db:submit'
export const DB_QUERY_CHANNEL = 'db:query'
export const DB_DISCONNECT_CHANNEL = 'db:disconnect'
export const PROJECTS_REVEAL_CHANNEL = 'projects:reveal'
export const SESSION_PROMPT_CHANNEL = 'session:prompt'
export const SESSION_EDIT_PROMPT_CHANNEL = 'session:edit-prompt'
export const SESSION_REWIND_CHANNEL = 'session:rewind'
export const SESSION_FORK_CHANNEL = 'session:fork'
export const LOOP_START_CHANNEL = 'loop:start'
export const LOOP_STOP_CHANNEL = 'loop:stop'
export const LOOP_SET_REMAINING_CHANNEL = 'loop:set-remaining'
export const LOOP_GET_CHANNEL = 'loop:get'
export const LOOPS_SNAPSHOT_CHANNEL = 'loops:snapshot'
export const SESSION_ABORT_CHANNEL = 'session:abort'
export const SESSION_QUEUE_CLEAR_CHANNEL = 'session:queue-clear'
export const SESSION_QUEUE_REMOVE_CHANNEL = 'session:queue-remove'
export const SESSION_QUEUE_TAKE_CHANNEL = 'session:queue-take'
export const SESSION_QUEUE_CONVERT_CHANNEL = 'session:queue-convert'
export const SESSION_SCHEDULE_CHANNEL = 'session:schedule'
export const SESSION_SCHEDULED_LIST_CHANNEL = 'session:scheduled-list'
export const SESSION_SCHEDULED_CANCEL_CHANNEL = 'session:scheduled-cancel'
export const SCHEDULED_CHANGED_CHANNEL = 'scheduled:changed'
export const SESSION_SET_MODEL_CHANNEL = 'session:set-model'
export const SESSION_COMMANDS_CHANNEL = 'session:commands'
export const SESSION_CONTEXT_BREAKDOWN_CHANNEL = 'session:context-breakdown'
export const SESSION_SET_THINKING_CHANNEL = 'session:set-thinking'
export const SESSION_RESPOND_DIALOG_CHANNEL = 'session:respond-dialog'
export const SESSION_PENDING_DIALOGS_CHANNEL = 'session:pending-dialogs'
export const GIT_STATUS_CHANNEL = 'git:status'
export const GIT_FILE_DIFF_CHANNEL = 'git:file-diff'
export const GIT_STAGE_CHANNEL = 'git:stage'
export const GIT_UNSTAGE_CHANNEL = 'git:unstage'
export const GIT_COMMIT_CHANNEL = 'git:commit'
export const GIT_PUSH_CHANNEL = 'git:push'
export const GIT_PUSH_BRANCH_CHANNEL = 'git:push-branch'
export const GIT_PULL_BRANCH_CHANNEL = 'git:pull-branch'
export const GIT_BRANCH_SYNC_CHANNEL = 'git:branch-sync'
export const GIT_FETCH_CHANNEL = 'git:fetch'
export const GIT_LOG_CHANNEL = 'git:log'
export const GIT_REPOS_CHANNEL = 'git:repos'
export const GIT_COMMIT_FILES_CHANNEL = 'git:commit-files'
export const GIT_COMMIT_FILE_DIFF_CHANNEL = 'git:commit-file-diff'
export const GIT_BRANCHES_CHANNEL = 'git:branches'
export const GIT_CHECKOUT_CHANNEL = 'git:checkout'
export const GIT_BRANCH_RENAME_CHANNEL = 'git:branch-rename'
export const GIT_BRANCH_DELETE_CHANNEL = 'git:branch-delete'
export const GIT_CHERRY_PICK_CHANNEL = 'git:cherry-pick'
export const GIT_REVERT_CHANNEL = 'git:revert'
export const GIT_RESET_CHANNEL = 'git:reset'
export const GIT_TAG_CREATE_CHANNEL = 'git:tag-create'
export const GIT_DROP_COMMIT_CHANNEL = 'git:drop-commit'
export const GIT_EDIT_MESSAGE_CHANNEL = 'git:edit-message'
export const GIT_SQUASH_INTO_CHANNEL = 'git:squash-into'
export const GIT_CONFLICT_STATE_CHANNEL = 'git:conflict-state'
export const GIT_CONFLICT_RESOLVE_CHANNEL = 'git:conflict-resolve'
export const GIT_CONFLICT_CONTINUE_CHANNEL = 'git:conflict-continue'
export const GIT_CONFLICT_ABORT_CHANNEL = 'git:conflict-abort'
export const GIT_REBASE_CHANNEL = 'git:rebase'
export const GIT_CHECKOUT_REBASE_CHANNEL = 'git:checkout-rebase'
export const GIT_GENERATE_MESSAGE_CHANNEL = 'git:generate-message'
export const WORKTREE_CREATE_CHANNEL = 'worktree:create'
export const WORKTREE_REMOVE_CHANNEL = 'worktree:remove'
export const FILES_LIST_CHANNEL = 'files:list'
export const FILES_SEARCH_CHANNEL = 'files:search'
export const FILES_READ_CHANNEL = 'files:read'
export const FILES_READ_IMAGE_CHANNEL = 'files:read-image'
export const FILES_WRITE_CHANNEL = 'files:write'
export const FILES_RENAME_CHANNEL = 'files:rename'
export const FILES_DELETE_CHANNEL = 'files:delete'
export const FILES_MKDIR_CHANNEL = 'files:mkdir'
export const FILES_WATCH_CHANNEL = 'files:watch'
export const FILES_REVEAL_CHANNEL = 'files:reveal'
export const SHELL_OPEN_EXTERNAL_CHANNEL = 'shell:open-external'
export const FILES_CHANGED_CHANNEL = 'files:changed'
export const ATTACHMENTS_PUT_CHANNEL = 'attachments:put'
export const ATTACHMENTS_CHOOSE_CHANNEL = 'attachments:choose'
export const KANBAN_BOARDS_CHANNEL = 'kanban:boards'
export const KANBAN_BOARD_GET_CHANNEL = 'kanban:board-get'
export const KANBAN_BOARD_CREATE_CHANNEL = 'kanban:board-create'
export const KANBAN_BOARD_RENAME_CHANNEL = 'kanban:board-rename'
export const KANBAN_BOARD_DELETE_CHANNEL = 'kanban:board-delete'
export const KANBAN_CARD_CREATE_CHANNEL = 'kanban:card-create'
export const KANBAN_CARD_UPDATE_CHANNEL = 'kanban:card-update'
export const KANBAN_CARD_DELETE_CHANNEL = 'kanban:card-delete'
export const KANBAN_CARD_MOVE_CHANNEL = 'kanban:card-move'
export const KANBAN_CARD_COMMENT_CHANNEL = 'kanban:card-comment'
export const KANBAN_COMMENT_UPDATE_CHANNEL = 'kanban:comment-update'
export const KANBAN_COMMENT_DELETE_CHANNEL = 'kanban:comment-delete'
export const KANBAN_COLUMN_CREATE_CHANNEL = 'kanban:column-create'
export const KANBAN_COLUMN_RENAME_CHANNEL = 'kanban:column-rename'
export const KANBAN_COLUMN_DELETE_CHANNEL = 'kanban:column-delete'
export const KANBAN_COLUMN_MOVE_CHANNEL = 'kanban:column-move'
export const KANBAN_COLUMN_CLEAR_CHANNEL = 'kanban:column-clear'
export const KANBAN_COLUMN_CARDS_MOVE_CHANNEL = 'kanban:column-cards-move'
export const KANBAN_WORKFLOW_SET_CHANNEL = 'kanban:workflow-set'
export const KANBAN_ATTACHMENT_PUT_CHANNEL = 'kanban:attachment-put'
export const KANBAN_ATTACHMENT_GET_CHANNEL = 'kanban:attachment-get'
export const KANBAN_THEME_LIST_CHANNEL = 'kanban:theme-list'
export const KANBAN_THEME_IMPORT_CHANNEL = 'kanban:theme-import'
export const KANBAN_THEME_EXPORT_CHANNEL = 'kanban:theme-export'
export const KANBAN_THEME_IMPORT_DATA_CHANNEL = 'kanban:theme-import-data'
export const KANBAN_THEME_EXPORT_DATA_CHANNEL = 'kanban:theme-export-data'
export const KANBAN_THEME_DELETE_CHANNEL = 'kanban:theme-delete'
export const SOUNDS_READ_CHANNEL = 'sounds:read'
export const SOUNDS_CHOOSE_CHANNEL = 'sounds:choose'
export const SOUNDS_UPLOAD_CHANNEL = 'sounds:upload'
export const FS_LIST_DIR_CHANNEL = 'fs:list-dir'
export const TELEGRAM_SET_TOKEN_CHANNEL = 'telegram:set-token'
export const TELEGRAM_TOKEN_STATUS_CHANNEL = 'telegram:token-status'
export const TELEGRAM_TEST_CHANNEL = 'telegram:test'
export const TELEGRAM_TOGGLE_SESSION_CHANNEL = 'telegram:toggle-session'
export const REMOTE_STATUS_CHANNEL = 'remote:status'
export const REMOTE_CHECK_PORT_CHANNEL = 'remote:check-port'
export const REMOTE_RETRY_CHANNEL = 'remote:retry'
export const REMOTE_SHARE_SESSION_CHANNEL = 'remote:share-session'
export const DAEMON_STATUS_CHANNEL = 'daemon:status'
export const DAEMON_STOP_BACKGROUND_CHANNEL = 'daemon:stop-background'
export const DAEMON_SKEW_CHANNEL = 'daemon:skew'
export const DAEMON_RESOLVE_SKEW_CHANNEL = 'daemon:resolve-skew'
export const MODELS_LIST_CHANNEL = 'models:list'
export const MODELS_SAVE_CHANNEL = 'models:save'
export const MODELS_REVEAL_CHANNEL = 'models:reveal'
export const MODELS_REFRESH_CHANNEL = 'models:refresh'
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
