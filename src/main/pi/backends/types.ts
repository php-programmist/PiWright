/** Типы общие для бэкендов pi. */
import type { Readable, Writable } from 'node:stream'

export interface PiSpawnRequest {
  /** Каталог проекта на стороне хоста (Windows-путь, UNC WSL или POSIX-путь удалённого сервера). */
  cwd: string
  /** Аргументы pi после пути к бинарю (см. piArgs). */
  args: string[]
}

/** Минимальный интерфейс процесса pi, который нужен PiConnection: настоящий ChildProcess
 *  (native/wsl) или обёртка SSH exec-канала (см. SshChildProcess). */
export interface PiChildProcess {
  readonly stdin: Writable | null
  readonly stdout: Readable | null
  readonly stderr: Readable | null
  kill(): void
  on(event: 'error', listener: (err: Error) => void): unknown
  on(event: 'close', listener: (code: number | null) => void): unknown
}

export type PiSpawner = (req: PiSpawnRequest) => Promise<PiChildProcess>

export interface PiBackend {
  displayName: string
  spawner: PiSpawner
}
