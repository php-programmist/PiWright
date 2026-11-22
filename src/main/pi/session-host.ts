/** Одна pi-сессия: ленивый старт, хендшейк, трансляция событий, диалоги расширений,
 *  abort/модель/thinking/переименование, рестарт после падения с `--session <путь>` и реплеем истории.
 *  Порт жизненного цикла `PiSession`. Реестр хостов — `PiHost`. */
import { randomUUID } from 'node:crypto'
import type { DialogAnswer, ExtensionDialog, UiEvent } from '../../shared/agent-events'
import type { DialogResult, PiStatus, PromptBehavior, PromptResult, ProjectEntry, QueueTexts, Settings } from '../../shared/ipc-contracts'
import type { PiJsonObject, PiSlashCommand } from '../../shared/protocol-types'
import type { PiHandshakeResult, PiResponse } from '../../shared/protocol-types'
import type { PiModelInfo } from '../../shared/protocol-types'
import type { PiBackend } from './backends/types'
import { PiConnection } from './connection'
import { createPiBackend } from './backends/factory'
import type { CreateBackendResult } from './backends/factory'
import { PiEventTranslator } from './event-translator'
import { stripWslUncPrefix } from './backends/shell'
import { decodeExtensionDialog, decodeExtensionUi, encodeDialogAnswer } from './extension-ui'
import { ensureAskExtension } from './ask-extension'
import { ensureSessionToolsExtension } from './session-tools-extension'
import { ensureLoopStopExtension } from './loop-stop-extension'
import { ensureSubagentBridgeExtension } from './subagent-bridge-extension'
import { readAttachmentImages } from '../attachments/attachments'
import { runHandshake, decodeSessionTokens, decodeCommands, dataObject } from './handshake'
import { generateSessionTitle } from './session-title'
import { sessionStatus } from './session-status'
import { piArgs, splitArgs } from './pi-args'

export interface SessionHostListener {
  onStatus(status: PiStatus): void
  onEvent(event: UiEvent): void
}

interface PendingDialogEntry {
  dialog: ExtensionDialog
  timer: NodeJS.Timeout | null
}

const DIALOG_EXPIRY_GRACE_MS = 2000
/** Инструменты, спавнящие фоновых субагентов/воркфлоу — только после них ждём грейс-паузу на subagents:started. */
const SUBAGENT_SPAWNING_TOOLS = new Set(['Agent', 'SubagentWorkflow'])
/** subagents:started уходит асинхронно и часто приходит после turn_end — столько ждём его. */
const SUBAGENT_GRACE_MS = 2000

function modelKey(model: { provider: string; id: string } | null | undefined): string | null {
  return model ? `${model.provider}/${model.id}` : null
}

/** Текст user-сообщения из записи pi (message.content — строка или блоки). */
function userPromptText(entry: PiJsonObject): string | null {
  if (entry['type'] !== 'message') return null
  const message = entry['message']
  if (typeof message !== 'object' || message === null) return null
  const m = message as PiJsonObject
  if (m['role'] !== 'user') return null
  const content = m['content']
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const block of content) {
      if (typeof block === 'object' && block !== null && (block as PiJsonObject)['type'] === 'text') {
        const text = (block as PiJsonObject)['text']
        if (typeof text === 'string') parts.push(text)
      }
    }
    return parts.join('')
  }
  return null
}

/** Вшитые PiWright расширения, ставятся перед спавном pi; порядок = порядок `-e`. */
function ensurePiwrightExtensions(project: ProjectEntry, settings: Settings): Promise<(string | null)[]> {
  const extensions = [
    ensureAskExtension(project, settings),
    ensureSessionToolsExtension(project, settings),
    ensureSubagentBridgeExtension(project, settings),
    ...(settings.loopsEnabled ? [ensureLoopStopExtension(project, settings)] : [])
  ]
  return Promise.all(extensions)
}

export interface SessionHostOptions {
  /** Файл сессии для возобновления — спавн с `--session <путь>` и реплей истории. */
  sessionFile?: string | null
  createBackend?: (project: ProjectEntry, settings: Settings) => Promise<CreateBackendResult>
  /** Установка вшитых расширений; null в списке — стартовать без этого расширения. */
  installExtensions?: (project: ProjectEntry, settings: Settings) => Promise<(string | null)[]>
  /** Каталог моделей/уровней thinking из кэша прошлых сессий — виден в UI до хендшейка. */
  seedModels?: PiModelInfo[]
  seedThinkingLevels?: string[]
  /** Последний выбор пользователя (настройки) — применяется в новой сессии сразу после хендшейка. */
  initialModel?: string | null
  initialThinkingLevel?: string | null
  /** Имя сессии до подъёма процесса — уйдет в хендшейке (fork: «<родитель> (fork)»). */
  initialSessionName?: string | null
  /** Форк при старте на файле родительской сессии: userText=null → clone всей сессии,
   *  иначе fork на user-промпт (точка после ответа агента) до хендшейка — порт handshake-fork из jb-pi. */
  forkSpec?: { userText: string | null; occurrence: number }
  /** Грейс-пауза на subagents:started после turn_end (переопределяется в тестах). */
  subagentGraceMs?: number
}

