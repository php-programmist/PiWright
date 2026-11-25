import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { splitLinkTokens } from './LinkChips'

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

/**
 * Textarea с живым бейджем токенов-ссылок (kanban:task:c-xxxxxxxx, session:<id>):
 * поверх поля лежит непрозрачный для событий бэкдроп с тем же текстом — токены
 * выделены чипом. Текст самой textarea виден как обычно, выделение и каретка работают.
 */
export const TokenField = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TokenField(props, ref) {
    const { onScroll, ...rest } = props
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
        <textarea ref={textareaRef} {...rest} onScroll={syncScroll} />
        <div ref={backdropRef} className="token-backdrop" aria-hidden>
          {parts.map((part, i) =>
            part.kind === 'text' ? (
              <span key={i}>{part.text}</span>
            ) : (
              <span key={i} className="token-chip">
                {part.kind === 'task' ? `kanban:task:${part.id}` : `session:${part.id}`}
              </span>
            ),
          )}
          {value.endsWith('\n') ? '\u200b' : null}
        </div>
      </div>
    )
  },
)
