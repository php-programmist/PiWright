/** Клиент демона в Electron main: JSONL по каналу, hello с токеном, spawn/attach, маршрутизация
 *  пушей к адаптерам. Пуши для ещё не созданных адаптеров (ответ spawn в полёте) буферизуются
 *  здесь — «буфер на стороне клиента, не демона». Обрыв канала → все адаптеры отключаются. */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { connect, type Socket } from 'node:net'
import { join } from 'node:path'
import type { BackendMode } from '../../shared/ipc-contracts'
import type { PiSpawnSpec } from '../pi/backends/types'
import { NdjsonAccumulator } from '../pi/ndjson'
import {
  DAEMON_PROTO_VERSION,
  daemonChannelPath,
  parseDaemonMessage,
  type DaemonClientMessage,
  type DaemonResponse,
  type DaemonPush,
  type DaemonWelcome
} from './protocol'
import { readDaemonToken } from './token'
import { DaemonChildProcess, type DaemonChildTransport } from './child-process'

/** Демон недоступен (не поднялся, не ответил на hello, несовместимый протокол) — спавнер
 *  делает локальный фолбэк. Ошибки ответа spawn сюда не входят: ребёнок мог уже родиться. */
export class DaemonUnavailableError extends Error {
  constructor(reason: string) {
    super(`daemon unavailable: ${reason}`)
  }
}

export interface DaemonClientOptions {
  userDataDir: string
  appVersion: string
  /** Переопределения для тестов. */
  channelPath?: string
  daemonJsPath?: string
  connectTimeoutMs?: number
  connectRetryMs?: number
  connectRetryTotalMs?: number
  helloTimeoutMs?: number
  spawnTimeoutMs?: number
  /** Грейс отвязанной сессии после завершения хода: столько живёт процесс без нового хода,
   *  потом закрывается (держать агента в памяти дороже, чем восстановить из транскрипта). */
  detachedGraceMs?: number
}

export interface DaemonSpawnResult {
  child: DaemonChildProcess
  sessionKey: string
  attached: boolean
}

interface PendingRequest {
  resolve: (response: DaemonResponse) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout | null
}

const BUFFERED_PUSH_LIMIT = 500

export class DaemonClient implements DaemonChildTransport {
  private readonly options: DaemonClientOptions
  private socket: Socket | null = null
  private connected = false
  private connecting: Promise<void> | null = null
  private disabled = false
  private nextId = 1
  private readonly pending = new Map<string, PendingRequest>()
  private readonly adapters = new Map<string, DaemonChildProcess>()
  private readonly buffered = new Map<string, DaemonPush[]>()
  /** Ключи отвязанных детей (detach вкладки во время хода): живы в демоне, пуши не буферизуются.
   *  stdout легковесно парсится: ход завершился (agent_settled) → грейс 10 мин без нового хода →
   *  ребёнок закрывается (держать агента в памяти дороже, чем восстановить из транскрипта). */
  private readonly detached = new Set<string>()
  private detachedListener: ((sessionKey: string, reason: 'settled' | 'exit') => void) | null = null
  /** Таймеры грейса отвязанных сессий (agent_settled → грейс → close; agent_start → отмена). */
  private readonly detachedTimers = new Map<string, NodeJS.Timeout>()
  private welcomeWaiter: { resolve: (welcome: DaemonWelcome) => void; reject: (error: Error) => void; timer: NodeJS.Timeout | null } | null = null

  constructor(options: DaemonClientOptions) {
    this.options = options
  }

  private get channel(): string {
    return this.options.channelPath ?? daemonChannelPath(this.options.userDataDir)
  }

  private get connectTimeoutMs(): number {
    return this.options.connectTimeoutMs ?? 2000
  }

  private get connectRetryMs(): number {
    return this.options.connectRetryMs ?? 150
  }

  private get connectRetryTotalMs(): number {
    return this.options.connectRetryTotalMs ?? 10_000
  }

  private get helloTimeoutMs(): number {
    return this.options.helloTimeoutMs ?? 5000
  }

  private get spawnTimeoutMs(): number {
    return this.options.spawnTimeoutMs ?? 60_000
  }

  private get detachedGraceMs(): number {
    return this.options.detachedGraceMs ?? 10 * 60_000
  }

