import type { TodoItem } from '../../../shared/todo'
import { useT } from '../lib/i18n'

/** Todo-виджет расширения (порт `TodoPanel.kt` без прогресс-полосы пиксель-в-пиксель):
 *  шапка «Todo done/total» + строки ✓/▶/○. */
export function TodoPanel({ items }: { items: TodoItem[] }): React.JSX.Element | null {
  const t = useT()
  if (items.length === 0) return null
  const done = items.filter((item) => item.status === 'completed').length
  return (
    <details className="todo-panel" open>
      <summary>
        <span className="todo-title">{t('Todo')}</span>
        <span className="todo-count">
          {done}/{items.length}
        </span>
        <span className="todo-bar">
          <span style={{ width: `${Math.round((done / items.length) * 100)}%` }} />
        </span>
      </summary>
      <div className="todo-body">
        {items.map((item, index) => (
          <div key={index} className={`todo-row ${item.status}`}>
            <span className="todo-glyph">{item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '▶' : '○'}</span>
            <span className="todo-subject">{item.subject}</span>
          </div>
        ))}
      </div>
    </details>
  )
}
