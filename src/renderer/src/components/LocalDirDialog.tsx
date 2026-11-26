/** Диалог выбора папки проекта в веб-режиме: обзор файловой системы сервера по RPC
 *  (fs:list-dir) — браузер не видит ФС машины, где работает PiWright. UI — как у
 *  SshProjectDialog (тот же паттерн навигации). */
import { useEffect, useState } from 'react'
import { useSessionsStore } from '../stores/sessions'
import { useT } from '../lib/i18n'
import type { BackendMode } from '../../../shared/ipc-contracts'

export function LocalDirDialog({
  kind,
  onDone,
  onClose
}: {
  kind: BackendMode
  onDone: () => void
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const addProject = useSessionsStore((s) => s.addProject)
  const [path, setPath] = useState('')
  const [resolved, setResolved] = useState('')
  const [parent, setParent] = useState<string | null>(null)
  const [dirs, setDirs] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      const result = await window.piwright.fsListDir(path)
      if (cancelled) return
      if (result.ok) {
        setResolved(result.path)
        setParent(result.parent)
        setDirs(result.dirs)
        setError(null)
      } else {
        setError(result.error ?? 'Failed to list directory')
        setDirs([])
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [path])

  const joinPath = (base: string, name: string): string =>
    base.endsWith('\\') || base.endsWith('/') ? `${base}${name}` : `${base}/${name}`

  const add = async (): Promise<void> => {
    if (resolved.length === 0 || busy) return
    setBusy(true)
    await addProject({ kind, dir: resolved })
    setBusy(false)
    onDone()
  }

  return (
    <div className="ssh-dialog-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ssh-dialog">
        <div className="ssh-dialog-head">
          <span>{t('Choose project folder')}</span>
          <span className="spacer" />
          <button className="icon" onClick={onClose}>×</button>
        </div>
        <div className="ssh-dialog-body">
          <div className="ssh-dialog-path">
            <button className="ghost" disabled={parent === null} onClick={() => setPath(parent ?? '')}>↑</button>
            <input
              value={resolved.length > 0 && path.length === 0 ? resolved : path}
              onChange={(e) => setPath(e.target.value)}
              placeholder={t('Absolute path')}
              spellCheck={false}
            />
          </div>
          <div className="ssh-dialog-list">
            {loading && <div className="panel-hint">{t('loading…')}</div>}
            {!loading && error !== null && <div className="ssh-test-result err">{error}</div>}
            {!loading &&
              dirs.map((name) => (
                <button key={name} className="ssh-dialog-entry" onClick={() => setPath(joinPath(resolved, name))}>
                  <span className="ssh-entry-icon">▸</span>
                  {name}
                </button>
              ))}
          </div>
          {error === null && !loading && resolved.length > 0 && (
            <div className="ssh-dialog-actions">
              <button className="primary" disabled={busy} onClick={() => void add()}>
                {t('Add project')}
              </button>
              <button className="ghost" onClick={onClose}>{t('Cancel')}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
