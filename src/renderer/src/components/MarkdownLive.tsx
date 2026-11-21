/** Markdown live-preview в стиле Obsidian (фича 29): блоки рендерятся, клик по блоку
 *  открывает его исходник в textarea, уход фокуса/Escape/Ctrl+S — запись в файл. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ProjectEntry } from '../../../shared/ipc-contracts'
import { joinMarkdownDoc, splitMarkdownDoc } from '../../../shared/markdown-blocks'
import { continueListItem } from '../../../shared/markdown-enter'
import { useFilesStore } from '../stores/files'
import { Markdown } from './Markdown'

interface MarkdownLiveProps {
  project: ProjectEntry
  path: string
  content: string
  wordWrap: boolean
}

export function MarkdownLive({ project, path, content, wordWrap }: MarkdownLiveProps): React.JSX.Element {
  const doc = useMemo(() => splitMarkdownDoc(content), [content])
  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const activeRef = useRef<number | null>(null)
  const draftRef = useRef('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const caretRef = useRef<number | null>(null)
  const saveContent = useFilesStore((s) => s.saveContent)

  useLayoutEffect(() => {
    const pos = caretRef.current
    if (pos === null) return
    caretRef.current = null
    textareaRef.current?.setSelectionRange(pos, pos)
  }, [draft])

  useEffect(() => {
    activeRef.current = activeIdx
  }, [activeIdx])
  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  const commit = (): void => {
    const idx = activeRef.current
    if (idx === null) return
    activeRef.current = null
    setActiveIdx(null)
    const next = draftRef.current
    if (next === doc.blocks[idx]) return
    const blocks = doc.blocks.slice()
    blocks[idx] = next
    const text = joinMarkdownDoc({ ...doc, blocks })
    if (text !== content) void saveContent(project, path, text)
  }

  const startEdit = (i: number): void => {
    setDraft(doc.blocks[i])
    setActiveIdx(i)
  }

  return (
    <div
      className={`md-live${wordWrap ? ' wrap' : ''}`}
      onMouseDown={() => {
        if (activeRef.current !== null) commit()
      }}
    >
      {doc.frontMatter !== null && <pre className="md-frontmatter">{doc.frontMatter.replace(/\n+$/, '')}</pre>}
      {doc.blocks.map((block, i) =>
        i === activeIdx ? (
          <textarea
            key={i}
            ref={textareaRef}
            className="md-edit"
            value={draft}
            autoFocus
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                commit()
              } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault()
                commit()
              } else if (
                e.key === 'Enter' &&
                !e.shiftKey &&
                !e.altKey &&
                !e.ctrlKey &&
                !e.metaKey &&
                !e.nativeEvent.isComposing
              ) {
                const el = e.currentTarget
                const next = continueListItem(draft, el.selectionStart ?? 0, el.selectionEnd ?? 0)
                if (next === null) return
                e.preventDefault()
                caretRef.current = next.caret
                setDraft(next.text)
              }
            }}
          />
        ) : (
          <div
            key={i}
            className="md-block"
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (activeRef.current !== null) commit()
              startEdit(i)
            }}
          >
            <Markdown text={block.replace(/\s+$/, '')} />
          </div>
        )
      )}
    </div>
  )
}
