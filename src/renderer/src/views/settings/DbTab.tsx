/** Вкладка Settings → DB: подключения к PostgreSQL/MySQL (с per-connection SSH-туннелем),
 *  тест реального коннекта, удаление. Пароли (БД и SSH) не попадают в settings.json —
 *  только в зашифрованный db-secrets.json через db:connection-save. */
import { useState } from 'react'
import { useT } from '../../lib/i18n'
import type {
  DbAuthType,
  DbConnectionEntry,
  DbKind,
  DbSecretInput,
  SshAuthType,
  Settings
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

export function DbTab({ draft, update }: { draft: Settings; update: (patch: Partial<Settings>) => void }): React.JSX.Element {
  const t = useT()
  const [editing, setEditing] = useState<DraftConnection | null>(null)
  const [testResult, setTestResult] = useState<{ connectionId: string; ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    if (editing === null || !formValid(editing)) return
    const id = editing.id.length > 0 ? editing.id : `db-${crypto.randomUUID().slice(0, 8)}`
    const entry = draftEntry({ ...editing, id })
    entry.name = editing.name.trim() || entry.database
    setBusy(true)
    const result = await window.piwright.dbConnectionSave(entry, draftSecrets(editing))
    setBusy(false)
    if (result.ok) {
      update({ dbConnections: result.connections })
      setEditing(null)
    } else {
      setTestResult({ connectionId: id, ok: false, text: result.error ?? t('Connection failed') })
    }
  }

  const remove = async (connection: DbConnectionEntry): Promise<void> => {
    const result = await window.piwright.dbConnectionDelete(connection.id)
    if (result.ok) update({ dbConnections: result.connections })
  }

  const test = async (draftConnection: DraftConnection): Promise<void> => {
    if (!formValid(draftConnection)) return
    const id = draftConnection.id.length > 0 ? draftConnection.id : 'draft'
    setBusy(true)
    setTestResult(null)
    const result = await window.piwright.dbConnectionTest(draftEntry(draftConnection), draftSecrets(draftConnection))
    setBusy(false)
    const text = result.ok ? `${t('Connected')} · ${result.serverVersion ?? ''}` : (result.error ?? t('Connection failed'))
    setTestResult({ connectionId: id, ok: result.ok, text })
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
    <>
      <section className="settings-section">
        <h3>{t('Database connections')}</h3>
        {draft.dbConnections.length === 0 && (
          <div className="panel-hint">{t('No connections yet — add one to browse tables and run queries')}</div>
        )}
        {draft.dbConnections.map((connection) => (
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
        <button className="ghost" onClick={() => { setEditing(emptyDraft()); setTestResult(null) }}>+ {t('Add connection')}</button>
      </section>
      {editing !== null && (
        <section className="settings-section ssh-edit">
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
          <div className="ssh-edit-actions">
            <button className="primary" disabled={!formValid(editing) || busy} onClick={() => void save()}>
              {t('Save connection')}
            </button>
            <button disabled={!formValid(editing) || busy} onClick={() => void test(editing)}>{t('Test connection')}</button>
            <button className="ghost" onClick={() => setEditing(null)}>{t('Cancel')}</button>
          </div>
        </section>
      )}
    </>
  )
}
