import { isValidElement, useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { highlightCode } from '../lib/highlight'
import { shikiLanguage } from '../lib/tool-blocks'

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
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    highlightCode(code, shikiLanguage(language))
      .then((result) => {
        if (!cancelled) setHtml(result)
      })
    return () => {
      cancelled = true
    }
  }, [code, language])

  if (html !== null) {
    return <div className="code-block" dangerouslySetInnerHTML={{ __html: html }} />
  }
  return (
    <pre className="code-block plain">
      <code>{code}</code>
    </pre>
  )
}

/** Markdown ассистента: GFM, fenced-блоки — через Shiki. */
export function Markdown({ text }: { text: string }): React.JSX.Element {
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
          }
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
