/** Чистые помощники headless-входа (без side-effect'ов — тестируются отдельно). */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export interface HeadlessArgs {
  port: number
  userData: string
  bindHost: string
  tlsCert: string | null
  tlsKey: string | null
}

export function parseArgs(argv: string[]): HeadlessArgs {
  const args: HeadlessArgs = {
    port: 7691,
    userData: defaultUserData(),
    bindHost: '127.0.0.1',
    tlsCert: null,
    tlsKey: null
  }
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i + 1]
    if (value === undefined) continue
    if (argv[i] === '--port') args.port = Number(value)
    else if (argv[i] === '--user-data') args.userData = resolve(value)
    else if (argv[i] === '--host') args.bindHost = value
    else if (argv[i] === '--tls-cert') args.tlsCert = resolve(value)
    else if (argv[i] === '--tls-key') args.tlsKey = resolve(value)
  }
  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) {
    throw new Error(`Invalid --port: ${args.port}`)
  }
  if ((args.tlsCert === null) !== (args.tlsKey === null)) {
    throw new Error('--tls-cert and --tls-key must be used together')
  }
  return args
}

/** Те же каталоги, что app.getPath('userData') у Electron: настройки/проекты/сессии общие. */
export function defaultUserData(): string {
  switch (process.platform) {
    case 'win32':
      return join(process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'), 'piwright')
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', 'piwright')
    default:
      return join(process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'), 'piwright')
  }
}

/** Версия из package.json: dev — корень репо (out/../..), упакованный — корень app.asar. */
export function readAppVersion(moduleDir: string): string {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(moduleDir, '..', '..', 'package.json'), 'utf8'))
    const version = (raw as Record<string, unknown>)?.['version']
    return typeof version === 'string' ? version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}
