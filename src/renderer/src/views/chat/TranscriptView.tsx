/** Транскрипт сессии субагента вместо чата: ленивое чтение JSONL без запуска pi,
 *  кнопка «назад к родителю». Перезмонтируется по key={path} при смене сессии. */
import { useEffect, useRef, useState } from 'react'
import { EntryView } from './ChatView'
import { useVirtualFeed } from './useVirtualFeed'
import { transcriptEntries } from '../../stores/chat'
import type { Entry } from '../../stores/chat'
import { tabId, useTabsStore } from '../../stores/tabs'
import { useLang, useT } from '../../lib/i18n'
import type { ProjectEntry, SessionSummary } from '../../../../shared/ipc-contracts'

const noopAnswer = (): void => {}

export function TranscriptView({ project, summary }: { project: ProjectEntry; summary: SessionSummary }): React.JSX.Element {
  const t = useT()
  const lang = useLang()
  const closeTranscript = (): void => {
    useTabsStore.getState().closeTab(project, tabId({ kind: 'transcript', path: summary.path }))
  }
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const transcriptRef = useRef<HTMLElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const pinRef = useRef(true)
  const feed = useVirtualFeed(entries ?? [], transcriptRef, {
    pinRef,
    onScroll: (atBottom) => {
      pinRef.current = atBottom
    }
  })
  const { jumpToBottom } = feed

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
    if (entries === null) return
    jumpToBottom()
    bottomRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [entries, jumpToBottom])

  const loaded = entries !== null && error === null && entries.length > 0
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
      <main className="transcript" ref={transcriptRef} onScroll={feed.handleScroll}>
        {entries === null && <div className="panel-hint">{t('loading…')}</div>}
        {error !== null && <div className="error entry-error">{error}</div>}
        {entries !== null && error === null && entries.length === 0 && (
          <div className="panel-hint">{t('no past sessions')}</div>
        )}
        {loaded && feed.topSpacer > 0 && <div className="feed-spacer" style={{ height: feed.topSpacer }} aria-hidden="true" />}
        {loaded &&
          entries.slice(feed.range.start, feed.range.end).map((entry) => (
            <div key={entry.id} className="entry-slot" data-entry-id={entry.id}>
              <EntryView entry={entry} onAnswer={noopAnswer} />
            </div>
          ))}
        {loaded && feed.bottomSpacer > 0 && <div className="feed-spacer" style={{ height: feed.bottomSpacer }} aria-hidden="true" />}
        <div ref={bottomRef} />
      </main>
    </>
  )
}
