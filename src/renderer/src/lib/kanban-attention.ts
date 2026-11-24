/** Непрочитанное внимание на задачах канбана: зелёная точка переживает закрытие сессии
 *  и снимается открытием карточки. Живёт в settings.kanbanCardAttention (переживает перезапуск). */
import { cardAttentionKey } from '../../../shared/kanban'
import type { KanbanCardAttention, ProjectEntry } from '../../../shared/ipc-contracts'
import { projectKey, useSessionsStore } from '../stores/sessions'

const EMPTY: KanbanCardAttention = { sessions: [], dismissed: [] }

function patch(key: string, mutate: (entry: KanbanCardAttention) => KanbanCardAttention): void {
  const store = useSessionsStore.getState()
  const settings = store.settings
  if (settings === null) return
  const next = mutate(settings.kanbanCardAttention[key] ?? EMPTY)
  const map = { ...settings.kanbanCardAttention }
  if (next.sessions.length === 0 && next.dismissed.length === 0) delete map[key]
  else map[key] = next
  void window.piwright.setSettings({ kanbanCardAttention: map }).then((saved) => store.setSettings(saved))
}

/** Сессия закрылась с непрочитанным ходом — все её задачи получают зелёную точку. */
export function markSessionAttention(project: ProjectEntry, sessionId: string): void {
  patch(projectKey(project), (entry) =>
    entry.sessions.includes(sessionId) ? entry : { ...entry, sessions: [...entry.sessions, sessionId] },
  )
}

/** Карточку открыли — точка с неё снимается (точка других задач той же сессии остаётся). */
export function dismissCardAttention(project: ProjectEntry, boardId: string, cardId: string): void {
  const key = cardAttentionKey(boardId, cardId)
  patch(projectKey(project), (entry) =>
    entry.dismissed.includes(key) ? entry : { ...entry, dismissed: [...entry.dismissed, key] },
  )
}
