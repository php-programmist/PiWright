/** Демон-держатель процессов pi: слушает канал, спавнит детей по спекам, пересылает
 *  stdin/stdout/stderr, переживает отключение клиента. Тонкий: без хендшейка, реплея и
 *  перевода событий — всё это остаётся в Electron main. stdout детей читается всегда
 *  (иначе pi встаёт по backpressure), без клиента — только счётчики и хвост stderr.
 *  Фоновые дети (без клиентов): легковесный парсинг stdout — конец хода/диалог без клиента
 *  дают звук + telegram, затем grace-период и kill; idle-дети умирают вместе с клиентом
 *  (иначе процессы копятся — утечка). */
import { createServer, connect, type Server, type Socket } from 'node:net'
import { randomBytes } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import type { BackendMode } from '../../shared/ipc-contracts'
import type { PiChildProcess, PiSpawnSpec } from '../pi/backends/types'
import { NdjsonAccumulator } from '../pi/ndjson'
import { decodeExtensionDialog } from '../pi/extension-ui'
import { sendTelegramNotification } from '../notifications/telegram'
import type { RemoteNotifyKind } from '../notifications/telegram'
import {
  DAEMON_PROTO_VERSION,
  daemonChannelPath,
  parseDaemonMessage,
  type DaemonClientMessage,
  type DaemonResponse,
  type DaemonServerMessage,
  type DaemonSessionInfo
} from './protocol'
import { ensureDaemonToken } from './token'
import { playSoundFile, projectLabel, readDaemonSettings } from './notify'
import { errorMessage } from '../../shared/errors'

export interface DaemonServerOptions {
  userDataDir: string
  /** Спавн ребёнка по спеке (прод: spawnFromSpec с ssh-сервисом демона; тесты: фейки). */
  spawnChild: (spec: PiSpawnSpec) => Promise<PiChildProcess>
  /** Переопределение канала — тесты. */
  channelPath?: string
  /** Версия приложения для welcome (демон сам не знает — передаётся в argv). */
  appVersion?: string
  /** Путь settings.json: фоновые уведомления (chatId, события, звуки, grace). Нет — уведомлений нет. */
  settingsPath?: string
  /** Переопределение проигрывания звука — тесты. */
  playSound?: (path: string) => void
  /** Grace-период поверх настроек, мс — тесты. */
  backgroundGraceMs?: number
  idleExitMs?: number
  helloTimeoutMs?: number
  killAfterCloseMs?: number
  log?: (line: string) => void
}

interface ConnState {
  id: string
  socket: Socket
  authenticated: boolean
  helloTimer: NodeJS.Timeout | null
  accumulator: NdjsonAccumulator
}

interface ChildRecord {
  key: string
  sessionFile: string | null
  mode: BackendMode
  child: PiChildProcess
  clients: Set<string>
  exited: boolean
  cause: string | null
  stdoutLines: number
  lastStdout: string | null
  stderrTail: string[]
  killTimer: NodeJS.Timeout | null
  accumulator: NdjsonAccumulator
  /** Легковесный парсинг stdout: состояние хода и уведомлений. */
  projectDir: string
  title: string | null
  streaming: boolean
  turnError: string | null
  graceTimer: NodeJS.Timeout | null
  /** Фоновый ход уже уведомлён (agent_end и agent_settled — один ход, не два). */
  turnNotified: boolean
  /** Id диалогов, уже уведомлённых в фоне (повторные кадры того же диалога — молча). */
  notifiedDialogs: Set<string>
}

const STDERR_TAIL_LINES = 20
const STDERR_LINE_LIMIT = 500
const PROBE_TIMEOUT_MS = 1000

export const DEFAULT_IDLE_EXIT_MS = 10 * 60_000
export const DEFAULT_HELLO_TIMEOUT_MS = 5000
export const DEFAULT_KILL_AFTER_CLOSE_MS = 2000

