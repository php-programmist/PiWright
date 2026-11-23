/** Модальный диалог переименования (референс — PHPStorm, как в FilesPanel):
 *  zustand-очередь из одного pending-запроса + хост-компонент (монтируется в App).
 *  renameDialog() возвращает Promise<string | null> — null при отмене. */
import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { useT } from '../lib/i18n'

export interface RenameOptions {
  title: string
  initial: string
  /** Текст кнопки подтверждения; по умолчанию «Rename». */
  confirmLabel?: string
}

interface Pending extends RenameOptions {
  resolve: (value: string | null) => void
}

interface RenameState {
  pending: Pending | null
  open: (options: RenameOptions) => Promise<string | null>
  finish: (value: string | null) => void
}

export const useRenameStore = create<RenameState>((set, get) => ({
  pending: null,

  open: (options) =>
    new Promise<string | null>((resolve) => {
      const previous = get().pending
      if (previous !== null) previous.resolve(null)
      set({ pending: { ...options, resolve } })
    }),

  finish: (value) => {
    const pending = get().pending
    if (pending === null) return
    set({ pending: null })
    pending.resolve(value)
  }
}))

export function renameDialog(options: RenameOptions): Promise<string | null> {
  return useRenameStore.getState().open(options)
}

export function RenameDialogHost(): React.JSX.Element | null {
  const t = useT()
  const pending = useRenameStore((s) => s.pending)
  const finish = useRenameStore((s) => s.finish)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (pending === null) return
    inputRef.current?.focus()
    inputRef.current?.select()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') finish(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, finish])

  if (pending === null) return null

  const submit = (): void => {
    const value = inputRef.current?.value.trim() ?? ''
    finish(value.length === 0 ? null : value)
  }

  return (
    <div
      className="files-rename-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) finish(null)
      }}
    >
      <div className="files-rename-box">
        <div className="files-rename-title">{pending.title}</div>
        <input
          ref={inputRef}
          autoFocus
          defaultValue={pending.initial}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          onFocus={(e) => e.target.select()}
        />
        <div className="files-rename-actions">
          <button onClick={() => finish(null)}>{t('Cancel')}</button>
          <button className="primary" onClick={submit}>
            {pending.confirmLabel ?? t('Rename')}
          </button>
        </div>
      </div>
    </div>
  )
}
