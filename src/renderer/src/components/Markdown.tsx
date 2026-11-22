import { createContext, useContext, isValidElement, useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { highlightCode } from '../lib/highlight'
import { shikiLanguage } from '../lib/tool-blocks'
import { useSessionsStore } from '../stores/sessions'

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

function CodeBlock({ code, language }: { code: string; language: string | null }): React.JSX.Element {
  const theme = useSessionsStore((s) => s.settings?.theme ?? 'dark')
  const [html, setHtml] = useState<string | null>(null)

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

  if (html !== null) {
    return <div className="code-block" dangerouslySetInnerHTML={{ __html: html }} />
  }
  return (
    <pre className="code-block plain">
      <code>{code}</code>
    </pre>
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
