/** Кружок статуса сессии. Порт `core/remote/RemoteProtocol.kt sessionStatus`. */
import type { SessionDot } from '../../shared/ipc-contracts'

export function sessionStatus(streaming: boolean, pendingMethods: string[]): SessionDot {
  if (pendingMethods.includes('confirm')) return 'confirm'
  if (pendingMethods.length > 0) return 'question'
  if (streaming) return 'busy'
  return 'idle'
}
