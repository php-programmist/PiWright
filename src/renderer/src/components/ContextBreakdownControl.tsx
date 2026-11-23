import { useEffect, useRef, useState } from 'react'
import { useT } from '../lib/i18n'
import { percentColor } from '../../../shared/agent-events'
import type { ContextBreakdownData } from '../../../shared/ipc-contracts'

interface Props {
  hostId: string | null
  percent: number | null
  title: string
}

/** Процент заполнения контекста в шапке; клик — поповер с разбивкой токенов
 *  (оценка chars/4 по сообщениям + остаток «системный промпт и инструменты»). */
export function ContextBreakdownControl({ hostId, percent, title }: Props) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<ContextBreakdownData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (!open || hostId === null) return
    let cancelled = false
    void window.piwright.contextBreakdown(hostId).then((r) => {
      if (cancelled) return
      if (r.ok && r.breakdown !== null) {
        setData(r.breakdown)
        setError(null)
      } else {
        setData(null)
        setError(r.error ?? t('No context usage yet'))
      }
    })
    return () => {
      cancelled = true
    }
  }, [open, hostId, t])

  const fmt = (n: number): string => n.toLocaleString('en-US')
  const total = data?.contextTokens ?? null
  const rows: { label: string; value: number }[] =
    data === null
      ? []
      : [
          { label: t('System prompt and tools'), value: data.systemAndTools },
          { label: t('User messages'), value: data.userMessages },
          { label: t('Agent text and thinking'), value: data.assistantText },
          { label: t('Tool calls'), value: data.assistantToolCalls },
          { label: t('Tool results'), value: data.toolResults },
          ...(data.other > 0 ? [{ label: t('Other'), value: data.other }] : [])
        ]

  return (
    <span className="ctx-breakdown" ref={rootRef}>
      {percent !== null && (
        <button
          className="ctx-usage"
          style={{ color: percentColor(percent) }}
          title={title}
          onClick={() => setOpen((v) => !v)}
        >
          {percent}%
        </button>
      )}
      {open && (
        <div className="ctx-popover">
          {data === null ? (
            <div className="ctx-popover-empty">{error ?? t('No context usage yet')}</div>
          ) : (
            <>
              {rows.map((r) => (
                <div key={r.label} className="ctx-row">
                  <span className="ctx-row-label">{r.label}</span>
                  <span className="ctx-row-value">{fmt(r.value)}</span>
                  <span className="ctx-row-pct">
                    {total !== null && total > 0 ? `${Math.round((r.value / total) * 100)}%` : ''}
                  </span>
                </div>
              ))}
              <div className="ctx-row ctx-row-total">
                <span className="ctx-row-label">{t('Total context')}</span>
                <span className="ctx-row-value">{total !== null ? fmt(total) : '—'}</span>
                <span className="ctx-row-pct" />
              </div>
            </>
          )}
        </div>
      )}
    </span>
  )
}
