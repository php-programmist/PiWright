/** Панель терминалов проекта (справа, паттерн FilesPanel): вкладки, выбор профиля, спавн. */
import { useEffect, useMemo, useRef } from 'react'
import '@xterm/xterm/css/xterm.css'
import { useTerminalStore } from '../../stores/terminal'
import { useSessionsStore } from '../../stores/sessions'
import { persistPanel } from '../../stores/panels-prefs'
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
  const width = useTerminalStore((s) => s.width)
  const setWidth = useTerminalStore((s) => s.setWidth)
  const projectKey = useTerminalStore((s) => s.projectKey)
  const current = useTerminalStore((s) => (s.projectKey !== null ? s.projects[s.projectKey] : undefined))
  const terms = useTerminalStore((s) => s.terms)
  const profiles = useTerminalStore((s) => s.profiles)
  const defaultProfileId = useTerminalStore((s) => s.defaultProfileId)
  const spawn = useTerminalStore((s) => s.spawn)
  const closeTab = useTerminalStore((s) => s.close)
  const activate = useTerminalStore((s) => s.activate)

  useEffect(() => {
    useTerminalStore.getState().setProject(project)
  }, [project])

  const startResize = (down: React.MouseEvent): void => {
    down.preventDefault()
    const move = (e: MouseEvent): void => setWidth(window.innerWidth - e.clientX)
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      persistPanel('terminal', { width: useTerminalStore.getState().width })
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
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
      const n = counters.get(tab.profileId) ?? 0
      counters.set(tab.profileId, n + 1)
      return n === 0 ? tab.label : `${tab.label} ${n + 1}`
    })
  }, [ids, terms])

  if (project === null) {
    return (
      <aside className="terminal-panel" style={{ width }}>
        <div className="terminal-resizer" onMouseDown={startResize} />
        <div className="panel-hint">Pick a session to open a terminal</div>
      </aside>
    )
  }

  return (
    <aside className="terminal-panel" style={{ width }}>
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
              <span className="term-tab-name">{tabLabels[index]}</span>
              <button
                className="icon term-close"
                title="Close terminal"
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
        <button className="term-new" title="New terminal (default profile)" onClick={() => void spawn(project)}>
          +
        </button>
        <span className="spacer" />
        <select
          className="term-profile-select"
          title="Profile for new terminal"
          value={defaultProfileId ?? ''}
          disabled={profiles.length === 0}
          onChange={(e) => void spawn(project, e.target.value as TerminalProfileId)}
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <TerminalError />
      <div className="term-body">
        {activeId !== null && projectKey !== null && <TermMount key={activeId} id={activeId} />}
        {activeId === null && <div className="panel-hint">No terminals — press + or pick a profile</div>}
      </div>
    </aside>
  )
}
