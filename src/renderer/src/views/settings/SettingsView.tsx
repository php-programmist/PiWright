import { useEffect, useRef, useState } from 'react'
import { ModelsTab } from './ModelsTab'
import { KanbanThemeSection } from './KanbanThemeSection'
import { useSessionsStore } from '../../stores/sessions'
import { useT } from '../../lib/i18n'
import type { TFunc } from '../../lib/i18n'
import type { NotificationSounds, Settings, Theme, UiLanguage } from '../../../../shared/ipc-contracts'

const AUTOSAVE_DEBOUNCE_MS = 500

/** Опрос статуса remote-моста: первый — после автосейва, дальше — пока сервер не поднялся. */
const REMOTE_STATUS_FIRST_MS = 1200
const REMOTE_STATUS_POLL_MS = 3000
const REMOTE_STATUS_RETRY_MS = 300

const CHAT_FONT_SIZES = [12, 13, 14, 16, 18]

type Tab = 'general' | 'appearance' | 'notifications' | 'models' | 'advanced'

const TABS: { id: Tab; key: string }[] = [
  { id: 'general', key: 'General' },
  { id: 'appearance', key: 'Appearance' },
  { id: 'notifications', key: 'Notifications' },
  { id: 'models', key: 'Models' },
  { id: 'advanced', key: 'Advanced features' }
]

export function SettingsView(): React.JSX.Element {
  const settings = useSessionsStore((s) => s.settings)
  const closeSettings = useSessionsStore((s) => s.closeSettings)
  const t = useT()

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeSettings()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeSettings])

  return (
    <div
      className="settings-modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeSettings()
      }}
    >
      <div className="settings-modal">
        {settings === null ? (
          <div className="settings-body">
            <div className="panel-hint">{t('loading…')}</div>
          </div>
        ) : (
          <SettingsForm settings={settings} onClose={closeSettings} />
        )}
      </div>
    </div>
  )
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
    <>
      <header className="settings-head">
        <span>{t('Settings')}</span>
        {saved && <span className="saved">{t('saved')}</span>}
        <span className="spacer" />
        <button className="ghost" onClick={() => void window.piwright.revealSettings()}>
          {t('Open configuration file')}
        </button>
        <button className="settings-close" title={t('Close settings')} onClick={onClose}>×</button>
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
                  {t('Send message with')}
                  <select
                    value={draft.sendOnEnter ? 'enter' : 'ctrlEnter'}
                    onChange={(e) => update({ sendOnEnter: e.target.value === 'enter' })}
                  >
                    <option value="enter">{t('Enter (Shift+Enter — newline)')}</option>
                    <option value="ctrlEnter">Ctrl+Enter</option>
                  </select>
                </label>
                <label>
                  {t('Interface language')}
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
                  {t('Pi path')}
                  <input
                    value={draft.piPathNative}
                    placeholder="Авто (%USERPROFILE%\.pi\agent\bin\pi.cmd)"
                    onChange={(e) => update({ piPathNative: e.target.value })}
                  />
                </label>
              </section>
              <section className="settings-section">
                <h3>{t('Launch')}</h3>
                <label>
                  {t('Extra pi args')}
                  <input
                    value={draft.piExtraArgs}
                    placeholder="--no-extensions -e C:\path\to\ext"
                    onChange={(e) => update({ piExtraArgs: e.target.value })}
                  />
                </label>
                <label>
                  {t('Update feed URL')}
                  <input
                    value={draft.updateUrl}
                    placeholder={t('https://server/updates/ (empty = off)')}
                    onChange={(e) => update({ updateUrl: e.target.value })}
                  />
                </label>
              </section>
              <section className="settings-section">
                <h3>{t('Remote (phone browser)')}</h3>
                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={draft.notifications.remote.enabled}
                    onChange={(e) =>
                      update({
                        notifications: { ...draft.notifications, remote: { ...draft.notifications.remote, enabled: e.target.checked } }
                      })
                    }
                  />
                  {t('Enable remote bridge (sessions are shared on the LAN)')}
                </label>
                {draft.notifications.remote.enabled && <RemotePortField draft={draft} update={update} />}
                {draft.notifications.remote.enabled && <RemoteStaticPinField draft={draft} update={update} />}
                <RemoteStatus draft={draft} />
              </section>
              <section className="settings-section">
                <h3>WSL</h3>
                <label>
                  {t('Distro')}
                  <input
                    value={draft.wslDistro}
                    placeholder={t('Auto (first distro)')}
                    onChange={(e) => update({ wslDistro: e.target.value })}
                  />
                </label>
                <label>
                  {t('Pi path')}
                  <input
                    value={draft.piPathWsl}
                    placeholder={t('Auto (command -v pi)')}
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
                  {t('Model / thinking selectors and Stop button')}
                  <select
                    value={draft.selectorPlacement}
                    onChange={(e) => update({ selectorPlacement: e.target.value as 'top' | 'bottom' })}
                  >
                    <option value="top">{t('Top — in the chat header')}</option>
                    <option value="bottom">{t('Bottom — above the message input')}</option>
                  </select>
                </label>
              </section>
              <section className="settings-section">
                <h3>{t('Theme')}</h3>
                <label>
                  {t('Color theme')}
                  <select value={draft.theme} onChange={(e) => update({ theme: e.target.value as Theme })}>
                    <option value="dark">{t('Dark')}</option>
                    <option value="light">{t('Light')}</option>
                  </select>
                </label>
                <label>
                  {t('Chat font size')}
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
              {draft.kanbanEnabled && <KanbanThemeSection draft={draft} update={update} />}
            </>
          )}
          {tab === 'notifications' && <NotificationsTab draft={draft} update={update} />}
          {tab === 'models' && <ModelsTab />}
          {tab === 'advanced' && (
            <section className="settings-section">
              <h3>{t('Loops')}</h3>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={draft.loopsEnabled}
                  onChange={(e) => update({ loopsEnabled: e.target.checked })}
                />
                {t('Enable loops (the Loop checkbox near the prompt field and in Remote)')}
              </label>
              {draft.loopsEnabled && (
                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={draft.loopCloseSession}
                    onChange={(e) => update({ loopCloseSession: e.target.checked })}
                  />
                  {t('Close the session after the loop cycle ends')}
                </label>
              )}
              <div className="panel-hint">{t('Loops explanation')}</div>
            </section>
          )}
          {tab === 'advanced' && (
            <section className="settings-section">
              <h3>{t('Kanban')}</h3>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={draft.kanbanEnabled}
                  onChange={(e) => update({ kanbanEnabled: e.target.checked })}
                />
                {t('Enable kanban boards (agent tools and the boards panel)')}
              </label>
              <div className="panel-hint">{t('Kanban explanation')}</div>
            </section>
          )}
        </div>
      </div>
    </>
  )
}

