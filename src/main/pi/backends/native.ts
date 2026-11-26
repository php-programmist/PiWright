/** Нативный (Windows/хост) бэкенд: резолв pi и спавн через cmd.exe. Порт `exec/LocalBackend.kt`
 *  с поправкой на спайк: на Windows .cmd нельзя спавнить напрямую, только через cmd.exe. */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import type { PiSpawnRequest, PiSpawnSpec } from './types'
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

/** env для спавна: окружение процесса + каталог pi в начале PATH (так делал спайк).
 *  env в спеке уже собран — демон спавнит без доступа к окружению main.
 *  На Windows ключ окружения лежит как 'Path' (process.env — proxy без регистра, копия через
 *  Object.entries регистр сохраняет): оставляем ровно один ключ 'PATH' — дубль другого регистра
 *  уводит поиск исполняемого в libuv на пустой PATH (spawn cmd.exe ENOENT). */
export function buildNativeSpec(piPath: string, req: PiSpawnRequest): PiSpawnSpec {
  const binDir = dirname(piPath)
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  let originalPath = ''
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'path') {
      originalPath = env[key]
      delete env[key]
    }
  }
  env['PATH'] = `${binDir};${originalPath}`
  return { mode: 'native', piPath, args: req.args, cwd: req.cwd, env }
}

/** Спавн по спеке: `cmd.exe /d /s /c "<pi.cmd> <args>"` на Windows (напрямую .cmd Node спавнить
 *  нельзя — EINVAL), иначе прямой спавн. windowsVerbatimArguments: Node иначе сам заквотит
 *  аргумент бэкслешами, cmd.exe их не понимает. */
export function spawnFromSpec(spec: PiSpawnSpec): ChildProcess {
  if (process.platform === 'win32') {
    const commandLine = [spec.piPath, ...spec.args].map(quoteWindowsArg).join(' ')
    return spawn('cmd.exe', ['/d', '/s', '/c', `"${commandLine}"`], {
      cwd: spec.cwd,
      env: spec.env ?? undefined,
      windowsHide: true,
      windowsVerbatimArguments: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
  }
  return spawn(spec.piPath, spec.args, { cwd: spec.cwd, env: spec.env ?? undefined, stdio: ['pipe', 'pipe', 'pipe'] })
}

export type { ChildProcess }