export class SessionHost {
  readonly id = randomUUID()

  private conn: PiConnection | null = null
  /** Ожидается agent_start от нашего prompt (не nudge/follow_up из pi) — сбрасывается первым agent_start. */
  private ownPromptPending = false
  private backend: PiBackend | null = null
  private sessionFile: string | null
  private startPromise: Promise<void> | null = null
  private translator: PiEventTranslator | null = null
  private handshake: PiHandshakeResult | null = null
  private lastState: PiStatus['state'] = 'idle'
  private lastStatusData: PiStatus | null = null
  private sessionName: string | null = null
  private firstUserText: string | null = null
  /** Уровень thinking/имя сессии/модель, выбранные до подъёма процесса, — уйдут в хендшейке и сразу после него. */
  private desiredThinkingLevel: string | null = null
  private desiredSessionName: string | null = null
  private desiredModel: string | null = null
  /** Форк/клон родительской сессии при старте (см. SessionHostOptions.forkSpec). */
  private readonly forkSpec: { userText: string | null; occurrence: number } | undefined
  /** Название первой сессии уже генерировали (успешно или нет) — второй раз не спавним одноразовый pi. */
  private titleGenerated = false
  /** Тоггл Telegram-уведомлений этой сессии — независим от remote-шаринга (jb-pi: поле вкладки);
   *  мост держит зеркало для телефона, источник истины — здесь. */
  telegramEnabled = false
  private readonly seedModels: PiModelInfo[]
  private readonly seedThinkingLevels: string[]
  private readonly subagentGraceMs: number
  private readonly pendingDialogs = new Map<string, PendingDialogEntry>()
  /** Активные субагенты/воркфлоу (subagents_activity) — ход с ними не переходит в ready. */
  private readonly subagents = new Set<string>()
  private readonly workflows = new Set<string>()
  private waitingSubagents = false
  /** turn_end этого хода уже разрешён или отложен — дубль agent_end/agent_settled гасим. */
  private turnEndHandled = false
  private turnEndTimer: NodeJS.Timeout | null = null
  /** В ходе был вызов Agent/SubagentWorkflow — спавн уходит асинхронно, нужен грейс-окно. */
  private subagentToolSeen = false
  private readonly remoteTaps = new Set<(line: string) => void>()
  private readonly createBackend: (project: ProjectEntry, settings: Settings) => Promise<CreateBackendResult>
  private readonly installExtensions: (project: ProjectEntry, settings: Settings) => Promise<(string | null)[]>

  constructor(
    private readonly getSettings: () => Settings,
    private readonly listener: SessionHostListener,
    public readonly project: ProjectEntry,
    opts: SessionHostOptions = {}
  ) {
    this.sessionFile = opts.sessionFile ?? null
    this.createBackend = opts.createBackend ?? createPiBackend
    this.installExtensions = opts.installExtensions ?? ensurePiwrightExtensions
    this.seedModels = opts.seedModels ?? []
    this.seedThinkingLevels = opts.seedThinkingLevels ?? []
    this.subagentGraceMs = opts.subagentGraceMs ?? SUBAGENT_GRACE_MS
    this.desiredModel = opts.initialModel ?? null
    this.desiredThinkingLevel = opts.initialThinkingLevel ?? null
    this.desiredSessionName = opts.initialSessionName ?? null
    this.forkSpec = opts.forkSpec
    this.status('idle')
  }

  /** Заголовок: имя сессии → первый текст пользователя → «New Chat». */
  private get title(): string {
    return this.sessionName ?? this.firstUserText ?? 'New Chat'
  }

  private status(state: PiStatus['state'], error: string | null = null): void {
    this.lastState = state
    const snapshot: PiStatus = {
      hostId: this.id,
      state,
      backend: this.backend?.displayName ?? null,
      model: this.handshake?.model
        ? `${this.handshake.model.provider}/${this.handshake.model.id}`
        : this.desiredModel,
      sessionId: this.handshake?.sessionId ?? null,
      sessionFile: this.sessionFile,
      error,
      models: this.handshake?.models ?? this.seedModels,
      thinkingLevels: this.handshake?.thinkingLevels ?? this.seedThinkingLevels,
      thinkingLevel: this.handshake?.thinkingLevel ?? this.desiredThinkingLevel,
      project: this.project,
      title: this.title,
      dot: sessionStatus(state === 'streaming', [...this.pendingDialogs.values()].map((e) => e.dialog.kind), state === 'waiting')
    }
    this.lastStatusData = snapshot
    this.listener.onStatus(snapshot)
  }

