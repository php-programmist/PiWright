/** Секреты подключений БД (пароль БД, пароль/passphrase SSH-туннеля): файл в userData,
 *  значения шифруются тем же кодеком, что ssh-secrets (safeStorage / file-codec в headless).
 *  settings.json секретов не содержит — санитайзер mergeDbConnections их выбрасывает. */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface DbSecret {
  password?: string
  sshPassword?: string
  sshKeyPassphrase?: string
}

/** Минимальный интерфейс хранилища секретов для DbService (по образцу SshSecretsStore). */
export interface DbSecretsStore {
  get(connectionId: string): DbSecret
  set(connectionId: string, patch: { password?: string | null; sshPassword?: string | null; sshKeyPassphrase?: string | null }): void
  remove(connectionId: string): void
  ids(): string[]
}

interface SecretsFile {
  connections: Record<string, DbSecret>
}

export class DbSecretsService implements DbSecretsStore {
  private cache: SecretsFile | null = null

  constructor(
    private readonly filePath: string,
    private readonly encrypt: (value: string) => Buffer,
    private readonly decrypt: (buffer: Buffer) => string
  ) {}

  private read(): SecretsFile {
    if (this.cache !== null) return this.cache
    if (!existsSync(this.filePath)) {
      this.cache = { connections: {} }
      return this.cache
    }
    try {
      const raw: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'))
      const connections: Record<string, DbSecret> = {}
      if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
        const rawConnections = (raw as Record<string, unknown>)['connections']
        if (rawConnections !== null && typeof rawConnections === 'object' && !Array.isArray(rawConnections)) {
          for (const [id, value] of Object.entries(rawConnections as Record<string, unknown>)) {
            if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
            const record = value as Record<string, unknown>
            const secret: DbSecret = {}
            if (typeof record['password'] === 'string') secret.password = record['password']
            if (typeof record['sshPassword'] === 'string') secret.sshPassword = record['sshPassword']
            if (typeof record['sshKeyPassphrase'] === 'string') secret.sshKeyPassphrase = record['sshKeyPassphrase']
            if (Object.keys(secret).length > 0) connections[id] = secret
          }
        }
      }
      this.cache = { connections }
    } catch {
      this.cache = { connections: {} }
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

  /** Расшифрованный секрет подключения; пустой объект — секретов нет. */
  get(connectionId: string): DbSecret {
    const stored = this.read().connections[connectionId]
    if (stored === undefined) return {}
    const out: DbSecret = {}
    try {
      if (stored.password !== undefined) out.password = this.decrypt(Buffer.from(stored.password, 'base64'))
      if (stored.sshPassword !== undefined) out.sshPassword = this.decrypt(Buffer.from(stored.sshPassword, 'base64'))
      if (stored.sshKeyPassphrase !== undefined) out.sshKeyPassphrase = this.decrypt(Buffer.from(stored.sshKeyPassphrase, 'base64'))
    } catch {
      return {}
    }
    return out
  }

  /** Частичное обновление: null — удалить поле, undefined — не трогать. */
  set(connectionId: string, patch: { password?: string | null; sshPassword?: string | null; sshKeyPassphrase?: string | null }): void {
    const file = this.read()
    const current = { ...(file.connections[connectionId] ?? {}) }
    if (patch.password !== undefined) {
      if (patch.password === null) delete current.password
      else current.password = this.encrypt(patch.password).toString('base64')
    }
    if (patch.sshPassword !== undefined) {
      if (patch.sshPassword === null) delete current.sshPassword
      else current.sshPassword = this.encrypt(patch.sshPassword).toString('base64')
    }
    if (patch.sshKeyPassphrase !== undefined) {
      if (patch.sshKeyPassphrase === null) delete current.sshKeyPassphrase
      else current.sshKeyPassphrase = this.encrypt(patch.sshKeyPassphrase).toString('base64')
    }
    if (Object.keys(current).length === 0) delete file.connections[connectionId]
    else file.connections[connectionId] = current
    this.write(file)
  }

  remove(connectionId: string): void {
    const file = this.read()
    if (file.connections[connectionId] === undefined) return
    delete file.connections[connectionId]
    this.write(file)
  }

  /** Все id с сохранёнными секретами. */
  ids(): string[] {
    return Object.keys(this.read().connections)
  }
}
