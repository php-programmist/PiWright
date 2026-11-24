import { useT } from '../lib/i18n'
import type { QueueTexts } from '../../../shared/ipc-contracts'

/** Очередь сообщений во время хода (steering + followUp): строки с кнопками «в промпт»/«в другую очередь»/×. */
export function QueuePanel({
  queue,
  onRemove,
  onEdit,
  onConvert,
  onClearAll
}: {
  queue: QueueTexts
  onRemove: (kind: keyof QueueTexts, index: number) => void
  onEdit: (kind: keyof QueueTexts, index: number) => void
  onConvert: (kind: keyof QueueTexts, index: number) => void
  onClearAll: () => void
}): React.JSX.Element | null {
  const t = useT()
  const count = queue.steering.length + queue.followUp.length
  if (count === 0) return null
  const row = (kind: keyof QueueTexts, text: string, index: number): React.JSX.Element => (
    <div key={`${kind}-${index}`} className="queue-row">
      <span className="queue-badge">{t(kind === 'steering' ? 'steer' : 'follow-up')}</span>
      <span className="queue-text">{text}</span>
      <button
        className="queue-act"
        title={t('Return to prompt')}
        onClick={() => onEdit(kind, index)}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        className="queue-act queue-convert"
        title={t(kind === 'steering' ? 'Move to follow-up' : 'Move to steer')}
        onClick={() => onConvert(kind, index)}
      >
        {t(kind === 'steering' ? 'follow-up' : 'steer')}
      </button>
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