  /** Последний статус — стартовая выдача панели для уже запущенных сессий. */
  lastStatus(): PiStatus | null {
    return this.lastStatusData
  }

  /** Идёт ход (agent_start…agent_settled) — для remote-моста при регистрации. */
  get streaming(): boolean {
    return this.lastState === 'streaming'
  }

  /** Файл сессии текущей ветки — для форка в новую сессию (PiHost.createFork). */
  get sessionFilePath(): string | null {
    return this.sessionFile
  }

  /** Заголовок для remote-моста (имя → первый текст → «New Chat»). */
  get displayTitle(): string {
    return this.title
  }

  /** Remote-мост: сырые строки stdout pi; переживают рестарт процесса — как в jb-pi. */
  addRemoteTap(tap: (line: string) => void): void {
    this.remoteTaps.add(tap)
    this.conn?.addRawSink(tap)
  }

  removeRemoteTap(tap: (line: string) => void): void {
    this.remoteTaps.delete(tap)
    this.conn?.removeRawSink(tap)
  }

  /** Сырая строка в stdin pi (кадр телефона с переписанным id). */
  sendRemoteLine(line: string): void {
    this.conn?.sendRaw(line)
  }

  /** RPC-запрос от моста; reject — процесс не жив. */
  requestRemote(type: string, fields?: PiJsonObject | null): Promise<PiResponse> {
    return this.conn !== null ? this.conn.request(type, fields) : Promise.reject(new Error('pi connection is not running'))
  }

  /** Ответ с телефона (remote-мост): снять диалог с ПК, сообщить renderer'у, пересчитать точку. */
  respondRemoteUi(id: string, fields: PiJsonObject): void {
    const entry = this.pendingDialogs.get(id)
    if (entry !== undefined) {
      if (entry.timer !== null) clearTimeout(entry.timer)
      this.pendingDialogs.delete(id)
      this.emit({ type: 'dialog_answered', id, by: 'phone' })
      this.status(this.lastState)
    }
    this.conn?.respondExtensionUi(id, fields)
  }

  private emit(event: UiEvent): void {
    this.listener.onEvent(event)
  }

