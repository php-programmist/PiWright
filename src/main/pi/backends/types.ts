/** Типы общие для бэкендов pi. */
import type { ChildProcess } from 'node:child_process'

export interface PiSpawnRequest {
  /** Каталог проекта на стороне хоста (Windows-путь или UNC WSL). */
  cwd: string
  /** Аргументы pi после пути к бинарю (см. piArgs). */
  args: string[]
}

export type PiSpawner = (req: PiSpawnRequest) => Promise<ChildProcess>

export interface PiBackend {
  displayName: string
  spawner: PiSpawner
}
