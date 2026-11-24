import type { KanbanCard } from '../../../../shared/kanban'
import { useT } from '../../lib/i18n'
import { DOT_CLASS, DOT_LABEL, cardDotOf, type CardDotInputs } from '../../lib/kanban-card-dot'

/** Кружок у задачи; без статуса — невидимый span, чтобы заголовки задач оставались выровнены. */
export function CardDot({ card, boardId, inputs }: { card: KanbanCard; boardId: string; inputs: CardDotInputs }): React.JSX.Element {
  const t = useT()
  const hit = cardDotOf(card, boardId, inputs)
  if (hit === null) return <span className="dot dot-off" />
  return <span className={`dot ${DOT_CLASS[hit.dot]}`} title={`${hit.title} · ${t(DOT_LABEL[hit.dot])}`} />
}
