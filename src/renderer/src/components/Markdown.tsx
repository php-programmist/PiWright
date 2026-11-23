import { createContext, useContext, isValidElement, useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { highlightCode } from '../lib/highlight'
import { shikiLanguage } from '../lib/tool-blocks'
import { useSessionsStore } from '../stores/sessions'
import { useT } from '../lib/i18n'

interface CodeElementProps {
  className?: string
  children?: unknown
}

function extractCode(children: unknown): { code: string; language: string | null } | null {
  if (!isValidElement(children)) return null
  const props = children.props as CodeElementProps
  const className = typeof props.className === 'string' ? props.className : ''
  const language = /language-(\S+)/.exec(className)?.[1] ?? null
  const code = String(props.children ?? '').replace(/\n$/, '')
  return { code, language }
}

function CopyIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5v-2a1.5 1.5 0 0 0-1.5-1.5H4.5A1.5 1.5 0 0 0 3 3.5v5A1.5 1.5 0 0 0 4.5 10h1" />
    </svg>
  )
}

function CheckIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  )
}

function CodeBlock({ code, language }: { code: string; language: string | null }): React.JSX.Element {
  const theme = useSessionsStore((s) => s.settings?.theme ?? 'dark')
  const t = useT()
  const [html, setHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const copy = (): void => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  useEffect(() => {
    let cancelled = false
    highlightCode(code, shikiLanguage(language), theme)
      .then((result) => {
        if (!cancelled) setHtml(result)
      })
    return () => {
      cancelled = true
    }
  }, [code, language, theme])

  const button = (
    <button
      type="button"
      className="code-copy-btn"
      title={copied ? t('Copied') : t('Copy')}
      onClick={copy}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  )

  if (html !== null) {
    return (
      <div className="code-block-wrap">
        <div className="code-block" dangerouslySetInnerHTML={{ __html: html }} />
        {button}
      </div>
    )
  }
  return (
    <div className="code-block-wrap">
      <pre className="code-block plain">
        <code>{code}</code>
      </pre>
      {button}
    </div>
  )
}

interface MarkdownProps {
  text: string
  /** line — 1-based номер строки в text с чекбоксом. */
  onToggleCheckbox?: (line: number) => void
}

/** У input-ноды GFM нет position, строку берём из li.task-list-item. */
const CheckboxLineContext = createContext<number | undefined>(undefined)

interface HastNodeProp {
  node?: {
    position?: { start?: { line?: number } }
    properties?: Record<string, unknown>
  }
}

/** Чекбокс GFM-задачи: отдельный компонент, чтобы useContext звать в теле компонента, а не в render-prop. */
function TaskCheckbox({
  checked,
  onToggleCheckbox,
  ...rest
}: React.JSX.IntrinsicElements['input'] & HastNodeProp & { onToggleCheckbox?: (line: number) => void }): React.JSX.Element {
  const line = useContext(CheckboxLineContext)
  const canToggle = onToggleCheckbox !== undefined && typeof line === 'number'
  return (
    <input
      {...rest}
      type="checkbox"
      checked={checked ?? false}
      readOnly
      disabled={!canToggle}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (canToggle && typeof line === 'number') onToggleCheckbox(line)
      }}
    />
  )
}

/** Markdown ассистента: GFM, fenced-блоки — через Shiki. */
export function Markdown({ text, onToggleCheckbox }: MarkdownProps): React.JSX.Element {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => {
            const extracted = extractCode(children)
            if (extracted !== null) {
              return <CodeBlock key={`${extracted.language}:${extracted.code}`} code={extracted.code} language={extracted.language} />
            }
            return <pre>{children}</pre>
          },
          li: ({ node, children, ...rest }: React.JSX.IntrinsicElements['li'] & HastNodeProp) => {
            const className = node?.properties?.className
            const isTask = Array.isArray(className) && className.includes('task-list-item')
            const line = node?.position?.start?.line
            if (!isTask || typeof line !== 'number') return <li {...rest}>{children}</li>
            return (
              <li {...rest}>
                <CheckboxLineContext.Provider value={line}>{children}</CheckboxLineContext.Provider>
              </li>
            )
          },
          input: (props: React.JSX.IntrinsicElements['input'] & HastNodeProp) => (
            <TaskCheckbox {...props} onToggleCheckbox={onToggleCheckbox} />
          )
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
