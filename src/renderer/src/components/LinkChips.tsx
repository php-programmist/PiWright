import { useEffect, useMemo, useState } from 'react'
import type { KanbanSessionRef } from '../../../shared/kanban'
import type { ProjectEntry, SessionSummary } from '../../../shared/ipc-contracts'
import { projectKey, useSessionsStore } from '../stores/sessions'
import { parentTabKey, useTabsStore } from '../stores/tabs'
import { useLang, useT } from '../lib/i18n'

/** Токен-ссылка в тексте: kanban:task:c-xxxxxxxx или kanban:session:<sessionId>. */
const LINK_TOKEN_RE = /kanban:(task|session):([A-Za-z0-9-]+)/g

export type LinkSegment =
  | { kind: 'text'; text: string }
  | { kind: 'task'; id: string }
  | { kind: 'session'; id: string }

export function splitLinkTokens(text: string): LinkSegment[] {
  const parts: LinkSegment[] = []
  let last = 0
  for (const m of text.matchAll(LINK_TOKEN_RE)) {
    const start = m.index ?? 0
    if (start > last) parts.push({ kind: 'text', text: text.slice(last, start) })
    parts.push(m[1] === 'task' ? { kind: 'task', id: m[2] } : { kind: 'session', id: m[2] })
    last = start + m[0].length
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) })
  return parts
}

export function hasLinkTokens(text: string): boolean {
  return splitLinkTokens(text).some((p) => p.kind !== 'text')
}

export function copyText(text: string): void {
  void navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  })
}

const truncateTitle = (title: string): string => (title.length > 20 ? `${title.slice(0, 20)}…` : title)

interface TaskRef {
  boardId: string
  title: string
}

const taskRefCache = new Map<string, TaskRef | null>()

/** Чип ссылки на задачу: клик — открыть задачу в отдельной вкладке. */
function TaskChip({ project, taskId }: { project: ProjectEntry; taskId: string }): React.JSX.Element {
  const t = useT()
  const cacheKey = `${projectKey(project)}\u0000${taskId}`
  const [ref, setRef] = useState<TaskRef | null | undefined>(() => taskRefCache.get(cacheKey))
  useEffect(() => {
    if (ref !== undefined) return
    let cancelled = false
    void (async () => {
      const boards = await window.piwright.kanbanBoards(project)
      if (!boards.ok) {
        taskRefCache.set(cacheKey, null)
        if (!cancelled) setRef(null)
        return
      }
      for (const board of boards.boards) {
        const res = await window.piwright.kanbanBoardGet(project, board.id)
        const card = res.ok && res.board !== null ? res.board.cards.find((c) => c.id === taskId) : undefined
        if (card !== undefined) {
          const found: TaskRef = { boardId: board.id, title: card.title }
          taskRefCache.set(cacheKey, found)
          if (!cancelled) setRef(found)
          return
        }
      }
      taskRefCache.set(cacheKey, null)
      if (!cancelled) setRef(null)
    })()
    return () => {
      cancelled = true
    }
  }, [cacheKey, project, ref, taskId])

  const open = (): void => {
    if (ref === null || ref === undefined) return
    useTabsStore.getState().openTab(project, { kind: 'task', boardId: ref.boardId, title: ref.title, taskId })
  }

  if (ref === null) {
    return (
      <span className="board-chip missing" title={t('Task not found')}>
        {t('Task not found')}
      </span>
    )
  }
  const title = ref !== undefined ? truncateTitle(ref.title) : truncateTitle(taskId)
  return (
    <span className="board-chip task" title={ref !== undefined ? ref.title : taskId} onClick={open}>
      {title}
    </span>
  )
}

/** Чип сессии в комментарии: живая — активация чата, из истории — восстановление чата,
 *  нигде не найдена — приглушённый чип с тултипом. Пустой title (ссылка-токен) —
 *  заголовок ищется в активных сессиях и истории. */
