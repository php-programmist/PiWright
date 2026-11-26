/** Авторизация remote: PIN на процесс приложения, cookie-сессии в памяти, lockout пира.
 *  Порт `core/remote/RemoteAuth.kt`. */
import { randomInt, randomUUID } from 'node:crypto'

const PIN_LENGTH = 6
const TOKEN_LENGTH = 32
const LOCKOUT_ATTEMPTS = 5
const LOCKOUT_MILLIS = 30_000

/** PIN вводят с пробелами («123 456») — сравниваем без пробельных символов. */
export function normalizePin(input: string): string {
  return input.replace(/\s/g, '')
}

export function generatePin(): string {
  let pin = ''
  for (let i = 0; i < PIN_LENGTH; i++) pin += String(randomInt(10))
  return pin
}

export function isValidStaticPin(pin: string): boolean {
  return /^\d{6}$/.test(pin)
}

function generateToken(): string {
  const alphabet = '0123456789abcdef'
  let token = ''
  for (let i = 0; i < TOKEN_LENGTH; i++) token += alphabet[randomInt(alphabet.length)]
  return token
}

interface Failure {
  count: number
  lockedUntil: number
}

export class RemoteAuth {
  private readonly browserSessions = new Set<string>()
  private readonly failures = new Map<string, Failure>()

  private fromStatic = false
  pin: string

  constructor(pin: string) {
    this.pin = pin
  }

  /** Статичный пин из настроек: задан — применяется; снят — возврат к случайному (один раз).
   *  Реальная смена пина отзывает все cookie-сессии (известные браузеры проходят повторный вход);
   *  повторный вызов с тем же значением (applySettings на каждом settings:set) — no-op. */
  setStaticPin(pin: string | null): void {
    if (pin !== null) {
      if (this.fromStatic && this.pin === pin) return
      this.browserSessions.clear()
      this.pin = pin
      this.fromStatic = true
    } else if (this.fromStatic) {
      this.browserSessions.clear()
      this.pin = generatePin()
      this.fromStatic = false
    }
  }

  /** PIN с пробелами для показа: «123 456». */
  get groupedPin(): string {
    return this.pin.replace(/(\d{3})(?=\d)/g, '$1 ')
  }

  newBrowserSession(): string {
    const token = generateToken()
    this.browserSessions.add(token)
    return token
  }

  isAuthorized(cookie: string | null): boolean {
    return cookie !== null && this.browserSessions.has(cookie)
  }

  checkPin(input: string): boolean {
    return normalizePin(input) === this.pin
  }

  isLocked(peer: string, now = Date.now()): boolean {
    const failure = this.failures.get(peer)
    return failure !== undefined && failure.lockedUntil > now
  }

  /** Учитывает промах; true — пир заблокирован после этого промаха. */
  noteFailure(peer: string, now = Date.now()): boolean {
    const current = this.failures.get(peer)
    const count = (current?.count ?? 0) + 1
    if (count >= LOCKOUT_ATTEMPTS) {
      this.failures.set(peer, { count: 0, lockedUntil: now + LOCKOUT_MILLIS })
      return true
    }
    this.failures.set(peer, { count, lockedUntil: 0 })
    return false
  }

  clearFailures(peer: string): void {
    this.failures.delete(peer)
  }
}

/** Идентификатор cookie-сессии (не используется как токен доступа). */
export function newSessionCookieId(): string {
  return randomUUID()
}
