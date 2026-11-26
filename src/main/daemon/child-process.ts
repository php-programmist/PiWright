/** Адаптер ребёнка демона под интерфейс PiChildProcess: stdin — Writable, пересылающий чанки
 *  командой input (end → endInput), stdout/stderr — PassThrough, куда клиент кладёт строки
 *  из пушей демона. exit-пуш → error (причина) + close (код), как у настоящего ChildProcess. */
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import type { PiChildProcess } from '../pi/backends/types'
import type { DaemonPush } from './protocol'

export class DaemonChildProcess extends EventEmitter implements PiChildProcess {
  readonly stdin: Writable
  readonly stdout: PassThrough
  readonly stderr: PassThrough
  private exited = false

  constructor(
    readonly sessionKey: string,
    private readonly transport: DaemonChildTransport,
    /** Ребёнок уже в ходе (аттач к работающей сессии) — SessionHost выставит статус streaming. */
    readonly attachedStreaming = false
  ) {
    super()
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        this.transport.sendInput(this.sessionKey, typeof chunk === 'string' ? chunk : chunk.toString('utf8'))
        callback()
      },
      final: (callback) => {
        this.transport.sendEndInput(this.sessionKey)
        callback()
      }
    })
    this.stdout = new PassThrough()
    this.stderr = new PassThrough()
  }

  kill(): void {
    this.transport.sendClose(this.sessionKey)
  }

  /** Отвязка без остановки: ребёнок демона продолжает работать, адаптер уходит из клиента.
   *  События error/close не эмитятся — вызывающий (PiConnection.detach) уже закрыл состояние. */
  detach(): void {
    if (this.exited) return
    this.exited = true
    this.stdout.end()
    this.stderr.end()
    this.transport.releaseAdapter(this.sessionKey)
  }

  /** Пуши демона: строки — в потоки, exit — в error/close (порядок как у нативного спавна). */
  handlePush(push: DaemonPush): void {
    if (push.type === 'stdout') {
      this.stdout.write(`${push.line}\n`)
      return
    }
    if (push.type === 'stderr') {
      this.stderr.write(`${push.line}\n`)
      return
    }
    if (this.exited) return
    this.exited = true
    if (push.cause !== null) this.emit('error', new Error(push.cause))
    this.stdout.end()
    this.stderr.end()
    this.emit('close', push.code)
  }

  /** Обрыв канала демона: дети недоступны — сессия считается отключённой. */
  handleDisconnect(): void {
    if (this.exited) return
    this.exited = true
    this.emit('error', new Error('daemon connection lost'))
    this.stdout.end()
    this.stderr.end()
    this.emit('close', null)
  }
}

/** Транспорт адаптера: команды в демона без ответа (input/endInput/close) + отвязка адаптера. */
export interface DaemonChildTransport {
  sendInput(sessionKey: string, chunk: string): void
  sendEndInput(sessionKey: string): void
  sendClose(sessionKey: string): void
  releaseAdapter(sessionKey: string): void
}
