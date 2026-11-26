/** Протокол клиент( Electron main)↔демон: JSONL по LF-кадрам, как у pi RPC.
 *  Модуль общий для обеих сторон и не тянет electron — демон работает в режиме чистого Node. */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { BackendMode } from '../../shared/ipc-contracts'
import type { PiSpawnSpec } from '../pi/backends/types'

export const DAEMON_PROTO_VERSION = 1

/** Канал демона: named pipe с хешем userData (Windows) или unix socket в userData. */
export function daemonChannelPath(userDataDir: string): string {
  if (process.platform === 'win32') {
    const hash = createHash('md5').update(userDataDir).digest('hex')
    return `\\\\.\\pipe\\piwright-daemon-${hash}`
  }
  return join(userDataDir, 'daemon.sock')
}

export interface DaemonSessionInfo {
  sessionKey: string
  sessionFile: string | null
  mode: BackendMode
  /** Сколько клиентов приаттачено: 0 — сессия фоновая (уведомления и grace-kill демона). */
  clients: number
  /** Каталог проекта (cwd спавна) — для попапа фоновых сессий в панели. */
  projectDir: string
  /** Имя сессии из session_info_changed; null — ещё не задано. */
  title: string | null
  /** Идёт ход агента (индикатор в попапе). */
  streaming: boolean
}

export interface DaemonHello {
  type: 'hello'
  token: string
  protoVersion: number
  appVersion: string
  /** Токен бота Telegram (safeStorage расшифрован в main) — для фоновых уведомлений. */
  telegramToken?: string
}

export interface DaemonWelcome {
  type: 'welcome'
  protoVersion: number
  appVersion: string
  sessions: DaemonSessionInfo[]
}

export type DaemonRequest =
  | { type: 'spawn'; id: string; spec: PiSpawnSpec; sessionFile: string | null }
  | { type: 'input'; sessionKey: string; chunk: string }
  | { type: 'endInput'; sessionKey: string }
  | { type: 'close'; sessionKey: string }
  | { type: 'rekey'; id: string; sessionKey: string; sessionFile: string }
  | { type: 'list'; id: string }
  | { type: 'shutdown'; id: string }
  /** Вкладка закрыта (detach): ребёнок остаётся фоновым, даже пока клиент подключён. */
  | { type: 'detachChild'; sessionKey: string }
  | { type: 'killBackground'; id: string }

export type DaemonResponse =
  | { type: 'response'; id: string; ok: true; data: Record<string, unknown> }
  | { type: 'response'; id: string; ok: false; error: string }

export type DaemonPush =
  | { type: 'stdout'; sessionKey: string; line: string }
  | { type: 'stderr'; sessionKey: string; line: string }
  | { type: 'exit'; sessionKey: string; code: number | null; cause: string | null; stderrTail: string }

export type DaemonServerMessage = DaemonWelcome | DaemonResponse | DaemonPush
export type DaemonClientMessage = DaemonHello | DaemonRequest

/** Разбор строки протокола; null — не JSON или не объект. */
export function parseDaemonMessage(line: string): DaemonServerMessage | DaemonClientMessage | null {
  try {
    const parsed: unknown = JSON.parse(line)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    if (typeof record['type'] !== 'string') return null
    return parsed as DaemonServerMessage | DaemonClientMessage
  } catch {
    return null
  }
}
