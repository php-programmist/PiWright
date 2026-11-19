/** WSL-бэкенд: резолв pi в дистрибутиве и спавн через `wsl.exe … bash -lic`. Порт `exec/WslBackend.kt`
 *  со спайковыми поправками: `wsl.exe -l -q` отдаёт UTF-16LE с NUL, спавн только по схеме из §3 плана. */
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { PiSpawner } from './types'
import { buildBashCommand, buildWslSpawnArgs, shellQuote, stripWslUncPrefix } from './shell'

export const KNOWN_PI_PATHS = ['$HOME/.local/bin/pi', '/usr/local/bin/pi', '/usr/bin/pi']

const PROBE_TIMEOUT_MS = 15_000

/** Однократный прогон скрипта в login-shell дистрибутива; stdout или null. */
export function runWslProbe(distro: string, script: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn('wsl.exe', ['-d', distro, '--exec', 'bash', '-lic', script], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let settled = false
    const done = (value: string | null) => {
      if (!settled) {
        settled = true
        resolve(value)
      }
    }
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.on('error', () => done(null))
    child.on('close', (code) => done(code === 0 ? stdout : null))
    const timer = setTimeout(() => {
      done(null)
      child.kill()
    }, timeoutMs)
    timer.unref()
  })
}

/** `wsl.exe -l -q`: UTF-16LE с NUL-байтами (ловушка из спайка) — режем NUL и CR. */
export async function listWslDistros(): Promise<string[]> {
  return new Promise((resolve) => {
    const child = spawn('wsl.exe', ['-l', '-q'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    let settled = false
    const done = (value: string[]) => {
      if (!settled) {
        settled = true
        resolve(value)
      }
    }
    child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.on('error', () => done([]))
    child.on('close', () => {
      const buffer = Buffer.concat(chunks)
      const text = buffer.includes(0) ? buffer.toString('utf16le') : buffer.toString('utf8')
      done(
        text
          .split('\n')
          .map((l) => l.replace(/\r/g, '').replace(/\0/g, '').trim())
          .filter((l) => l.length > 0 && !l.startsWith('docker-desktop'))
      )
    })
    setTimeout(() => {
      done([])
      child.kill()
    }, PROBE_TIMEOUT_MS).unref()
  })
}

export async function hasWslDistro(): Promise<boolean> {
  return (await listWslDistros()).length > 0
}

/** Путь к pi в дистрибутиве: настройка → `command -v pi` → известные пути. Порт `WslBackend.resolvePiPath`. */
export async function resolveWslPi(distro: string, settingsPath: string | null): Promise<string | null> {
  const fromSettings = (settingsPath ?? '').trim()
  if (fromSettings.length > 0) return fromSettings
  const probes = ['command -v pi 2>/dev/null']
  for (const p of KNOWN_PI_PATHS) {
    probes.push(`{ [ -x "${p}" ] && echo "${p}"; }`)
  }
  const output = await runWslProbe(distro, probes.join(' || '))
  if (output === null) return null
  return output.split('\n').map((l) => l.trim()).find((l) => l.includes('/pi')) ?? null
}

const wslPathCache = new Map<string, string>()

/** Windows-путь (C:\... или UNC) → путь внутри WSL; WSL-путь возвращается как есть. Кэшируется. */
export async function wslPathFor(distro: string, hostPath: string): Promise<string | null> {
  const unc = stripWslUncPrefix(hostPath)
  if (unc !== null) return unc
  if (hostPath.startsWith('/')) return hostPath
  const cached = wslPathCache.get(`${distro}\u0000${hostPath}`)
  if (cached !== undefined) return cached
  const output = await runWslProbe(distro, `wslpath -u ${shellQuote(hostPath)}`)
  const converted = output?.trim().startsWith('/') ? output.trim() : null
  if (converted !== null) wslPathCache.set(`${distro}\u0000${hostPath}`, converted)
  return converted
}

/** Спавн: `wsl.exe -d <distro> --cd <wslCwd> --exec bash -lic '<pi с аргументами>'`. */
export function createWslSpawner(distro: string, piPath: string): PiSpawner {
  return async (req) => {
    const wslCwd = await wslPathFor(distro, req.cwd)
    const bashCommand = buildBashCommand(piPath, req.args)
    const child: ChildProcess = spawn('wsl.exe', buildWslSpawnArgs(distro, wslCwd, bashCommand), {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    return child
  }
}
