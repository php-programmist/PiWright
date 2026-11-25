/** Обёртка SSH exec-канала под интерфейс PiChildProcess: stdin/stdout — сам канал (duplex),
 *  stderr — отдельный readable, 'close' — с кодом из 'exit', kill — signal KILL + close. */
import { EventEmitter } from 'node:events'
import type { Readable } from 'node:stream'
import type { ClientChannel } from 'ssh2'
import type { PiChildProcess } from '../pi/backends/types'

export class SshChildProcess implements PiChildProcess {
  readonly stdin: ClientChannel
  readonly stdout: ClientChannel
  readonly stderr: Readable
  private readonly events = new EventEmitter()
  private code: number | null = null
  private closed = false

  constructor(private readonly channel: ClientChannel) {
    this.stdin = channel
    this.stdout = channel
    this.stderr = channel.stderr
    channel.on('exit', (code: number | null) => {
      this.code = typeof code === 'number' ? code : null
    })
    channel.on('close', () => {
      if (this.closed) return
      this.closed = true
      this.events.emit('close', this.code)
    })
    channel.on('error', (err: Error) => {
      this.events.emit('error', err)
    })
  }

  on(event: 'error', listener: (err: Error) => void): void
  on(event: 'close', listener: (code: number | null) => void): void
  // any в реализации обязателен: совместимость оверлоадов с EventEmitter-подпиской.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): void {
    this.events.on(event, listener)
  }

  get exitCode(): number | null {
    return this.code
  }

  kill(): void {
    try {
      this.channel.signal('KILL')
    } catch {
      // сервер мог не дать сигнал — закрываем канал
    }
    this.channel.close()
    this.channel.destroy()
  }
}
