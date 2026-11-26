/** Клиент одного `pi --mode rpc`. Порт `core/rpc/PiRpcClient.kt`:
 *  stdout читается непрерывно (иначе pi встаёт), строки режутся только по LF, stderr — хвост 20 строк,
 *  ответы матчятся по `id` (порядок не гарантирован), падение размораживает pending-запросы ошибкой. */
import type { PiJsonObject, PiResponse } from '../../shared/protocol-types'
import { NdjsonAccumulator } from './ndjson'
import { encodeCommand, encodeExtensionUiResponse, parseInbound } from './rpc'
import type { PiChildProcess, PiSpawnRequest, PiSpawner } from './backends/types'

export interface PiConnectionListener {
  onEvent(type: string, payload: PiJsonObject): void
  onExtensionUiRequest(id: string, method: string, payload: PiJsonObject): void
  onDisconnected(cause: string | null, exitCode: number | null, stderrTail: string): void
}

interface Pending {
  resolve: (response: PiResponse) => void
  reject: (error: Error) => void
}

const STDERR_TAIL_LINES = 20
const STDERR_LINE_LIMIT = 500
const STDERR_TAIL_TEXT_LIMIT = 800
const KILL_AFTER_CLOSE_MS = 2000

/** Сообщение об обрыве канала: причина, код выхода и хвост stderr — без них диагноз невозможен. */
export function describeExit(cause: string | null, exitCode: number | null, stderrTail: string): string {
  const head = cause !== null ? `pi process exited: ${cause}` : 'pi process exited'
  const code = exitCode !== null ? ` (code ${exitCode})` : ''
  const tail = stderrTail.trim().length > 0 ? `. stderr: ${stderrTail}` : '.'
  return head + code + tail
}

export class PiConnection {
  private nextId = 1
  private readonly pending = new Map<string, Pending>()
  private child: PiChildProcess | null = null
  private closed = false
  private disconnected = false
  private exited = false
  private readonly exitWaiters = new Set<() => void>()
  private readonly stderrTail: string[] = []
  private readonly rawSinks = new Set<(line: string) => void>()

  constructor(
    private readonly spawner: PiSpawner,
    private readonly listener: PiConnectionListener
  ) {}

  get running(): boolean {
    return this.child !== null && !this.closed && !this.disconnected
  }

  /** Ключ ребёнка в демоне (DaemonChildProcess.sessionKey); null — локальный спавн/не запущен. */
  get daemonSessionKey(): string | null {
    const child = this.child as { sessionKey?: string } | null
    return typeof child?.sessionKey === 'string' && child.sessionKey.length > 0 ? child.sessionKey : null
  }

  /** Ребёнок демона уже в ходе (аттач к работающей сессии); false — локальный спавн/новый ребёнок. */
  get attachedStreaming(): boolean {
    const child = this.child as { attachedStreaming?: boolean } | null
    return child?.attachedStreaming === true
  }

