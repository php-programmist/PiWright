/** Фабрика бэкенда из проекта и настроек: резолв pi, готовый спавнер. Вид бэкенда выбирается
 *  при добавлении проекта (native | wsl), глобального auto больше нет. */
import { homedir } from 'node:os'
import type { ProjectEntry, Settings } from '../../../shared/ipc-contracts'
import type { PiBackend } from './types'
import { createNativeSpawner, resolveNativePi } from './native'
import { createWslSpawner, listWslDistros, resolveWslPi } from './wsl'

export type CreateBackendResult = { backend: PiBackend; error: null } | { backend: null; error: string }

/** Настройка «pi path» валидна только в формате своего бэкенда: Windows-путь для native,
 *  POSIX для WSL; чужой формат — авто-резолв (после миграции там мог быть путь другого бэкенда). */
export function filterSettingsPiPath(kind: 'native' | 'wsl', raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  const posix = trimmed.startsWith('/') || trimmed.startsWith('~/')
  return kind === 'wsl' ? (posix ? trimmed : null) : posix ? null : trimmed
}

export async function createPiBackend(project: ProjectEntry, settings: Settings): Promise<CreateBackendResult> {
  if (project.kind === 'native') {
    const piPath = resolveNativePi(filterSettingsPiPath('native', settings.piPathNative), homedir())
    if (piPath === null) {
      return { backend: null, error: 'Could not find the pi executable on the host. Set it in settings.' }
    }
    return { backend: { displayName: 'Native (host)', spawner: createNativeSpawner(piPath) }, error: null }
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
  return { backend: { displayName: `WSL: ${distro}`, spawner: createWslSpawner(distro, piPath) }, error: null }
}
