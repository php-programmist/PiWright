/** Мост «телефон ↔ сессии PiWright»: реестр сессий, раздача потока pi подключённым сокетам,
 *  ответы на диалоги с телефона, telegram-флаги. Порт `core/remote/RemoteBridge.kt`;
 *  вкладки IDE → SessionHost из PiHost, EDT → прямые вызовы (однопоточный main). */
import { basename } from 'node:path'
import type { DialogAnswer } from '../../shared/agent-events'
import type { PiJsonObject } from '../../shared/protocol-types'
import type { Settings } from '../../shared/ipc-contracts'
import { PLAN_WIDGET_KEY, TODO_WIDGET_KEY } from '../../shared/todo'
import type { SessionHost } from '../pi/session-host'
import type { PiHost } from '../pi/pi-host'
import type { LoopController } from '../pi/loop-controller'
import type { LoopInfo } from '../../shared/agent-events'
import { decodeExtensionDialog, decodeExtensionUi, encodeDialogAnswer } from '../pi/extension-ui'
import { sessionStatus } from '../pi/session-status'
import type { RemoteAuth } from './auth'
import { isValidStaticPin } from './auth'
import { RemoteWebServer, lanCandidates } from './server'
import {
  attachedFrame,
  catalogFrame,
  catalogModelOf,
  errorFrame,
  loopStateFrame,
  normalizeCreateSessionRequest,
  normalizePromptImages,
  normalizeSessionName,
  parseFrame,
  remoteRequestId,
  remoteTodos,
  resolveCreateProject,
  sessionCreatedFrame,
  sessionListFrame,
  snapshotFrame,
  stripRemoteRequestId,
  todosFrame,
  uiAnsweredFrame,
  frameString,
  newRemoteSessionId,
  pickLanAddress,
  type RemoteSessionInfo
} from './protocol'
import type { RemoteSocket } from './ws'

const SNAPSHOT_ATTEMPTS = 5
const SNAPSHOT_RETRY_MS = 700
const EXPIRY_GRACE_MS = 250
/** Старт по «Порт занят» повторяется с экспоненциальным backoff (dev-инстанс рядом с
 *  установленным PiWright, который держит remote.port). */
const START_RETRY_BASE_MS = 1000
const START_RETRY_MAX_MS = 30_000

interface PendingUi {
  remote: RemoteSession
  method: string
  line: string
  createdAt: number
  timeoutMs: number | null
  answered: boolean
  timer: NodeJS.Timeout | null
}

export class RemoteSession {
  readonly id = newRemoteSessionId()
  readonly sockets: RemoteSocket[] = []
  readonly widgetLines = new Map<string, string[]>()
  /** Идёт ход: ведётся по сырым строкам (agent_start/agent_settled), как в jb-pi —
   *  тап срабатывает до обновления статуса хоста. */
  streaming: boolean
  /** Ход завершился, а телефон его не долистал — зелёная точка таба. */
  unread: boolean

  constructor(
    readonly host: SessionHost,
    readonly tap: (line: string) => void
  ) {
    this.streaming = host.streaming
    this.unread = false
  }

  get title(): string {
    return this.host.displayTitle
  }

  get projectName(): string {
    return basename(this.host.project.dir) || this.host.project.dir
  }
}

export class RemoteBridge {
  private readonly sessions = new Map<string, RemoteSession>()
  private readonly sessionsByHost = new Map<string, RemoteSession>()
  /** hostId сессий, расшаренных глобусом в шапке чата (jb-pi: per-tab share); в памяти. */
  private readonly sharedHostIds = new Set<string>()
  private readonly socketSessions = new Map<number, string>()
  private readonly allSockets = new Set<RemoteSocket>()
  private readonly pendingUi = new Map<string, PendingUi>()
  /** Состояние страницы телефона по сокету: видимость и «на дне ленты». */
  private readonly socketView = new Map<number, { visible: boolean; atBottom: boolean }>()
  /** Код последней неудачи старта (EADDRINUSE, EACCES) — показывается в настройках. */
  private startError: string | null = null
  private retryTimer: NodeJS.Timeout | null = null
  private retryDelayMs = 0

