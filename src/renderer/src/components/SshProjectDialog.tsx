/** Диалог добавления SSH-проекта: выбор сервера, браузер удалённых папок (SFTP readdir),
 *  опциональное имя. Каталог — POSIX-путь на сервере. */
import { useEffect, useState } from 'react'
import { useSessionsStore } from '../stores/sessions'
import { useT } from '../lib/i18n'
import type { SshDirEntry, SshServerEntry } from '../../../shared/ipc-contracts'

export function SshProjectDialog({
  servers,
  onDone,
  onClose
}: {
  servers: SshServerEntry[]
  onDone: () => void
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const addProject = useSessionsStore((s) => s.addProject)
  const [serverId, setServerId] = useState(servers[0]?.id ?? '')
  const [path, setPath] = useState<string | null>(null)
  const [entries, setEntries] = useState<SshDirEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  const server = servers.find((s) => s.id === serverId) ?? null

  useEffect(() => {
    if (server === null) return
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      const result = await window.piwright.sshListDir(server, path ?? '/')
      if (cancelled) return
      if (result.ok) {
        setEntries(result.entries.filter((e) => e.isDir))
        setError(null)
      } else {
        setError(result.error ?? 'Failed to list directory')
        setEntries([])
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [server, path])

  const parentPath = (p: string): string => {
    const trimmed = p.replace(/\/+$/, '')
    const slash = trimmed.lastIndexOf('/')
    if (slash <= 0) return '/'
    return trimmed.slice(0, slash)
  }

  const joinPath = (base: string, name: string): string => (base === '/' ? `/${name}` : `${base.replace(/\/+$/, '')}/${name}`)

  const add = async (): Promise<void> => {
    if (server === null || path === null || busy) return
    setBusy(true)
    await addProject({ kind: 'ssh', serverId: server.id, dir: path })
    setBusy(false)
    onDone()
  }

  return (
    <div className="ssh-dialog-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ssh-dialog">
        <div className="ssh-dialog-head">
          <span>{t('Add project from SSH server')}</span>
          <span className="spacer" />
          <button className="icon" onClick={onClose}>×</button>
        </div>
        {servers.length === 0 ? (
          <div className="ssh-dialog-body">
            <div className="panel-hint">{t('No SSH servers configured — add one in Settings → SSH')}</div>
            <div className="ssh-dialog-actions">
              <button className="ghost" onClick={onClose}>{t('Cancel')}</button>
            </div>
          </div>
        ) : (
          <div className="ssh-dialog-body">
            <label className="ssh-dialog-server">
              {t('Server')}
              <select value={serverId} onChange={(e) => { setServerId(e.target.value); setPath(null) }}>
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.user}@{s.host})</option>
                ))}
              </select>
            </label>
            <div className="ssh-dialog-path">
              <button className="ghost" disabled={path === null || path === '/'} onClick={() => setPath(path === null ? '/' : parentPath(path))}>↑</button>
              <input
                value={path ?? '/'}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/home/user/project"
                spellCheck={false}
              />
            </div>
            <div className="ssh-dialog-list">
              {loading && <div className="panel-hint">{t('loading…')}</div>}
              {!loading && error !== null && <div className="ssh-test-result err">{error}</div>}
              {!loading &&
                entries.map((entry) => (
                  <button
                    key={entry.name}
                    className="ssh-dialog-entry"
                    onClick={() => setPath(joinPath(path ?? '/', entry.name))}
                  >
                    <span className="ssh-entry-icon">{entry.isDir ? '▸' : '·'}</span>
                    {entry.name}
                  </button>
                ))}
            </div>
            {error === null && !loading && path !== null && (
              <div className="ssh-dialog-actions">
                <button className="primary" disabled={busy} onClick={() => void add()}>
                  {t('Add project')}
                </button>
                <button className="ghost" onClick={onClose}>{t('Cancel')}</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
