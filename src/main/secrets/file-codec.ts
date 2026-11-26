/** Кодек секретов для headless-хоста (чистый node, без Electron safeStorage): AES-256-GCM
 *  с ключом из файла в userData (32 случайных байта, 0600 на posix). Формат 'enc1:' —
 *  base64(iv ‖ authTag ‖ ciphertext). Расшифровка понимает и фолбэк 'b64:' (секрет мог быть
 *  записан до появления ключа); safeStorage-блобы (DPAPI/keyring) в node нечитаемы — ясная ошибка. */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { dirname } from 'node:path'
import type { SecretCodec } from './secret-codec'

const PREFIX = 'enc1:'
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32

function readOrCreateKey(keyFile: string): Buffer {
  if (existsSync(keyFile)) {
    const key = readFileSync(keyFile)
    if (key.length === KEY_BYTES) return key
  }
  const key = randomBytes(KEY_BYTES)
  mkdirSync(dirname(keyFile), { recursive: true })
  writeFileSync(keyFile, key, { mode: 0o600 })
  try {
    chmodSync(keyFile, 0o600)
  } catch {
    // windows: права не применяются — файл и так в профиле юзера
  }
  return key
}

export function createFileSecretCodec(keyFile: string): SecretCodec {
  const key = readOrCreateKey(keyFile)
  return {
    encrypt(value: string): Buffer {
      const iv = randomBytes(IV_BYTES)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      const body = Buffer.concat([iv, cipher.getAuthTag(), encrypted])
      return Buffer.from(PREFIX + body.toString('base64'), 'utf8')
    },
    decrypt(buffer: Buffer): string {
      const text = buffer.toString('utf8')
      if (text.startsWith('b64:')) {
        return Buffer.from(text.slice(4), 'base64').toString('utf8')
      }
      if (!text.startsWith(PREFIX)) {
        throw new Error('Secret was encrypted with safeStorage — unavailable in node host')
      }
      const body = Buffer.from(text.slice(PREFIX.length), 'base64')
      if (body.length < IV_BYTES + TAG_BYTES) throw new Error('Corrupted secret blob')
      const iv = body.subarray(0, IV_BYTES)
      const tag = body.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(body.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8')
    }
  }
}
