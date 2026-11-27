/** SSH-транспорт: пул соединений ssh2 на сервер (user@host:port), exec/spawn/sftp/shell,
 *  host key — accept-new (новый запоминается, подмена — ошибка), секреты — SshSecretsService.
 *  Синглтон инициализируется в main при app.ready; тесты строят экземпляр напрямую. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client, type ClientChannel, type ConnectConfig, type SFTPWrapper } from 'ssh2'
import type { Duplex } from 'node:stream'
import type { SshServerEntry } from '../../shared/ipc-contracts'
import type { PiChildProcess } from '../pi/backends/types'
import { SshKnownHosts } from './known-hosts'
import { SshSecretsService, type SshSecret, type SshSecretsStore } from './secrets'
import { SshChildProcess } from './ssh-child'
import { buildRemoteCommand, loginShellCommand } from './remote-command'
import { errorMessage } from '../../shared/errors'

export interface SshExecResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export interface SshExecOptions {
  cwd?: string | null
  env?: Record<string, string> | null
  timeoutMs?: number
  /** Обёртка `bash -lic` — для команд, которым нужен login-окружении (pi, nvm). */
  login?: boolean
}

export interface SshTestResult {
  ok: boolean
  error: string | null
  fingerprint: string | null
  home: string | null
  piPath: string | null
}

export const SSH_CONNECT_TIMEOUT_MS = 20_000
export const SSH_EXEC_TIMEOUT_MS = 30_000
const EXEC_OUTPUT_LIMIT = 16 * 1024 * 1024

interface Pooled {
  client: Client
  ready: Promise<Client>
  sftp: Promise<SFTPWrapper> | null
}

export class SshService {
  private readonly pool = new Map<string, Pooled>()

  constructor(
    private readonly secrets: SshSecretsStore,
    private readonly knownHosts: SshKnownHosts
  ) {}

  private static key(server: SshServerEntry): string {
    return `${server.user}@${server.host}:${server.port}`
  }

  /** Секрет соединения: явный (черновик из UI) или из хранилища по id. */
  resolveSecret(server: SshServerEntry, explicit?: SshSecret | null): SshSecret {
    if (explicit !== undefined && explicit !== null) return explicit
    return this.secrets.get(server.id)
  }

  private connect(server: SshServerEntry, secret: SshSecret): Promise<Client> {
    return new Promise<Client>((resolve, reject) => {
      let rejectedFingerprint: string | null = null
      const client = new Client()
      const config: ConnectConfig = {
        host: server.host,
        port: server.port,
        username: server.user,
        keepaliveInterval: 15_000,
        readyTimeout: SSH_CONNECT_TIMEOUT_MS,
        tryKeyboard: false,
        hostVerifier: (key: Buffer) => {
          const fingerprint = 'sha256:' + createHash('sha256').update(key).digest('base64')
          const state = this.knownHosts.state(server.host, server.port, fingerprint)
          if (state === 'changed') {
            rejectedFingerprint = fingerprint
            return false
          }
          if (state === 'new') this.knownHosts.remember(server.host, server.port, fingerprint)
          return true
        }
      }
      try {
        if (server.auth === 'password') {
          config.password = secret.password ?? ''
        } else if (server.auth === 'key') {
          config.privateKey = readFileSync(server.keyPath ?? '')
          if (secret.keyPassphrase !== undefined) config.passphrase = secret.keyPassphrase
        } else {
          config.agent = process.env['SSH_AUTH_SOCK'] ?? '\\\\.\\pipe\\openssh-ssh-agent'
        }
      } catch (err) {
        reject(new Error(`Failed to read private key: ${errorMessage(err)}`))
        return
      }
      client.on('ready', () => resolve(client))
      client.on('error', (err: Error) => {
        if (rejectedFingerprint !== null) {
          reject(
            new Error(
              `Host key of ${server.host}:${server.port} has changed (fingerprint ${rejectedFingerprint}). ` +
                'If the server was reinstalled or rekeyed, forget its host key in Settings → SSH.'
            )
          )
        } else {
          reject(err)
        }
      })
      client.connect(config)
    })
  }