export class DaemonServer {
  private readonly options: DaemonServerOptions
  private readonly connections = new Map<string, ConnState>()
  private readonly children = new Map<string, ChildRecord>()
  private readonly bySessionFile = new Map<string, string>()
  private readonly pendingSpawns = new Map<string, Promise<ChildRecord>>()
  private server: Server | null = null
  private token = ''
  private telegramToken: string | null = null
  private nextId = 1
  private nextKey = 1
  private idleTimer: NodeJS.Timeout | null = null
  private shuttingDown = false

  constructor(options: DaemonServerOptions) {
    this.options = options
  }

  private log(line: string): void {
    this.options.log?.(`${new Date().toISOString()} ${line}`)
  }

  private get idleExitMs(): number {
    return this.options.idleExitMs ?? DEFAULT_IDLE_EXIT_MS
  }

  private get helloTimeoutMs(): number {
    return this.options.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS
  }

  private get killAfterCloseMs(): number {
    return this.options.killAfterCloseMs ?? DEFAULT_KILL_AFTER_CLOSE_MS
  }

  /** Канал: занят — демон уже работает ('busy'), иначе слушаем. Токен пишется до listen —
   *  клиент читает его после успешного подключения. */
  async start(): Promise<'started' | 'busy'> {
    const channel = this.options.channelPath ?? daemonChannelPath(this.options.userDataDir)
    if (await channelAlive(channel)) return 'busy'
    this.token = ensureDaemonToken(this.options.userDataDir)
    if (process.platform !== 'win32') {
      try {
        unlinkSync(channel)
      } catch {
        // файла могло не быть
      }
    }
    await new Promise<void>((resolve, reject) => {
      const server = createServer((socket) => this.onConnection(socket))
      server.on('error', (err: Error) => {
        if (server.listening) this.log(`server error: ${err.message}`)
        else reject(err)
      })
      server.listen(channel, () => resolve())
      this.server = server
    })
    this.log(`listening on ${channel}`)
    this.scheduleIdleCheck()
    return 'started'
  }

  /** Остановка для тестов: убить детей, закрыть соединения и сервер. */
  async stop(): Promise<void> {
    this.shuttingDown = true
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    for (const record of this.children.values()) {
      if (record.killTimer !== null) clearTimeout(record.killTimer)
      if (record.graceTimer !== null) clearTimeout(record.graceTimer)
      try {
        record.child.kill()
      } catch {
        // ребёнок мог уже умереть
      }
    }
    for (const conn of this.connections.values()) {
      if (conn.helloTimer !== null) clearTimeout(conn.helloTimer)
      conn.socket.destroy()
    }
    this.connections.clear()
    const server = this.server
    if (server === null) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
    this.server = null
  }

