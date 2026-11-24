/** Просмотр диффа — контент вкладки проекта (вкладками управляет TabBar): стрелки (кнопки
 *  и клавиши ↑/↓) листают файлы контекста — у коммита файлы коммита, у рабочей копии изменённые
 *  файлы статуса — открывая недостающие вкладки; переключение unified/side-by-side. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { DiffEditor } from '../../components/DiffEditor'
import { useGitStore } from '../../stores/git'
import { tabId, useTabsStore } from '../../stores/tabs'
import { useT } from '../../lib/i18n'
import { baseName } from './GitPanel'
import type { ProjectTab } from '../../stores/tabs'

export function DiffOverlay({ tab }: { tab: ProjectTab }): React.JSX.Element | null {
  const t = useT()
  const path = tab.path ?? ''
  const commitHash = tab.hash
  const selectedPath = useGitStore((s) => s.selectedPath)
  const diff = useGitStore((s) => s.diff)
  const diffLoading = useGitStore((s) => s.diffLoading)
  const [sideBySide, setSideBySide] = useState(true)
  const [contextFiles, setContextFiles] = useState<string[] | null>(null)
  const loadedRef = useRef(false)

  useEffect(() => {
    const git = useGitStore.getState()
    if (commitHash !== undefined) {
      if (git.selectedPath !== path || git.commitHash !== commitHash || (git.diff === null && !git.diffLoading)) {
        void git.openCommitFile(tab.project, commitHash, path)
      }
      return
    }
    if (git.selectedPath !== path || (git.diff === null && !git.diffLoading)) void git.openFile(tab.project, path)
  }, [tab.project, path, commitHash])

  // Дифф файла исчез из статуса (закоммичен/откачен) — закрываем его вкладку (только рабочая копия).
  useEffect(() => {
    if (commitHash !== undefined) return
    if (selectedPath === path) loadedRef.current = true
    if (loadedRef.current && selectedPath === null && !diffLoading) {
      loadedRef.current = false
      useTabsStore.getState().closeTab(tab.project, tabId(tab))
    }
  }, [selectedPath, diffLoading, tab, path, commitHash])

  // Список файлов контекста для листания стрелками: у коммита — файлы коммита,
  // у рабочей копии — изменённые файлы статуса.
  useEffect(() => {
    let cancelled = false
    if (commitHash !== undefined) {
      void window.piwright.gitCommitFiles(tab.project, commitHash).then((r) => {
        if (!cancelled) setContextFiles(r.ok ? r.files.map((f) => f.path) : null)
      })
    } else {
      void window.piwright.gitStatus(tab.project).then((r) => {
        if (!cancelled) setContextFiles(r.ok && r.status !== null ? r.status.entries.map((e) => e.path) : null)
      })
    }
    return () => {
      cancelled = true
    }
  }, [tab.project, commitHash])

  const step = useCallback(
    (delta: number): void => {
      if (contextFiles === null || contextFiles.length < 2) return
      const index = contextFiles.indexOf(path)
      if (index < 0) return
      const nextPath = contextFiles[(index + delta + contextFiles.length) % contextFiles.length]
      const git = useGitStore.getState()
      if (commitHash !== undefined) {
        useTabsStore.getState().openTab(tab.project, { kind: 'diff', path: nextPath, hash: commitHash })
        void git.openCommitFile(tab.project, commitHash, nextPath)
      } else {
        useTabsStore.getState().openTab(tab.project, { kind: 'diff', path: nextPath })
        void git.openFile(tab.project, nextPath)
      }
    },
    [contextFiles, path, commitHash, tab.project]
  )

  // Клавиши ↑/↓ листают диффы, пока фокус не внутри Monaco/поля ввода (там стрелки — курсор).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      if (e.target instanceof Element && e.target.closest('.monaco-editor, input, textarea, select')) return
      e.preventDefault()
      step(e.key === 'ArrowDown' ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step])

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
