import { useEffect, useRef, useState } from 'react'
import { useSessionsStore } from '../../stores/sessions'
import type { Settings, Theme } from '../../../../shared/ipc-contracts'

const AUTOSAVE_DEBOUNCE_MS = 500

const CHAT_FONT_SIZES = [12, 13, 14, 16, 18]

type Tab = 'general' | 'appearance' | 'models'

const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
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
                <h3>Launch</h3>
                <label>
                  extra pi args
                  <input
                    value={draft.piExtraArgs}
                    placeholder="--no-extensions -e C:\path\to\ext"
                    onChange={(e) => update({ piExtraArgs: e.target.value })}
                  />
                </label>
                <label>
                  update feed URL
                  <input
                    value={draft.updateUrl}
                    placeholder="https://server/updates/ (empty = off)"
                    onChange={(e) => update({ updateUrl: e.target.value })}
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
          {tab === 'appearance' && (
            <>
              <section className="settings-section">
                <h3>Chat toolbar</h3>
                <label>
                  model / thinking selectors and Stop button
                  <select
                    value={draft.selectorPlacement}
                    onChange={(e) => update({ selectorPlacement: e.target.value as 'top' | 'bottom' })}
                  >
                    <option value="top">top — in the chat header</option>
                    <option value="bottom">bottom — above the message input</option>
                  </select>
                </label>
              </section>
              <section className="settings-section">
                <h3>Theme</h3>
                <label>
                  color theme
                  <select value={draft.theme} onChange={(e) => update({ theme: e.target.value as Theme })}>
                    <option value="dark">dark</option>
                    <option value="light">light</option>
                  </select>
                </label>
                <label>
                  chat font size
                  <select
                    value={String(draft.chatFontSize)}
                    onChange={(e) => update({ chatFontSize: Number(e.target.value) })}
                  >
                    {CHAT_FONT_SIZES.map((size) => (
                      <option key={size} value={String(size)}>
                        {size} px
                      </option>
                    ))}
                  </select>
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
