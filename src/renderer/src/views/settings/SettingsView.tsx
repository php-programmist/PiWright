import { useEffect, useRef, useState } from 'react'
import { ModelsTab } from './ModelsTab'
import { useSessionsStore } from '../../stores/sessions'
import { useT } from '../../lib/i18n'
import type { NotificationSounds, Settings, Theme, UiLanguage } from '../../../../shared/ipc-contracts'

const AUTOSAVE_DEBOUNCE_MS = 500

const CHAT_FONT_SIZES = [12, 13, 14, 16, 18]

type Tab = 'general' | 'appearance' | 'notifications' | 'models'

const TABS: { id: Tab; key: string }[] = [
  { id: 'general', key: 'General' },
  { id: 'appearance', key: 'Appearance' },
  { id: 'notifications', key: 'Notifications' },
  { id: 'models', key: 'Models' }
]

export function SettingsView(): React.JSX.Element {
  const settings = useSessionsStore((s) => s.settings)
  const closeSettings = useSessionsStore((s) => s.closeSettings)
  const t = useT()

  if (settings === null) {
    return (
      <div className="settings-screen">
        <header className="settings-head">
          <span>{t('Settings')}</span>
          <span className="spacer" />
          <button className="icon" title={t('Close settings')} onClick={closeSettings}>×</button>
        </header>
        <div className="settings-body">
          <div className="panel-hint">{t('loading…')}</div>
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
  const t = useT()

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
        <span>{t('Settings')}</span>
        {saved && <span className="saved">{t('saved')}</span>}
        <span className="spacer" />
        <button className="icon" title={t('Close settings')} onClick={onClose}>×</button>
      </header>
      <div className="settings-body">
        <nav className="settings-nav">
          {TABS.map((tb) => (
            <button key={tb.id} className={tb.id === tab ? 'current' : ''} onClick={() => setTab(tb.id)}>
              {t(tb.key)}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {tab === 'general' && (
            <>
              <section className="settings-section">
                <h3>{t('Chat')}</h3>
                <label>
                  {t('send message with')}
                  <select
                    value={draft.sendOnEnter ? 'enter' : 'ctrlEnter'}
                    onChange={(e) => update({ sendOnEnter: e.target.value === 'enter' })}
                  >
                    <option value="enter">{t('Enter (Shift+Enter — newline)')}</option>
                    <option value="ctrlEnter">Ctrl+Enter</option>
                  </select>
                </label>
                <label>
                  {t('interface language')}
                  <select
                    value={draft.language}
                    onChange={(e) => update({ language: e.target.value as UiLanguage })}
                  >
                    <option value="en">English</option>
                    <option value="ru">Русский</option>
                  </select>
                </label>
              </section>
              <section className="settings-section">
                <h3>Windows</h3>
                <label>
                  {t('pi path')}
                  <input
                    value={draft.piPathNative}
                    placeholder="auto (%USERPROFILE%\.pi\agent\bin\pi.cmd)"
                    onChange={(e) => update({ piPathNative: e.target.value })}
                  />
                </label>
              </section>
              <section className="settings-section">
                <h3>{t('Launch')}</h3>
                <label>
                  {t('extra pi args')}
                  <input
                    value={draft.piExtraArgs}
                    placeholder="--no-extensions -e C:\path\to\ext"
                    onChange={(e) => update({ piExtraArgs: e.target.value })}
                  />
                </label>
                <label>
                  {t('update feed URL')}
                  <input
                    value={draft.updateUrl}
                    placeholder={t('https://server/updates/ (empty = off)')}
                    onChange={(e) => update({ updateUrl: e.target.value })}
                  />
                </label>
              </section>
              <section className="settings-section">
                <h3>WSL</h3>
                <label>
                  {t('distro')}
                  <input
                    value={draft.wslDistro}
                    placeholder={t('auto (first distro)')}
                    onChange={(e) => update({ wslDistro: e.target.value })}
                  />
                </label>
                <label>
                  {t('pi path')}
                  <input
                    value={draft.piPathWsl}
                    placeholder={t('auto (command -v pi)')}
                    onChange={(e) => update({ piPathWsl: e.target.value })}
                  />
                </label>
              </section>
            </>
          )}
          {tab === 'appearance' && (
            <>
              <section className="settings-section">
                <h3>{t('Chat toolbar')}</h3>
                <label>
                  {t('model / thinking selectors and Stop button')}
                  <select
                    value={draft.selectorPlacement}
                    onChange={(e) => update({ selectorPlacement: e.target.value as 'top' | 'bottom' })}
                  >
                    <option value="top">{t('top — in the chat header')}</option>
                    <option value="bottom">{t('bottom — above the message input')}</option>
                  </select>
                </label>
              </section>
              <section className="settings-section">
                <h3>{t('Theme')}</h3>
                <label>
                  {t('color theme')}
                  <select value={draft.theme} onChange={(e) => update({ theme: e.target.value as Theme })}>
                    <option value="dark">{t('dark')}</option>
                    <option value="light">{t('light')}</option>
                  </select>
                </label>
                <label>
                  {t('chat font size')}
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
                <h3>{t('Tool blocks')}</h3>
                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={draft.singleLineTools}
                    onChange={(e) => update({ singleLineTools: e.target.checked })}
                  />
                  {t('single-line tool blocks (command in one line, full command and output when expanded)')}
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

const SOUND_FIELDS: { key: keyof NotificationSounds; key2: string }[] = [
  { key: 'completion', key2: 'turn completed' },
  { key: 'await', key2: 'pi asks a question' },
  { key: 'error', key2: 'error' }
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
  const t = useT()

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
        <h3>{t('Sounds')}</h3>
        {SOUND_FIELDS.map(({ key, key2 }) => (
          <label key={key}>
            {t(key2)}
            <span className="sound-row">
              <input
                value={sounds[key]}
                placeholder={t('empty = off (wav / aif / aiff / au)')}
                onChange={(e) => updateSounds({ [key]: e.target.value })}
              />
              <button className="ghost" title={t('Choose audio file')} onClick={() => void browseSound(key)}>
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
          {t('bot token')}
          <span className="sound-row">
            <input
              type="password"
              value={tokenInput}
              placeholder={tokenConfigured ? t('token saved — type to replace') : '123456:ABC-DEF…'}
              onChange={(e) => setTokenInput(e.target.value)}
            />
            <button className="ghost" onClick={() => void saveToken()} disabled={tokenInput.trim().length === 0 && !tokenConfigured}>
              {t('Save')}
            </button>
          </span>
        </label>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={telegram.events.turnEnd}
            onChange={(e) => updateTelegram({ events: { ...telegram.events, turnEnd: e.target.checked } })}
          />
          {t('turn completed')}
        </label>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={telegram.events.permission}
            onChange={(e) => updateTelegram({ events: { ...telegram.events, permission: e.target.checked } })}
          />
          {t('asks permission (confirm)')}
        </label>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={telegram.events.question}
            onChange={(e) => updateTelegram({ events: { ...telegram.events, question: e.target.checked } })}
          />
          {t('needs an answer (question)')}
        </label>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={telegram.events.error}
            onChange={(e) => updateTelegram({ events: { ...telegram.events, error: e.target.checked } })}
          />
          {t('extension error')}
        </label>
        <div className="settings-row">
          <button className="ghost" onClick={() => void sendTest()} disabled={telegram.chatId.trim().length === 0}>
            {t('Send test message')}
          </button>
          {testResult !== null && (
            <span className={testResult === 'sent' || testResult === '…' ? 'saved' : 'settings-error'}>
              {testResult === 'sent' ? t('sent') : testResult}
            </span>
          )}
        </div>
      </section>
      <section className="settings-section">
        <h3>{t('Remote (phone browser)')}</h3>
        <label className="settings-check">
          <input type="checkbox" checked={remotePrefs.enabled} onChange={(e) => updateRemote({ enabled: e.target.checked })} />
          {t('enable remote bridge (sessions are shared on the LAN)')}
        </label>
        <label>
          {t('port')}
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
        {remote !== null && !remote.running && <div className="panel-hint">{t('Bridge is off — enable it and reopen settings.')}</div>}
      </section>
    </>
  )
}
