/** Просмотр диффа поверх ленты чата: стрелки — предыдущий/следующий файл,
 *  переключение unified/side-by-side, крестик закрытия (референс — дифф PHPStorm). */
import { useMemo, useState } from 'react'
import { DiffEditor } from '../../components/DiffEditor'
import { useGitStore } from '../../stores/git'
import { useSessionsStore } from '../../stores/sessions'
import { useT } from '../../lib/i18n'
import { baseName } from './GitPanel'

export function DiffOverlay(): React.JSX.Element | null {
  const t = useT()
  const activeHostId = useSessionsStore((s) => s.activeHostId)
  const active = useSessionsStore((s) => s.active)
  const project = useMemo(() => active.find((r) => r.hostId === activeHostId)?.project ?? null, [active, activeHostId])
  const selectedPath = useGitStore((s) => s.selectedPath)
  const diff = useGitStore((s) => s.diff)
  const diffLoading = useGitStore((s) => s.diffLoading)
  const status = useGitStore((s) => s.status)
  const closeFile = useGitStore((s) => s.closeFile)
  const openFile = useGitStore((s) => s.openFile)
  const [sideBySide, setSideBySide] = useState(true)

  const files = useMemo(
    () =>
      (status?.entries ?? [])
        .filter((e) => e.index !== '.' || e.worktree !== '.' || e.untracked)
        .map((e) => e.path),
    [status]
  )

  if (selectedPath === null || project === null) return null

  const step = (delta: number): void => {
    if (files.length === 0) return
    const index = files.indexOf(selectedPath)
    const next = index < 0 ? 0 : (index + delta + files.length) % files.length
    void openFile(project, files[next])
  }

  return (
    <div className="diff-overlay">
      <div className="diff-head">
        <button className="icon" title={t('Previous file')} onClick={() => step(-1)}>↑</button>
        <button className="icon" title={t('Next file')} onClick={() => step(1)}>↓</button>
        <span className="diff-title" title={selectedPath}>{baseName(selectedPath)}</span>
        <span className="spacer" />
        <button className={`diff-mode${sideBySide ? '' : ' active'}`} title={t('Unified diff')} onClick={() => setSideBySide(false)}>
          {t('Unified')}
        </button>
        <button className={`diff-mode${sideBySide ? ' active' : ''}`} title={t('Side-by-side diff')} onClick={() => setSideBySide(true)}>
          {t('Split')}
        </button>
        <button className="icon diff-close" title={t('Close diff (back to chat)')} onClick={closeFile}>×</button>
      </div>
      <div className="diff-body">
        {diffLoading && <div className="panel-hint">{t('loading…')}</div>}
        {!diffLoading && diff !== null && (
          <DiffEditor path={selectedPath} original={diff.original} modified={diff.modified} sideBySide={sideBySide} />
        )}
      </div>
    </div>
  )
}
