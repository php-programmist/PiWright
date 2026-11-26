/** Точка входа демона (out/daemon/index.js, ELECTRON_RUN_AS_NODE): свой SshService с шимом
 *  секретов (прилетают в спеках по каналу), host keys — общий с main файл в userData.
 *  Канал занят — демон уже жив, выходим. Секреты и токен в лог не пишем. */
import { join } from 'node:path'
import { appendFileSync, existsSync, statSync, truncateSync } from 'node:fs'
import { SshService } from '../ssh/ssh-service'
import { SshKnownHosts } from '../ssh/known-hosts'
import type { SshSecret, SshSecretsStore } from '../ssh/secrets'
import { spawnFromSpec } from '../pi/backends/spawn'
import type { PiChildProcess, PiSpawnSpec } from '../pi/backends/types'
import { DaemonServer } from './server'

const LOG_MAX_BYTES = 1024 * 1024

/** Секреты SSH для демона: наполняются из спек спавна, на диск не пишутся. */
class SpecSecrets implements SshSecretsStore {
  private readonly secrets = new Map<string, SshSecret>()

  get(serverId: string): SshSecret {
    return this.secrets.get(serverId) ?? {}
  }

  hasPassword(serverId: string): boolean {
    return this.secrets.get(serverId)?.password !== undefined
  }

  hasKeyPassphrase(serverId: string): boolean {
    return this.secrets.get(serverId)?.keyPassphrase !== undefined
  }

  set(serverId: string, patch: { password?: string | null; keyPassphrase?: string | null }): void {
    const current = { ...(this.secrets.get(serverId) ?? {}) }
    if (patch.password !== undefined) {
      if (patch.password === null) delete current.password
      else current.password = patch.password
    }
    if (patch.keyPassphrase !== undefined) {
      if (patch.keyPassphrase === null) delete current.keyPassphrase
      else current.keyPassphrase = patch.keyPassphrase
    }
    this.secrets.set(serverId, current)
  }

  remove(serverId: string): void {
    this.secrets.delete(serverId)
  }

  ids(): string[] {
    return [...this.secrets.keys()]
  }
}

function parseArgs(argv: string[]): { userDataDir: string; appVersion: string } | null {
  let userDataDir: string | null = null
  let appVersion = ''
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--user-data' && i + 1 < argv.length) userDataDir = argv[i + 1] ?? null
    if (argv[i] === '--app-version' && i + 1 < argv.length) appVersion = argv[i + 1] ?? ''
  }
  return userDataDir !== null && userDataDir.length > 0 ? { userDataDir, appVersion } : null
}

function fileLogger(path: string): (line: string) => void {
  return (line: string) => {
    try {
      if (existsSync(path) && statSync(path).size > LOG_MAX_BYTES) truncateSync(path, 0)
      appendFileSync(path, `${line}\n`, 'utf8')
    } catch {
      // лог не критичен
    }
  }
}

function main(): void {
  const parsed = parseArgs(process.argv.slice(2))
  if (parsed === null) {
    process.stderr.write('usage: daemon --user-data <dir> [--app-version <v>]\n')
    process.exit(1)
    return
  }
  const log = fileLogger(join(parsed.userDataDir, 'daemon.log'))
  const ssh = new SshService(new SpecSecrets(), new SshKnownHosts(join(parsed.userDataDir, 'ssh-known-hosts.json')))
  const spawnChild = async (spec: PiSpawnSpec): Promise<PiChildProcess> => {
    if (spec.ssh !== undefined) {
      ssh.setSecret(spec.ssh.server.id, {
        password: spec.ssh.secret.password ?? null,
        keyPassphrase: spec.ssh.secret.keyPassphrase ?? null
      })
    }
    return spawnFromSpec(spec, ssh)
  }
  const server = new DaemonServer({
    userDataDir: parsed.userDataDir,
    appVersion: parsed.appVersion,
    spawnChild,
    settingsPath: join(parsed.userDataDir, 'settings.json'),
    log
  })
  server
    .start()
    .then((state) => {
      if (state === 'busy') {
        log('another daemon is already running, exiting')
        process.exit(0)
      }
      log(`daemon pid ${process.pid}`)
    })
    .catch((err: unknown) => {
      log(`failed to start: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    })
}

main()