  constructor(
    private readonly getSettings: () => Settings,
    private readonly piHost: PiHost,
    private readonly auth: RemoteAuth,
    private server: RemoteWebServer | null = null,
    /** Контроллер петель: старт с телефона, рассылка loop_state. Не задан в тестах. */
    private readonly loops?: LoopController
  ) {}

  // ------------------------------------------------------------- lifecycle

  /** Синхронизация реестра с живыми сессиями: расшаренные — регистрируются, мёртвые и
   *  расшаренные — снимаются. Живость хоста берём из piHost.get — у новой сессии до первого
   *  статуса lastStatus() ещё null, и по statuses() она была бы потеряна. */
  syncSessions(): void {
    for (const [hostId, remote] of this.sessionsByHost) {
      const alive = this.piHost.get(hostId) !== null
      if (!alive || !this.sharedHostIds.has(hostId)) {
        this.unregister(remote)
        if (!alive) this.sharedHostIds.delete(hostId)
      }
    }
    for (const hostId of this.sharedHostIds) {
      if (this.sessionsByHost.has(hostId)) continue
      const host = this.piHost.get(hostId)
      if (host === null) continue
      this.registerHost(host)
    }
  }

  private registerHost(host: SessionHost): RemoteSession {
    const remote = new RemoteSession(host, (line) => this.handleLine(remote, line))
    this.sessions.set(remote.id, remote)
    this.sessionsByHost.set(host.id, remote)
    host.addRemoteTap(remote.tap)
    return remote
  }

  unregister(remote: RemoteSession): void {
    this.sessions.delete(remote.id)
    this.sessionsByHost.delete(remote.host.id)
    for (const [id, pending] of this.pendingUi) {
      if (pending.remote === remote) {
        if (pending.timer !== null) clearTimeout(pending.timer)
        this.pendingUi.delete(id)
      }
    }
    for (const socket of remote.sockets) {
      this.socketSessions.delete(socket.seq)
      socket.send(JSON.stringify(errorFrame('session is no longer shared')))
    }
    remote.sockets.length = 0
    remote.host.removeRemoteTap(remote.tap)
  }

  /** Включить/выключить сервер по настройкам; вызывается на старте и из settings:set. */
  applySettings(settings: Settings): void {
    const remote = settings.notifications.remote
    this.auth.setStaticPin(isValidStaticPin(remote.staticPin) ? remote.staticPin : null)
    if (!remote.enabled) {
      this.stopServer()
      return
    }
    if (this.server !== null && this.server.port === remote.port) return
    this.stopServer()
    void this.startServer(remote.port)
  }

  /** Немедленная повторная попытка старта (кнопка «Повторить» в настройках): сбрасывает backoff.
   *  false — remote выключен или сервер уже слушает нужный порт. */
  retryNow(): boolean {
    const remote = this.getSettings().notifications.remote
    if (!remote.enabled) return false
    if (this.server !== null && this.server.port === remote.port) return false
    this.stopServer()
    void this.startServer(remote.port)
    return true
  }

  private stopServer(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.startError = null
    this.retryDelayMs = 0
    this.server?.stop()
    this.server = null
  }

  private async startServer(port: number): Promise<void> {
    const created = new RemoteWebServer(port, this.auth, {
      onOpen: (socket) => this.onOpen(socket),
      onText: (socket, text) => this.onText(socket, text),
      onClose: (socket) => this.onClose(socket)
    })
    const result = await created.start()
    const live = this.getSettings().notifications.remote
    if (!live.enabled || live.port !== port) {
      // настройки передёрнули, пока мы биндились, — не возвращать сервер к жизни
      created.stop()
      return
    }
    if (!result.ok) {
      this.startError = result.error
      this.scheduleStartRetry(port)
      return
    }
    this.startError = null
    this.retryDelayMs = 0
    this.server = created
  }

