import { createContext, useContext, isValidElement, useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { highlightCode } from '../lib/highlight'
import { shikiLanguage } from '../lib/tool-blocks'
import { useSessionsStore } from '../stores/sessions'
import { useFilesStore } from '../stores/files'
import { useTabsStore } from '../stores/tabs'
import { resolveChatLink, resolveMarkdownImage } from '../../../shared/file-paths'
import type { ProjectEntry } from '../../../shared/ipc-contracts'
import { useT } from '../lib/i18n'
import { Lightbox } from './Lightbox'

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

/** Готовый html подсветки: remount CodeBlock (правка блока, возврат на вкладку)
 *  восстанавливает его мгновенно, без вспышки plain до ответа Shiki. */
const codeHtmlCache = new Map<string, string>()
const CODE_HTML_CACHE_MAX = 300

function CodeBlock({ code, language }: { code: string; language: string | null }): React.JSX.Element {
  const theme = useSessionsStore((s) => s.settings?.theme ?? 'dark')
  const t = useT()
  const [html, setHtml] = useState<string | null>(
    () => codeHtmlCache.get(`${theme}\u0000${language ?? ''}\u0000${code}`) ?? null
  )
  const [copied, setCopied] = useState(false)

  const copy = (): void => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  useEffect(() => {
    let cancelled = false
    const cacheKey = `${theme}\u0000${language ?? ''}\u0000${code}`
    highlightCode(code, shikiLanguage(language), theme)
      .then((result) => {
        if (cancelled) return
        if (result !== null) {
          if (codeHtmlCache.size >= CODE_HTML_CACHE_MAX) codeHtmlCache.clear()
          codeHtmlCache.set(cacheKey, result)
        }
        setHtml(result)
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

/** Env markdown-рендера через контекст: типы компонентов react-markdown обязаны быть
 *  модульными константами — новая функция в components при каждом рендере remountит
 *  поддерево, CodeBlock теряет готовый html и блок мигает plain→highlighted. */
interface MarkdownEnv {
  project?: ProjectEntry | null
  imageBase?: string
  onToggleCheckbox?: (line: number) => void
}
const MarkdownEnvContext = createContext<MarkdownEnv>({})

interface HastNodeProp {
  node?: {
    position?: { start?: { line?: number } }
    properties?: Record<string, unknown>
  }
}

/** Чекбокс GFM-задачи: отдельный компонент, чтобы useContext звать в теле компонента, а не в render-prop. */
function TaskCheckbox({
  checked,
  ...rest
}: React.JSX.IntrinsicElements['input'] & HastNodeProp): React.JSX.Element {
  const line = useContext(CheckboxLineContext)
  const onToggleCheckbox = useContext(MarkdownEnvContext).onToggleCheckbox
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

/** Ссылка в markdown: файл проекта — вкладка файла, http(s)/mailto — системный браузер,
 *  остальное — мёртвая ссылка без href. */
function MdLink({ href, children }: { href?: string; children?: React.ReactNode }): React.JSX.Element {
  const activeHostId = useSessionsStore((s) => s.activeHostId)
  const project = useSessionsStore((s) => s.active.find((r) => r.hostId === activeHostId)?.project ?? null)
  const target = href !== undefined && project !== null ? resolveChatLink(project.dir, href) : null
  const onClick = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if (target === null || project === null) return
    if (target.kind === 'external') {
      void window.piwright.shellOpenExternal(target.url)
      return
    }
    useTabsStore.getState().openTab(project, { kind: 'file', path: target.path })
    void useFilesStore.getState().openFile(project, target.path)
  }
  if (target === null) return <span className="md-link dead">{children}</span>
  return (
    <a href={href} title={target.kind === 'file' ? target.path : undefined} onClick={onClick}>
      {children}
    </a>
  )
}

/** Кэш data URL картинок из markdown: ключ kind\0dir\0path. */
const mdImageCache = new Map<string, string>()

interface MdImageProps extends HastNodeProp {
  src?: string
  alt?: string
  title?: string
}

/** Картинка в markdown: путь файла проекта (относительный — от каталога md-файла)
 *  грузится через filesReadImage как data URL; data:/http(s) — как есть.
 *  Клик — просмотр в Lightbox. */
function MdImage({ src, alt, title }: MdImageProps): React.JSX.Element {
  const env = useContext(MarkdownEnvContext)
  const activeHostId = useSessionsStore((s) => s.activeHostId)
  const storeProject = useSessionsStore((s) => s.active.find((r) => r.hostId === activeHostId)?.project ?? null)
  const project = env.project !== undefined ? env.project : storeProject
  const imageBase = env.imageBase ?? ''
  const resolved = src !== undefined && project !== null ? resolveMarkdownImage(project.dir, imageBase, src) : null
  const cacheKey = resolved !== null && project !== null ? `${project.kind}\u0000${project.dir}\u0000${resolved}` : null
  const [state, setState] = useState<{ status: 'loading' | 'ok' | 'error'; url: string }>(() =>
    cacheKey !== null && mdImageCache.has(cacheKey)
      ? { status: 'ok', url: mdImageCache.get(cacheKey) ?? '' }
      : { status: 'loading', url: '' }
  )
  const [zoom, setZoom] = useState(false)

  useEffect(() => {
    if (cacheKey === null || project === null || resolved === null || mdImageCache.has(cacheKey)) return
    let cancelled = false
    void window.piwright.filesReadImage(project, resolved).then((result) => {
      if (cancelled) return
      if (result.ok) {
        mdImageCache.set(cacheKey, result.dataUrl)
        setState({ status: 'ok', url: result.dataUrl })
      } else {
        setState({ status: 'error', url: '' })
      }
    })
    return () => {
      cancelled = true
    }
  }, [cacheKey, project, resolved])

  if (resolved === null) return <img src={src} alt={alt ?? ''} title={title} draggable={false} />
  if (state.status !== 'ok') {
    return (
      <span className={`md-image ${state.status === 'loading' ? 'pending' : 'dead'}`} title={resolved}>
        {alt ?? ''}
      </span>
    )
  }
  return (
    <>
      <img
        className="md-image"
        src={state.url}
        alt={alt ?? ''}
        title={title ?? resolved}
        draggable={false}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setZoom(true)
        }}
      />
      {zoom && <Lightbox src={state.url} alt={alt ?? ''} onClose={() => setZoom(false)} />}
    </>
  )
}

function MdPre({ children }: { children?: React.ReactNode }): React.JSX.Element {
  const extracted = extractCode(children)
  if (extracted !== null) {
    return <CodeBlock key={`${extracted.language}:${extracted.code}`} code={extracted.code} language={extracted.language} />
  }
  return <pre>{children}</pre>
}

function MdLi({ node, children, ...rest }: React.JSX.IntrinsicElements['li'] & HastNodeProp): React.JSX.Element {
  const className = node?.properties?.className
  const isTask = Array.isArray(className) && className.includes('task-list-item')
  const line = node?.position?.start?.line
  if (!isTask || typeof line !== 'number') return <li {...rest}>{children}</li>
  return (
    <li {...rest}>
      <CheckboxLineContext.Provider value={line}>{children}</CheckboxLineContext.Provider>
    </li>
  )
}

function MdInput(props: React.JSX.IntrinsicElements['input'] & HastNodeProp): React.JSX.Element {
  return <TaskCheckbox {...props} />
}

const MD_PLUGINS = [remarkGfm]
const MD_COMPONENTS = {
  pre: MdPre,
  li: MdLi,
  input: MdInput,
  a: MdLink,
  img: MdImage
}

/** Markdown ассистента: GFM, fenced-блоки — через Shiki. */
export function Markdown({
  text,
  onToggleCheckbox,
  project,
  imageBase = ''
}: MarkdownProps & { project?: ProjectEntry | null; imageBase?: string }): React.JSX.Element {
  return (
    <div className="markdown">
      <MarkdownEnvContext.Provider value={{ project, imageBase, onToggleCheckbox }}>
        <ReactMarkdown remarkPlugins={MD_PLUGINS} components={MD_COMPONENTS}>{text}</ReactMarkdown>
      </MarkdownEnvContext.Provider>
    </div>
  )
}
