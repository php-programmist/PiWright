import { useT } from '../lib/i18n'
import type { ScheduledPrompt } from '../../../shared/ipc-contracts'

/** Отложенные промпты активной сессии: тот же паттерн, что у QueuePanel (шапка + строки с ×). */
export function ScheduledPanel({ items, onCancel }: { items: ScheduledPrompt[]; onCancel: (id: string) => void }): React.JSX.Element | null {
  const t = useT()
  if (items.length === 0) return null
  const triggerLabel = (item: ScheduledPrompt): string => {
    const base =
      item.trigger.kind === 'after'
        ? t('after "{name}"', { name: item.trigger.sourceTitle })
        : t('at {time}', { time: new Date(item.trigger.atEpochMs).toLocaleString() })
    return item.loop !== null ? `${base} · ⟳ ${item.loop.maxIterations}` : base
  }
  return (
    <details className="queue-panel scheduled-panel" open>
      <summary>
        <span className="queue-title">{t('Scheduled')}</span>
        <span className="queue-count">{items.length}</span>
      </summary>
      <div className="queue-body">
        {items.map((item) => (
          <div key={item.id} className="queue-row" title={item.loop !== null ? `${item.text}\n— ${t('Loop')}: ${item.loop.maxIterations}${item.loop.exitCondition.length > 0 ? ` · ${item.loop.exitCondition}` : ''}` : item.text}>
            <span className="queue-badge">{triggerLabel(item)}</span>
            <span className="queue-text">{item.text}</span>
            <button className="queue-remove" title={t('Cancel scheduled send')} onClick={() => onCancel(item.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </details>
  )
}
