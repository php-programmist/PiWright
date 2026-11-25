/** Спавн pi по спеке любым бэкендом. Общий модуль main и демона: демон передаёт свой
 *  SshService (секреты приходят в спеке), локальный фолбэк — синглтон main. */
import type { PiChildProcess, PiSpawnSpec } from './types'
import { spawnFromSpec as spawnNative } from './native'
import { spawnFromSpec as spawnWsl } from './wsl'
import { spawnFromSpec as spawnSsh } from './ssh'
import type { SshService } from '../../ssh/ssh-service'
import { getSshService } from '../../ssh/ssh-service'

export async function spawnFromSpec(spec: PiSpawnSpec, ssh?: SshService): Promise<PiChildProcess> {
  if (spec.mode === 'native') return spawnNative(spec)
  if (spec.mode === 'wsl') return spawnWsl(spec)
  return spawnSsh(spec, ssh ?? getSshService())
}