  /** Спавн/attach ребёнка через демона. Ответ ошибки spawn пробрасывается как есть —
   *  локальный фолбэк на нём не нужен (та же ошибка воспроизведётся и локально). */
  async spawn(spec: PiSpawnSpec, sessionFile: string | null): Promise<DaemonSpawnResult> {
    await this.ensureConnected()
    const id = String(this.nextId++)
    const response = await this.request({ type: 'spawn', id, spec, sessionFile }, this.spawnTimeoutMs)
    if (!response.ok) throw new Error(response.error)
    const sessionKey = response.data['sessionKey']
    if (typeof sessionKey !== 'string' || sessionKey.length === 0) {
      throw new Error('malformed spawn response from daemon')
    }
    const child = new DaemonChildProcess(sessionKey, this)
    this.registerAdapter(sessionKey, child)
    return { child, sessionKey, attached: response.data['attached'] === true }
  }

  sendInput(sessionKey: string, chunk: string): void {
    this.send({ type: 'input', sessionKey, chunk })
  }

  sendEndInput(sessionKey: string): void {
    this.send({ type: 'endInput', sessionKey })
  }

  sendClose(sessionKey: string): void {
    this.send({ type: 'close', sessionKey })
  }

  /** Обновить файл сессии ребёнка (после хендшейка/fork): без rekey рестарт не найдёт ребёнка для attach. */
  async rekey(sessionKey: string, sessionFile: string): Promise<void> {
    await this.ensureConnected()
    const id = String(this.nextId++)
    const response = await this.request({ type: 'rekey', id, sessionKey, sessionFile }, this.helloTimeoutMs)
    if (!response.ok) throw new Error(response.error)
  }

