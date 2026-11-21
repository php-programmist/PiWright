/** Просмотр диффа — контент вкладки проекта (вкладками управляет TabBar): стрелки листают
 *  открытые дифф-вкладки (новые не открывают), переключение unified/side-by-side. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { DiffEditor } from '../../components/DiffEditor'
import { useGitStore } from '../../stores/git'
import { tabId, useTabsStore } from '../../stores/tabs'
import { useT } from '../../lib/i18n'
import { baseName } from './GitPanel'
import type { ProjectTab } from '../../stores/tabs'

export function DiffOverlay({ tab }: { tab: ProjectTab }): React.JSX.Element | null {
  const t = useT()
  const path = tab.path ?? ''
  const selectedPath = useGitStore((s) => s.selectedPath)
  const diff = useGitStore((s) => s.diff)
  const diffLoading = useGitStore((s) => s.diffLoading)
  const [sideBySide, setSideBySide] = useState(true)
  const loadedRef = useRef(false)

  useEffect(() => {
    const git = useGitStore.getState()
    if (git.selectedPath !== path || (git.diff === null && !git.diffLoading)) void git.openFile(tab.project, path)
  }, [tab.project, path])

  // Дифф файла исчез из статуса (закоммичен/откачен) — закрываем его вкладку.
  useEffect(() => {
    if (selectedPath === path) loadedRef.current = true
    if (loadedRef.current && selectedPath === null && !diffLoading) {
      loadedRef.current = false
      useTabsStore.getState().closeTab(tab.project, tabId(tab))
    }
  }, [selectedPath, diffLoading, tab, path])

  const allTabs = useTabsStore((s) => (s.activeProjectKey !== null ? s.byProject[s.activeProjectKey]?.tabs : undefined))
  const diffTabs = useMemo(() => (allTabs ?? []).filter((x) => x.kind === 'diff'), [allTabs])

  const step = (delta: number): void => {
    if (diffTabs.length < 2) return
    const index = diffTabs.findIndex((x) => x.path === path)
    const next = index < 0 ? 0 : (index + delta + diffTabs.length) % diffTabs.length
    const target = diffTabs[next]
    useTabsStore.getState().setActive(target.project, tabId(target))
    void useGitStore.getState().openFile(target.project, target.path ?? '')
  }

  return (
    <div className="diff-overlay">
      <div className="diff-head">
        <button className="icon" title={t('Previous file')} onClick={() => step(-1)}>↑</button>
        <button className="icon" title={t('Next file')} onClick={() => step(1)}>↓</button>
        <span className="diff-title" title={path}>{baseName(path)}</span>
        <span className="spacer" />
        <button className={`diff-mode${sideBySide ? '' : ' active'}`} title={t('Unified diff')} onClick={() => setSideBySide(false)}>
          {t('Unified')}
        </button>
        <button className={`diff-mode${sideBySide ? ' active' : ''}`} title={t('Side-by-side diff')} onClick={() => setSideBySide(true)}>
          {t('Split')}
        </button>
      </div>
      <div className="diff-body">
        {diffLoading && <div className="panel-hint">{t('loading…')}</div>}
        {!diffLoading && diff !== null && (
          <DiffEditor path={path} original={diff.original} modified={diff.modified} sideBySide={sideBySide} />
        )}
      </div>
    </div>
  )
}
