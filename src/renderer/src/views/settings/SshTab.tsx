/** Вкладка Settings → SSH: список серверов, CRUD, тест соединения, секреты (safeStorage),
 *  забытый host key. Секреты не попадают в settings.json — только в ssh-secrets.json. */
import { useEffect, useState } from 'react'
import { useT } from '../../lib/i18n'
import type { SshAuthType, SshSecretStatus, SshServerEntry, Settings } from '../../../../shared/ipc-contracts'

const AUTH_LABELS: Record<SshAuthType, string> = {
  password: 'Password',
  key: 'Key pair',
  agent: 'ssh-agent'
}

interface DraftServer extends SshServerEntry {
  password?: string
  keyPassphrase?: string
}

function emptyDraft(): DraftServer {
  return { id: '', name: '', host: '', port: 22, user: 'root', auth: 'password' }
}

export function SshTab({ draft, update }: { draft: Settings; update: (patch: Partial<Settings>) => void }): React.JSX.Element {
  const t = useT()
  const [editing, setEditing] = useState<DraftServer | null>(null)
  const [statuses, setStatuses] = useState<Record<string, SshSecretStatus>>({})
  const [testResult, setTestResult] = useState<{ serverId: string; ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const next: Record<string, SshSecretStatus> = {}
      for (const server of draft.sshServers) {
        next[server.id] = await window.piwright.sshSecretStatus(server.id)
      }
      if (!cancelled) setStatuses(next)
    })()
    return () => {
      cancelled = true
    }
  }, [draft.sshServers])

  const saveSecrets = async (server: DraftServer): Promise<void> => {
    const patch: { password?: string | null; keyPassphrase?: string | null } = {}
    if (server.password !== undefined && server.password.length > 0) patch.password = server.password
    if (server.keyPassphrase !== undefined && server.keyPassphrase.length > 0) patch.keyPassphrase = server.keyPassphrase
    if (Object.keys(patch).length > 0) await window.piwright.sshSetSecret(server.id, patch)
  }

  const save = async (): Promise<void> => {
    if (editing === null) return
    const id = editing.id.length > 0 ? editing.id : `s-${crypto.randomUUID().slice(0, 8)}`
    const entry: SshServerEntry = { id, name: editing.name.trim() || editing.host.trim(), host: editing.host.trim(), port: editing.port, user: editing.user.trim(), auth: editing.auth }
    if (editing.keyPath !== undefined && editing.keyPath.trim().length > 0) entry.keyPath = editing.keyPath.trim()
    const others = draft.sshServers.filter((s) => s.id !== id)
    update({ sshServers: [...others, entry] })
    await saveSecrets({ ...editing, id })
    setEditing(null)
  }

  const remove = (server: SshServerEntry): void => {
    update({ sshServers: draft.sshServers.filter((s) => s.id !== server.id) })
  }

  const test = async (server: DraftServer): Promise<void> => {
    if (server.host.trim().length === 0 || server.user.trim().length === 0) return
    const id = server.id.length > 0 ? server.id : 'draft'
    setBusy(true)
    setTestResult(null)
    const secret: { password?: string; keyPassphrase?: string } = {}
    if (server.password !== undefined && server.password.length > 0) secret.password = server.password
    if (server.keyPassphrase !== undefined && server.keyPassphrase.length > 0) secret.keyPassphrase = server.keyPassphrase
    const entry: SshServerEntry = {
      id: server.id.length > 0 ? server.id : 'draft',
      name: server.name,
      host: server.host.trim(),
      port: server.port,
      user: server.user.trim(),
      auth: server.auth,
      ...(server.keyPath !== undefined && server.keyPath.trim().length > 0 ? { keyPath: server.keyPath.trim() } : {})
    }
    const result = await window.piwright.sshTest(entry, secret)
    setBusy(false)
    const text = result.ok
      ? `${t('Connected')}. pi: ${result.piPath ?? t('not found')}`
      : (result.error ?? t('Connection failed'))
    setTestResult({ serverId: id, ok: result.ok, text })
  }

  const forgetHostKey = async (server: SshServerEntry): Promise<void> => {
    await window.piwright.sshForgetHostKey(server)
    setTestResult({ serverId: server.id, ok: true, text: t('Host key forgotten — it will be accepted on the next connect') })
  }

  return (
    <>
      <section className="settings-section">
        <h3>{t('SSH servers')}</h3>
        <label>
          {t('Pi path on servers (POSIX)')}
          <input
            value={draft.piPathSsh}
            placeholder="~/.local/bin/pi"
            onChange={(e) => update({ piPathSsh: e.target.value })}
          />
        </label>
        {draft.sshServers.length === 0 && <div className="panel-hint">{t('No servers yet — add one to use projects on a remote machine')}</div>}
        {draft.sshServers.map((server) => (
          <div key={server.id} className="ssh-server-row">
            <span className="ssh-server-name" title={`${server.user}@${server.host}:${server.port}`}>{server.name}</span>
            <span className="ssh-server-meta">{server.user}@{server.host}:{server.port} · {AUTH_LABELS[server.auth]}</span>
            <span className="spacer" />
            <button className="ghost" disabled={busy} onClick={() => void test({ ...server })}>{t('Test')}</button>
            <button className="ghost" onClick={() => void forgetHostKey(server)} title={t('Forget host key (after server reinstall)')}>{t('Forget key')}</button>
            <button
              className="ghost"
              onClick={() => {
                setEditing({ ...server })
                setTestResult(null)
              }}
            >
              {t('Edit')}
            </button>
            <button className="ghost danger" onClick={() => remove(server)}>{t('Delete')}</button>
            {testResult?.serverId === server.id && (
              <div className={`ssh-test-result ${testResult.ok ? 'ok' : 'err'}`}>{testResult.text}</div>
            )}
          </div>
        ))}
        <button className="ghost" onClick={() => { setEditing(emptyDraft()); setTestResult(null) }}>+ {t('Add server')}</button>
      </section>
      {editing !== null && (
        <section className="settings-section ssh-edit">
          <h3>{editing.id.length > 0 ? t('Edit server') : t('New server')}</h3>
          <div className="ssh-form-grid">
            <label>
              {t('Name')}
              <input value={editing.name} placeholder={t('My server')} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </label>
            <label>
              {t('Host')}
              <input value={editing.host} placeholder="example.com" onChange={(e) => setEditing({ ...editing, host: e.target.value })} />
            </label>
            <label>
              {t('Port')}
              <input
                type="number"
                min={1}
                max={65535}
                value={editing.port}
                onChange={(e) => setEditing({ ...editing, port: Math.min(65535, Math.max(1, Number(e.target.value) || 22)) })}
              />
            </label>
            <label>
              {t('User')}
              <input value={editing.user} onChange={(e) => setEditing({ ...editing, user: e.target.value })} />
            </label>
            <label>
              {t('Authentication')}
              <select value={editing.auth} onChange={(e) => setEditing({ ...editing, auth: e.target.value as SshAuthType })}>
                <option value="password">Password</option>
                <option value="key">Key pair</option>
                <option value="agent">ssh-agent</option>
              </select>
            </label>
            {editing.auth === 'key' && (
              <label>
                {t('Private key path')}
                <input
                  value={editing.keyPath ?? ''}
                  placeholder="C:\Users\me\.ssh\id_ed25519"
                  onChange={(e) => setEditing({ ...editing, keyPath: e.target.value })}
                />
              </label>
            )}
            {editing.auth === 'password' && (
              <label>
                {t('Password')}
                <input
                  type="password"
                  value={editing.password ?? ''}
                  placeholder={statuses[editing.id]?.hasPassword === true ? t('saved — leave empty to keep') : ''}
                  onChange={(e) => setEditing({ ...editing, password: e.target.value })}
                />
              </label>
            )}
            {(editing.auth === 'key' || editing.auth === 'agent') && (
              <label>
                {t('Key passphrase')}
                <input
                  type="password"
                  value={editing.keyPassphrase ?? ''}
                  placeholder={statuses[editing.id]?.hasKeyPassphrase === true ? t('saved — leave empty to keep') : ''}
                  onChange={(e) => setEditing({ ...editing, keyPassphrase: e.target.value })}
                />
              </label>
            )}
          </div>
          {testResult !== null && testResult.serverId === 'draft' && (
            <div className={`ssh-test-result ${testResult.ok ? 'ok' : 'err'}`}>{testResult.text}</div>
          )}
          <div className="ssh-edit-actions">
            <button className="primary" disabled={editing.host.trim().length === 0 || editing.user.trim().length === 0} onClick={() => void save()}>
              {t('Save server')}
            </button>
            <button disabled={busy} onClick={() => void test(editing)}>{t('Test connection')}</button>
            <button className="ghost" onClick={() => setEditing(null)}>{t('Cancel')}</button>
          </div>
        </section>
      )}
    </>
  )
}
