/** Модалка «Что нового»: релизы с фида обновлений (новые сверху), тела без хэшей коммитов. */
import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChangelogResult } from '../../../shared/ipc-contracts'
import { useT } from '../lib/i18n'

export function ChangelogModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const t = useT()
  const [state, setState] = useState<ChangelogResult | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.piwright.changelog().then((result) => {
      if (!cancelled) setState(result)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="changelog-modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="changelog-modal">
        <div className="changelog-head">
          <span>{t("What's new")}</span>
          <span className="spacer" />
          <button className="settings-close" title={t('Close')} onClick={onClose}>×</button>
        </div>
        <div className="changelog-body">
          {state === null && <div className="changelog-status">{t('Loading…')}</div>}
          {state !== null && state.releases.length === 0 && !state.ok && (
            <>
              <div className="changelog-status">{t('Failed to load changelog')}</div>
              {state.error !== null && <div className="changelog-status dim">{state.error}</div>}
            </>
          )}
          {state !== null && state.releases.length === 0 && state.ok && (
            <div className="changelog-status">{t('No releases yet')}</div>
          )}
          {state !== null && state.stale && <div className="changelog-status stale">{t('Showing saved copy (offline)')}</div>}
          {state !== null &&
            state.releases.map((r) => (
              <section key={r.version} className="changelog-release">
                <div className="changelog-release-head">
                  <span className="changelog-version">v{r.version}</span>
                  {r.date.length > 0 && <span className="changelog-date">{r.date}</span>}
                </div>
                {r.bodyHtml !== undefined ? (
                  <div className="markdown changelog-md" dangerouslySetInnerHTML={{ __html: r.bodyHtml }} />
                ) : (
                  r.body.length > 0 && (
                    <div className="markdown changelog-md">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{r.body}</ReactMarkdown>
                    </div>
                  )
                )}
              </section>
            ))}
        </div>
      </div>
    </div>
  )
}