export function SessionChip({ project, session, at }: { project: ProjectEntry; session: KanbanSessionRef; at?: string }): React.JSX.Element {
  const t = useT()
  const lang = useLang()
  const [missing, setMissing] = useState(false)
  const [resolvedTitle, setResolvedTitle] = useState(session.title)
  useEffect(() => {
    const st = useSessionsStore.getState()
    if (st.active.some((r) => r.sessionId === session.id)) return
    if (st.projects.some((p) => p.history.some((h) => h.id === session.id))) return
    let cancelled = false
    void window.piwright.sessionHistory(project).then((history) => {
      if (cancelled) return
      if (!history.some((h) => h.id === session.id)) setMissing(true)
    })
    return () => {
      cancelled = true
    }
  }, [project, session.id])
  useEffect(() => {
    if (session.title !== '') return
    let cancelled = false
    void (async () => {
      await Promise.resolve()
      const st = useSessionsStore.getState()
      const active = st.active.find((r) => r.sessionId === session.id)
      if (active !== undefined) {
        setResolvedTitle(active.title)
        return
      }
      const history = await window.piwright.sessionHistory(project)
      if (!cancelled) setResolvedTitle(history.find((h) => h.id === session.id)?.title ?? session.id.slice(0, 8))
    })()
    return () => {
      cancelled = true
    }
  }, [project, session.id, session.title])

  const open = (): void => {
    const st = useSessionsStore.getState()
    const row = st.active.find((r) => r.sessionId === session.id)
    if (row !== undefined) {
      useTabsStore.getState().setActiveProject(parentTabKey(row.project))
      useTabsStore.getState().activateSession(row.project)
      st.setActive(row.hostId)
      return
    }
    const resume = async (found: SessionSummary): Promise<void> => {
      const result = await window.piwright.openSession(project, found.path)
      if (!result.ok) {
        if (result.error !== null) window.alert(result.error)
        return
      }
      useTabsStore.getState().setActiveProject(parentTabKey(project))
      useTabsStore.getState().activateSession(project)
      st.setActive(result.hostId)
    }
    const summary = st.projects
      .find((p) => p.history.some((h) => h.id === session.id))
      ?.history.find((h) => h.id === session.id)
    if (summary !== undefined) {
      void resume(summary)
      return
    }
    void window.piwright.sessionHistory(project).then((history) => {
      const found = history.find((h) => h.id === session.id)
      if (found !== undefined) void resume(found)
    })
  }

  const when = at === undefined ? '' : ` · ${new Date(at).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US')}`
  return (
    <span
      className={missing ? 'board-chip missing' : 'board-chip session'}
      title={missing ? t('Session not found') : `${resolvedTitle}${when}`}
      onClick={open}
    >
      {resolvedTitle}
    </span>
  )
}

/** Текст с токенами-ссылками: токены рендерятся чипами, остальное — renderText или plain span. */
export function RichText({
  text,
  project,
  renderText,
}: {
  text: string
  project: ProjectEntry | null
  renderText?: (chunk: string) => React.ReactNode
}): React.JSX.Element {
  const parts = useMemo(() => splitLinkTokens(text), [text])
  if (parts.length === 1 && parts[0].kind === 'text') {
    return <>{renderText !== undefined ? renderText(parts[0].text) : parts[0].text}</>
  }
  return (
    <>
      {parts.map((part, i) => {
        if (part.kind === 'text') {
          const chunk = part.text
          return <span key={i}>{renderText !== undefined ? renderText(chunk) : chunk}</span>
        }
        if (project === null) return <span key={i}>{`kanban:${part.kind}:${part.id}`}</span>
        return part.kind === 'task' ? (
          <TaskChip key={i} project={project} taskId={part.id} />
        ) : (
          <SessionChip key={i} project={project} session={{ id: part.id, title: '' }} />
        )
      })}
    </>
  )
}