const SOUND_FIELDS: { key: keyof NotificationSounds; key2: string }[] = [
  { key: 'completion', key2: 'Turn completed' },
  { key: 'await', key2: 'Pi asks a question' },
  { key: 'error', key2: 'Error' }
]

/** Поле порта remote + проверка занятости (Settings → General). */
function RemotePortField({
  draft,
  update
}: {
  draft: Settings
  update: (patch: Partial<Settings>) => void
}): React.JSX.Element {
  const remotePrefs = draft.notifications.remote
  const [check, setCheck] = useState<'idle' | 'checking' | 'free' | 'busy'>('idle')
  const t = useT()

  const checkPort = async (): Promise<void> => {
    setCheck('checking')
    const result = await window.piwright.remoteCheckPort(remotePrefs.port)
    setCheck(result.busy ? 'busy' : 'free')
  }

  return (
    <>
      <label>
        {t('Port')}
        <span className="sound-row">
          <input
            type="number"
            value={remotePrefs.port}
            min={1}
            max={65535}
            onChange={(e) => {
              updateRemotePort(update, draft, Number(e.target.value))
              setCheck('idle')
            }}
          />
          <button className="ghost" onClick={() => void checkPort()} disabled={check === 'checking'}>
            {t('Check')}
          </button>
        </span>
      </label>
      {check === 'free' && <div className="panel-hint">{t('Port is free')}</div>}
      {check === 'busy' && <div className="settings-error">{t('Port is busy')}</div>}
    </>
  )
}

function updateRemotePort(update: (patch: Partial<Settings>) => void, draft: Settings, port: number): void {
  if (!Number.isFinite(port)) return
  update({ notifications: { ...draft.notifications, remote: { ...draft.notifications.remote, port } } })
}

/** Статичный пин remote: 6 цифр, пусто — случайный пин на процесс. */
function RemoteStaticPinField({
  draft,
  update
}: {
  draft: Settings
  update: (patch: Partial<Settings>) => void
}): React.JSX.Element {
  const remotePrefs = draft.notifications.remote
  const t = useT()
  const incomplete = remotePrefs.staticPin.length > 0 && remotePrefs.staticPin.length < 6
  return (
    <label>
      {t('Static PIN code')}
      <input
        value={remotePrefs.staticPin}
        placeholder={t('6 digits (empty = random PIN)')}
        inputMode="numeric"
        maxLength={6}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 6)
          update({ notifications: { ...draft.notifications, remote: { ...remotePrefs, staticPin: digits } } })
        }}
      />
      {incomplete && <div className="settings-error">{t('PIN must be exactly 6 digits')}</div>}
    </label>
  )
}

