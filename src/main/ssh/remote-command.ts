/** Сборка команд для удалённого exec: `cd <cwd> && ENV='v' … command`. Логин-обёртка
 *  `bash -lic '<cmd>'` — для pi (nvm/PATH), как у WSL-бэкенда. */
import { shellQuote } from '../pi/backends/shell'

export interface RemoteCommandOptions {
  cwd?: string | null
  env?: Record<string, string> | null
}

export function buildRemoteCommand(command: string, opts: RemoteCommandOptions = {}): string {
  const parts: string[] = []
  if (opts.cwd !== undefined && opts.cwd !== null && opts.cwd.length > 0) {
    parts.push(`cd ${shellQuote(opts.cwd)}`)
  }
  let chain = command
  if (opts.env !== undefined && opts.env !== null) {
    const prefix = Object.entries(opts.env)
      .map(([key, value]) => `${key}=${shellQuote(value)}`)
      .join(' ')
    if (prefix.length > 0) chain = `${prefix} ${chain}`
  }
  parts.push(chain)
  return parts.join(' && ')
}

/** Login-shell обёртка: грузит .profile/.bashrc (nvm) — как `bash -lic` у WSL-бэкенда. */
export function loginShellCommand(inner: string): string {
  return `bash -lic ${shellQuote(inner)}`
}
