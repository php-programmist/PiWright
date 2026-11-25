/** Ctrl+Tab — переключатель вкладок всех проектов (как в PHPStorm): удержание Ctrl
 *  показывает модалку со списком открытых вкладок в MRU-порядке, Tab/Shift+Tab листает,
 *  отпускание Ctrl переключает вкладку, Escape отменяет. */
import { useEffect, useRef, useState } from 'react'
import { projectKey, useSessionsStore } from '../stores/sessions'
import { mruAlive, mruIdent, parentTabKey, tabId, useTabsStore, type MruEntry, type ProjectTab } from '../stores/tabs'
import { useT } from '../lib/i18n'
import { baseName } from '../views/git/GitPanel'
import { TAB_ICONS } from './TabBar'

interface SwitcherItem {
  entry: MruEntry
  icon: React.JSX.Element
  title: string
  projectName: string
}

type T = (key: string, params?: Record<string, string | number>) => string

const SESSION_ICON = (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6a1.5 1.5 0 0 1-1.5 1.5H8.4L5 13.6V11H3.5A1.5 1.5 0 0 1 2 9.5v-6Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
  </svg>
)

function dirName(dir: string): string {
  const parts = dir.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || dir
}

function tabTitle(tab: ProjectTab, t: T): string {
  if (tab.kind === 'file' || tab.kind === 'diff') return baseName(tab.path ?? '')
  if (tab.kind === 'transcript') return tab.title ?? baseName(tab.path ?? '')
  if (tab.kind === 'kanban') return tab.title ?? t('Kanban')
  if (tab.kind === 'task') return tab.title ?? t('Task')
  return tab.kind === 'mcp' ? t('MCP servers') : t('Skills')
}

function projectName(key: string): string {
  const st = useSessionsStore.getState()
  const proj = st.projects.find((p) => projectKey(p.project) === key)?.project
  if (proj !== undefined) return proj.name ?? dirName(proj.dir)
  return dirName(key.split('\u0000')[1] ?? key)
}

/** Все открытые вкладки всех проектов: сначала MRU, затем остальные (сессии, потом вкладки). */
function buildItems(t: T): SwitcherItem[] {
  const st = useSessionsStore.getState()
  const ts = useTabsStore.getState()
  const items: SwitcherItem[] = []
  const seen = new Set<string>()
  const push = (entry: MruEntry, icon: React.JSX.Element, title: string): void => {
    const id = mruIdent(entry)
    if (seen.has(id) || !mruAlive(entry)) return
    seen.add(id)
    items.push({ entry, icon, title, projectName: projectName(entry.key) })
  }
  for (const e of ts.mru) {
    if (e.kind === 'session') {
      const row = st.active.find((r) => r.hostId === e.hostId)
      if (row !== undefined) push(e, SESSION_ICON, row.title)
    } else {
      const tab = ts.byProject[e.key]?.tabs.find((x) => tabId(x) === e.id)
      if (tab !== undefined) push(e, TAB_ICONS[tab.kind], tabTitle(tab, t))
    }
  }
  for (const row of st.active) {
    push({ kind: 'session', hostId: row.hostId, key: parentTabKey(row.project) }, SESSION_ICON, row.title)
  }
  for (const [key, entry] of Object.entries(ts.byProject)) {
    for (const tab of entry.tabs) push({ kind: 'tab', key, id: tabId(tab) }, TAB_ICONS[tab.kind], tabTitle(tab, t))
  }
  return items
}

export function TabSwitcherHost(): React.JSX.Element | null {
  const t = useT()
  const [items, setItems] = useState<SwitcherItem[]>([])
  const [index, setIndex] = useState(0)
  const openRef = useRef(false)
  const itemsRef = useRef<SwitcherItem[]>([])
  const indexRef = useRef(0)
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const activeIdent = (): string | null => {
      const st = useSessionsStore.getState()
      const ts = useTabsStore.getState()
      const row = st.active.find((r) => r.hostId === st.activeHostId)
      const key = ts.activeProjectKey
      if (row !== undefined && key === parentTabKey(row.project) && (ts.byProject[key]?.activeId ?? null) === null) {
        return `s:${row.hostId}`
      }
      const aid = key !== null ? (ts.byProject[key]?.activeId ?? null) : null
      return aid !== null ? `t:${key}:${aid}` : null
    }

    const hide = (): void => {
      openRef.current = false
      itemsRef.current = []
      setItems([])
    }

    const commit = (): void => {
      if (!openRef.current) return
      const item = itemsRef.current[indexRef.current]
      hide()
      if (item !== undefined) useTabsStore.getState().activateMru(item.entry)
    }

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.ctrlKey && !e.altKey && !e.metaKey && e.key === 'Tab') {
        e.preventDefault()
        if (!openRef.current) {
          const built = buildItems(t)
          if (built.length === 0) return
          openRef.current = true
          itemsRef.current = built
          const ai = built.findIndex((i) => mruIdent(i.entry) === activeIdent())
          const start = ai >= 0 ? (ai + 1) % built.length : 0
          indexRef.current = start
          setItems(built)
          setIndex(start)
        } else {
          const count = itemsRef.current.length
          if (count === 0) return
          const next = (indexRef.current + (e.shiftKey ? -1 : 1) + count) % count
          indexRef.current = next
          setIndex(next)
        }
        return
      }
      if (openRef.current && e.key === 'Escape') {
        e.preventDefault()
        hide()
      }
    }

    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === 'Control') commit()
    }
    const onBlur = (): void => commit()

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [t])

  useEffect(() => {
    if (items.length === 0) return
    const el = listRef.current?.querySelectorAll('.tab-switcher-item')[index]
    el?.scrollIntoView({ block: 'nearest' })
  }, [index, items])

  if (items.length === 0) return null

  return (
    <div className="files-rename-overlay tab-switcher-overlay">
      <div className="tab-switcher-box">
        <div className="tab-switcher-list" ref={listRef}>
          {items.map((item, i) => (
            <div
              key={mruIdent(item.entry)}
              className={`tab-switcher-item${i === index ? ' selected' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                openRef.current = false
                itemsRef.current = []
                setItems([])
                useTabsStore.getState().activateMru(item.entry)
              }}
            >
              <span className="tab-switcher-icon">{item.icon}</span>
              <span className="tab-switcher-title">{item.title}</span>
              <span className="tab-switcher-project">{item.projectName}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