  /** Флеш команд (endInput/close) в канал и закрытие сокета — для will-quit: записи в сокет
   *  асинхронны, без ожидания они теряются при выходе процесса и дети демона переживают
   *  приложение (раньше stdin.end доходил до pi напрямую). */
  async dispose(flushTimeoutMs = 2000): Promise<void> {
    const socket = this.socket
    this.socket = null
    this.connected = false
    if (socket === null || socket.destroyed) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, flushTimeoutMs)
      socket.once('close', () => {
        clearTimeout(timer)
        resolve()
      })
      socket.end()
    })
  }

  /** Живые ли дети у демона (для тестов и задачи восстановления). */
  async list(): Promise<{ sessionKey: string; sessionFile: string | null; mode: BackendMode }[]> {
    await this.ensureConnected()
    const id = String(this.nextId++)
    const response = await this.request({ type: 'list', id }, this.helloTimeoutMs)
    if (!response.ok) throw new Error(response.error)
    const sessions = response.data['sessions']
    if (!Array.isArray(sessions)) throw new Error('malformed list response from daemon')
    return sessions.filter(
      (s): s is { sessionKey: string; sessionFile: string | null; mode: BackendMode } =>
        s !== null && typeof s === 'object' && typeof (s as Record<string, unknown>)['sessionKey'] === 'string'
    )
  }

  private ensureConnected(): Promise<void> {
    if (this.disabled) return Promise.reject(new DaemonUnavailableError('protocol version mismatch earlier'))
    if (this.connected && this.socket !== null && !this.socket.destroyed) return Promise.resolve()
    if (this.connecting !== null) return this.connecting
    this.connecting = this.doConnect().finally(() => {
      this.connecting = null
    })
    return this.connecting
  }

  private async doConnect(): Promise<void> {
    let daemonLaunched = false
    const deadline = Date.now() + this.connectRetryTotalMs
    for (;;) {
      let socket: Socket
      try {
        socket = await this.connectOnce()
      } catch {
        if (!daemonLaunched) {
          daemonLaunched = true
          this.launchDaemon()
        }
        if (Date.now() >= deadline) throw new DaemonUnavailableError('connect failed')
        await new Promise((resolve) => setTimeout(resolve, this.connectRetryMs))
        continue
      }
      await this.handshake(socket)
      this.socket = socket
      this.connected = true
      return
    }
  }

  private connectOnce(): Promise<Socket> {
    return new Promise<Socket>((resolve, reject) => {
      const socket = connect(this.channel)
      const timer = setTimeout(() => {
        socket.destroy()
        reject(new Error('connect timeout'))
      }, this.connectTimeoutMs)
      socket.on('connect', () => {
        clearTimeout(timer)
        resolve(socket)
      })
      socket.on('error', (err: Error) => {
        clearTimeout(timer)
        reject(err)
      })
    })
  }

  /** Демон — Electron в режиме чистого Node: полный доступ к node_modules из asar.
   *  Windows: запуск через посредника PowerShell Start-Process — .NET зовёт CreateProcess
   *  с bInheritHandles=FALSE, демон не наследует хэндлы приложения. Прямой spawn (libuv) и
   *  cmd start наследуют всё: после выхода приложения демон держал унаследованный сокет CDP
   *  (и хэндл job-объекта, не давая умереть детям), порт оставался занят и перезапуск не мог
   *  подняться («Cannot start http server for devtools»). Сам powershell спавнится БЕЗ
   *  detached: DETACHED_PROCESS молча ломает его выполнение (exit 0 без запуска команды);
   *  windowsHide скрывает консоль, сам powershell выходит сразу после Start-Process. */
  private launchDaemon(): void {
    const daemonJs = this.options.daemonJsPath ?? join(__dirname, '..', 'daemon', 'index.js')
    if (!existsSync(daemonJs)) return
    if (process.platform === 'win32') {
      const psq = (value: string): string => `'${value.replace(/'/g, "''")}'`
      const command = [
        'Start-Process', '-FilePath', psq(process.execPath),
        '-ArgumentList', psq(daemonJs), ',', psq('--user-data'), ',', psq(this.options.userDataDir),
        ',', psq('--app-version'), ',', psq(this.options.appVersion),
        '-WindowStyle', 'Hidden'
      ].join(' ')
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
      })
      child.on('error', () => {})
      child.unref()
      return
    }
    const child = spawn(
      process.execPath,
      [daemonJs, '--user-data', this.options.userDataDir, '--app-version', this.options.appVersion],
      {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
      }
    )
    child.unref()
  }

  private handshake(socket: Socket): Promise<void> {
    const token = readDaemonToken(this.options.userDataDir)
    if (token === null) {
      socket.destroy()
      return Promise.reject(new DaemonUnavailableError('daemon token file is missing'))
    }
    socket.setEncoding('utf8')
    const accumulator = new NdjsonAccumulator((line) => this.onLine(line))
    socket.on('data', (chunk: string) => accumulator.append(chunk))
    socket.on('error', () => this.handleDisconnect())
    socket.on('close', () => this.handleDisconnect())
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.welcomeWaiter = null
        socket.destroy()
        reject(new DaemonUnavailableError('welcome timeout'))
      }, this.helloTimeoutMs)
      this.welcomeWaiter = {
        resolve: (welcome) => {
          clearTimeout(timer)
          this.welcomeWaiter = null
          if (welcome.protoVersion !== DAEMON_PROTO_VERSION) {
            // демон от другой версии пережил обновление — работаем локально (диалог — задача 3)
            this.disabled = true
            socket.destroy()
            this.handleDisconnect()
            reject(new DaemonUnavailableError(`protocol version ${welcome.protoVersion} != ${DAEMON_PROTO_VERSION}`))
            return
          }
          resolve()
        },
        reject: (error) => {
          clearTimeout(timer)
          this.welcomeWaiter = null
          reject(error)
        },
        timer
      }
      this.write(socket, {
        type: 'hello',
        token,
        protoVersion: DAEMON_PROTO_VERSION,
        appVersion: this.options.appVersion
      })
    })
  }

  private onLine(line: string): void {
    const message = parseDaemonMessage(line)
    if (message === null) return
    if (message.type === 'welcome') {
      this.welcomeWaiter?.resolve(message)
      return
    }
    if (message.type === 'response') {
      const pending = this.pending.get(message.id)
      if (pending !== undefined) {
        this.pending.delete(message.id)
        if (pending.timer !== null) clearTimeout(pending.timer)
        pending.resolve(message)
      }
      return
    }
    const push = message as DaemonPush
    const adapter = this.adapters.get(push.sessionKey)
    if (adapter !== undefined) adapter.handlePush(push)
    else if (this.detached.has(push.sessionKey)) this.handleDetachedPush(push)
    else this.bufferPush(push)
  }

  /** Колбэк «отвязанная сессия завершилась» (ход дописан или процесс умер) — реестр вкладок чистит. */
  setDetachedListener(listener: (sessionKey: string, reason: 'settled' | 'exit') => void): void {
    this.detachedListener = listener
  }

  private handleDetachedPush(push: DaemonPush): void {
    if (push.type === 'exit') {
      this.clearDetachedGrace(push.sessionKey)
      this.detached.delete(push.sessionKey)
      this.detachedListener?.(push.sessionKey, 'exit')
      return
    }
    if (push.type !== 'stdout') return
    let eventType: string | null = null
    try {
      const parsed: unknown = JSON.parse(push.line)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const t = (parsed as Record<string, unknown>)['type']
        if (typeof t === 'string') eventType = t
      }
    } catch {
      // не JSON — строка не про ход агента
    }
    if (eventType === 'agent_settled') {
      // Ход в фоне дописан: грейс (по умолчанию 10 мин) — вдруг начнётся новый ход;
      // по истечении закрываем ребёнка (stdin.end + kill через 2 c у демона).
      if (this.detachedTimers.has(push.sessionKey)) return
      const timer = setTimeout(() => {
        this.detachedTimers.delete(push.sessionKey)
        this.sendClose(push.sessionKey)
        this.detachedListener?.(push.sessionKey, 'settled')
      }, this.detachedGraceMs)
      timer.unref()
      this.detachedTimers.set(push.sessionKey, timer)
      return
    }
    if (eventType === 'agent_start') this.clearDetachedGrace(push.sessionKey)
  }

  private clearDetachedGrace(sessionKey: string): void {
    const timer = this.detachedTimers.get(sessionKey)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.detachedTimers.delete(sessionKey)
    }
  }

  private bufferPush(push: DaemonPush): void {
    let list = this.buffered.get(push.sessionKey)
    if (list === undefined) {
      list = []
      this.buffered.set(push.sessionKey, list)
    }
    list.push(push)
    if (list.length > BUFFERED_PUSH_LIMIT) list.shift()
  }

  private registerAdapter(sessionKey: string, child: DaemonChildProcess): void {
    this.adapters.set(sessionKey, child)
    this.detached.delete(sessionKey)
    const buffered = this.buffered.get(sessionKey)
    if (buffered !== undefined) {
      this.buffered.delete(sessionKey)
      for (const push of buffered) child.handlePush(push)
    }
  }

  /** Отвязать адаптер без остановки ребёнка (detach вкладки): адаптер уходит, пуши ключа
   *  не буферизуются — при повторном открытии транскрипт догоняет get_messages-реплей. */
  releaseAdapter(sessionKey: string): void {
    this.adapters.delete(sessionKey)
    this.buffered.delete(sessionKey)
    this.detached.add(sessionKey)
  }

  private handleDisconnect(): void {
    if (!this.connected && this.pending.size === 0 && this.adapters.size === 0 && this.welcomeWaiter === null) return
    this.connected = false
    this.socket = null
    for (const timer of this.detachedTimers.values()) clearTimeout(timer)
    this.detachedTimers.clear()
    this.detached.clear()
    const error = new DaemonUnavailableError('connection lost')
    for (const pending of this.pending.values()) {
      if (pending.timer !== null) clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    if (this.welcomeWaiter !== null) {
      const waiter = this.welcomeWaiter
      this.welcomeWaiter = null
      if (waiter.timer !== null) clearTimeout(waiter.timer)
      waiter.reject(error)
    }
    for (const adapter of this.adapters.values()) adapter.handleDisconnect()
    this.adapters.clear()
    this.buffered.clear()
  }

  private request(message: DaemonClientMessage & { id: string }, timeoutMs: number): Promise<DaemonResponse> {
    const socket = this.socket
    if (socket === null || !this.connected || socket.destroyed) {
      return Promise.reject(new DaemonUnavailableError('not connected'))
    }
    return new Promise<DaemonResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(String(message.id))
        reject(new Error(`daemon request ${message.type} timed out`))
      }, timeoutMs)
      this.pending.set(String(message.id), { resolve, reject, timer })
      this.write(socket, message)
    })
  }

  private send(message: DaemonClientMessage): void {
    const socket = this.socket
    if (socket === null || !this.connected || socket.destroyed) return
    this.write(socket, message)
  }

  private write(socket: Socket, message: DaemonClientMessage): void {
    try {
      socket.write(`${JSON.stringify(message)}\n`)
    } catch {
      // сокет мог умереть — close почистит
    }
  }
}

let client: DaemonClient | null = null

/** Инициализация синглтона в main (app.ready). До неё спавнеры работают локально. */
export function initDaemonClient(options: DaemonClientOptions): void {
  client = new DaemonClient(options)
}

export function getDaemonClient(): DaemonClient | null {
  return client
}

/** Подмена синглтона в тестах (null — спавнеры работают локально). */
export function setDaemonClientForTests(value: DaemonClient | null): void {
  client = value
}
