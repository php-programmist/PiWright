/** Секреты SSH-серверов (пароль, passphrase ключа): файл в userData, значения шифруются
 *  safeStorage (как telegram-токен). Настройки (settings.json) секретов не содержат. */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface SshSecret {
  password?: string
  keyPassphrase?: string
}

/** Минимальный интерфейс хранилища секретов для SshService: настоящий SshSecretsService (файл
 *  с safeStorage) или шим демона (секреты приходят в спеках по каналу). */
export interface SshSecretsStore {
  get(serverId: string): SshSecret
  hasPassword(serverId: string): boolean
  hasKeyPassphrase(serverId: string): boolean
  set(serverId: string, patch: { password?: string | null; keyPassphrase?: string | null }): void
  remove(serverId: string): void
  ids(): string[]
}

interface SecretsFile {
  servers: Record<string, SshSecret>
}

export class SshSecretsService implements SshSecretsStore {
  private cache: SecretsFile | null = null

  constructor(
    private readonly filePath: string,
    private readonly encrypt: (value: string) => Buffer,
    private readonly decrypt: (buffer: Buffer) => string
  ) {}

  private read(): SecretsFile {
    if (this.cache !== null) return this.cache
    if (!existsSync(this.filePath)) {
      this.cache = { servers: {} }
      return this.cache
    }
    try {
      const raw: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'))
      const servers: Record<string, SshSecret> = {}
      if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
        const rawServers = (raw as Record<string, unknown>)['servers']
        if (rawServers !== null && typeof rawServers === 'object' && !Array.isArray(rawServers)) {
          for (const [id, value] of Object.entries(rawServers as Record<string, unknown>)) {
            if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
            const record = value as Record<string, unknown>
            const secret: SshSecret = {}
            if (typeof record['password'] === 'string') secret.password = record['password']
            if (typeof record['keyPassphrase'] === 'string') secret.keyPassphrase = record['keyPassphrase']
            if (Object.keys(secret).length > 0) servers[id] = secret
          }
        }
      }
      this.cache = { servers }
    } catch {
      this.cache = { servers: {} }
    }
    return this.cache
  }

  private write(file: SecretsFile): void {
    this.cache = file
    mkdirSync(dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, JSON.stringify(file, null, 2), 'utf8')
    renameSync(tmp, this.filePath)
  }

  /** Расшифрованный секрет сервера; пустой объект — секрета нет. */
  get(serverId: string): SshSecret {
    const stored = this.read().servers[serverId]
    if (stored === undefined) return {}
    const out: SshSecret = {}
    try {
      if (stored.password !== undefined) out.password = this.decrypt(Buffer.from(stored.password, 'base64'))
      if (stored.keyPassphrase !== undefined) out.keyPassphrase = this.decrypt(Buffer.from(stored.keyPassphrase, 'base64'))
    } catch {
      return {}
    }
    return out
  }

  hasPassword(serverId: string): boolean {
    return this.read().servers[serverId]?.password !== undefined
  }

  hasKeyPassphrase(serverId: string): boolean {
    return this.read().servers[serverId]?.keyPassphrase !== undefined
  }

  /** Частичное обновление: null — удалить поле, undefined — не трогать. */
  set(serverId: string, patch: { password?: string | null; keyPassphrase?: string | null }): void {
    const file = this.read()
    const current = { ...(file.servers[serverId] ?? {}) }
    if (patch.password !== undefined) {
      if (patch.password === null) delete current.password
      else current.password = this.encrypt(patch.password).toString('base64')
    }
    if (patch.keyPassphrase !== undefined) {
      if (patch.keyPassphrase === null) delete current.keyPassphrase
      else current.keyPassphrase = this.encrypt(patch.keyPassphrase).toString('base64')
    }
    if (Object.keys(current).length === 0) delete file.servers[serverId]
    else file.servers[serverId] = current
    this.write(file)
  }

  remove(serverId: string): void {
    const file = this.read()
    if (file.servers[serverId] === undefined) return
    delete file.servers[serverId]
    this.write(file)
  }

  /** Все id с сохранёнными секретами. */
  ids(): string[] {
    return Object.keys(this.read().servers)
  }
}