/** Статус remote-моста: адрес+PIN, ошибка старта с кнопкой «Повторить». */
function RemoteStatus({ draft }: { draft: Settings }): React.JSX.Element {
  const remotePrefs = draft.notifications.remote
  const [remote, setRemote] = useState<Awaited<ReturnType<typeof window.piwright.remoteStatus>> | null>(null)
  const [attempt, setAttempt] = useState(0)
  const t = useT()

  // Первый опрос — после автосейва (500 мс) и попытки старта сервера; пока сервер не поднялся,
  // опрашиваем дальше: авто-ретрай старта с backoff поднимает его сам, без ре-тумблера.
  useEffect(() => {
    if (!remotePrefs.enabled) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const poll = async (): Promise<void> => {
      const status = await window.piwright.remoteStatus()
      if (cancelled) return
      setRemote(status)
      if (!status.running) timer = setTimeout(() => void poll(), REMOTE_STATUS_POLL_MS)
    }
    timer = setTimeout(() => void poll(), attempt === 0 ? REMOTE_STATUS_FIRST_MS : REMOTE_STATUS_RETRY_MS)
    return () => {
      cancelled = true
      if (timer !== null) clearTimeout(timer)
    }
  }, [remotePrefs.enabled, remotePrefs.port, attempt])

  const retry = async (): Promise<void> => {
    await window.piwright.remoteRetry()
    setAttempt((value) => value + 1)
  }

  const startError = remotePrefs.enabled && remote !== null && !remote.running ? remote.error : null

  return (
    <>
      {remote !== null && remote.running && (
        <div className="panel-hint">
          {remote.lanAddresses.length > 0 ? `http://${remote.lanAddresses[0]}:${remote.port}/` : `port ${remote.port}`} · PIN{' '}
          {remote.pin}
        </div>
      )}
      {startError !== null && (
        <div className="settings-error">
          {remoteStartErrorText(startError, remotePrefs.port, t)}
          <button className="ghost" onClick={() => void retry()}>
            {t('Retry')}
          </button>
        </div>
      )}
    </>
  )
}

function remoteStartErrorText(code: string, port: number, t: TFunc): string {
  if (code === 'EADDRINUSE') return t('Port {port} is busy — retrying automatically', { port })
  if (code === 'EACCES') return t('No permission to listen on port {port}', { port })
  return t('Remote server did not start on port {port}: {error}', { port, error: code })
}

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
  const t = useT()

  useEffect(() => {
    void window.piwright.telegramTokenStatus().then((s) => setTokenConfigured(s.configured))
  }, [])

  const sounds = draft.notifications.sounds
  const telegram = draft.notifications.telegram

  const updateSounds = (patch: Partial<NotificationSounds>): void =>
    update({ notifications: { ...draft.notifications, sounds: { ...sounds, ...patch } } })
  const updateTelegram = (patch: Partial<typeof telegram>): void =>
    update({ notifications: { ...draft.notifications, telegram: { ...telegram, ...patch } } })

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
          {t('Chat id')}
          <input
            value={telegram.chatId}
            placeholder="123456789 (from @userinfobot)"
            onChange={(e) => updateTelegram({ chatId: e.target.value })}
          />
        </label>
        <label>
          {t('Bot token')}
          <span className="sound-row">
            <input
              type="password"
              value={tokenInput}
              placeholder={tokenConfigured ? t('Token saved — type to replace') : '123456:ABC-DEF…'}
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
          {t('Turn completed')}
        </label>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={telegram.events.permission}
            onChange={(e) => updateTelegram({ events: { ...telegram.events, permission: e.target.checked } })}
          />
          {t('Asks permission (confirm)')}
        </label>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={telegram.events.question}
            onChange={(e) => updateTelegram({ events: { ...telegram.events, question: e.target.checked } })}
          />
          {t('Needs an answer (question)')}
        </label>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={telegram.events.error}
            onChange={(e) => updateTelegram({ events: { ...telegram.events, error: e.target.checked } })}
          />
          {t('Extension error')}
        </label>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={telegram.events.loopEnd}
            onChange={(e) => updateTelegram({ events: { ...telegram.events, loopEnd: e.target.checked } })}
          />
          {t('Loop completed')}
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
    </>
  )
}