  /** Спавнит процесс и начинает непрерывное чтение stdout. */
  async start(req: PiSpawnRequest): Promise<void> {
    if (this.child !== null) throw new Error('PiConnection is already started')
    const child = await this.spawner(req)
    if (this.closed) {
      child.kill()
      throw new Error('PiConnection was closed before start')
    }
    this.child = child

    const accumulator = new NdjsonAccumulator((line) => this.handleLine(line))
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => accumulator.append(chunk))
    child.stdout?.on('end', () => accumulator.flush())

    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) {
        const trimmed = line.trim()
        if (trimmed.length === 0) continue
        this.stderrTail.push(trimmed.slice(0, STDERR_LINE_LIMIT))
        while (this.stderrTail.length > STDERR_TAIL_LINES) this.stderrTail.shift()
      }
    })

    child.on('error', (err: Error) => {
      this.handleDisconnect(err.message, null)
      this.markExited()
    })
    child.on('close', (code: number | null) => {
      accumulator.flush()
      this.handleDisconnect(null, code)
      this.markExited()
    })
  }

  private stderrTailText(): string {
    return this.stderrTail
      .filter((l) => l.trim().length > 0)
      .join(' | ')
      .slice(-STDERR_TAIL_TEXT_LIMIT)
  }

  private handleDisconnect(cause: string | null, exitCode: number | null): void {
    if (this.disconnected || this.closed) return
    this.disconnected = true
    this.child = null
    const error = new Error(describeExit(cause, exitCode, this.stderrTailText()))
    for (const p of this.pending.values()) p.reject(error)
    this.pending.clear()
    this.listener.onDisconnected(cause, exitCode, this.stderrTailText())
  }

  private handleLine(line: string): void {
    for (const sink of this.rawSinks) {
      try {
        sink(line)
      } catch {
        // sink не должен ронять чтение stdout
      }
    }
    const message = parseInbound(line)
    if (message === null) return
    if (message.kind === 'response') {
      const id = message.response.id
      const p = id !== null ? this.pending.get(id) : undefined
      if (p !== undefined) {
        if (id !== null) this.pending.delete(id)
        p.resolve(message.response)
      }
      return
    }
    if (message.kind === 'extensionUiRequest') {
      this.listener.onExtensionUiRequest(message.id, message.method, message.payload)
      return
    }
    this.listener.onEvent(message.type, message.payload)
  }

  /** Шлёт команду; Promise получит ответ с тем же `id`. Падение процесса — reject. */
  request(type: string, fields?: PiJsonObject | null): Promise<PiResponse> {
    if (this.child === null || this.closed || this.disconnected) {
      return Promise.reject(new Error('pi connection is not running'))
    }
    const id = String(this.nextId++)
    return new Promise<PiResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.send(encodeCommand(id, type, fields))
    })
  }

  respondExtensionUi(id: string, fields: PiJsonObject): void {
    this.send(encodeExtensionUiResponse(id, fields))
  }

  /** Приёмник сырых строк stdout (remote-мост); вызывается до парсинга. */
  addRawSink(sink: (line: string) => void): void {
    this.rawSinks.add(sink)
  }

  removeRawSink(sink: (line: string) => void): void {
    this.rawSinks.delete(sink)
  }

  /** Сырая строка в stdin pi (пересланный кадр телефона с переписанным id). */
  sendRaw(line: string): void {
    this.send(line)
  }

  private send(line: string): void {
    const stdin = this.child?.stdin
    if (stdin === null || stdin === undefined || stdin.destroyed || this.closed) return
    stdin.write(line + '\n')
  }

  private markExited(): void {
    if (this.exited) return
    this.exited = true
    for (const waiter of [...this.exitWaiters]) waiter()
    this.exitWaiters.clear()
  }

  /** Дождаться выхода процесса (или таймаута) — нужно перед удалением worktree-каталога. */
  waitForExit(timeoutMs = 3000): Promise<void> {
    if (this.exited || this.child === null) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const finish = (): void => {
        clearTimeout(timer)
        this.exitWaiters.delete(waiter)
        resolve()
      }
      const waiter = (): void => finish()
      const timer = setTimeout(finish, timeoutMs)
      timer.unref()
      this.exitWaiters.add(waiter)
    })
  }

  /** Отвязка без остановки процесса (крестик вкладки): ребёнок демона живёт, stdin не закрывается,
   *  kill не отправляется. Локальное состояние закрывается, ожидающие запросы размораживаются. */
  detach(): void {
    if (this.closed) return
    this.closed = true
    for (const p of this.pending.values()) p.reject(new Error('pi connection was detached'))
    this.pending.clear()
    const child = this.child
    this.child = null
    this.markExited()
    if (child !== null && typeof (child as { detach?: unknown }).detach === 'function') {
      ;(child as unknown as { detach: () => void }).detach()
    }
  }

  /** Закрытие stdin — штатное завершение pi; процесс добиваем, если завис. */
  close(): void {
    if (this.closed) return
    this.closed = true
    for (const p of this.pending.values()) p.reject(new Error('pi connection was closed'))
    this.pending.clear()
    const stdin = this.child?.stdin
    if (stdin !== null && stdin !== undefined && !stdin.destroyed) stdin.end()
    const child = this.child
    if (child !== null) {
      const timer = setTimeout(() => child.kill(), KILL_AFTER_CLOSE_MS)
      timer.unref()
    }
  }
}
