/** Фабрика бэкенда из проекта и настроек: резолв pi, готовый спавнер. Вид бэкенда выбирается
 *  при добавлении проекта (native | wsl | ssh), глобального auto больше нет.
 *  Спавнер всегда демон-режим: спека строится здесь (резолв pi и секреты — только в main),
 *  спавн уходит демону; недоступен демон — локальный фолбэк spawnFromSpec. */
import { homedir } from 'node:os'
import type { ProjectEntry, Settings } from '../../../shared/ipc-contracts'
import type { PiBackend } from './types'
import { buildNativeSpec, resolveNativePi } from './native'
import { buildWslSpec, listWslDistros, resolveWslPi } from './wsl'
import { buildSshSpec, resolveSshPi } from './ssh'
import { createDaemonSpawner } from '../../daemon/spawner'
import { getSshService } from '../../ssh/ssh-service'

export type CreateBackendResult = { backend: PiBackend; error: null } | { backend: null; error: string }

/** Настройка «pi path» валидна только в формате своего бэкенда: Windows-путь для native,
 *  POSIX для WSL/SSH; чужой формат — авто-резолв (после миграции там мог быть путь другого бэкенда). */
export function filterSettingsPiPath(kind: 'native' | 'wsl' | 'ssh', raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  const posix = trimmed.startsWith('/') || trimmed.startsWith('~/')
  return kind === 'native' ? (posix ? null : trimmed) : posix ? trimmed : null
}

export async function createPiBackend(project: ProjectEntry, settings: Settings): Promise<CreateBackendResult> {
  if (project.kind === 'native') {
    const piPath = resolveNativePi(filterSettingsPiPath('native', settings.piPathNative), homedir())
    if (piPath === null) {
      return { backend: null, error: 'Could not find the pi executable on the host. Set it in settings.' }
    }
    return {
      backend: {
        displayName: 'Native (host)',
        spawner: createDaemonSpawner({ buildSpec: (req) => buildNativeSpec(piPath, req) })
      },
      error: null
    }
  }
  if (project.kind === 'ssh') {
    const server = settings.sshServers.find((s) => s.id === project.serverId)
    if (server === undefined) {
      return { backend: null, error: 'SSH server for this project is missing. Check settings.' }
    }
    try {
      const ssh = getSshService()
      const piPath = await resolveSshPi(ssh, server, filterSettingsPiPath('ssh', settings.piPathSsh))
      if (piPath === null) {
        return { backend: null, error: `Could not find the pi executable on "${server.name}". Set it in settings.` }
      }
      const secret = ssh.resolveSecret(server)
      return {
        backend: {
          displayName: `SSH: ${server.name}`,
          spawner: createDaemonSpawner({ buildSpec: (req) => buildSshSpec(server, secret, piPath, req) })
        },
        error: null
      }
    } catch (err) {
      return { backend: null, error: err instanceof Error ? err.message : String(err) }
    }
  }
  if (process.platform !== 'win32') {
    return { backend: null, error: 'WSL backend is only available on Windows.' }
  }
  const distros = await listWslDistros()
  const distro = settings.wslDistro.trim() || distros[0]
  if (!distro) {
    return { backend: null, error: 'No WSL distro available. Set it in settings.' }
  }
  const piPath = await resolveWslPi(distro, filterSettingsPiPath('wsl', settings.piPathWsl))
  if (piPath === null) {
    return { backend: null, error: `Could not find the pi executable in WSL distro "${distro}". Set it in settings.` }
  }
  return {
    backend: {
      displayName: `WSL: ${distro}`,
      spawner: createDaemonSpawner({ buildSpec: (req) => buildWslSpec(distro, piPath, req) })
    },
    error: null
  }
}
