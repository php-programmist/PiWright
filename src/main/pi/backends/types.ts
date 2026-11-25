/** Типы общие для бэкендов pi. */
import type { Readable, Writable } from 'node:stream'
import type { BackendMode, SshServerEntry } from '../../../shared/ipc-contracts'
import type { SshSecret } from '../../ssh/secrets'

export interface PiSpawnRequest {
  /** Каталог проекта на стороне хоста (Windows-путь, UNC WSL или POSIX-путь удалённого сервера). */
  cwd: string
  /** Аргументы pi после пути к бинарю (см. piArgs). */
  args: string[]
}

/** SSH-часть спеки: сервер из настроек + расшифрованный секрет (только в памяти, не в settings/логах). */
export interface PiSpawnSpecSsh {
  server: SshServerEntry
  secret: SshSecret
}

/** Данные спавна pi вместо замыкания-spawner'а: демон спавнит по спеке в чужом процессе.
 *  env уже собран (нативный бэкенд добавляет каталог pi в PATH); wsl.cwd — путь внутри
 *  дистрибутива (null — конвертация не удалась, спавн без --cd, как раньше). */
export interface PiSpawnSpec {
  mode: BackendMode
  piPath: string
  args: string[]
  cwd: string
  env: Record<string, string> | null
  wsl?: { distro: string; cwd: string | null }
  ssh?: PiSpawnSpecSsh
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
