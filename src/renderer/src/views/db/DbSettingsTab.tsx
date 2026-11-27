/** Вкладка «Базы данных» проекта: подключения к PostgreSQL/MySQL (с per-connection SSH-туннелем),
 *  тест реального коннекта, удаление. Подключения хранятся на проект
 *  (settings.projectDbConnections[projectKey]); пароли (БД и SSH) не попадают в settings.json —
 *  только в зашифрованный db-secrets.json через db:connection-save. */
import { useEffect, useState } from 'react'
import { useT } from '../../lib/i18n'
import { useSessionsStore } from '../../stores/sessions'
import { parentTabKey, type ProjectTab } from '../../stores/tabs'
import { useDbStore } from '../../stores/db'
import type {
  DbAuthType,
  DbConnectionEntry,
  DbKind,
  DbSecretInput,
  SshAuthType
} from '../../../../shared/ipc-contracts'

const KIND_LABELS: Record<DbKind, string> = {
  postgres: 'PostgreSQL',
  mysql: 'MySQL'
}

const DEFAULT_PORTS: Record<DbKind, number> = {
  postgres: 5432,
  mysql: 3306
}

interface DraftConnection extends DbConnectionEntry {
  password?: string
  sshPassword?: string
  sshKeyPassphrase?: string
}

function emptyDraft(kind: DbKind = 'postgres'): DraftConnection {
  return { id: '', name: '', kind, host: '', port: DEFAULT_PORTS[kind], database: '', user: '', authType: 'password', ssh: null }
}

function draftSecrets(draft: DraftConnection): DbSecretInput | null {
  const secrets: DbSecretInput = {}
  if (draft.authType === 'password' && draft.password !== undefined && draft.password.length > 0) secrets.password = draft.password
  if (draft.ssh !== null && draft.ssh !== undefined) {
    if (draft.sshPassword !== undefined && draft.sshPassword.length > 0) secrets.sshPassword = draft.sshPassword
    if (draft.sshKeyPassphrase !== undefined && draft.sshKeyPassphrase.length > 0) secrets.sshKeyPassphrase = draft.sshKeyPassphrase
  }
  return Object.keys(secrets).length > 0 ? secrets : null
}

function draftEntry(draft: DraftConnection): DbConnectionEntry {
  const entry: DbConnectionEntry = {
    id: draft.id,
    name: draft.name,
    kind: draft.kind,
    host: draft.host.trim(),
    port: draft.port,
    database: draft.database.trim(),
    user: draft.user.trim(),
    authType: draft.authType
  }
  if (draft.ssh !== null && draft.ssh !== undefined) {
    const ssh = { ...draft.ssh, host: draft.ssh.host.trim(), user: draft.ssh.user.trim() }
    if (ssh.keyPath !== undefined && ssh.keyPath.trim().length === 0) delete ssh.keyPath
    entry.ssh = ssh
  }
  return entry
}

function formValid(draft: DraftConnection): boolean {
  if (draft.host.trim().length === 0 || draft.database.trim().length === 0 || draft.user.trim().length === 0) return false
  if (draft.ssh !== null && draft.ssh !== undefined && (draft.ssh.host.trim().length === 0 || draft.ssh.user.trim().length === 0)) return false
  return true
}

export function DbSettingsTab({ tab }: { tab: ProjectTab }): React.JSX.Element {
  const settings = useSessionsStore((s) => s.settings)
  const key = parentTabKey(tab.project)
  const connections = settings?.projectDbConnections[key] ?? []

  const onChange = (list: DbConnectionEntry[]): void => {
    void (async () => {
      const current = useSessionsStore.getState().settings
      if (current === null) return
      const next = await window.piwright.setSettings({ projectDbConnections: { ...current.projectDbConnections, [key]: list } })
      useSessionsStore.getState().setSettings(next)
    })()
  }

  return <DbConnectionsEditor projectKey={key} editId={tab.connectionId} connections={connections} onChange={onChange} />
}

