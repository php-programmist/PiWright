/** Терминальный док — горизонтальная область внизу экрана (референс PHPStudio/PHPStorm):
 *  теснит чат и правые панели, проекты и вертикальный тулбар не трогает. */
import { useEffect, useMemo, useRef, useState } from 'react'
import '@xterm/xterm/css/xterm.css'
import { useTerminalStore } from '../../stores/terminal'
import { useSessionsStore } from '../../stores/sessions'
import { persistPanel } from '../../stores/panels-prefs'
import { useT } from '../../lib/i18n'
import { attach, detach, fit } from './term-registry'
import type { TerminalProfileId } from '../../../../shared/ipc-contracts'

function TermMount({ id }: { id: string }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el === null) return
    attach(id, el)
    const observer = new ResizeObserver(() => fit(id))
    observer.observe(el)
    return () => {
      observer.disconnect()
      detach(id)
    }
  }, [id])
  return <div className="term-mount" ref={ref} />
}

function TerminalError(): React.JSX.Element | null {
  const error = useTerminalStore((s) => s.error)
  const setError = useTerminalStore((s) => s.setError)
  if (error === null) return null
  return (
    <div className="files-error">
      <span>{error}</span>
      <button className="icon" onClick={() => setError(null)}>×</button>
    </div>
  )
}

export function TerminalPanel(): React.JSX.Element {
  const activeHostId = useSessionsStore((s) => s.activeHostId)
  const active = useSessionsStore((s) => s.active)
  const project = useMemo(() => active.find((r) => r.hostId === activeHostId)?.project ?? null, [active, activeHostId])
  const height = useTerminalStore((s) => s.height)
  const setHeight = useTerminalStore((s) => s.setHeight)
  const projectKey = useTerminalStore((s) => s.projectKey)
  const current = useTerminalStore((s) => (s.projectKey !== null ? s.projects[s.projectKey] : undefined))
  const terms = useTerminalStore((s) => s.terms)
  const profiles = useTerminalStore((s) => s.profiles)
  const defaultProfileId = useTerminalStore((s) => s.defaultProfileId)
  const spawn = useTerminalStore((s) => s.spawn)
  const closeTab = useTerminalStore((s) => s.close)
  const activate = useTerminalStore((s) => s.activate)
  const rename = useTerminalStore((s) => s.rename)
  const t = useT()
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [profileMenu, setProfileMenu] = useState<{ x: number; y: number } | null>(null)
  const profileMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (profileMenu === null) return
    const onDown = (e: MouseEvent): void => {
      if (profileMenuRef.current !== null && !profileMenuRef.current.contains(e.target as Node)) setProfileMenu(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setProfileMenu(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [profileMenu])

  const startRename = (id: string, current: string): void => {
    setRenamingId(id)
    setRenameText(current)
  }
  const submitRename = (): void => {
    if (renamingId !== null) rename(renamingId, renameText)
    setRenamingId(null)
  }

  useEffect(() => {
    useTerminalStore.getState().setProject(project)
  }, [project])

  const startResize = (down: React.MouseEvent): void => {
    down.preventDefault()
    const move = (e: MouseEvent): void => setHeight(window.innerHeight - e.clientY)
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      persistPanel('terminal', { height: useTerminalStore.getState().height })
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'row-resize'
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const ids = useMemo(() => current?.ids ?? [], [current])
  const activeId = current?.activeId ?? null
  const tabLabels = useMemo(() => {
    const counters = new Map<string, number>()
    return ids.map((id) => {
      const tab = terms[id]
      if (tab === undefined) return id
      if (tab.customLabel !== undefined) return tab.customLabel
      const n = counters.get(tab.profileId) ?? 0
      counters.set(tab.profileId, n + 1)
      return n === 0 ? tab.label : `${tab.label} ${n + 1}`
    })
  }, [ids, terms])

  if (project === null) {
    return (
      <aside className="terminal-dock" style={{ height }}>
        <div className="terminal-resizer" onMouseDown={startResize} />
        <div className="panel-hint">{t('Pick a session to open a terminal')}</div>
      </aside>
    )
  }

  return (
    <aside className="terminal-dock" style={{ height }}>
      <div className="terminal-resizer" onMouseDown={startResize} />
      <div className="terminal-head">
        {ids.map((id, index) => {
          const tab = terms[id]
          return (
            <div
              key={id}
              className={`term-tab${id === activeId ? ' active' : ''}${tab?.dead === true ? ' dead' : ''}`}
              onClick={() => activate(id)}
            >
              {renamingId === id ? (
                <input
                  className="term-rename"
                  value={renameText}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitRename()
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                  onChange={(e) => setRenameText(e.target.value)}
                  onBlur={submitRename}
                />
              ) : (
                <span
                  className="term-tab-name"
                  title={t('Rename terminal')}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    startRename(id, tabLabels[index])
                  }}
                >
                  {tabLabels[index]}
                </span>
              )}
              <button
                className="icon term-close"
                title={t('Close terminal')}
                onClick={(e) => {
                  e.stopPropagation()
                  void closeTab(id)
                }}
              >
                ×
              </button>
            </div>
          )
        })}
        <button className="term-new" title={t('New terminal (default profile)')} onClick={() => void spawn(project)}>
          +
        </button>
        <button
          className="term-new term-profile-arrow"
          title={t('Profile for new terminal')}
          disabled={profiles.length === 0}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            setProfileMenu((prev) => (prev !== null ? null : { x: rect.left, y: rect.bottom + 4 }))
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="spacer" />
        <button
          className="term-new term-collapse"
          title={t('Collapse terminal')}
          onClick={() => {
            useTerminalStore.getState().toggleOpen()
            persistPanel('terminal', { open: false })
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <line x1="1.5" y1="5" x2="8.5" y2="5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {profileMenu !== null && (
        <div className="tab-menu" style={{ left: profileMenu.x, top: profileMenu.y }} ref={profileMenuRef}>
          {profiles.map((p) => (
            <button
              key={p.id}
              className={`tab-menu-item${p.id === defaultProfileId ? ' current' : ''}`}
              onClick={() => {
                setProfileMenu(null)
                void spawn(project, p.id as TerminalProfileId)
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
      <TerminalError />
      <div className="term-body">
        {activeId !== null && projectKey !== null && <TermMount key={activeId} id={activeId} />}
        {activeId === null && <div className="panel-hint">{t('No terminals — press + or pick a profile')}</div>}
      </div>
    </aside>
  )
}