  /** Ленивый старт: бэкенд из настроек → спавн → хендшейк → реплей истории при возобновлении.
   *  Упавший процесс поднимается заново с `--session <файл>` на следующем prompt. */
  ensureStarted(): Promise<void> {
    if (this.conn !== null && this.conn.running) return Promise.resolve()
    if (this.startPromise !== null) return this.startPromise
    this.startPromise = this.start()
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        this.conn = null
        this.status('error', message)
        throw err
      })
      .finally(() => {
        this.startPromise = null
      })
    return this.startPromise
  }

  private async start(): Promise<void> {
    const settings = this.getSettings()
    const projectDir = this.project.dir.trim()
    if (projectDir.length === 0) {
      throw new Error('Project directory is not set.')
    }
    const resume = this.sessionFile !== null
    this.status('starting')
    const created = await this.createBackend(this.project, settings)
    if (created.backend === null) {
      throw new Error(created.error)
    }
    this.backend = created.backend
    const translator = new PiEventTranslator({
      onAssistantTextDelta: (text) => this.emit({ type: 'assistant_delta', text }),
      onThoughtDelta: (text) => this.emit({ type: 'thought_delta', text }),
      onInjectedUserMessage: (text) => {
        if (this.firstUserText === null && text.trim().length > 0) this.firstUserText = text.trim()
        this.emit({ type: 'injected_user_message', text })
      },
      onUserMessage: (text) => {
        if (this.firstUserText === null && text.trim().length > 0) this.firstUserText = text.trim()
        this.emit({ type: 'user_message', text })
      },
      onQueueUpdate: (steering, followUp) => this.emit({ type: 'queue_update', steering, followUp }),
      onToolStart: (call) => {
        if (call.parentToolCallId === null && SUBAGENT_SPAWNING_TOOLS.has(call.name)) this.subagentToolSeen = true
        this.emit({ type: 'tool_start', call })
      },
      onToolUpdate: (id, text) => this.emit({ type: 'tool_update', id, text }),
      onToolEnd: (call, result) => this.emit({ type: 'tool_end', call, result }),
      onContextUsageUpdate: (usage) => this.emit({ type: 'context_usage', used: usage.used, size: usage.size }),
      onSessionNameChanged: (name) => {
        if (name !== null && name.trim().length > 0) this.sessionName = name
        this.emit({ type: 'session_name', name })
        this.status(this.lastState)
      },
      onNotify: (message, isError) => this.emit({ type: 'notify', message, isError }),
      onCompactionStart: (reason) => this.emit({ type: 'compaction_start', reason }),
      onCompactionEnd: (end) => this.emit({ type: 'compaction_end', end }),
      onResult: (usage) => this.emit({ type: 'turn_result', usage }),
      onError: (message) => this.emit({ type: 'turn_error', message }),
      onSubagentsActivity: (kind, id) => {
        this.trackSubagents(kind, id)
        this.emit({ type: 'subagents_activity', kind, id })
      }
    })
    const conn = new PiConnection(created.backend.spawner, {
      onEvent: (type, payload) => this.handleEvent(translator, type, payload),
      onExtensionUiRequest: (id, method, payload) => this.handleDialogRequest(id, method, payload),
      onDisconnected: (cause, exitCode, stderrTail) => {
        this.conn = null
        this.translator = null
        this.handshake = null
        this.clearPendingDialogs()
        this.cancelTurnEndTimer()
        this.turnEndHandled = false
        this.waitingSubagents = false
        const message = cause !== null || exitCode !== null
          ? `pi exited (code ${exitCode ?? '?'}). stderr: ${stderrTail || '—'}`
          : 'pi exited'
        this.status('disconnected', message)
      }
    })
    try {
      const installed = await this.installExtensions(this.project, settings)
      // WSL: pi внутри дистрибутива UNC-путь не видит — для `-e` нужен POSIX-путь.
      const extensionPaths = installed.map((path) =>
        path !== null && this.project.kind === 'wsl' ? (stripWslUncPrefix(path) ?? path) : path
      )
      await conn.start({ cwd: projectDir, args: piArgs(this.sessionFile, extensionPaths, splitArgs(settings.piExtraArgs)) })
      // Форк/клон до хендшейка — иначе pi писал бы в файл родительской сессии (как в jb-pi).
      if (this.forkSpec !== undefined) await this.branchAtStart(conn)
      const handshake = await runHandshake(conn, {
        desiredThinkingLevel: this.desiredThinkingLevel,
        sessionName: this.desiredSessionName
      })
      const handshakeSessionName = this.desiredSessionName
      this.desiredSessionName = null
      if (this.sessionName === null && handshakeSessionName !== null) this.sessionName = handshakeSessionName
      this.sessionFile = handshake.sessionFile
      this.handshake = handshake
      translator.contextWindow = handshake.model?.contextWindow ?? 0
      this.conn = conn
      this.translator = translator
      for (const tap of this.remoteTaps) conn.addRawSink(tap)
      if (handshake.sessionTokens !== null) {
        this.emit({ type: 'session_stats', tokens: handshake.sessionTokens })
      }
      if (resume) {
        const response = await conn.request('get_messages')
        const data: PiJsonObject =
          response.data !== null && typeof response.data === 'object' && !Array.isArray(response.data)
            ? (response.data as PiJsonObject)
            : {}
        const messages = data['messages']
        if (Array.isArray(messages)) translator.replay(messages)
      }
      if (this.desiredModel !== null && this.desiredModel !== modelKey(handshake.model)) {
        // Модели нет в каталоге этого бэкенда (выбор из другого) — оставляем дефолт pi.
        if (handshake.models.some((m) => `${m.provider}/${m.id}` === this.desiredModel)) {
          await this.applyModelKey(this.desiredModel)
        }
      }
      this.status('ready')
    } catch (err) {
      conn.close()
      throw err instanceof Error ? err : new Error(String(err))
    }
  }

  private handleEvent(translator: PiEventTranslator, type: string, payload: Record<string, unknown>): void {
    if (type === 'agent_start') {
      const external = !this.ownPromptPending
      this.ownPromptPending = false
      this.cancelTurnEndTimer()
      this.turnEndHandled = false
      this.waitingSubagents = false
      this.subagentToolSeen = false
      this.emit({ type: 'turn_start', external })
      this.status('streaming')
    } else if (type === 'agent_settled' || type === 'agent_end') {
      translator.onEvent(type, payload)
      this.handleTurnEnd()
      return
    } else if (type === 'message_start' && (payload['message'] as Record<string, unknown> | undefined)?.['role'] === 'assistant') {
      this.emit({ type: 'assistant_message_start' })
    }
    translator.onEvent(type, payload)
  }

  /** Субагенты/воркфлоу: учёт активных; когда ожидающий их ход дождался — разрешаем turn_end. */
  private trackSubagents(
    kind: 'started' | 'completed' | 'workflow_started' | 'workflow_settled' | 'disposed',
    id: string | null
  ): void {
    if (kind === 'disposed') {
      this.subagents.clear()
      this.workflows.clear()
    } else if (kind === 'started' && id !== null) {
      this.subagents.add(id)
    } else if (kind === 'completed' && id !== null) {
      this.subagents.delete(id)
    } else if (kind === 'workflow_started' && id !== null) {
      this.workflows.add(id)
    } else if (kind === 'workflow_settled' && id !== null) {
      this.workflows.delete(id)
    }
    if (this.waitingSubagents && this.subagents.size === 0 && this.workflows.size === 0) {
      this.resolveDeferredTurnEnd()
    }
  }

  /** Конец хода: при живых субагентах — статус waiting, turn_end откладывается до их завершения;
   *  после Agent/SubagentWorkflow — грейс-пауза (subagents:started приходит после turn_end).
   *  Звук окончания хода и Telegram-уведомление привязаны к turn_end — при waiting они уходят
   *  только когда субагенты завершатся и сессия реально перейдёт в ready. */
  private handleTurnEnd(): void {
    if (this.turnEndHandled) return
    this.turnEndHandled = true
    if (this.subagents.size > 0 || this.workflows.size > 0) {
      this.waitingSubagents = true
      this.status('waiting')
      return
    }
    if (this.subagentToolSeen) {
      this.status('waiting')
      this.turnEndTimer = setTimeout(() => {
        this.turnEndTimer = null
        if (this.subagents.size === 0 && this.workflows.size === 0) this.resolveDeferredTurnEnd()
      }, this.subagentGraceMs)
      this.turnEndTimer.unref()
      return
    }
    this.finishTurnEnd()
  }

  /** Отложенный turn_end разрешается: субагенты завершились или грейс-окно истекло пустым. */
  private resolveDeferredTurnEnd(): void {
    if (!this.turnEndHandled) return
    this.turnEndHandled = false
    this.finishTurnEnd()
  }

  private finishTurnEnd(): void {
    this.waitingSubagents = false
    this.emit({ type: 'turn_end' })
    this.status('ready')
    this.refreshSessionStats()
  }

  private cancelTurnEndTimer(): void {
    if (this.turnEndTimer !== null) {
      clearTimeout(this.turnEndTimer)
      this.turnEndTimer = null
    }
  }

  /** Суммарные токены сессии после хода — fire-and-forget, renderer заменяет totals целиком. */
  private refreshSessionStats(): void {
    const conn = this.conn
    if (conn === null || !conn.running) return
    void conn
      .request('get_session_stats')
      .then((response) => {
        const tokens = decodeSessionTokens(response)
        if (tokens !== null) this.emit({ type: 'session_stats', tokens })
      })
      .catch(() => {})
  }

  /** Диалоги (confirm/select/input/editor) — в реестр и renderer; fire-and-forget методы — мимо. */
  private handleDialogRequest(id: string, method: string, payload: Record<string, unknown>): void {
    const dialog = decodeExtensionDialog(method, payload)
    if (dialog === null) {
      const ui = decodeExtensionUi(method, payload)
      if (ui !== null) {
        if (ui.kind === 'status') this.emit({ type: 'extension_status', key: ui.key, text: ui.text })
        else this.emit({ type: 'widget', key: ui.key, lines: ui.lines })
      }
      return
    }
    const entry: PendingDialogEntry = {
      dialog,
      timer:
        dialog.timeoutMs !== null
          ? setTimeout(() => {
              if (this.pendingDialogs.get(id) === entry) {
                this.pendingDialogs.delete(id)
                this.emit({ type: 'dialog_expired', id })
                this.status(this.lastState)
              }
            }, dialog.timeoutMs + DIALOG_EXPIRY_GRACE_MS)
          : null
    }
    if (entry.timer !== null) entry.timer.unref()
    this.pendingDialogs.set(id, entry)
    this.emit({ type: 'dialog_open', id, dialog })
    this.status(this.lastState)
  }

  private clearPendingDialogs(): void {
    for (const entry of this.pendingDialogs.values()) {
      if (entry.timer !== null) clearTimeout(entry.timer)
    }
    this.pendingDialogs.clear()
  }

  /** Ответ на диалог; первый выигрывает, повтор — ошибка. */
  respondDialog(id: string, answer: DialogAnswer): DialogResult {
    const entry = this.pendingDialogs.get(id)
    if (entry === undefined) return { ok: false, error: 'dialog already answered or expired' }
    if (entry.timer !== null) clearTimeout(entry.timer)
    this.pendingDialogs.delete(id)
    this.conn?.respondExtensionUi(id, encodeDialogAnswer(answer))
    this.emit({ type: 'dialog_answered', id, by: 'pc' })
    this.status(this.lastState)
    return { ok: true, error: null }
  }

  getPendingDialogs(): { id: string; dialog: ExtensionDialog }[] {
    return [...this.pendingDialogs.entries()].map(([id, entry]) => ({ id, dialog: entry.dialog }))
  }

  /** Переименовать сессию: живой процесс — `set_session_name`, до подъёма — в хендшейке. */
  async rename(name: string): Promise<PromptResult> {
    const trimmed = name.trim()
    if (trimmed.length === 0) return { ok: false, error: 'Session name is empty' }
    this.sessionName = trimmed
    this.emit({ type: 'session_name', name: trimmed })
    const conn = this.conn
    if (conn === null || !conn.running) {
      this.desiredSessionName = trimmed
      this.status(this.lastState)
      return { ok: true, error: null }
    }
    try {
      const response = await conn.request('set_session_name', { name: trimmed })
      if (!response.success) {
        return { ok: false, error: `set_session_name failed: ${response.error ?? 'no details'}` }
      }
      this.status(this.lastState)
      return { ok: true, error: null }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** Прервать ход: сначала снять очередь, затем `abort`. Процесс и сессия живут дальше.
   *  Порт `PiSession.cancel` (тексты снятой очереди не возвращаем в поле ввода). */
  async abort(): Promise<PromptResult> {
    const conn = this.conn
    if (conn === null || !conn.running) return { ok: false, error: 'pi connection is not running' }
    try {
      const cleared = await this.clearQueue(conn)
      await conn.request('abort')
      return { ok: true, error: null, cleared }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** clear_queue: тексты очереди наружу, renderer гасит очередь событием queue_update. */
  async queueClear(): Promise<PromptResult> {
    const conn = this.conn
    if (conn === null || !conn.running) return { ok: false, error: 'pi connection is not running' }
    try {
      const cleared = await this.clearQueue(conn)
      return { ok: true, error: null, cleared }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** Удаление одного элемента: clear_queue → убрать → остальные обратно (steer/follow_up при ходе,
   *  иначе — тексты в cleared, renderer вернёт их в поле ввода). */
  async queueRemove(kind: keyof QueueTexts, index: number): Promise<PromptResult> {
    const conn = this.conn
    if (conn === null || !conn.running) return { ok: false, error: 'pi connection is not running' }
    try {
      const texts = await this.clearQueue(conn)
      const list = [...texts[kind]]
      if (index >= 0 && index < list.length) list.splice(index, 1)
      const remaining: QueueTexts = {
        steering: kind === 'steering' ? list : texts.steering,
        followUp: kind === 'followUp' ? list : texts.followUp
      }
      if (!this.streaming) return { ok: true, error: null, cleared: remaining }
      const failed: string[] = []
      for (const text of remaining.steering) {
        if (!(await this.requeue(conn, 'steer', text))) failed.push(text)
      }
      for (const text of remaining.followUp) {
        if (!(await this.requeue(conn, 'follow_up', text))) failed.push(text)
      }
      return {
        ok: true,
        error: null,
        cleared: { steering: failed, followUp: [] }
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  private async clearQueue(conn: PiConnection): Promise<QueueTexts> {
    const response = await conn.request('clear_queue')
    if (!response.success) throw new Error(`clear_queue failed: ${response.error ?? 'no details'}`)
    const data = (typeof response.data === 'object' && response.data !== null ? response.data : {}) as Record<string, unknown>
    const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [])
    const cleared = { steering: strings(data['steering']), followUp: strings(data['followUp']) }
    this.emit({ type: 'queue_update', steering: [], followUp: [] })
    return cleared
  }

  private async requeue(conn: PiConnection, command: 'steer' | 'follow_up', text: string): Promise<boolean> {
    const response = await conn.request(command, { message: text })
    return response.success
  }

  /** Живой список slash-команд (`get_commands`, включая навыки) для автодополнения;
   *  процесс не поднят или RPC упал — команды последнего хендшейка. */
  async commands(): Promise<PiSlashCommand[]> {
    const conn = this.conn
    if (conn === null || !conn.running) return this.handshake?.commands ?? []
    try {
      return decodeCommands(dataObject(await conn.request('get_commands')))
    } catch {
      return this.handshake?.commands ?? []
    }
  }

  /** Сменить модель на живой сессии; до подъёма процесса — применится сразу после хендшейка. */
  async setModel(key: string): Promise<PromptResult> {
    const conn = this.conn
    if (conn === null || !conn.running) {
      this.desiredModel = key
      this.status(this.lastState)
      return { ok: true, error: null }
    }
    return this.applyModelKey(key)
  }

  /** set_model + обновить handshake/контекстное окно + перечитать уровни thinking. */
  private async applyModelKey(key: string): Promise<PromptResult> {
    const conn = this.conn
    if (conn === null || !conn.running || this.handshake === null) return { ok: false, error: 'pi connection is not running' }
    const model = this.handshake.models.find((m) => `${m.provider}/${m.id}` === key)
    try {
      const response = await conn.request('set_model', {
        provider: model?.provider ?? key.split('/')[0] ?? key,
        modelId: model?.id ?? key.split('/')[1] ?? key
      })
      if (!response.success) {
        return { ok: false, error: `set_model failed: ${response.error ?? 'no details'}` }
      }
      if (model !== undefined) {
        this.handshake = { ...this.handshake, model }
        if (this.translator !== null) this.translator.contextWindow = model.contextWindow
      }
      await this.refreshThinkingState()
      return { ok: true, error: null }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** Сменить уровень thinking; до подъёма процесса применится в хендшейке. */
  async setThinkingLevel(level: string): Promise<PromptResult> {
    this.desiredThinkingLevel = level
    const conn = this.conn
    if (conn === null || !conn.running) {
      this.status(this.lastState)
      return { ok: true, error: null }
    }
    try {
      const response = await conn.request('set_thinking_level', { level })
      if (!response.success) {
        return { ok: false, error: `set_thinking_level failed: ${response.error ?? 'no details'}` }
      }
      if (this.handshake !== null) this.handshake = { ...this.handshake, thinkingLevel: level }
      await this.refreshThinkingState()
      return { ok: true, error: null }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** Перечитать уровни thinking и текущий уровень; обновляет статус с моделью/уровнями. */
  private async refreshThinkingState(): Promise<void> {
    const conn = this.conn
    if (conn === null || !conn.running || this.handshake === null) return
    const levelsResponse = await conn.request('get_available_thinking_levels')
    const levelsData: PiJsonObject =
      levelsResponse.data !== null && typeof levelsResponse.data === 'object' && !Array.isArray(levelsResponse.data)
        ? (levelsResponse.data as PiJsonObject)
        : {}
    const levels = Array.isArray(levelsData['levels'])
      ? levelsData['levels'].filter((l): l is string => typeof l === 'string')
      : []
    const state = await conn.request('get_state')
    const stateData: PiJsonObject =
      state.data !== null && typeof state.data === 'object' && !Array.isArray(state.data)
        ? (state.data as PiJsonObject)
        : {}
    const current = typeof stateData['thinkingLevel'] === 'string' ? stateData['thinkingLevel'] : null
    this.handshake = { ...this.handshake, thinkingLevels: levels, thinkingLevel: current }
    this.status(this.lastState)
  }

  private async sendPrompt(text: string, images: string[], behavior?: PromptBehavior): Promise<PromptResult> {
    const conn = this.conn
    if (conn === null || !conn.running) return { ok: false, error: 'pi connection is not running' }
    // Ход, начатый этим prompt'ом — «свой»; agent_start без него — внешний ход (nudge субагента,
    // follow_up из pi) — петля его не считает продолжением работы пользователя.
    if (behavior === undefined) this.ownPromptPending = true
    const fields: PiJsonObject = { message: text }
    // Модель без `input: image` картинку не примет — остаётся ссылка `@путь` в тексте.
    if (images.length > 0 && (this.handshake?.model?.imageInput ?? false)) {
      const blocks = await readAttachmentImages(this.project, images)
      if (blocks.length > 0) fields['images'] = blocks
    }
    // steer/follow_up только во время хода; ход кончился — обычный prompt (начнёт новый ход).
    const command = behavior === 'steer' && this.streaming ? 'steer' : behavior === 'followUp' && this.streaming ? 'follow_up' : 'prompt'
    const response = await conn.request(command, fields)
    if (!response.success) {
      if (behavior === undefined) this.ownPromptPending = false
      const error = `${response.command} failed: ${response.error ?? 'no details'}`
      this.status('error', error)
      return { ok: false, error }
    }
    return { ok: true, error: null }
  }

  async prompt(text: string, images: string[] = [], behavior?: PromptBehavior): Promise<PromptResult> {
    try {
      await this.ensureStarted()
      await this.maybeGenerateTitle(text)
      return await this.sendPrompt(text, images, behavior)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: message }
    }
  }

  /** Редактирование отправленного промпта (порт Rewind из jb-pi): выделенного RPC нет —
   *  `fork {entryId}` переводит pi на новую ветку-сессию (старый файл не трогается),
   *  затем обычный prompt с новым текстом. История после сообщения стирается.
   *  occurrence — номер вхождения текста среди user-промптов активной ветки с конца (0 = последнее). */
  async editPrompt(text: string, occurrence: number, newText: string): Promise<PromptResult> {
    if (this.streaming) return { ok: false, error: 'Session is busy — wait for the current turn to finish' }
    try {
      await this.ensureStarted()
      const conn = this.conn
      if (conn === null || !conn.running) return { ok: false, error: 'pi connection is not running' }
      const entryId = await this.findUserPromptEntryId(conn, text, occurrence)
      if (entryId === null) return { ok: false, error: 'Prompt not found in session history' }
      const forkResponse = await conn.request('fork', { entryId })
      if (!forkResponse.success) {
        return { ok: false, error: `fork failed: ${forkResponse.error ?? 'no details'}` }
      }
      if (
        typeof forkResponse.data === 'object' &&
        forkResponse.data !== null &&
        (forkResponse.data as PiJsonObject)['cancelled'] === true
      ) {
        return { ok: false, error: 'Edit was cancelled' }
      }
      await this.applyForkedState(conn)
      return await this.sendPrompt(newText, [])
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: message }
    }
  }

  /** Форк/клон при старте на файле родительской сессии: точка — user-промпт активной ветки
   *  (ответ агента перед ним остаётся в ветке); null — clone всей сессии. */
  private async branchAtStart(conn: PiConnection): Promise<void> {
    const spec = this.forkSpec
    if (spec === undefined) return
    if (spec.userText === null) {
      const response = await conn.request('clone', {})
      if (!response.success) throw new Error(`clone failed: ${response.error ?? 'no details'}`)
      return
    }
    const entryId = await this.findUserPromptEntryId(conn, spec.userText, spec.occurrence)
    if (entryId === null) throw new Error('Prompt not found in session history')
    const response = await conn.request('fork', { entryId })
    if (!response.success) throw new Error(`fork failed: ${response.error ?? 'no details'}`)
  }

  /** entryId промпта в активной ветке: get_entries → цепочка parentId от leafId → матч по тексту с конца. */
  private async findUserPromptEntryId(conn: PiConnection, text: string, occurrence: number): Promise<string | null> {
    const response = await conn.request('get_entries')
    if (!response.success) return null
    const data: PiJsonObject =
      response.data !== null && typeof response.data === 'object' && !Array.isArray(response.data)
        ? (response.data as PiJsonObject)
        : {}
    const entries = Array.isArray(data['entries']) ? (data['entries'] as unknown[]) : []
    const byId = new Map<string, PiJsonObject>()
    for (const entry of entries) {
      if (typeof entry !== 'object' || entry === null) continue
      const record = entry as PiJsonObject
      const id = record['id']
      if (typeof id === 'string') byId.set(id, record)
    }
    let cursor: unknown = data['leafId']
    const prompts: { id: string; text: string }[] = []
    while (typeof cursor === 'string' && byId.has(cursor)) {
      const entry = byId.get(cursor)
      if (entry === undefined) break
      const promptText = userPromptText(entry)
      if (promptText !== null) prompts.push({ id: cursor, text: promptText })
      cursor = entry['parentId']
    }
    // Матч с конца (как matchPromptIds в jb-pi): начало ленты расходится после компакции.
    let seen = 0
    for (const prompt of prompts) {
      if (prompt.text.trim() === text.trim()) {
        if (seen === occurrence) return prompt.id
        seen++
      }
    }
    return null
  }

  /** После fork pi живёт в новом файле сессии — обновляем путь/id, чтобы рестарт и панель видели ветку. */
  private async applyForkedState(conn: PiConnection): Promise<void> {
    const state = await conn.request('get_state')
    const data: PiJsonObject =
      state.data !== null && typeof state.data === 'object' && !Array.isArray(state.data)
        ? (state.data as PiJsonObject)
        : {}
    const sessionFile = data['sessionFile']
    if (typeof sessionFile === 'string' && sessionFile.length > 0) this.sessionFile = sessionFile
    const sessionId = data['sessionId']
    if (this.handshake !== null && typeof sessionId === 'string' && sessionId.length > 0) {
      this.handshake = { ...this.handshake, sessionId }
    }
    this.status(this.lastState)
  }

  /** Первое сообщение новой сессии: одноразовый pi с той же моделью придумывает название 2-3 слова,
   *  затем оно ставится через rename (set_session_name). Любая неудача — промпт уходит без названия. */
  private async maybeGenerateTitle(message: string): Promise<void> {
    if (this.titleGenerated || this.sessionName !== null || this.firstUserText !== null) return
    this.titleGenerated = true
    const model = modelKey(this.handshake?.model)
    if (model === null) return
    try {
      const created = await this.createBackend(this.project, this.getSettings())
      if (created.backend === null) return
      const title = await generateSessionTitle(created.backend.spawner, this.project.dir, model, message)
      if (title !== null && this.sessionName === null) await this.rename(title)
    } catch {
      // название не критично — молча продолжаем с эвристическим заголовком
    }
  }

  dispose(): void {
    this.clearPendingDialogs()
    this.cancelTurnEndTimer()
    this.conn?.close()
    this.conn = null
  }
}
