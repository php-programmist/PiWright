import { useT } from '../lib/i18n'
import type { QueueTexts } from '../../../shared/ipc-contracts'

/** Очередь сообщений во время хода (steering + followUp): шапка «Queued N» + строки с × и Clear all. */
export function QueuePanel({
  queue,
  onRemove,
  onClearAll
}: {
  queue: QueueTexts
  onRemove: (kind: keyof QueueTexts, index: number) => void
  onClearAll: () => void
}): React.JSX.Element | null {
  const t = useT()
  const count = queue.steering.length + queue.followUp.length
  if (count === 0) return null
  const row = (kind: keyof QueueTexts, text: string, index: number): React.JSX.Element => (
    <div key={`${kind}-${index}`} className="queue-row">
      <span className="queue-badge">{t(kind === 'steering' ? 'steer' : 'follow-up')}</span>
      <span className="queue-text">{text}</span>
      <button className="queue-remove" title={t('Remove from queue')} onClick={() => onRemove(kind, index)}>
        ×
      </button>
    </div>
  )
  return (
    <details className="queue-panel" open>
      <summary>
        <span className="queue-title">{t('Queued')}</span>
        <span className="queue-count">{count}</span>
        <button
          className="queue-clear"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onClearAll()
          }}
        >
          {t('Clear all')}
        </button>
      </summary>
      <div className="queue-body">
        {queue.steering.map((text, i) => row('steering', text, i))}
        {queue.followUp.map((text, i) => row('followUp', text, i))}
      </div>
    </details>
  )
}
