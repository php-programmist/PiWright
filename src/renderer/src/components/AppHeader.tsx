/** Шапка приложения (референс PHPStorm): переключатель проекта, ветка с попапом,
 *  стрелки ahead/behind. Активный проект автоматически забирает изменения с remote
 *  (git fetch) — при переключении и раз в минуту. */
import { useEffect, useState } from 'react'
import { useGitStore } from '../stores/git'
import { useSessionsStore } from '../stores/sessions'
import { parentTabKey, useCenterProject, useTabsStore } from '../stores/tabs'
import { splitWorktreeHostDir } from '../../../shared/worktree'
import { useT } from '../lib/i18n'
import { BranchSelect } from './BranchSelect'

function dirName(dir: string): string {
  const parts = dir.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || dir
}

const FETCH_INTERVAL_MS = 60_000

export function AppHeader(): React.JSX.Element | null {
  const project = useCenterProject()
  const projects = useSessionsStore((s) => s.projects)
  const status = useGitStore((s) => s.status)
  const t = useT()
  const [open, setOpen] = useState(false)

  // Git-стор держит данные центрального проекта даже при закрытой панели Git.
  useEffect(() => {
    useGitStore.getState().setProject(project)
  }, [project])

  // Автоматический fetch активного проекта: при переключении и по интервалу.
  // Ошибки fetch (нет сети/remote) молча игнорируются — стрелки просто не обновляются.
  useEffect(() => {
    if (project === null) return
    let cancelled = false
    const run = (): void => {
      void window.piwright.gitFetch(project).then(() => {
        if (!cancelled) void useGitStore.getState().refreshStatus(project, true)
      })
    }
    run()
    const timer = setInterval(run, FETCH_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [project])

  if (project === null) return null

  const activeKey = parentTabKey(project)
  const hostDir = splitWorktreeHostDir(project.dir)?.root ?? project.dir
  const hostRow = projects.find((p) => parentTabKey(p.project) === activeKey)
  const projectName = hostRow?.project.name ?? dirName(hostDir)
  const ahead = status?.ahead ?? 0
  const behind = status?.behind ?? 0

  return (
    <header className="app-header">
      <div className="menu-wrap">
        <button className={`hdr-project${open ? ' raised' : ''}`} title={hostDir} onClick={() => setOpen((v) => !v)}>
          <span className="hdr-project-name">{projectName}</span>
          <span className="branch-chevron">▾</span>
        </button>
        {open && <div className="popup-overlay" onClick={() => setOpen(false)} />}
        {open && (
          <div className="project-menu">
            {projects.map((row) => {
              const key = parentTabKey(row.project)
              return (
                <button
                  key={key}
                  className={`project-menu-item${key === activeKey ? ' current' : ''}`}
                  onClick={() => {
                    setOpen(false)
                    useTabsStore.getState().setActiveProject(key)
                  }}
                >
                  <span className="hdr-item-name">{row.project.name ?? dirName(row.project.dir)}</span>
                  <span className="kind-badge">{row.project.kind === 'wsl' ? 'WSL' : 'Win'}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
      <BranchSelect project={project} branch={status?.branch ?? null} detached={status?.detached ?? false} />
      {ahead > 0 && (
        <span className="hdr-arrow up" title={t('Ahead: {count}', { count: ahead })}>
          ↑{ahead}
        </span>
      )}
      {behind > 0 && (
        <span className="hdr-arrow down" title={t('Behind: {count}', { count: behind })}>
          ↓{behind}
        </span>
      )}
      <span className="spacer" />
    </header>
  )
}
