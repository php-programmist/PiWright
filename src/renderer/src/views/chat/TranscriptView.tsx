/** Транскрипт сессии субагента вместо чата: ленивое чтение JSONL без запуска pi,
 *  кнопка «назад к родителю». Перезмонтируется по key={path} при смене сессии. */
import { useEffect, useRef, useState } from 'react'
import { EntryView } from './ChatView'
import { transcriptEntries } from '../../stores/chat'
import type { Entry } from '../../stores/chat'
import { tabId, useTabsStore } from '../../stores/tabs'
import { useLang, useT } from '../../lib/i18n'
import type { ProjectEntry, SessionSummary } from '../../../../shared/ipc-contracts'

export function TranscriptView({ project, summary }: { project: ProjectEntry; summary: SessionSummary }): React.JSX.Element {
  const t = useT()
  const lang = useLang()
  const closeTranscript = (): void => {
    useTabsStore.getState().closeTab(project, tabId({ kind: 'transcript', path: summary.path }))
  }
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const transcriptRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await window.piwright.sessionTranscript(project, summary.path)
      if (cancelled) return
      if (!result.ok) {
        setError(result.error ?? t('Transcript failed to load'))
        setEntries([])
        return
      }
      setEntries(transcriptEntries(result.events))
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, summary.path])

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight })
  }, [entries])

  return (
    <>
      <header className="header">
        <button className="icon" title={t('Back to parent session')} onClick={closeTranscript}>←</button>
        <span className="state">{summary.title}</span>
        <span className="ext-status">
          {new Date(summary.lastActivityEpochMs).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })}
        </span>
        <span className="spacer" />
      </header>
      <main className="transcript" ref={transcriptRef}>
        {entries === null && <div className="panel-hint">{t('loading…')}</div>}
        {error !== null && <div className="error entry-error">{error}</div>}
        {entries !== null && error === null && entries.length === 0 && (
          <div className="panel-hint">{t('no past sessions')}</div>
        )}
        {entries !== null && entries.map((entry) => <EntryView key={entry.id} entry={entry} onAnswer={() => {}} />)}
      </main>
    </>
  )
}
