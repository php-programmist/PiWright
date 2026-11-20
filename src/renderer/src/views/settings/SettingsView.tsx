import { useEffect, useRef, useState } from 'react'
import { ModelsTab } from './ModelsTab'
import { useSessionsStore } from '../../stores/sessions'
import type { NotificationSounds, Settings, Theme } from '../../../../shared/ipc-contracts'

const AUTOSAVE_DEBOUNCE_MS = 500

const CHAT_FONT_SIZES = [12, 13, 14, 16, 18]

type Tab = 'general' | 'appearance' | 'notifications' | 'models'

const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'notifications', label: 'Notifications' },
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
              <section className="settings-section">
                <h3>Tool blocks</h3>
                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={draft.singleLineTools}
                    onChange={(e) => update({ singleLineTools: e.target.checked })}
                  />
                  single-line tool blocks (command in one line, full command and output when expanded)
                </label>
              </section>
            </>
          )}
          {tab === 'notifications' && <NotificationsTab draft={draft} update={update} />}
          {tab === 'models' && <ModelsTab />}
        </div>
      </div>
    </div>
  )
}

const SOUND_FIELDS: { key: keyof NotificationSounds; label: string }[] = [
  { key: 'completion', label: 'turn completed' },
  { key: 'await', label: 'pi asks a question' },
  { key: 'error', label: 'error' }
]

function NotificationsTab({
  draft,
  update
}: {
  draft: Settings
  update: (patch: Partial<Settings>) => void
}): React.JSX.Element {
  const [tokenConfigured, setTokenConfigured] = useState(false)
  const [tokenInput, setTokenInput] = useState('')
  const [testResult, setTestResult] = useState<string | null>(null)
  const [remote, setRemote] = useState<Awaited<ReturnType<typeof window.piwright.remoteStatus>> | null>(null)

  useEffect(() => {
    void window.piwright.telegramTokenStatus().then((s) => setTokenConfigured(s.configured))
    void window.piwright.remoteStatus().then(setRemote)
  }, [])

  const sounds = draft.notifications.sounds
  const telegram = draft.notifications.telegram
  const remotePrefs = draft.notifications.remote

  const updateSounds = (patch: Partial<NotificationSounds>): void =>
    update({ notifications: { ...draft.notifications, sounds: { ...sounds, ...patch } } })
  const updateTelegram = (patch: Partial<typeof telegram>): void =>
    update({ notifications: { ...draft.notifications, telegram: { ...telegram, ...patch } } })
  const updateRemote = (patch: Partial<typeof remotePrefs>): void =>
    update({ notifications: { ...draft.notifications, remote: { ...remotePrefs, ...patch } } })

  const browseSound = async (key: keyof NotificationSounds): Promise<void> => {
    const res = await window.piwright.soundsChoose()
    if (res.ok && res.path.length > 0) updateSounds({ [key]: res.path })
  }

  const saveToken = async (): Promise<void> => {
    const res = await window.piwright.setTelegramToken(tokenInput)
    if (res.ok) {
      setTokenInput('')
      setTokenConfigured(tokenInput.trim().length === 0 ? false : true)
    }
  }

  const sendTest = async (): Promise<void> => {
    setTestResult('…')
    const res = await window.piwright.telegramTest(telegram.chatId, tokenInput)
    setTestResult(res.error ?? 'sent')
    if (res.error === null) setTokenConfigured(true)
  }

  return (
    <>
      <section className="settings-section">
        <h3>Sounds</h3>
        {SOUND_FIELDS.map(({ key, label }) => (
          <label key={key}>
            {label}
            <span className="sound-row">
              <input
                value={sounds[key]}
                placeholder="empty = off (wav / aif / aiff / au)"
                onChange={(e) => updateSounds({ [key]: e.target.value })}
              />
              <button className="ghost" title="Choose audio file" onClick={() => void browseSound(key)}>
                …
              </button>
            </span>
          </label>
        ))}
      </section>
      <section className="settings-section">
        <h3>Telegram</h3>
        <label>
          chat id
          <input
            value={telegram.chatId}
            placeholder="123456789 (from @userinfobot)"
            onChange={(e) => updateTelegram({ chatId: e.target.value })}
          />
        </label>
        <label>
          bot token
          <span className="sound-row">
            <input
              type="password"
              value={tokenInput}
              placeholder={tokenConfigured ? 'token saved — type to replace' : '123456:ABC-DEF…'}
              onChange={(e) => setTokenInput(e.target.value)}
            />
            <button className="ghost" onClick={() => void saveToken()} disabled={tokenInput.trim().length === 0 && !tokenConfigured}>
              Save
            </button>
          </span>
        </label>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={telegram.events.turnEnd}
            onChange={(e) => updateTelegram({ events: { ...telegram.events, turnEnd: e.target.checked } })}
          />
          turn completed
        </label>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={telegram.events.permission}
            onChange={(e) => updateTelegram({ events: { ...telegram.events, permission: e.target.checked } })}
          />
          asks permission (confirm)
        </label>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={telegram.events.question}
            onChange={(e) => updateTelegram({ events: { ...telegram.events, question: e.target.checked } })}
          />
          needs an answer (question)
        </label>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={telegram.events.error}
            onChange={(e) => updateTelegram({ events: { ...telegram.events, error: e.target.checked } })}
          />
          extension error
        </label>
        <div className="settings-row">
          <button className="ghost" onClick={() => void sendTest()} disabled={telegram.chatId.trim().length === 0}>
            Send test message
          </button>
          {testResult !== null && <span className={testResult === 'sent' || testResult === '…' ? 'saved' : 'settings-error'}>{testResult}</span>}
        </div>
      </section>
      <section className="settings-section">
        <h3>Remote (phone browser)</h3>
        <label className="settings-check">
          <input type="checkbox" checked={remotePrefs.enabled} onChange={(e) => updateRemote({ enabled: e.target.checked })} />
          enable remote bridge (sessions are shared on the LAN)
        </label>
        <label>
          port
          <input
            type="number"
            value={remotePrefs.port}
            min={1}
            max={65535}
            onChange={(e) => updateRemote({ port: Number(e.target.value) })}
          />
        </label>
        {remote !== null && remote.running && (
          <div className="panel-hint">
            {remote.lanAddresses.length > 0 ? `http://${remote.lanAddresses[0]}:${remote.port}/` : `port ${remote.port}`} · PIN{' '}
            {remote.pin}
          </div>
        )}
        {remote !== null && !remote.running && <div className="panel-hint">Bridge is off — enable it and reopen settings.</div>}
      </section>
    </>
  )
}
