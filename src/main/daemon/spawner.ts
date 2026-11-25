/** Спавнер поверх демона: спека строится в main (резолв pi, секреты SSH), спавн уходит демону.
 *  Демон недоступен (не поднялся, протокол несовместим) — локальный фолбэк spawnFromSpec:
 *  поведение приложения не меняется. Ошибка ответа spawn пробрасывается — ребёнок мог уже
 *  родиться, дублировать спавн локально нельзя. */
import type { PiChildProcess, PiSpawnRequest, PiSpawnSpec, PiSpawner } from '../pi/backends/types'
import { spawnFromSpec } from '../pi/backends/spawn'
import { sessionFileFromArgs } from '../pi/pi-args'
import { DaemonUnavailableError, getDaemonClient } from './client'

export interface DaemonSpawnerOptions {
  buildSpec: (req: PiSpawnRequest) => PiSpawnSpec | Promise<PiSpawnSpec>
  /** Локальный спавн (фолбэк); по умолчанию — общий spawnFromSpec. */
  spawnLocal?: (spec: PiSpawnSpec) => Promise<PiChildProcess>
}

export function createDaemonSpawner(options: DaemonSpawnerOptions): PiSpawner {
  const spawnLocal = options.spawnLocal ?? spawnFromSpec
  return async (req: PiSpawnRequest): Promise<PiChildProcess> => {
    const spec = await options.buildSpec(req)
    const client = getDaemonClient()
    if (client === null) return spawnLocal(spec)
    try {
      const result = await client.spawn(spec, sessionFileFromArgs(req.args))
      return result.child
    } catch (err) {
      if (err instanceof DaemonUnavailableError) return spawnLocal(spec)
      throw err
    }
  }
}
