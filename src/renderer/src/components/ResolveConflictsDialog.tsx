/** Диалог Resolve Conflicts (референс PHPStorm): список конфликтных файлов активного
 *  rebase/merge, Yours/Theirs на файл (checkout --ours|--theirs + add), Edit — файл
 *  с маркерами конфликта в редакторе, Resolve with AI — новая сессия с промптом
 *  (паттерн BoardView.startCardSession), Continue/Abort. Открывается автоматически после
 *  неудачного pull/rebase с конфликтами; переоткрытие — кнопка в шапке Git-панели,
 *  пока sequencer активен. Конфликтные файлы — статус-записи с кодами DD/AU/UD/UA/DU/AA/UU. */
import { useEffect, useMemo } from 'react'
import { useGitStore } from '../stores/git'
import { useCenterProject, useTabsStore, parentTabKey } from '../stores/tabs'
import { useSessionsStore } from '../stores/sessions'
import { draftMap } from '../stores/chat'
import { useT } from '../lib/i18n'
import { confirmDialog } from './ConfirmDialog'
import type { GitFileEntry } from '../../../shared/ipc-contracts'

const CONFLICT_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])

const isConflictEntry = (entry: GitFileEntry): boolean => CONFLICT_CODES.has(`${entry.index}${entry.worktree}`)

export function ResolveConflictsDialog(): React.JSX.Element | null {
  const project = useCenterProject()
  const conflictOpen = useGitStore((s) => s.conflictOpen)
  const conflict = useGitStore((s) => s.conflict)
  const status = useGitStore((s) => s.status)
  const busy = useGitStore((s) => s.busy)
  const t = useT()

  const files = useMemo(() => {
    if (conflict === null) return []
    return (status?.entries ?? []).filter(
      (e) => isConflictEntry(e) && (conflict.repoRoot === null ? e.repoRoot === undefined : e.repoRoot === conflict.repoRoot)
    )
  }, [conflict, status])

  useEffect(() => {
    if (!conflictOpen || conflict === null) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') useGitStore.getState().closeConflicts()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [conflictOpen, conflict])

  if (project === null || !conflictOpen || conflict === null) return null

  const close = (): void => useGitStore.getState().closeConflicts()
  const op = conflict.state === 'rebase' ? 'rebase' : 'merge'

  const startAiSession = (paths: string[]): void => {
    const prompt =
      paths.length === 1
        ? t(
            'Resolve the git {op} conflict in {path}: edit the file to remove the conflict markers (<<<<<<<, =======, >>>>>>>) keeping the correct code, then stage it with `git add`.',
            { op, path: paths[0] }
          )
        : t(
            'Resolve the git {op} conflicts in the project. For each file below: edit it to remove the conflict markers (<<<<<<<, =======, >>>>>>>) keeping the correct code, then stage it with `git add`. Files:\n{files}',
            { op, files: paths.map((p) => `- ${p}`).join('\n') }
          )
    void window.piwright.newSession(project).then((ref) => {
      draftMap.set(ref.hostId, prompt)
      useTabsStore.getState().setActiveProject(parentTabKey(project))
      useTabsStore.getState().activateSession(project)
      useSessionsStore.getState().setActive(ref.hostId)
    })
    close()
  }

  const abort = (): void => {
    void confirmDialog({
      message: t('Abort the {op}? Resolved files stay staged, the operation is cancelled.', { op }),
      confirmLabel: t('Abort'),
      danger: true
    }).then((ok) => {
      if (ok) void useGitStore.getState().abortConflict(project)
    })
  }

  return (
    <div
      className="files-rename-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="files-rename-box conflict-box">
        <div className="conflict-title">
          <span>{t('Resolve Conflicts')}</span>
          <span className="conflict-op">{conflict.state === 'rebase' ? t('Rebase in progress') : t('Merge in progress')}</span>
        </div>
        {files.length === 0 && <div className="panel-hint">{t('No conflicting files')}</div>}
        <div className="conflict-list">
          {files.map((e) => (
            <div key={e.path} className="conflict-row" title={e.path}>
              <span className="git-badge conflict">
                {e.index}
                {e.worktree}
              </span>
              <span className="conflict-path">{e.path}</span>
              <div className="conflict-row-actions">
                <button
                  title={t('Keep our version and mark resolved')}
                  disabled={busy}
                  onClick={() => void useGitStore.getState().resolveConflictSide(project, e.path, 'ours')}
                >
                  {t('Yours')}
                </button>
                <button
                  title={t('Keep their version and mark resolved')}
                  disabled={busy}
                  onClick={() => void useGitStore.getState().resolveConflictSide(project, e.path, 'theirs')}
                >
                  {t('Theirs')}
                </button>
                <button
                  title={t('Edit the file with conflict markers manually')}
                  onClick={() => useTabsStore.getState().openTab(project, { kind: 'file', path: e.path })}
                >
                  {t('Edit')}
                </button>
                <button title={t('Resolve with AI in a new session')} onClick={() => startAiSession([e.path])}>
                  AI
                </button>
                <button
                  title={t('Mark resolved (git add)')}
                  disabled={busy}
                  onClick={() => void useGitStore.getState().stage(project, [e.path])}
                >
                  ✓
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="conflict-actions">
          <button disabled={busy || files.length === 0} onClick={() => startAiSession(files.map((e) => e.path))}>
            {t('Resolve with AI')}
          </button>
          <button className="danger" disabled={busy} onClick={abort}>
            {t('Abort')}
          </button>
          <button className="primary" disabled={busy} onClick={() => void useGitStore.getState().continueConflict(project)}>
            {t('Continue')}
          </button>
        </div>
      </div>
    </div>
  )
}
