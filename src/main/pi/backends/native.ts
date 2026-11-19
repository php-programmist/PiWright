/** Нативный (Windows/хост) бэкенд: резолв pi и спавн через cmd.exe. Порт `exec/LocalBackend.kt`
 *  с поправкой на спайк: на Windows .cmd нельзя спавнить напрямую, только через cmd.exe. */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import type { PiSpawner } from './types'
import { quoteWindowsArg } from './shell'

/** Pure-резолв: настройка → каталоги PATH × имена → известные кандидаты. `exists` инжектится. */
export function resolveLocalPi(
  settingsPath: string | null,
  pathDirs: string[],
  exeNames: string[],
  candidates: string[],
  exists: (p: string) => boolean
): string | null {
  if (settingsPath !== null && settingsPath.trim().length > 0 && exists(settingsPath)) return settingsPath
  for (const dir of pathDirs) {
    const base = dir.trim().replace(/[\\/]+$/, '')
    for (const name of exeNames) {
      const sep = base.includes('\\') ? '\\' : '/'
      const p = `${base}${sep}${name}`
      if (exists(p)) return p
    }
  }
  return candidates.find((c) => exists(c)) ?? null
}

/** Известные места установки pi на Windows (спайк: инсталлятор кладёт в `%USERPROFILE%\.pi\agent\bin`). */
export function windowsPiCandidates(home: string): string[] {
  const h = home.replace(/[\\/]+$/, '')
  return [join(h, '.pi', 'agent', 'bin', 'pi.cmd')]
}

export function pathDirsFromEnv(pathEnv: string | undefined): string[] {
  return (pathEnv ?? '')
    .split(';')
    .map((d) => d.trim().replace(/[\\/]+$/, ''))
    .filter((d) => d.length > 0)
}

/** Резолв pi на хосте: настройка → PATH (pi.cmd/pi.exe/pi) → известные кандидаты. */
export function resolveNativePi(settingsPath: string | null, home: string): string | null {
  return resolveLocalPi(
    settingsPath,
    pathDirsFromEnv(process.env['PATH'] ?? process.env['Path']),
    ['pi.cmd', 'pi.exe', 'pi'],
    windowsPiCandidates(home),
    (p) => existsSync(p)
  )
}

/** Спавн через `cmd.exe /d /s /c "<pi.cmd> <args>"`: напрямую .cmd Node спавнить нельзя (EINVAL),
 *  PATH пополняется каталогом pi — так делал спайк. windowsVerbatimArguments: Node иначе сам
 *  заквотит аргумент бэкслешами, cmd.exe их не понимает. */
export function createNativeSpawner(piPath: string): PiSpawner {
  return async (req) => {
    const binDir = dirname(piPath)
    const env = { ...process.env, PATH: `${binDir};${process.env['PATH'] ?? ''}` }
    if (process.platform === 'win32') {
      const commandLine = [piPath, ...req.args].map(quoteWindowsArg).join(' ')
      return spawn('cmd.exe', ['/d', '/s', '/c', `"${commandLine}"`], {
        cwd: req.cwd,
        env,
        windowsHide: true,
        windowsVerbatimArguments: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    }
    return spawn(piPath, req.args, { cwd: req.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
  }
}

export type { ChildProcess }