  private onConnection(socket: Socket): void {
    const id = `c${this.nextId++}`
    const conn: ConnState = {
      id,
      socket,
      authenticated: false,
      helloTimer: null,
      accumulator: new NdjsonAccumulator((line) => this.onClientLine(conn, line))
    }
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => conn.accumulator.append(chunk))
    socket.on('error', () => this.dropConnection(conn))
    socket.on('close', () => this.dropConnection(conn))
    conn.helloTimer = setTimeout(() => {
      if (!conn.authenticated) {
        this.log(`connection ${id} dropped: hello timeout`)
        socket.destroy()
      }
    }, this.helloTimeoutMs)
    this.connections.set(id, conn)
    this.scheduleIdleCheck()
  }

  private dropConnection(conn: ConnState): void {
    if (conn.helloTimer !== null) {
      clearTimeout(conn.helloTimer)
      conn.helloTimer = null
    }
    if (!this.connections.delete(conn.id)) return
    for (const record of this.children.values()) record.clients.delete(conn.id)
    this.killIdleChildren()
    this.scheduleIdleCheck()
  }

  /** Клиент ушёл (приложение закрылось/упало): idle-дети умирают сразу — иначе процессы
   *  копятся (утечка). Занятые (ход идёт) дорабатывают: уведомление + grace + kill. */
  private killIdleChildren(): void {
    for (const record of this.children.values()) {
      if (record.clients.size === 0 && !record.exited && !record.streaming) this.handleClose(record.key)
    }
  }

  private onClientLine(conn: ConnState, line: string): void {
    const message = parseDaemonMessage(line)
    if (message === null) return
    if (!conn.authenticated) {
      if (message.type !== 'hello') {
        conn.socket.destroy()
        return
      }
      if (message.token !== this.token) {
        this.log(`connection ${conn.id} dropped: bad token`)
        conn.socket.destroy()
        return
      }
      conn.authenticated = true
      if (conn.helloTimer !== null) {
        clearTimeout(conn.helloTimer)
        conn.helloTimer = null
      }
      if (typeof message['telegramToken'] === 'string' && (message['telegramToken'] as string).length > 0) {
        this.telegramToken = message['telegramToken'] as string
      }
      this.send(conn, {
        type: 'welcome',
        protoVersion: DAEMON_PROTO_VERSION,
        appVersion: this.options.appVersion ?? '',
        sessions: this.sessionInfos()
      })
      return
    }
    void this.onRequest(conn, message as DaemonClientMessage)
  }

  private sessionInfos(): DaemonSessionInfo[] {
    return [...this.children.values()]
      .filter((record) => !record.exited)
      .map((record) => ({
        sessionKey: record.key,
        sessionFile: record.sessionFile,
        mode: record.mode,
        clients: record.clients.size,
        projectDir: record.projectDir,
        title: record.title,
        streaming: record.streaming
      }))
  }

  private async onRequest(conn: ConnState, message: DaemonClientMessage): Promise<void> {
    if (message.type === 'hello') {
      // Повторный hello на живом подключении — обновление токена бота (сохранён после старта).
      if (typeof message.telegramToken === 'string' && message.telegramToken.length > 0) {
        this.telegramToken = message.telegramToken
        this.log('telegram token updated')
      }
      return
    }
    if (message.type === 'spawn') {
      await this.handleSpawn(conn, message.id, message.spec, message.sessionFile)
      return
    }
    if (message.type === 'input') {
      const record = this.children.get(message.sessionKey)
      if (record !== undefined && !record.exited) {
        try {
          record.child.stdin?.write(message.chunk)
        } catch {
          // процесс мог умереть между проверкой и записью
        }
      }
      return
    }
    if (message.type === 'endInput') {
      const record = this.children.get(message.sessionKey)
      if (record !== undefined && !record.exited) {
        try {
          record.child.stdin?.end()
        } catch {
          // процесс мог умереть между проверкой и записью
        }
      }
      return
    }
    if (message.type === 'close') {
      this.handleClose(message.sessionKey)
      return
    }
    if (message.type === 'rekey') {
      this.handleRekey(conn, message.id, message.sessionKey, message.sessionFile)
      return
    }
    if (message.type === 'list') {
      this.respond(conn, message.id, { sessions: this.sessionInfos() })
      return
    }
    if (message.type === 'detachChild') {
      const record = this.children.get(message.sessionKey)
      if (record !== undefined) record.clients.delete(conn.id)
      return
    }
    if (message.type === 'killBackground') {
      let stopped = 0
      for (const record of this.children.values()) {
        if (record.clients.size > 0 || record.exited) continue
        this.handleClose(record.key)
        stopped++
      }
      this.respond(conn, message.id, { stopped })
      return
    }
    if (message.type === 'shutdown') {
      this.respond(conn, message.id, {})
      this.log('shutdown requested')
      await this.shutdown()
    }
  }

  private async handleSpawn(conn: ConnState, id: string, spec: PiSpawnSpec, sessionFile: string | null): Promise<void> {
    if (sessionFile !== null) {
      const existingKey = this.bySessionFile.get(sessionFile)
      const existing = existingKey !== undefined ? this.children.get(existingKey) : undefined
      if (existing !== undefined && !existing.exited) {
        existing.clients.add(conn.id)
        this.cancelGrace(existing)
        this.respond(conn, id, { sessionKey: existing.key, attached: true, streaming: existing.streaming })
        return
      }
      const pending = this.pendingSpawns.get(sessionFile)
      if (pending !== undefined) {
        try {
          const record = await pending
          record.clients.add(conn.id)
          this.cancelGrace(record)
          this.respond(conn, id, { sessionKey: record.key, attached: true, streaming: record.streaming })
        } catch (err) {
          this.respondError(conn, id, errorMessage(err))
        }
        return
      }
    }
    const key = `s${this.nextKey++}-${randomBytes(4).toString('hex')}`
    const promise = this.options.spawnChild(spec).then((child) => {
      const record: ChildRecord = {
        key,
        sessionFile,
        mode: spec.mode,
        child,
        clients: new Set([conn.id]),
        exited: false,
        cause: null,
        stdoutLines: 0,
        lastStdout: null,
        stderrTail: [],
        killTimer: null,
        accumulator: new NdjsonAccumulator((line) => this.onChildStdoutLine(record, line)),
        projectDir: spec.cwd,
        title: null,
        streaming: false,
        turnError: null,
        graceTimer: null,
        turnNotified: false,
        notifiedDialogs: new Set()
      }
      this.registerChild(record)
      return record
    })
    if (sessionFile !== null) this.pendingSpawns.set(sessionFile, promise)
    try {
      const record = await promise
      this.respond(conn, id, { sessionKey: record.key, attached: false })
    } catch (err) {
      this.respondError(conn, id, errorMessage(err))
    } finally {
      if (sessionFile !== null) this.pendingSpawns.delete(sessionFile)
    }
  }

  private registerChild(record: ChildRecord): void {
    this.children.set(record.key, record)
    if (record.sessionFile !== null) this.bySessionFile.set(record.sessionFile, record.key)
    const { stdout, stderr } = record.child
    stdout?.setEncoding('utf8')
    stdout?.on('data', (chunk: string) => record.accumulator.append(chunk))
    stderr?.setEncoding('utf8')
    stderr?.on('data', (chunk: string) => this.onChildStderr(record, chunk))
    record.child.on('error', (err: Error) => {
      if (record.cause === null) record.cause = err.message
    })
    record.child.on('close', (code: number | null) => this.onChildExit(record, code))
    this.log(`child ${record.key} spawned (mode ${record.mode}, session ${record.sessionFile ?? '—'})`)
    this.scheduleIdleCheck()
  }

  /** stdout ребёнка: читается всегда; клиентам уходит построчно, без них — только счётчики
   *  и легковесный парсинг типов для фоновых уведомлений. */
  private onChildStdoutLine(record: ChildRecord, line: string): void {
    record.stdoutLines++
    record.lastStdout = line
    this.parseChildLine(record, line)
    this.broadcast(record, { type: 'stdout', sessionKey: record.key, line })
  }

  /** Типы строк stdout pi, важные для фона: ход, конец хода, ошибка, диалог, имя сессии.
   *  Битые/чужие строки молча пропускаются. */
  private parseChildLine(record: ChildRecord, line: string): void {
    let frame: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(line)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return
      frame = parsed as Record<string, unknown>
    } catch {
      return
    }
    const type = frame['type']
    if (type === 'agent_start') {
      record.streaming = true
      record.turnError = null
      record.turnNotified = false
      this.cancelGrace(record)
      return
    }
    if (type === 'session_info_changed') {
      const name = frame['name']
      if (typeof name === 'string' && name.trim().length > 0) record.title = name.trim()
      return
    }
    if (type === 'message_end') {
      const message = frame['message']
      if (message !== null && typeof message === 'object' && !Array.isArray(message)) {
        const msg = message as Record<string, unknown>
        if (msg['stopReason'] === 'error') {
          record.turnError = typeof msg['errorMessage'] === 'string' ? msg['errorMessage'] : 'Model request failed.'
        }
      }
      return
    }
    if (type === 'agent_end' || type === 'agent_settled') {
      record.streaming = false
      // agent_end и agent_settled — конец одного и того же хода: уведомляем один раз.
      if (!record.turnNotified && record.clients.size === 0 && record.sessionFile !== null) {
        record.turnNotified = true
        this.onBackgroundTurnEnd(record)
      }
      return
    }
    if (type === 'extension_ui_request' && record.clients.size === 0 && record.sessionFile !== null) {
      this.onBackgroundDialog(record, frame)
    }
  }

  /** Ход завершился без клиента: уведомить (звук + telegram) и запустить grace-период. */
  private onBackgroundTurnEnd(record: ChildRecord): void {
    const error = record.turnError
    this.notifyBackground(record, error !== null ? 'error' : 'turnEnd', error ?? undefined)
    this.startGrace(record)
  }

  /** Диалог расширения без клиента: уведомить и запустить grace — время открыть приложение и ответить.
   *  setStatus/setWidget тоже идут через extension_ui_request — это не диалоги, молча пропускаем. */
  private onBackgroundDialog(record: ChildRecord, frame: Record<string, unknown>): void {
    const method = typeof frame['method'] === 'string' ? frame['method'] : ''
    const dialog = decodeExtensionDialog(method, frame as never)
    if (dialog === null) return
    const id = typeof frame['id'] === 'string' ? frame['id'] : ''
    if (id.length > 0) {
      if (record.notifiedDialogs.has(id)) return
      record.notifiedDialogs.add(id)
      if (record.notifiedDialogs.size > 50) record.notifiedDialogs.delete(record.notifiedDialogs.keys().next().value ?? '')
    }
    this.notifyBackground(record, dialog.kind === 'confirm' ? 'permission' : 'question')
    this.startGrace(record)
  }

  /** Звук + telegram по настройкам; ошибки глотаются. Пока есть клиент — тишина (шлёт main). */
  private notifyBackground(record: ChildRecord, kind: RemoteNotifyKind, detail?: string): void {
    if (this.options.settingsPath === undefined) return
    const settings = readDaemonSettings(this.options.settingsPath)
    if (settings === null) return
    const soundPath = kind === 'turnEnd' ? settings.notifications.sounds.completion : kind === 'error' ? settings.notifications.sounds.error : settings.notifications.sounds.await
    ;(this.options.playSound ?? playSoundFile)(soundPath)
    const telegram = settings.notifications.telegram
    if (telegram.chatId.trim().length === 0) return
    if (!telegram.events[kind]) return
    if (settings.sessionToggles[record.sessionFile ?? '']?.telegram !== true) return
    if (this.telegramToken === null) return
    sendTelegramNotification(telegram.chatId, this.telegramToken, projectLabel(record.projectDir), record.title ?? 'session', kind, detail)
    this.log(`background notify ${kind} for ${record.key}`)
  }

  private get backgroundGraceMs(): number {
    if (this.options.backgroundGraceMs !== undefined) return this.options.backgroundGraceMs
    const settings = this.options.settingsPath !== undefined ? readDaemonSettings(this.options.settingsPath) : null
    return (settings?.notifications.backgroundGraceMinutes ?? 10) * 60_000
  }

  /** Grace-период: процесс живёт, пока пользователь не откроет приложение; затем kill. */
  private startGrace(record: ChildRecord): void {
    if (record.graceTimer !== null) return
    const ms = this.backgroundGraceMs
    this.log(`background grace ${Math.round(ms / 1000)}s for ${record.key}`)
    record.graceTimer = setTimeout(() => {
      record.graceTimer = null
      if (record.exited || record.clients.size > 0) return
      this.log(`background grace expired, closing ${record.key}`)
      this.handleClose(record.key)
    }, ms)
  }

  private cancelGrace(record: ChildRecord): void {
    if (record.graceTimer === null) return
    clearTimeout(record.graceTimer)
    record.graceTimer = null
  }

  private onChildStderr(record: ChildRecord, chunk: string): void {
    for (const line of chunk.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue
      record.stderrTail.push(trimmed.slice(0, STDERR_LINE_LIMIT))
      while (record.stderrTail.length > STDERR_TAIL_LINES) record.stderrTail.shift()
      this.broadcast(record, { type: 'stderr', sessionKey: record.key, line: trimmed })
    }
  }

  /** Выход ребёнка: один exit-пуш (код + причина + хвост stderr), затем cleanup. */
  private onChildExit(record: ChildRecord, code: number | null): void {
    if (record.exited) return
    record.exited = true
    this.cancelGrace(record)
    if (record.killTimer !== null) {
      clearTimeout(record.killTimer)
      record.killTimer = null
    }
    record.accumulator.flush()
    this.broadcast(record, {
      type: 'exit',
      sessionKey: record.key,
      code,
      cause: record.cause,
      stderrTail: record.stderrTail.join(' | ')
    })
    this.children.delete(record.key)
    if (record.sessionFile !== null && this.bySessionFile.get(record.sessionFile) === record.key) {
      this.bySessionFile.delete(record.sessionFile)
    }
    this.log(`child ${record.key} exited (code ${code ?? '?'}, cause ${record.cause ?? '—'}, stdout ${record.stdoutLines})`)
    this.scheduleIdleCheck()
  }

  /** rekey: ребёнок, заспавненный без --session (файл создаёт pi), после хендшейка/fork получает
   *  реальный файл сессии — без этого рестарт не найдёт ребёнка для attach. */
  private handleRekey(conn: ConnState, id: string, sessionKey: string, sessionFile: string): void {
    const record = this.children.get(sessionKey)
    if (record === undefined || record.exited) {
      this.respondError(conn, id, 'unknown session')
      return
    }
    const owner = this.bySessionFile.get(sessionFile)
    if (owner !== undefined && owner !== sessionKey) {
      this.respondError(conn, id, 'session file already tracked')
      return
    }
    if (record.sessionFile !== null && this.bySessionFile.get(record.sessionFile) === sessionKey) {
      this.bySessionFile.delete(record.sessionFile)
    }
    record.sessionFile = sessionFile
    this.bySessionFile.set(sessionFile, sessionKey)
    this.respond(conn, id, { sessionKey, sessionFile })
    this.log(`child ${sessionKey} rekeyed to session ${sessionFile}`)
  }

  /** close: stdin.end + kill через 2 c — семантика PiConnection.close. */
  private handleClose(sessionKey: string): void {
    const record = this.children.get(sessionKey)
    if (record === undefined || record.exited) return
    try {
      record.child.stdin?.end()
    } catch {
      // процесс мог умереть
    }
    if (record.killTimer === null) {
      record.killTimer = setTimeout(() => {
        record.killTimer = null
        try {
          record.child.kill()
        } catch {
          // ребёнок мог уже умереть
        }
      }, this.killAfterCloseMs)
    }
  }

  private async shutdown(): Promise<void> {
    this.shuttingDown = true
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    for (const record of this.children.values()) {
      if (record.killTimer !== null) clearTimeout(record.killTimer)
      if (record.graceTimer !== null) clearTimeout(record.graceTimer)
      try {
        record.child.kill()
      } catch {
        // ребёнок мог уже умереть
      }
    }
    for (const conn of this.connections.values()) conn.socket.destroy()
    this.server?.close()
    // дать ответу shutdown уйти в сокет
    setTimeout(() => process.exit(0), 50)
  }

  private broadcast(record: ChildRecord, message: DaemonServerMessage): void {
    for (const clientId of record.clients) {
      const conn = this.connections.get(clientId)
      if (conn !== undefined) this.send(conn, message)
    }
  }

  private respond(conn: ConnState, id: string, data: Record<string, unknown>): void {
    const response: DaemonResponse = { type: 'response', id, ok: true, data }
    this.send(conn, response)
  }

  private respondError(conn: ConnState, id: string, error: string): void {
    const response: DaemonResponse = { type: 'response', id, ok: false, error }
    this.send(conn, response)
  }

  private send(conn: ConnState, message: DaemonServerMessage): void {
    if (conn.socket.destroyed) return
    try {
      conn.socket.write(`${JSON.stringify(message)}\n`)
    } catch {
      // сокет мог умереть — error/close почистит
    }
  }

  /** Авто-выход: нет детей и нет клиентов ~10 минут — демон завершается. */
  private scheduleIdleCheck(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    if (this.shuttingDown) return
    if (this.children.size > 0 || this.connections.size > 0) return
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      this.log('idle exit')
      process.exit(0)
    }, this.idleExitMs)
  }
}

/** Живёт ли уже демон на канале: успешное подключение — да. */
export function channelAlive(channel: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(channel)
    let settled = false
    const done = (value: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }
    socket.on('connect', () => done(true))
    socket.on('error', () => done(false))
    setTimeout(() => done(false), timeoutMs).unref()
  })
}
