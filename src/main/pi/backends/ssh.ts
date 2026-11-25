/** SSH-бэкенд: резолв pi на удалённом сервере и спавн через ssh2 exec-канал.
 *  cwd проекта — уже POSIX-путь на сервере (identity-конвертация). */
import type { SshServerEntry } from '../../../shared/ipc-contracts'
import type { PiChildProcess, PiSpawner } from './types'
import { buildBashCommand } from './shell'
import type { SshService } from '../../ssh/ssh-service'

export const SSH_KNOWN_PI_PATHS = ['$HOME/.local/bin/pi', '/usr/local/bin/pi', '/usr/bin/pi']

/** Путь к pi на сервере: настройка → `command -v pi` → известные пути (login-shell, как у WSL). */
export async function resolveSshPi(ssh: SshService, server: SshServerEntry, settingsPath: string | null): Promise<string | null> {
  const fromSettings = (settingsPath ?? '').trim()
  if (fromSettings.length > 0) return fromSettings
  const probes = ['command -v pi 2>/dev/null']
  for (const p of SSH_KNOWN_PI_PATHS) {
    probes.push(`{ [ -x "${p}" ] && echo "${p}"; }`)
  }
  const result = await ssh.exec(server, probes.join(' || '), { login: true, timeoutMs: 20_000 })
  if (result.code !== 0 && result.stdout.trim().length === 0) return null
  return result.stdout.split('\n').map((l) => l.trim()).find((l) => l.includes('/pi')) ?? null
}

/** Спавн pi: `bash -lic 'cd <cwd> && pi …'` через SSH exec-канал под интерфейсом PiChildProcess. */
export function createSshSpawner(ssh: SshService, server: SshServerEntry, piPath: string): PiSpawner {
  return async (req): Promise<PiChildProcess> => {
    return ssh.spawn(server, buildBashCommand(piPath, req.args), { cwd: req.cwd, login: true })
  }
}
