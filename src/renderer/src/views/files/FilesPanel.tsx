/** Панель дерева файлов проекта (справа, паттерн GitPanel): ленивая загрузка каталогов,
 *  клик по файлу — просмотрщик поверх чата. */
import { useEffect, useMemo } from 'react'
import { useFilesStore } from '../../stores/files'
import { useSessionsStore } from '../../stores/sessions'
import { persistPanel } from '../../stores/panels-prefs'
import type { ProjectEntry } from '../../../../shared/ipc-contracts'

function TreeLevel({ project, dir, depth }: { project: ProjectEntry; dir: string; depth: number }): React.JSX.Element | null {
  const listing = useFilesStore((s) => s.tree[dir])
  if (listing === undefined) return null
  if (listing.loading && listing.entries.length === 0) {
    return <div className="panel-hint" style={{ paddingLeft: 10 + depth * 14 }}>loading…</div>
  }
  return (
    <>
      {listing.entries.map((entry) =>
        entry.kind === 'dir' ? (
          <DirRow key={entry.name} project={project} parentDir={dir} name={entry.name} depth={depth} />
        ) : (
          <FileRow key={entry.name} project={project} dir={dir} name={entry.name} depth={depth} />
        )
      )}
    </>
  )
}

function DirRow({ project, parentDir, name, depth }: { project: ProjectEntry; parentDir: string; name: string; depth: number }): React.JSX.Element {
  const path = parentDir === '' ? name : `${parentDir}/${name}`
  const expanded = useFilesStore((s) => s.expanded[path] ?? false)
  const toggleDir = useFilesStore((s) => s.toggleDir)
  return (
    <>
      <div className="tree-row" style={{ paddingLeft: 6 + depth * 14 }} onClick={() => void toggleDir(project, path)}>
        <span className="tree-caret">{expanded ? '▾' : '▸'}</span>
        <span className="tree-name">{name}</span>
      </div>
      {expanded && <TreeLevel project={project} dir={path} depth={depth + 1} />}
    </>
  )
}

function FileRow({ project, dir, name, depth }: { project: ProjectEntry; dir: string; name: string; depth: number }): React.JSX.Element {
  const path = dir === '' ? name : `${dir}/${name}`
  const activePath = useFilesStore((s) => s.activePath)
  const openFile = useFilesStore((s) => s.openFile)
  return (
    <div
      className={`tree-row file${activePath === path ? ' current' : ''}`}
      style={{ paddingLeft: 6 + depth * 14 + 16 }}
      title={path}
      onClick={() => void openFile(project, path)}
    >
      <span className="tree-name">{name}</span>
    </div>
  )
}

function FilesError(): React.JSX.Element | null {
  const error = useFilesStore((s) => s.error)
  const setError = useFilesStore((s) => s.setError)
  if (error === null) return null
  return (
    <div className="files-error">
      <span>{error}</span>
      <button className="icon" onClick={() => setError(null)}>×</button>
    </div>
  )
}

export function FilesPanel(): React.JSX.Element {
  const activeHostId = useSessionsStore((s) => s.activeHostId)
  const active = useSessionsStore((s) => s.active)
  const project = useMemo(() => active.find((r) => r.hostId === activeHostId)?.project ?? null, [active, activeHostId])
  const width = useFilesStore((s) => s.width)
  const setWidth = useFilesStore((s) => s.setWidth)
  const refresh = useFilesStore((s) => s.refresh)

  useEffect(() => {
    useFilesStore.getState().setProject(project)
  }, [project])

  const startResize = (down: React.MouseEvent): void => {
    down.preventDefault()
    const move = (e: MouseEvent): void => setWidth(window.innerWidth - e.clientX)
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      persistPanel('files', { width: useFilesStore.getState().width })
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  if (project === null) {
    return (
      <aside className="files-panel" style={{ width }}>
        <div className="files-resizer" onMouseDown={startResize} />
        <div className="panel-hint">Pick a session to browse its files</div>
      </aside>
    )
  }

  return (
    <aside className="files-panel" style={{ width }}>
      <div className="files-resizer" onMouseDown={startResize} />
      <div className="files-head">
        <span className="files-title">Files</span>
        <span className="spacer" />
        <button className="icon" title="Refresh tree" onClick={() => void refresh(project)}>⟲</button>
      </div>
      <FilesError />
      <div className="files-body">
        <TreeLevel project={project} dir="" depth={0} />
      </div>
    </aside>
  )
}
