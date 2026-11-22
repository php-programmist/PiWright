/** Общий диалог подтверждения вместо window.confirm: zustand-очередь из одного
 *  pending-запроса + хост-компонент (монтируется в App). confirm() возвращает Promise. */
import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { useT } from '../lib/i18n'

export interface ConfirmOptions {
  message: string
  /** Текст кнопки подтверждения; по умолчанию «OK». */
  confirmLabel?: string
  /** Красная кнопка подтверждения (удаление). */
  danger?: boolean
}

interface Pending extends ConfirmOptions {
  resolve: (value: boolean) => void
}

interface ConfirmState {
  pending: Pending | null
  confirm: (options: ConfirmOptions) => Promise<boolean>
  answer: (value: boolean) => void
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  pending: null,

  confirm: (options) =>
    new Promise<boolean>((resolve) => {
      const previous = get().pending
      if (previous !== null) previous.resolve(false)
      set({ pending: { ...options, resolve } })
    }),

  answer: (value) => {
    const pending = get().pending
    if (pending === null) return
    set({ pending: null })
    pending.resolve(value)
  }
}))

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState().confirm(options)
}

export function ConfirmDialogHost(): React.JSX.Element | null {
  const t = useT()
  const pending = useConfirmStore((s) => s.pending)
  const answer = useConfirmStore((s) => s.answer)
  const confirmRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (pending === null) return
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') answer(false)
      if (e.key === 'Enter') answer(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, answer])

  if (pending === null) return null

  return (
    <div
      className="files-rename-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) answer(false)
      }}
    >
      <div className="files-rename-box confirm-box">
        <div className="files-rename-title confirm-message">{pending.message}</div>
        <div className="files-rename-actions">
          <button onClick={() => answer(false)}>{t('Cancel')}</button>
          <button
            ref={confirmRef}
            className={`primary${pending.danger ? ' danger' : ''}`}
            onClick={() => answer(true)}
          >
            {pending.confirmLabel ?? t('OK')}
          </button>
        </div>
      </div>
    </div>
  )
}
