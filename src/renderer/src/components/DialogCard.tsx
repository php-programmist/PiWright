import { useState } from 'react'
import type { DialogAnswer, ExtensionDialog } from '../../../shared/agent-events'

const RECEIPT_TEXT: Record<string, string> = {
  answered: 'answered',
  cancelled: 'cancelled',
  expired: 'expired — pi applied the default answer'
}

/** Инлайн-карточка диалога расширения pi (`confirm`/`select`/`input`/`editor`).
 *  После ответа — квитанция вместо кнопок; первый ответ выигрывает (main-сторона). */
export function DialogCard({
  dialog,
  receipt,
  onAnswer
}: {
  dialog: ExtensionDialog
  receipt: string | null
  onAnswer: (answer: DialogAnswer) => void
}): React.JSX.Element {
  const [value, setValue] = useState(dialog.kind === 'editor' ? (dialog.prefill ?? '') : '')

  if (receipt !== null) {
    return <div className="dialog-card receipt">{RECEIPT_TEXT[receipt] ?? receipt}</div>
  }

  const answer = (a: DialogAnswer): void => onAnswer(a)

  return (
    <div className="dialog-card">
      <div className="dialog-title">{dialog.title.length > 0 ? dialog.title : 'pi asks'}</div>
      {dialog.kind === 'confirm' && (
        <>
          {dialog.message !== null && <div className="dialog-body">{dialog.message}</div>}
          <div className="dialog-buttons">
            <button onClick={() => answer({ kind: 'confirmed', confirmed: true })}>Yes</button>
            <button onClick={() => answer({ kind: 'confirmed', confirmed: false })}>No</button>
          </div>
        </>
      )}
      {dialog.kind === 'select' && (
        <>
          {dialog.body !== null && <div className="dialog-body">{dialog.body}</div>}
          <div className="dialog-buttons">
            {dialog.options.map((option) => (
              <button key={option} onClick={() => answer({ kind: 'value', value: option })}>
                {option}
              </button>
            ))}
            <button onClick={() => answer({ kind: 'cancelled' })}>Cancel</button>
          </div>
        </>
      )}
      {dialog.kind === 'input' && (
        <>
          <input
            value={value}
            placeholder={dialog.placeholder ?? ''}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') answer({ kind: 'value', value })
            }}
          />
          <div className="dialog-buttons">
            <button onClick={() => answer({ kind: 'value', value })}>OK</button>
            <button onClick={() => answer({ kind: 'cancelled' })}>Cancel</button>
          </div>
        </>
      )}
      {dialog.kind === 'editor' && (
        <>
          <textarea value={value} rows={6} onChange={(e) => setValue(e.target.value)} />
          <div className="dialog-buttons">
            <button onClick={() => answer({ kind: 'value', value })}>OK</button>
            <button onClick={() => answer({ kind: 'cancelled' })}>Cancel</button>
          </div>
        </>
      )}
    </div>
  )
}
