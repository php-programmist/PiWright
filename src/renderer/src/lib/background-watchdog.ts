/** Вотчдог завершённых фоновых сессий: строка с play-иконкой, у которой ход уже закончился
 *  (dot idle/error), через notifications.backgroundGraceMinutes простоя закрывается —
 *  процесс останавливается, строка уходит в историю. Новая активность (attach, новый ход,
 *  диалог) снимает таймер; отсчёт ведётся от последней активности, повторный пересчёт
 *  заведённый таймер не перезапускает. Дети без клиентов (детач) гасит сам демон — здесь
 *  только строки приложения. */
import { splitWorktreeHostDir } from '../../../shared/worktree'
import { useSessionsStore, type SessionRow } from '../stores/sessions'

/** Ход завершён и ничего не ждёт от пользователя. */
function expired(row: SessionRow): boolean {
  return row.background && (row.dot === 'idle' || row.dot === 'error')
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()

/** Пересчитать таймеры по текущему списку сессий: снять с выбывших, завести новым. */
export function rearmBackgroundWatchdogs(): void {
  const state = useSessionsStore.getState()
  const graceMs = (state.settings?.notifications.backgroundGraceMinutes ?? 10) * 60_000
  const expiredIds = new Set(state.active.filter(expired).map((r) => r.hostId))
  for (const [hostId, timer] of timers) {
    if (expiredIds.has(hostId)) continue
    clearTimeout(timer)
    timers.delete(hostId)
  }
  for (const hostId of expiredIds) {
    if (timers.has(hostId)) continue
    timers.set(
      hostId,
      setTimeout(() => {
        timers.delete(hostId)
        // Состояние могло измениться, пока таймер спал — решает свежий срез стора.
        const row = useSessionsStore.getState().active.find((r) => r.hostId === hostId)
        if (row === undefined || !expired(row)) return
        const keepAlive = splitWorktreeHostDir(row.project.dir) === null
        void useSessionsStore.getState().closeSessionRow(hostId, keepAlive)
      }, graceMs)
    )
  }
}

/** Погасить все таймеры (тесты). */
export function clearBackgroundWatchdogs(): void {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
}
