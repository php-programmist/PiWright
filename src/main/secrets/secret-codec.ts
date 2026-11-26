/** Кодек секретов поверх Electron safeStorage. Windows — DPAPI всегда доступен. Linux —
 *  libsecret/kwallet; без keyring safeStorage.encryptString бросает — фолбэк basic_text:
 *  base64 с префиксом 'b64:' (файл в userData, не в облаке; читается только этим юзером).
 *  Расшифровка понимает оба формата: без префикса — safeStorage, с 'b64:' — фолбэк
 *  (keyring мог появиться после записи фолбэка). В headless-хосте (чистый node,
 *  веб-режим) safeStorage недоступен — кодек работает только с фолбэк-форматом.
 *  В CJS-сборке import из 'electron' в node даёт undefined — проверяется явно. */
import { safeStorage } from 'electron'

/** Минимальный интерфейс safeStorage (инжектится в тестах). */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(buffer: Buffer): string
}

const FALLBACK_PREFIX = 'b64:'

export interface SecretCodec {
  encrypt(value: string): Buffer
  decrypt(buffer: Buffer): string
}

export function createSecretCodec(safe: SafeStorageLike | undefined = safeStorage): SecretCodec {
  return {
    encrypt(value: string): Buffer {
      if (safe !== undefined && safe.isEncryptionAvailable()) return safe.encryptString(value)
      return Buffer.from(FALLBACK_PREFIX + Buffer.from(value, 'utf8').toString('base64'), 'utf8')
    },
    decrypt(buffer: Buffer): string {
      const text = buffer.toString('utf8')
      if (text.startsWith(FALLBACK_PREFIX)) {
        return Buffer.from(text.slice(FALLBACK_PREFIX.length), 'base64').toString('utf8')
      }
      if (safe === undefined) throw new Error('Secret was encrypted with safeStorage — unavailable in node host')
      return safe.decryptString(buffer)
    }
  }
}