function DbConnectionsEditor({
  projectKey,
  editId,
  connections,
  onChange
}: {
  projectKey: string
  /** Вкладка редактирования конкретного подключения (из шестерёнки панели) — форма без списка. */
  editId?: string
  connections: DbConnectionEntry[]
  onChange: (connections: DbConnectionEntry[]) => void
}): React.JSX.Element {
  const t = useT()
  const original = editId !== undefined ? connections.find((c) => c.id === editId) : undefined
  // Кнопка «+» панели БД открывает эту вкладку сразу с формой нового подключения:
  // флаг читается при монтировании (вкладка была закрыта) и по подписке (вкладка уже открыта).
  const [editing, setEditing] = useState<DraftConnection | null>(() =>
    original !== undefined ? { ...original } : (useDbStore.getState().addEditorPending ? emptyDraft() : null)
  )
  const [testResult, setTestResult] = useState<{ connectionId: string; ok: boolean; text: string } | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    useDbStore.getState().clearAddEditor()
    return useDbStore.subscribe((s, prev) => {
      if (!s.addEditorPending || prev.addEditorPending) return
      setEditing(emptyDraft())
      setTestResult(null)
      setSavedFlash(false)
    })
  }, [])

  // Подключение вкладки удалено (например, из панели) — редактировать нечего.
  if (editId !== undefined && original === undefined) {
    return (
      <div className="db-settings-tab">
        <div className="panel-hint">{t('not found')}</div>
      </div>
    )
  }

  const save = async (): Promise<void> => {
    if (editing === null || !formValid(editing)) return
    const id = editing.id.length > 0 ? editing.id : `db-${crypto.randomUUID().slice(0, 8)}`
    const entry = draftEntry({ ...editing, id })
    entry.name = editing.name.trim() || entry.database
    setBusy(true)
    try {
      const result = await window.piwright.dbConnectionSave(projectKey, entry, draftSecrets(editing))
      if (result.ok) {
        onChange(result.connections)
        setTestResult(null)
        const saved = result.connections.find((c) => c.id === id)
        if (saved !== undefined) setEditing({ ...saved })
        setSavedFlash(true)
      } else {
        setTestResult({ connectionId: id, ok: false, text: result.error ?? t('Connection failed') })
      }
    } finally {
      setBusy(false)
    }
  }

  const remove = async (connection: DbConnectionEntry): Promise<void> => {
    const result = await window.piwright.dbConnectionDelete(projectKey, connection.id)
    if (result.ok) onChange(result.connections)
  }

  const test = async (draftConnection: DraftConnection): Promise<void> => {
    if (!formValid(draftConnection)) return
    const id = draftConnection.id.length > 0 ? draftConnection.id : 'draft'
    setBusy(true)
    setTestResult(null)
    setSavedFlash(false)
    try {
      const result = await window.piwright.dbConnectionTest(draftEntry(draftConnection), draftSecrets(draftConnection))
      const text = result.ok ? `${t('Connected')} · ${result.serverVersion ?? ''}` : (result.error ?? t('Connection failed'))
      setTestResult({ connectionId: id, ok: result.ok, text })
    } catch (err) {
      setTestResult({ connectionId: id, ok: false, text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  const toggleSsh = (on: boolean): void => {
    if (editing === null) return
    setEditing({
      ...editing,
      ssh: on ? { host: '', port: 22, user: 'root', auth: 'password' } : null,
      sshPassword: on ? editing.sshPassword : undefined,
      sshKeyPassphrase: on ? editing.sshKeyPassphrase : undefined
    })
  }

  const patchSsh = (patch: Partial<NonNullable<DraftConnection['ssh']>>): void => {
    if (editing === null || editing.ssh === null || editing.ssh === undefined) return
    setEditing({ ...editing, ssh: { ...editing.ssh, ...patch } })
  }

  return (
    <div className="db-settings-tab">
      {editing === null && (
      <section className="settings-section">
        <h3>{t('Database connections')}</h3>
        {connections.length === 0 && (
          <div className="panel-hint">{t('No connections yet — add one to browse tables and run queries')}</div>
        )}
        {connections.map((connection) => (
          <div key={connection.id} className="ssh-server-row">
            <span className="ssh-server-name">{connection.name}</span>
            <span className="ssh-server-meta">
              {KIND_LABELS[connection.kind]} · {connection.user}@{connection.host}:{connection.port}/{connection.database}
              {connection.ssh !== null && connection.ssh !== undefined ? ' · SSH' : ''}
            </span>
            <span className="spacer" />
            <button className="ghost" disabled={busy} onClick={() => void test({ ...connection })}>{t('Test')}</button>
            <button
              className="ghost"
              onClick={() => {
                setEditing({ ...connection })
                setTestResult(null)
                setSavedFlash(false)
              }}
            >
              {t('Edit')}
            </button>
            <button className="ghost danger" onClick={() => void remove(connection)}>{t('Delete')}</button>
            {testResult?.connectionId === connection.id && (
              <div className={`ssh-test-result ${testResult.ok ? 'ok' : 'err'}`}>{testResult.text}</div>
            )}
          </div>
        ))}
        <button className="ghost" onClick={() => { setEditing(emptyDraft()); setTestResult(null); setSavedFlash(false) }}>+ {t('Add connection')}</button>
      </section>
      )}
      {editing !== null && (
        <section className="settings-section ssh-edit db-conn-form">
          <h3>{editing.id.length > 0 ? t('Edit connection') : t('New connection')}</h3>
          <div className="ssh-form-grid">
            <label>
              {t('Name')}
              <input value={editing.name} placeholder={t('empty = database name')} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </label>
            <label>
              {t('Type')}
              <select
                value={editing.kind}
                onChange={(e) => {
                  const kind = e.target.value as DbKind
                  setEditing({ ...editing, kind, port: DEFAULT_PORTS[kind] })
                }}
              >
                <option value="postgres">PostgreSQL</option>
                <option value="mysql">MySQL</option>
              </select>
            </label>
            <label>
              {t('Host')}
              <input value={editing.host} placeholder="localhost" onChange={(e) => setEditing({ ...editing, host: e.target.value })} />
            </label>
            <label>
              {t('Port')}
              <input
                type="number"
                min={1}
                max={65535}
                value={editing.port}
                onChange={(e) => setEditing({ ...editing, port: Math.min(65535, Math.max(1, Number(e.target.value) || DEFAULT_PORTS[editing.kind])) })}
              />
            </label>
            <label>
              {t('Database')}
              <input value={editing.database} onChange={(e) => setEditing({ ...editing, database: e.target.value })} />
            </label>
            <label>
              {t('User')}
              <input value={editing.user} onChange={(e) => setEditing({ ...editing, user: e.target.value })} />
            </label>
            <label>
              {t('Authentication')}
              <select value={editing.authType} onChange={(e) => setEditing({ ...editing, authType: e.target.value as DbAuthType })}>
                <option value="password">{t('Password')}</option>
                <option value="none">{t('No password (trust)')}</option>
              </select>
            </label>
            {editing.authType === 'password' && (
              <label>
                {t('Password')}
                <input
                  type="password"
                  value={editing.password ?? ''}
                  placeholder={editing.id.length > 0 ? t('saved — leave empty to keep') : ''}
                  onChange={(e) => setEditing({ ...editing, password: e.target.value })}
                />
              </label>
            )}
          </div>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={editing.ssh !== null && editing.ssh !== undefined}
              onChange={(e) => toggleSsh(e.target.checked)}
            />
            {t('Connect through SSH tunnel')}
          </label>
          {editing.ssh !== null && editing.ssh !== undefined && (
            <div className="ssh-form-grid">
              <label>
                {t('Host')}
                <input value={editing.ssh.host} placeholder="bastion.example.com" onChange={(e) => patchSsh({ host: e.target.value })} />
              </label>
              <label>
                {t('Port')}
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={editing.ssh.port}
                  onChange={(e) => patchSsh({ port: Math.min(65535, Math.max(1, Number(e.target.value) || 22)) })}
                />
              </label>
              <label>
                {t('User')}
                <input value={editing.ssh.user} onChange={(e) => patchSsh({ user: e.target.value })} />
              </label>
              <label>
                {t('Authentication')}
                <select value={editing.ssh.auth} onChange={(e) => patchSsh({ auth: e.target.value as SshAuthType })}>
                  <option value="password">Password</option>
                  <option value="key">Key pair</option>
                  <option value="agent">ssh-agent</option>
                </select>
              </label>
              {editing.ssh.auth === 'key' && (
                <label>
                  {t('Private key path')}
                  <input
                    value={editing.ssh.keyPath ?? ''}
                    placeholder="C:\Users\me\.ssh\id_ed25519"
                    onChange={(e) => patchSsh({ keyPath: e.target.value })}
                  />
                </label>
              )}
              {editing.ssh.auth === 'password' && (
                <label>
                  {t('Password')}
                  <input
                    type="password"
                    value={editing.sshPassword ?? ''}
                    placeholder={editing.id.length > 0 ? t('saved — leave empty to keep') : ''}
                    onChange={(e) => setEditing({ ...editing, sshPassword: e.target.value })}
                  />
                </label>
              )}
              {(editing.ssh.auth === 'key' || editing.ssh.auth === 'agent') && (
                <label>
                  {t('Key passphrase')}
                  <input
                    type="password"
                    value={editing.sshKeyPassphrase ?? ''}
                    placeholder={editing.id.length > 0 ? t('saved — leave empty to keep') : ''}
                    onChange={(e) => setEditing({ ...editing, sshKeyPassphrase: e.target.value })}
                  />
                </label>
              )}
            </div>
          )}
          {testResult !== null && (testResult.connectionId === 'draft' || testResult.connectionId === editing.id) && (
            <div className={`ssh-test-result ${testResult.ok ? 'ok' : 'err'}`}>{testResult.text}</div>
          )}
          {savedFlash && <div className="ssh-test-result ok">{t('Connection saved')}</div>}
          <div className="ssh-edit-actions">
            <button className="primary" disabled={!formValid(editing) || busy} onClick={() => void save()}>
              {t('Save connection')}
            </button>
            <button disabled={!formValid(editing) || busy} onClick={() => void test(editing)}>{t('Test connection')}</button>
            <button
              className="ghost"
              onClick={() => {
                setTestResult(null)
                setSavedFlash(false)
                if (editId !== undefined && original !== undefined) setEditing({ ...original })
                else setEditing(null)
              }}
            >
              {t('Cancel')}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
