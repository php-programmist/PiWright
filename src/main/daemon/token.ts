/** Одноразовый токен доступа к демону: файл в userData (0600), перегенерируется при старте демона.
 *  На Windows ACL канала и так по пользователю — токен подстраховка; секреты в логи не пишутся. */
import { randomBytes } from 'node:crypto'
import { existsSync, chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function daemonTokenPath(userDataDir: string): string {
  return join(userDataDir, 'daemon-token')
}

/** Прочитать токен (клиент шлёт его в hello); null — файла нет или не читается. */
export function readDaemonToken(userDataDir: string): string | null {
  try {
    const raw = readFileSync(daemonTokenPath(userDataDir), 'utf8').trim()
    return raw.length > 0 ? raw : null
  } catch {
    return null
  }
}

/** Токен демона: существующий файл или новый случайный (демон вызывает на старте до listen). */
export function ensureDaemonToken(userDataDir: string): string {
  const path = daemonTokenPath(userDataDir)
  const existing = readDaemonToken(userDataDir)
  if (existing !== null) return existing
  const token = randomBytes(32).toString('hex')
  writeFileSync(path, `${token}\n`, 'utf8')
  if (!existsSync(path)) throw new Error(`Failed to write daemon token to ${path}`)
  try {
    chmodSync(path, 0o600)
  } catch {
    // на Windows chmod не работает — ACL и так по пользователю
  }
  return token
}
