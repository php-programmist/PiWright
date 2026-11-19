import { useEffect, useRef, useState } from 'react'
import { useSessionsStore } from '../../stores/sessions'
import type { Settings } from '../../../../shared/ipc-contracts'

const AUTOSAVE_DEBOUNCE_MS = 500

type Tab = 'general' | 'models'

const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'models', label: 'Models' }
]

export function SettingsView(): React.JSX.Element {
  const settings = useSessionsStore((s) => s.settings)
  const closeSettings = useSessionsStore((s) => s.closeSettings)

  if (settings === null) {
    return (
      <div className="settings-screen">
        <header className="settings-head">
          <span>Settings</span>
          <span className="spacer" />
          <button className="icon" title="Close settings" onClick={closeSettings}>×</button>
        </header>
        <div className="settings-body">
          <div className="panel-hint">loading…</div>
        </div>
      </div>
    )
  }
  return <SettingsForm settings={settings} onClose={closeSettings} />
}

function SettingsForm({ settings, onClose }: { settings: Settings; onClose: () => void }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('general')
  const [draft, setDraft] = useState<Settings>(settings)
  const [saved, setSaved] = useState(false)
  const dirtyRef = useRef(false)

  useEffect(() => {
    if (!dirtyRef.current) return
    const timer = setTimeout(async () => {
      dirtyRef.current = false
      const next = await window.piwright.setSettings(draft)
      useSessionsStore.getState().setSettings(next)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    }, AUTOSAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [draft])

  const update = (patch: Partial<Settings>): void => {
    dirtyRef.current = true
    setDraft({ ...draft, ...patch })
  }

  return (
    <div className="settings-screen">
      <header className="settings-head">
        <span>Settings</span>
        {saved && <span className="saved">saved</span>}
        <span className="spacer" />
        <button className="icon" title="Close settings" onClick={onClose}>×</button>
      </header>
      <div className="settings-body">
        <nav className="settings-nav">
          {TABS.map((t) => (
            <button key={t.id} className={t.id === tab ? 'current' : ''} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {tab === 'general' && (
            <>
              <section className="settings-section">
                <h3>Windows</h3>
                <label>
                  pi path
                  <input
                    value={draft.piPathNative}
                    placeholder="auto (%USERPROFILE%\.pi\agent\bin\pi.cmd)"
                    onChange={(e) => update({ piPathNative: e.target.value })}
                  />
                </label>
              </section>
              <section className="settings-section">
                <h3>WSL</h3>
                <label>
                  distro
                  <input
                    value={draft.wslDistro}
                    placeholder="auto (first distro)"
                    onChange={(e) => update({ wslDistro: e.target.value })}
                  />
                </label>
                <label>
                  pi path
                  <input
                    value={draft.piPathWsl}
                    placeholder="auto (command -v pi)"
                    onChange={(e) => update({ piPathWsl: e.target.value })}
                  />
                </label>
              </section>
            </>
          )}
          {tab === 'models' && <div className="panel-hint">Model management will appear later.</div>}
        </div>
      </div>
    </div>
  )
}
