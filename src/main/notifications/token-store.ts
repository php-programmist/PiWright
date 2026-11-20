/** Токен бота Telegram: шифрованный файл рядом с settings.json (Electron safeStorage / DPAPI).
 *  Порт `TelegramTokenStore.kt` (там — PasswordSafe): в settings.json токен не попадает. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export class TelegramTokenStore {
  constructor(
    private readonly baseDir: string,
    private readonly encrypt: (value: string) => Buffer,
    private readonly decrypt: (value: Buffer) => string
  ) {}

  private get filePath(): string {
    return join(this.baseDir, 'telegram-token.bin')
  }

  read(): string | null {
    if (!existsSync(this.filePath)) return null
    try {
      const raw = readFileSync(this.filePath)
      const token = this.decrypt(raw)
      return token.trim().length > 0 ? token : null
    } catch {
      return null
    }
  }

  write(token: string): void {
    if (token.trim().length === 0) {
      if (existsSync(this.filePath)) {
        try {
          writeFileSync(this.filePath, '')
        } catch {
          // стереть не смогли — токен останется старым
        }
      }
      return
    }
    try {
      const encoded = this.encrypt(token)
      mkdirSync(this.baseDir, { recursive: true })
      writeFileSync(this.filePath, encoded)
    } catch {
      // шифрование недоступно — токен не сохраняем
    }
  }
}
