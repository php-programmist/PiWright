/** Известные host key SSH-серверов: файл в userData, формат `host:port → sha256:<base64>`.
 *  Политика accept-new: новый ключ принимается и запоминается, подмена известного — ошибка. */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { mkdirSync } from 'node:fs'

export type HostKeyState = 'ok' | 'new' | 'changed'

export class SshKnownHosts {
  private cache: Record<string, string> | null = null

  constructor(private readonly filePath: string) {}

  private read(): Record<string, string> {
    if (this.cache !== null) return this.cache
    if (!existsSync(this.filePath)) {
      this.cache = {}
      return this.cache
    }
    try {
      const raw: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'))
      const out: Record<string, string> = {}
      if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
          if (typeof value === 'string' && value.length > 0) out[key] = value
        }
      }
      this.cache = out
    } catch {
      this.cache = {}
    }
    return this.cache
  }

  private write(map: Record<string, string>): void {
    this.cache = map
    mkdirSync(dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, JSON.stringify(map, null, 2), 'utf8')
    renameSync(tmp, this.filePath)
  }

  private static key(host: string, port: number): string {
    return `${host.toLowerCase()}:${port}`
  }

  state(host: string, port: number, fingerprint: string): HostKeyState {
    const stored = this.read()[SshKnownHosts.key(host, port)]
    if (stored === undefined) return 'new'
    return stored === fingerprint ? 'ok' : 'changed'
  }

  remember(host: string, port: number, fingerprint: string): void {
    const map = this.read()
    const key = SshKnownHosts.key(host, port)
    if (map[key] === fingerprint) return
    this.write({ ...map, [key]: fingerprint })
  }

  forget(host: string, port: number): void {
    const map = this.read()
    const key = SshKnownHosts.key(host, port)
    if (map[key] === undefined) return
    const next = { ...map }
    delete next[key]
    this.write(next)
  }

  fingerprint(host: string, port: number): string | null {
    return this.read()[SshKnownHosts.key(host, port)] ?? null
  }
}
