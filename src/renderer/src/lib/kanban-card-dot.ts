/** Точка задачи канбана = статус сессии, которая её делает. Общая логика для дерева
 *  панели и карточек доски. */
import type { KanbanCard } from '../../../shared/kanban'
import { attentionSessionOfCard } from '../../../shared/kanban'
import type { KanbanCardAttention, ProjectEntry, SessionDot } from '../../../shared/ipc-contracts'
import { useChatStore, type HostChat } from '../stores/chat'
import { projectKey, useSessionsStore, type SessionRow } from '../stores/sessions'

export const DOT_LABEL: Record<SessionDot, string> = {
  confirm: 'Waiting for approval',
  question: 'Question',
  busy: 'Running',
  waiting: 'Waiting for subagents',
  idle: 'Unread turns',
}

export const DOT_CLASS: Record<SessionDot, string> = {
  confirm: 'confirm',
  question: 'question',
  busy: 'busy',
  waiting: 'waiting',
  idle: 'idle',
}

/** Класс бейджа-счётчика свёрнутой колонки для статуса задачи. */
export const BADGE_CLASS: Record<SessionDot, string> = {
  confirm: 'attention',
  question: 'attention',
  busy: 'busy',
  waiting: 'waiting',
  idle: 'green',
}

const PRIORITY: Record<SessionDot, number> = { confirm: 5, question: 4, busy: 3, waiting: 2, idle: 1 }

export interface CardDotInputs {
  active: SessionRow[]
  chatHosts: Record<string, HostChat>
  attention: KanbanCardAttention | undefined
}

export interface CardDotHit {
  dot: SessionDot
  title: string
}

/** Живые входы для точек задач: активные сессии, непрочитанность ходов, внимание закрытых сессий. */
export function useCardDotInputs(project: ProjectEntry): CardDotInputs {
  const active = useSessionsStore((s) => s.active)
  const chatHosts = useChatStore((s) => s.hosts)
  const attention = useSessionsStore((s) => s.settings?.kanbanCardAttention[projectKey(project)])
  return { active, chatHosts, attention }
}

/** Живая сессия — её dot (зелёный только при непрочитанном ходе), закрытая — зелёный пока
 *  карточку не открывали. Из нескольких сессий берётся самая требовательная к вниманию. */
export function cardDotOf(card: KanbanCard, boardId: string, inputs: CardDotInputs): CardDotHit | null {
  const sessions = card.sessions
  if (sessions === undefined || sessions.length === 0) return null
  let best: CardDotHit | null = null
  let rank = 0
  for (const session of sessions) {
    const row = inputs.active.find((r) => r.sessionId === session.id)
    let dot: SessionDot | null = null
    if (row !== undefined) {
      dot = row.dot
      if (dot === 'idle' && !(inputs.chatHosts[row.hostId]?.unread ?? false)) dot = null
    } else if (attentionSessionOfCard(card, boardId, inputs.attention)?.id === session.id) {
      dot = 'idle'
    }
    if (dot === null) continue
    if (best === null || PRIORITY[dot] > rank) {
      best = { dot, title: session.title }
      rank = PRIORITY[dot]
    }
  }
  return best
}