  /** Готовое соединение из пула; упавшее/закрытое вымывается, следующий вызов переподключается. */
  private pooled(server: SshServerEntry, secret: SshSecret): Promise<Client> {
    const key = SshService.key(server)
    const existing = this.pool.get(key)
    if (existing !== undefined) return existing.ready
    const pooled: Pooled = { client: null as unknown as Client, ready: null as unknown as Promise<Client>, sftp: null }
    const ready = this.connect(server, secret).then((client) => {
      pooled.client = client
      client.on('close', () => {
        if (this.pool.get(key) === pooled) this.pool.delete(key)
      })
      client.on('error', () => {
        if (this.pool.get(key) === pooled) this.pool.delete(key)
      })
      return client
    })
    pooled.ready = ready
    ready.catch(() => {
      if (this.pool.get(key) === pooled) this.pool.delete(key)
    })
    this.pool.set(key, pooled)
    return ready
  }

  /** Одна команда на сервере; stdout/stderr с лимитом, таймаут закрывает канал. */
  async exec(server: SshServerEntry, command: string, opts: SshExecOptions = {}): Promise<SshExecResult> {
    const client = await this.pooled(server, this.resolveSecret(server))
    const inner = buildRemoteCommand(command, { cwd: opts.cwd, env: opts.env })
    const full = opts.login === true ? loginShellCommand(inner) : inner
    const timeoutMs = opts.timeoutMs ?? SSH_EXEC_TIMEOUT_MS
    return new Promise<SshExecResult>((resolve, reject) => {
      client.exec(full, (err, stream) => {
        if (err) {
          reject(err)
          return
        }
        let stdout = ''
        let stderr = ''
        let exitCode: number | null = null
        let timedOut = false
        let settled = false
        const timer = setTimeout(() => {
          timedOut = true
          stream.close()
        }, timeoutMs)
        timer.unref()
        const finish = (): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve({ code: exitCode, stdout, stderr, timedOut })
        }
        stream.on('data', (chunk: Buffer | string) => {
          if (stdout.length < EXEC_OUTPUT_LIMIT) stdout += chunk.toString('utf8')
        })
        stream.stderr.on('data', (chunk: Buffer | string) => {
          if (stderr.length < EXEC_OUTPUT_LIMIT) stderr += chunk.toString('utf8')
        })
        stream.on('exit', (code: number | null) => {
          exitCode = typeof code === 'number' ? code : null
        })
        stream.on('close', finish)
        stream.on('error', (streamErr: Error) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          reject(streamErr)
        })
      })
    })
  }

  /** Долгоживущий процесс (pi --mode rpc) — exec-канал под интерфейсом PiChildProcess. */
  async spawn(server: SshServerEntry, command: string, opts: { cwd?: string | null; env?: Record<string, string> | null; login?: boolean } = {}): Promise<PiChildProcess> {
    const client = await this.pooled(server, this.resolveSecret(server))
    const inner = buildRemoteCommand(command, { cwd: opts.cwd, env: opts.env })
    const full = opts.login === true ? loginShellCommand(inner) : inner
    return new Promise<PiChildProcess>((resolve, reject) => {
      client.exec(full, (err, stream) => {
        if (err) {
          reject(err)
          return
        }
        resolve(new SshChildProcess(stream))
      })
    })
  }

  /** SFTP-канал соединения (кэшируется на пул). */
  async sftp(server: SshServerEntry, explicitSecret?: SshSecret | null): Promise<SFTPWrapper> {
    const key = SshService.key(server)
    const client = await this.pooled(server, this.resolveSecret(server, explicitSecret))
    const existing = this.pool.get(key)
    if (existing?.sftp !== null && existing?.sftp !== undefined) return existing.sftp
    const created = new Promise<SFTPWrapper>((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) reject(err)
        else resolve(sftp)
      })
    })
    created.catch(() => {
      const pooled = this.pool.get(key)
      if (pooled !== undefined && pooled.sftp === created) pooled.sftp = null
    })
    if (existing !== undefined) existing.sftp = created
    return created
  }

  /** Интерактивный shell-канал с pty (терминал). */
  async shell(server: SshServerEntry, opts: { cols: number; rows: number; term?: string }): Promise<ClientChannel> {
    const client = await this.pooled(server, this.resolveSecret(server))
    return new Promise<ClientChannel>((resolve, reject) => {
      client.shell({ term: opts.term ?? 'xterm-256color', cols: opts.cols, rows: opts.rows }, (err, stream) => {
        if (err) reject(err)
        else resolve(stream)
      })
    })
  }

  /** direct-tcpip канал к dstHost:dstPort через соединение пула (SSH-туннель для БД).
   *  Поток живёт пока живо соединение пула; client.end()/обрыв закрывают его. */
  async forwardOut(server: SshServerEntry, dstHost: string, dstPort: number, explicitSecret?: SshSecret | null): Promise<Duplex> {
    const client = await this.pooled(server, this.resolveSecret(server, explicitSecret))
    return new Promise<Duplex>((resolve, reject) => {
      client.forwardOut('127.0.0.1', 0, dstHost, dstPort, (err, stream) => {
        if (err) reject(err)
        else resolve(stream)
      })
    })
  }

  /** Проверка сервера: соединение, отпечаток host key, $HOME и путь к pi. */
  async test(server: SshServerEntry, explicitSecret?: SshSecret | null): Promise<SshTestResult> {
    try {
      await this.pooled(server, this.resolveSecret(server, explicitSecret))
      const fingerprint = this.knownHosts.fingerprint(server.host, server.port)
      const home = await this.execText(server, 'echo "$HOME"', { login: true })
      const pi = await this.execText(
        server,
        'command -v pi 2>/dev/null || { [ -x "$HOME/.local/bin/pi" ] && echo "$HOME/.local/bin/pi"; } || { [ -x /usr/local/bin/pi ] && echo /usr/local/bin/pi; }',
        { login: true }
      )
      return { ok: true, error: null, fingerprint, home, piPath: pi }
    } catch (err) {
      return { ok: false, error: errorMessage(err), fingerprint: null, home: null, piPath: null }
    }
  }

  private async execText(server: SshServerEntry, command: string, opts: SshExecOptions = {}): Promise<string | null> {
    const result = await this.exec(server, command, { ...opts, timeoutMs: opts.timeoutMs ?? 15_000 })
    const text = result.stdout.split('\n').map((l) => l.trim()).find((l) => l.length > 0)
    return text ?? null
  }

  /** Забыть host key сервера (после переустановки сервера). */
  forgetHostKey(server: SshServerEntry): void {
    this.knownHosts.forget(server.host, server.port)
  }

  /** Домашний каталог на сервере (`echo $HOME` в login-shell). */
  async homeDir(server: SshServerEntry, explicitSecret?: SshSecret | null): Promise<string | null> {
    this.resolveSecret(server, explicitSecret)
    const result = await this.exec(server, 'echo "$HOME"', { login: true, timeoutMs: 15_000 })
    return result.stdout.split('\n').map((l) => l.trim()).find((l) => l.startsWith('/')) ?? null
  }

  hasPassword(serverId: string): boolean {
    return this.secrets.hasPassword(serverId)
  }

  hasKeyPassphrase(serverId: string): boolean {
    return this.secrets.hasKeyPassphrase(serverId)
  }

  setSecret(serverId: string, patch: { password?: string | null; keyPassphrase?: string | null }): void {
    this.secrets.set(serverId, patch)
  }

  deleteSecret(serverId: string): void {
    this.secrets.remove(serverId)
  }

  /** id серверов, чьи секреты остались без записи в settings (для очистки). */
  removedServerIds(known: Set<string>): string[] {
    return this.secrets.ids().filter((id) => !known.has(id))
  }

  closeAll(): void {
    for (const pooled of this.pool.values()) {
      try {
        pooled.client.end()
      } catch {
        // соединение могло уже умереть
      }
    }
    this.pool.clear()
  }
}

let singleton: SshService | null = null

/** Инициализация синглтона в main (app.ready); повторный вызов заменяет экземпляр. */
export function initSshService(userDataDir: string, encrypt: (value: string) => Buffer, decrypt: (buffer: Buffer) => string): SshService {
  singleton = new SshService(
    new SshSecretsService(join(userDataDir, 'ssh-secrets.json'), encrypt, decrypt),
    new SshKnownHosts(join(userDataDir, 'ssh-known-hosts.json'))
  )
  return singleton
}

export function getSshService(): SshService {
  if (singleton === null) throw new Error('SSH service is not initialized')
  return singleton
}