  private scheduleStartRetry(port: number): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer)
    const delay =
      this.retryDelayMs === 0 ? START_RETRY_BASE_MS : Math.min(this.retryDelayMs * 2, START_RETRY_MAX_MS)
    this.retryDelayMs = delay
    const timer = setTimeout(() => {
      this.retryTimer = null
      void this.startServer(port)
    }, delay)
    timer.unref()
    this.retryTimer = timer
  }

  /** Адрес, порт и PIN для показа в настройках. */
  connectionInfo(): { running: boolean; port: number; pin: string; lanAddresses: string[]; error: string | null } {
    const best = pickLanAddress(lanCandidates())
    const all = lanCandidates().map(([, address]) => address)
    const ordered = best !== null ? [best, ...all.filter((a) => a !== best)] : all
    return {
      running: this.server !== null,
      port: this.server?.port ?? this.getSettings().notifications.remote.port,
      pin: this.auth.groupedPin,
      lanAddresses: ordered,
      error: this.server === null ? this.startError : null
    }
  }

  /** true — страница телефона на переднем плане: telegram-уведомления гасятся. */
  isPhoneVisible(): boolean {
    for (const view of this.socketView.values()) {
      if (view.visible) return true
    }
    return false
  }

  /** Telegram-флаг сессии — источник истины в SessionHost, виден для любой сессии
   *  (шаринг не обязателен); неизвестная — выключено. */
  telegramEnabledFor(hostId: string): boolean {
    return this.piHost.get(hostId)?.telegramEnabled ?? false
  }

  setTelegramEnabled(id: string, enabled: boolean): void {
    const remote = this.sessions.get(id)
    if (remote === undefined) return
    remote.host.telegramEnabled = enabled
    this.broadcastSessions()
  }

  /** Тоггл из UI ПК (иконка в шапке чата): работает для любой сессии, не только расшаренной. */
  setTelegramEnabledByHost(hostId: string, enabled: boolean): boolean {
    const host = this.piHost.get(hostId)
    if (host === null) return false
    host.telegramEnabled = enabled
    this.broadcastSessions()
    return true
  }

  /** Тоггл шаринга сессии на телефон (глобус в шапке чата, jb-pi): регистрирует/снимает сессию.
   *  false — host не найден. Сервер поднимается настройкой (или первым шарингом из renderer'а). */
  setSharedByHost(hostId: string, shared: boolean): boolean {
    if (this.piHost.get(hostId) === null) return false
    if (shared) this.sharedHostIds.add(hostId)
    else this.sharedHostIds.delete(hostId)
    this.syncSessions()
    this.broadcastSessions()
    return true
  }

  /** Расшарена ли сессия на телефон (флаг в списке сессий renderer'а). */
  sharedFor(hostId: string): boolean {
    return this.sharedHostIds.has(hostId)
  }

  /** Ответ на диалог от любого клиента; false — уже ответили раньше. */
  answerUi(id: string, answer: DialogAnswer, by: string): boolean {
    const pending = this.pendingUi.get(id)
    if (pending === undefined) return false
    if (pending.answered) return false
    pending.answered = true
    this.pendingUi.delete(id)
    if (pending.timer !== null) clearTimeout(pending.timer)
    pending.remote.host.respondRemoteUi(id, encodeDialogAnswer(answer))
    this.broadcast(pending.remote, JSON.stringify(uiAnsweredFrame(id, by)))
    this.broadcastSessions()
    return true
  }

  /** Диалог отвечен с ПК (SessionHost.respondDialog): закрыть карточку на телефоне и
   *  пересчитать точку таба. false — сессия не расшарена или диалог уже закрыт. */
  answerUiFromPc(hostId: string, id: string): boolean {
    const remote = this.sessionsByHost.get(hostId)
    if (remote === undefined) return false
    const pending = this.pendingUi.get(id)
    if (pending === undefined || pending.answered) return false
    pending.answered = true
    this.pendingUi.delete(id)
    if (pending.timer !== null) clearTimeout(pending.timer)
    this.broadcast(remote, JSON.stringify(uiAnsweredFrame(id, 'pc')))
    this.broadcastSessions()
    return true
  }

  // ------------------------------------------------------------- web server

  private onOpen(socket: RemoteSocket): void {
    this.allSockets.add(socket)
    this.syncSessions()
    socket.send(JSON.stringify(sessionListFrame(this.infos())))
  }

  private onClose(socket: RemoteSocket): void {
    this.allSockets.delete(socket)
    this.socketView.delete(socket.seq)
    this.detach(socket)
  }

  private onText(socket: RemoteSocket, text: string): void {
    const frame = parseFrame(text)
    if (frame === null) {
      socket.send(JSON.stringify(errorFrame('invalid JSON')))
      return
    }
    switch (frame['type']) {
      case 'attach':
        this.attach(socket, frameString(frame, 'id'))
        return
      case 'sessions':
        this.syncSessions()
        socket.send(JSON.stringify(sessionListFrame(this.infos())))
        return
      case 'ping':
        socket.send('{"type":"pong"}')
        return
      case 'prompt':
        void this.forwardPrompt(socket, frame)
        return
      case 'loop_stop':
        this.loopStop(socket)
        return
      case 'loop_set_remaining':
        this.loopSetRemaining(socket, frame)
        return
      case 'abort':
        this.forwardCommand(socket, frame, 'abort')
        return
      case 'ui_response':
        this.resolveUi(socket, frame)
        return
      case 'visibility': {
        const visible = frame['visible'] === true
        const atBottom = frame['atBottom'] === true
        const previous = this.socketView.get(socket.seq)
        this.socketView.set(socket.seq, { visible, atBottom })
        if (visible && atBottom && previous?.atBottom !== true) {
          const remote = this.sessionFor(socket)
          if (remote !== undefined && remote.unread) {
            remote.unread = false
            this.broadcastSessions()
          }
        }
        return
      }
      case 'telegram': {
        const remote = this.sessionFor(socket)
        if (remote === undefined) return
        if (typeof frame['enabled'] === 'boolean') this.setTelegramEnabled(remote.id, frame['enabled'])
        return
      }
      case 'rename': {
        const remote = this.targetSession(socket, frame)
        const name = normalizeSessionName(frame['name'])
        if (remote !== undefined && name !== null) void remote.host.rename(name)
        return
      }
      case 'unshare': {
        const remote = this.targetSession(socket, frame)
        if (remote !== undefined) this.setSharedByHost(remote.host.id, false)
        return
      }
      case 'create_session':
        void this.createSession(socket, frame)
        return
      case 'catalog':
        void this.sendCatalog(socket, frame)
        return
      default:
        socket.send(JSON.stringify(errorFrame('unknown frame type')))
        return
    }
  }

  private attach(socket: RemoteSocket, sessionId: string | null): void {
    this.syncSessions()
    const remote = sessionId !== null ? this.sessions.get(sessionId) : undefined
    if (remote === undefined) {
      socket.send(JSON.stringify(errorFrame('unknown session')))
      return
    }
    this.detach(socket)
    this.socketSessions.set(socket.seq, remote.id)
    remote.sockets.push(socket)
    remote.unread = false
    socket.send(JSON.stringify(attachedFrame(remote.id, remote.title, remote.projectName, remote.host.telegramEnabled, this.getSettings().loopsEnabled)))
    void this.sendSnapshot(socket, remote)
    socket.send(JSON.stringify(todosFrame(remoteTodos(widgetLinesOf(remote)))))
    const loopInfo = this.loops?.get(remote.host.id)
    if (loopInfo !== null && loopInfo !== undefined) {
      socket.send(JSON.stringify(loopStateFrame(remote.id, loopInfo)))
    }
    this.replayPendingDialogs(socket, remote)
    this.broadcastSessions()
  }

  private detach(socket: RemoteSocket): void {
    const sessionId = this.socketSessions.get(socket.seq)
    if (sessionId === undefined) return
    this.socketSessions.delete(socket.seq)
    const remote = this.sessions.get(sessionId)
    if (remote === undefined) return
    const index = remote.sockets.indexOf(socket)
    if (index >= 0) remote.sockets.splice(index, 1)
  }

  private async sendSnapshot(socket: RemoteSocket, remote: RemoteSession, attempt = 0): Promise<void> {
    try {
      const messages = await remote.host.requestRemote('get_messages')
      if (messages.success) {
        const data = objectOf(messages.data)
        const list = data !== null && Array.isArray(data['messages']) ? data['messages'] : []
        socket.send(JSON.stringify(snapshotFrame(list, null, null, remote.streaming)))
      }
    } catch {
      if (attempt < SNAPSHOT_ATTEMPTS) {
        setTimeout(() => void this.sendSnapshot(socket, remote, attempt + 1), SNAPSHOT_RETRY_MS).unref()
        return
      }
    }
    try {
      const state = await remote.host.requestRemote('get_state')
      if (state.success) socket.send(JSON.stringify(snapshotFrame(null, objectOf(state.data), null, remote.streaming)))
    } catch {
      // сессия умерла — телефон увидит это в списке
    }
    try {
      const stats = await remote.host.requestRemote('get_session_stats')
      if (stats.success) socket.send(JSON.stringify(snapshotFrame(null, null, objectOf(stats.data), remote.streaming)))
    } catch {
      // статистика не критична
    }
  }

  private replayPendingDialogs(socket: RemoteSocket, remote: RemoteSession): void {
    const now = Date.now()
    for (const pending of this.pendingUi.values()) {
      if (pending.remote !== remote || pending.answered) continue
      if (pending.timeoutMs !== null && now - pending.createdAt > pending.timeoutMs) continue
      socket.send(pending.line)
    }
  }

  private sessionFor(socket: RemoteSocket): RemoteSession | undefined {
    const sessionId = this.socketSessions.get(socket.seq)
    return sessionId !== undefined ? this.sessions.get(sessionId) : undefined
  }

  private targetSession(socket: RemoteSocket, frame: PiJsonObject): RemoteSession | undefined {
    const id = frameString(frame, 'id')
    if (id !== null) return this.sessions.get(id)
    return this.sessionFor(socket)
  }

  private async forwardPrompt(socket: RemoteSocket, frame: PiJsonObject): Promise<void> {
    const remote = this.sessionFor(socket)
    if (remote === undefined) {
      socket.send(JSON.stringify(errorFrame('attach to a session first')))
      return
    }
    const text = frameString(frame, 'text')?.trim() ?? ''
    if (text.length === 0) {
      socket.send(JSON.stringify(errorFrame('empty prompt')))
      return
    }
    const images = normalizePromptImages(frame['images'])
    if (images.error !== null) {
      socket.send(JSON.stringify(errorFrame(images.error)))
      return
    }
    const command: PiJsonObject = {
      type: 'prompt',
      id: remoteRequestId(socket.seq, frameString(frame, 'id')),
      message: text
    }
    const behavior = frameString(frame, 'behavior')
    if (behavior !== null) command['streamingBehavior'] = behavior
    if (images.blocks.length > 0) command['images'] = images.blocks
    remote.host.sendRemoteLine(JSON.stringify(command))
    this.startLoopFromPrompt(socket, remote, frame, text)
  }

  /** Петля с телефона: поле loop промпта {max, exit?}; exit пустой — петля без условия выхода. */
  private startLoopFromPrompt(socket: RemoteSocket, remote: RemoteSession, frame: PiJsonObject, text: string): void {
    const raw = frame['loop']
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return
    if (!this.getSettings().loopsEnabled || this.loops === undefined) {
      socket.send(JSON.stringify(errorFrame('Loops are disabled in settings')))
      return
    }
    const loop = raw as PiJsonObject
    const max = loop['max']
    const exit = frameString(loop, 'exit')?.trim() ?? ''
    if (typeof max !== 'number' || !Number.isFinite(max)) {
      socket.send(JSON.stringify(errorFrame('Invalid loop request')))
      return
    }
    this.loops.start(remote.host.id, text, max, exit)
  }

  private loopStop(socket: RemoteSocket): void {
    const remote = this.sessionFor(socket)
    if (remote === undefined || this.loops === undefined) return
    this.loops.stop(remote.host.id)
  }

  private loopSetRemaining(socket: RemoteSocket, frame: PiJsonObject): void {
    const remote = this.sessionFor(socket)
    const remaining = frame['remaining']
    if (remote === undefined || this.loops === undefined || typeof remaining !== 'number' || !Number.isFinite(remaining)) return
    this.loops.setRemaining(remote.host.id, remaining)
  }

  /** loop_state из LoopController → всем сокетам сессии. */
  loopState(hostId: string, info: LoopInfo): void {
    const remote = this.sessionsByHost.get(hostId)
    if (remote === undefined) return
    this.broadcast(remote, JSON.stringify(loopStateFrame(remote.id, info)))
  }

  private forwardCommand(socket: RemoteSocket, frame: PiJsonObject, type: string): void {
    const remote = this.sessionFor(socket)
    if (remote === undefined) {
      socket.send(JSON.stringify(errorFrame('attach to a session first')))
      return
    }
    const command: PiJsonObject = {
      type,
      id: remoteRequestId(socket.seq, frameString(frame, 'id'))
    }
    remote.host.sendRemoteLine(JSON.stringify(command))
  }

  private resolveUi(socket: RemoteSocket, frame: PiJsonObject): void {
    const id = frameString(frame, 'id')
    if (id === null) return
    const answer = decodePhoneAnswer(frame['answer'])
    if (answer === null) return
    if (!this.answerUi(id, answer, 'phone')) socket.send(JSON.stringify(errorFrame('dialog already answered')))
  }

  private async createSession(socket: RemoteSocket, frame: PiJsonObject): Promise<void> {
    const request = normalizeCreateSessionRequest(frame, 'New Chat')
    this.syncSessions()
    const available = [...new Set([...this.sessions.values()].map((r) => r.projectName))]
    const projectName = resolveCreateProject(request.project, available)
    if (projectName === null) {
      socket.send(JSON.stringify(errorFrame('no project with remote sessions to open a new tab')))
      return
    }
    const project = this.piHost.statuses().find((s) => basename(s.project.dir) === projectName)?.project
    if (project === undefined) {
      socket.send(JSON.stringify(errorFrame(`project "${projectName}" is not open`)))
      return
    }
    const host = this.piHost.create(project)
    if (request.name !== 'New Chat') void host.rename(request.name)
    if (request.model !== null || request.thinking !== null) {
      void host
        .ensureStarted()
        .then(async () => {
          if (request.model !== null) await host.setModel(request.model)
          if (request.thinking !== null) await host.setThinkingLevel(request.thinking)
        })
        .catch(() => {})
    }
    this.sharedHostIds.add(host.id)
    this.syncSessions()
    this.broadcastSessions()
    const remote = this.sessionsByHost.get(host.id)
    socket.send(JSON.stringify(sessionCreatedFrame(remote?.id ?? host.id)))
  }

  private async sendCatalog(socket: RemoteSocket, frame: PiJsonObject): Promise<void> {
    const requestId = frameString(frame, 'id')
    const status = this.piHost.statuses().find((s) => s.models.length > 0) ?? null
    if (status === null) {
      socket.send(JSON.stringify(errorFrame('no live session with a model catalog')))
      return
    }
    socket.send(
      JSON.stringify(
        catalogFrame(
          status.models.map(catalogModelOf),
          status.thinkingLevels,
          status.model,
          status.thinkingLevel,
          requestId
        )
      )
    )
  }

  // ------------------------------------------------------------ pi → phone

  private handleLine(remote: RemoteSession, line: string): void {
    const frame = parseFrame(line)
    const type = frame?.['type']
    if (type === 'agent_start') {
      remote.streaming = true
      this.broadcastSessions()
    } else if (type === 'agent_settled' || type === 'agent_end') {
      remote.streaming = false
      if (!this.hasAttachedViewer(remote)) remote.unread = true
      this.broadcastSessions()
    } else if (type === 'extension_ui_request' && frame !== null) {
      this.registerUiRequest(remote, frame, line)
      this.updateWidgets(remote, frame)
      this.broadcast(remote, line)
      return
    } else if ((type === 'response' || type === 'bash_execution_update') && frame !== null) {
      if (this.routeResponse(remote, frame)) return
    }
    this.broadcast(remote, line)
  }

  /** Виджеты задач (`pi-agent-desktop:todo`, `plan-todos`) — телефону нужен готовый список. */
  private updateWidgets(remote: RemoteSession, frame: PiJsonObject): void {
    const method = frameString(frame, 'method')
    if (method === null) return
    const ui = decodeExtensionUi(method, frame)
    if (ui === null || ui.kind !== 'widget') return
    if (ui.key !== TODO_WIDGET_KEY && ui.key !== PLAN_WIDGET_KEY) return
    if (ui.lines === null) remote.widgetLines.delete(ui.key)
    else remote.widgetLines.set(ui.key, ui.lines)
    this.broadcast(remote, JSON.stringify(todosFrame(remoteTodos(widgetLinesOf(remote)))))
  }

  private registerUiRequest(remote: RemoteSession, frame: PiJsonObject, line: string): void {
    const id = frameString(frame, 'id')
    const method = frameString(frame, 'method')
    if (id === null || method === null) return
    if (decodeExtensionDialog(method, frame) === null) return
    const timeoutRaw = frame['timeout']
    const timeoutMs = typeof timeoutRaw === 'number' && Number.isFinite(timeoutRaw) ? timeoutRaw : null
    const pending: PendingUi = {
      remote,
      method,
      line,
      createdAt: Date.now(),
      timeoutMs,
      answered: false,
      timer:
        timeoutMs !== null
          ? setTimeout(() => {
              if (this.pendingUi.get(id) === pending) {
                this.pendingUi.delete(id)
                this.broadcastSessions()
              }
            }, timeoutMs + EXPIRY_GRACE_MS)
          : null
    }
    pending.timer?.unref()
    this.pendingUi.set(id, pending)
    this.broadcastSessions()
  }

  /** Ответ с id телефона уходит только его сокету (id без префикса); иначе — broadcast. */
  private routeResponse(remote: RemoteSession, frame: PiJsonObject): boolean {
    const id = frameString(frame, 'id')
    if (id === null) return false
    const socket = remote.sockets.find((s) => stripRemoteRequestId(s.seq, id) !== null)
    if (socket === undefined) return false
    const copy = { ...frame, id: stripRemoteRequestId(socket.seq, id) }
    socket.send(JSON.stringify(copy))
    return true
  }

  /** Телефон сейчас смотрит конец ленты сессии — ход считается прочитанным сразу. */
  private hasAttachedViewer(remote: RemoteSession): boolean {
    return remote.sockets.some((s) => {
      const view = this.socketView.get(s.seq)
      return view !== undefined && view.visible && view.atBottom
    })
  }

  private broadcast(remote: RemoteSession, line: string): void {
    for (const socket of remote.sockets) socket.send(line)
  }

  private broadcastSessions(): void {
    this.syncSessions()
    const frame = JSON.stringify(sessionListFrame(this.infos()))
    for (const socket of this.allSockets) socket.send(frame)
  }

  private infos(): RemoteSessionInfo[] {
    const now = Date.now()
    for (const [id, pending] of this.pendingUi) {
      if (pending.timeoutMs !== null && now - pending.createdAt > pending.timeoutMs) {
        if (pending.timer !== null) clearTimeout(pending.timer)
        this.pendingUi.delete(id)
      }
    }
    return [...this.sessions.values()].map((remote) => {
      const methods = [...this.pendingUi.values()].filter((p) => p.remote === remote).map((p) => p.method)
      const status = sessionStatus(remote.streaming, methods, remote.host.lastStatus?.()?.state === 'waiting')
      return {
        id: remote.id,
        title: remote.title,
        project: remote.projectName,
        status,
        telegram: remote.host.telegramEnabled,
        unread: remote.unread
      }
    })
  }
}

function widgetLinesOf(remote: RemoteSession): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const [key, lines] of remote.widgetLines) result[key] = lines
  return result
}

function objectOf(data: unknown): PiJsonObject | null {
  return data !== null && typeof data === 'object' && !Array.isArray(data) ? (data as PiJsonObject) : null
}

function decodePhoneAnswer(value: unknown): DialogAnswer | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record['confirmed'] === 'boolean') return { kind: 'confirmed', confirmed: record['confirmed'] }
  if (typeof record['value'] === 'string') return { kind: 'value', value: record['value'] }
  if (record['cancelled'] === true) return { kind: 'cancelled' }
  return null
}
