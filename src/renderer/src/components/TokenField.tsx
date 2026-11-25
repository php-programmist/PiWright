import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import type { ProjectEntry } from '../../../shared/ipc-contracts'
import type { LinkSegment } from './LinkChips'
import { LINK_TOKEN_RE, splitLinkTokens, truncateTitle, useSessionTitle, useTaskRef } from './LinkChips'
import { useT } from '../lib/i18n'

/** Вычисленные стили textarea, которые надо скопировать в бэкдроп, чтобы текст
 *  совпал попиксельно (font, межбуквенные расстояния, padding, толщина рамки). */
const MIRRORED_PROPS = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'lineHeight',
  'letterSpacing',
  'wordSpacing',
  'textIndent',
  'textTransform',
  'tabSize',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'boxSizing',
] as const

type TokenPart = Exclude<LinkSegment, { kind: 'text' }>

/** Бейдж задачи в бэкдропе: имя с доски, пока ищется — усечённый id, не найдена — приглушённый. */
function TaskTokenBadge({ project, taskId }: { project: ProjectEntry; taskId: string }): React.JSX.Element {
  const t = useT()
  const ref = useTaskRef(project, taskId)
  if (ref === null) {
    return <span className="board-chip missing token-badge">{t('Task not found')}</span>
  }
  return (
    <span className="board-chip task token-badge">
      {ref !== undefined ? truncateTitle(ref.title) : truncateTitle(taskId)}
    </span>
  )
}

/** Бейдж сессии в бэкдропе: заголовок из активных сессий/истории, пока ищется — первые 8 символов id. */
function SessionTokenBadge({ project, sessionId }: { project: ProjectEntry; sessionId: string }): React.JSX.Element {
  const title = useSessionTitle(project, sessionId)
  return <span className="board-chip session token-badge">{title ?? sessionId.slice(0, 8)}</span>
}

/** Слот токена в бэкдропе: прозрачный сырой текст задаёт точную ширину строки,
 *  бейдж с именем задачи/сессии лежит поверх и закрывает технический токен. */
function TokenSlot({ project, part }: { project: ProjectEntry | null; part: TokenPart }): React.JSX.Element {
  const raw = part.kind === 'task' ? `kanban:task:${part.id}` : `session:${part.id}`
  return (
    <span className="token-slot">
      <span className="token-raw">{raw}</span>
      {project !== null &&
        (part.kind === 'task' ? (
          <TaskTokenBadge project={project} taskId={part.id} />
        ) : (
          <SessionTokenBadge project={project} sessionId={part.id} />
        ))}
    </span>
  )
}

interface TokenFieldProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  project: ProjectEntry | null
}

/**
 * Textarea с живыми бейджами токенов-ссылок (kanban:task:c-xxxxxxxx, session:<id>):
 * поверх поля лежит непрозрачный для событий бэкдроп с тем же текстом — токены
 * закрыты бейджем с именем задачи/сессии (как в ленте, но некликабельным).
 * Backspace справа от бейджа (или внутри него) удаляет токен целиком.
 */
export const TokenField = forwardRef<HTMLTextAreaElement, TokenFieldProps>(function TokenField(props, ref) {
  const { onScroll, onKeyDown, project, ...rest } = props
  const value = typeof rest.value === 'string' ? rest.value : ''
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  useImperativeHandle(ref, () => textareaRef.current as HTMLTextAreaElement, [])

  const parts = useMemo(() => splitLinkTokens(value), [value])

  useEffect(() => {
    const ta = textareaRef.current
    const backdrop = backdropRef.current
    if (ta === null || backdrop === null) return
    const cs = getComputedStyle(ta)
    for (const prop of MIRRORED_PROPS) {
      backdrop.style[prop] = cs[prop as keyof CSSStyleDeclaration] as string
    }
    backdrop.style.borderStyle = 'solid'
    backdrop.style.borderColor = 'transparent'
  }, [])

  /** Backspace справа от бейджа удаляет весь токен: каретка внутри/сразу после токена —
   *  снимаем нативное посимвольное удаление и стираем диапазон токена одним куском. */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    const ta = e.currentTarget
    if (
      e.key === 'Backspace' &&
      !e.altKey &&
      !e.metaKey &&
      ta.selectionStart === ta.selectionEnd &&
      ta.selectionStart > 0
    ) {
      const pos = ta.selectionStart
      const token = [...value.matchAll(LINK_TOKEN_RE)].find(
        (m) => pos > (m.index ?? 0) && pos <= (m.index ?? 0) + m[0].length,
      )
      const start = token?.index
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      if (token !== undefined && start !== undefined && setValue !== undefined) {
        e.preventDefault()
        const end = start + token[0].length
        setValue.call(ta, value.slice(0, start) + value.slice(end))
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        ta.setSelectionRange(start, start)
      }
    }
    onKeyDown?.(e)
  }

  const syncScroll = (e: React.UIEvent<HTMLTextAreaElement>): void => {
    const backdrop = backdropRef.current
    if (backdrop !== null) {
      backdrop.scrollTop = e.currentTarget.scrollTop
      backdrop.scrollLeft = e.currentTarget.scrollLeft
    }
    onScroll?.(e)
  }

  return (
    <div className="token-field">
      <textarea ref={textareaRef} {...rest} onKeyDown={handleKeyDown} onScroll={syncScroll} />
      <div ref={backdropRef} className="token-backdrop" aria-hidden>
        {parts.map((part, i) =>
          part.kind === 'text' ? (
            <span key={i}>{part.text}</span>
          ) : (
            <TokenSlot key={i} project={project} part={part} />
          ),
        )}
        {value.endsWith('\n') ? '\u200b' : null}
      </div>
    </div>
  )
})
