/** Панель дерева файлов проекта (справа, паттерн GitPanel): ленивая загрузка каталогов,
 *  клик по файлу — просмотрщик поверх чата, правый клик — меню (переименовать, удалить,
 *  копировать путь, обновить, создать папку/файл, добавить в контекст чата). */
import { useEffect, useRef, useState } from 'react'
import { useFilesStore } from '../../stores/files'
import { useGitStore } from '../../stores/git'
import { useTabsStore, useCenterProject } from '../../stores/tabs'
import { persistPanel } from '../../stores/panels-prefs'
import { confirmDialog } from '../../components/ConfirmDialog'
import { useT } from '../../lib/i18n'
import { isWindows } from '../../lib/platform'
import { canReveal } from '../../api/web'
import { injectIntoPrompt } from '../../lib/prompt-inject'
import { fileStatusClass } from '../../lib/git-file-class'
import type { GitStatus, ProjectEntry } from '../../../../shared/ipc-contracts'

type EntryKind = 'dir' | 'file'

interface MenuState {
  x: number
  y: number
  path: string
  kind: EntryKind | 'root'
}

interface DialogState {
  mode: 'rename' | 'newDir' | 'newFile'
  path: string
  value: string
}

/** dir проекта — хост-путь (native `D:\…` на Windows, posix на Linux, wsl UNC) → абсолютный путь. */
function absolutePath(dir: string, rel: string): string {
  const sep = isWindows ? '\\' : '/'
  return `${dir.replace(/[\\/]+$/, '')}${sep}${rel.replace(/\//g, sep)}`
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    document.body.appendChild(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }
}

function TreeLevel({ project, dir, depth, onMenu }: { project: ProjectEntry; dir: string; depth: number; onMenu: (path: string, kind: EntryKind, x: number, y: number) => void }): React.JSX.Element | null {
  const t = useT()
  const listing = useFilesStore((s) => s.tree[dir])
  if (listing === undefined) return null
  if (listing.loading && listing.entries.length === 0) {
    return <div className="panel-hint" style={{ paddingLeft: 10 + depth * 14 }}>{t('loading…')}</div>
  }
  return (
    <>
      {listing.entries.map((entry) =>
        entry.kind === 'dir' ? (
          <DirRow key={entry.name} project={project} parentDir={dir} name={entry.name} depth={depth} onMenu={onMenu} />
        ) : (
          <FileRow key={entry.name} project={project} dir={dir} name={entry.name} depth={depth} onMenu={onMenu} />
        )
      )}
    </>
  )
}

function DirRow({ project, parentDir, name, depth, onMenu }: { project: ProjectEntry; parentDir: string; name: string; depth: number; onMenu: (path: string, kind: EntryKind, x: number, y: number) => void }): React.JSX.Element {
  const path = parentDir === '' ? name : `${parentDir}/${name}`
  const expanded = useFilesStore((s) => s.expanded[path] ?? false)
  const toggleDir = useFilesStore((s) => s.toggleDir)
  return (
    <>
      <div
        className="tree-row"
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => void toggleDir(project, path)}
        onContextMenu={(e) => {
          e.preventDefault()
          onMenu(path, 'dir', e.clientX, e.clientY)
        }}
      >
        <span className="tree-caret">{expanded ? '▾' : '▸'}</span>
        <span className="tree-name">{name}</span>
      </div>
      {expanded && <TreeLevel project={project} dir={path} depth={depth + 1} onMenu={onMenu} />}
    </>
  )
}

function FileRow({ project, dir, name, depth, onMenu }: { project: ProjectEntry; dir: string; name: string; depth: number; onMenu: (path: string, kind: EntryKind, x: number, y: number) => void }): React.JSX.Element {
  const path = dir === '' ? name : `${dir}/${name}`
  const activePath = useTabsStore((s) => {
    const entry = s.activeProjectKey !== null ? s.byProject[s.activeProjectKey] : undefined
    return entry !== undefined && entry.activeId === `file\u0000${path}` ? path : null
  })
  const statusClass = useGitStore((s) => statusClassOf(s.status, path))
  return (
    <div
      className={`tree-row file${activePath === path ? ' current' : ''}`}
      style={{ paddingLeft: 6 + depth * 14 + 16 }}
      title={path}
      onClick={() => {
        useTabsStore.getState().openTab(project, { kind: 'file', path })
        void useFilesStore.getState().openFile(project, path)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(path, 'file', e.clientX, e.clientY)
      }}
    >
      <span className={`tree-name${statusClass === '' ? '' : ` ${statusClass}`}`}>{name}</span>
    </div>
  )
}

function statusClassOf(status: GitStatus | null, path: string): string {
  const entry = status?.entries.find((e) => e.path === path)
  return entry === undefined ? '' : fileStatusClass(entry)
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
  const project = useCenterProject()
  const width = useFilesStore((s) => s.width)
  const setWidth = useFilesStore((s) => s.setWidth)
  const rename = useFilesStore((s) => s.rename)
  const remove = useFilesStore((s) => s.remove)
  const createDir = useFilesStore((s) => s.createDir)
  const createFile = useFilesStore((s) => s.createFile)
  const reloadFile = useFilesStore((s) => s.reloadFile)
  const reloadDir = useFilesStore((s) => s.reloadDir)
  const t = useT()
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    useFilesStore.getState().setProject(project)
    useGitStore.getState().setProject(project)
  }, [project])

  useEffect(() => {
    if (menu === null) return
    const onDown = (e: MouseEvent): void => {
      if (menuRef.current !== null && !menuRef.current.contains(e.target as Node)) setMenu(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

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
        <div className="panel-hint">{t('Pick a session to browse its files')}</div>
      </aside>
    )
  }

  return (
    <aside className="files-panel" style={{ width }}>
      <div className="files-resizer" onMouseDown={startResize} />
      <div className="files-head">
        <span className="files-title">{t('Files')}</span>
        <span className="spacer" />
        <button className="icon" title={t('Refresh tree')} onClick={() => void reloadDir(project, '')}>⟲</button>
      </div>
      <FilesError />
      <div
        className="files-body"
        onContextMenu={(e) => {
          if (e.defaultPrevented) return
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, path: '', kind: 'root' })
        }}
      >
        <TreeLevel
          project={project}
          dir=""
          depth={0}
          onMenu={(path, kind, x, y) => setMenu({ x, y, path, kind })}
        />
      </div>
      {menu !== null && (
        <div
          className="files-menu"
          ref={menuRef}
          style={{
            left: Math.min(menu.x, window.innerWidth - 210),
            top: Math.min(menu.y, window.innerHeight - 300)
          }}
        >
          {menu.kind !== 'root' && (
            <button
              className="project-menu-item"
              onClick={() => {
                setDialog({ mode: 'rename', path: menu.path, value: menu.path.slice(menu.path.lastIndexOf('/') + 1) })
                setMenu(null)
              }}
            >
              {t('Rename')}
            </button>
          )}
          {menu.kind !== 'root' && (
            <button
              className="project-menu-item danger"
              onClick={() => {
                const name = menu.path.slice(menu.path.lastIndexOf('/') + 1)
                setMenu(null)
                void confirmDialog({ message: t('Delete "{name}"?', { name }), confirmLabel: t('Delete'), danger: true }).then(
                  (ok) => {
                    if (ok) void remove(project, menu.path)
                  }
                )
              }}
            >
              {t('Delete')}
            </button>
          )}
          {menu.kind !== 'root' && (
            <button
              className="project-menu-item"
              onClick={() => {
                void copyText(absolutePath(project.dir, menu.path))
                setMenu(null)
              }}
            >
              {t('Copy path')}
            </button>
          )}
          {menu.kind !== 'root' && (
            <button
              className="project-menu-item"
              onClick={() => {
                void copyText(menu.path)
                setMenu(null)
              }}
            >
              {t('Copy relative path')}
            </button>
          )}
          {menu.kind !== 'root' && project.kind !== 'ssh' && canReveal && (
            <button
              className="project-menu-item"
              onClick={() => {
                void window.piwright.filesReveal(project, menu.path)
                setMenu(null)
              }}
            >
              {t('Show in folder')}
            </button>
          )}
          {menu.kind === 'file' && (
            <button
              className="project-menu-item"
              onClick={() => {
                injectIntoPrompt(`@${menu.path}`)
                setMenu(null)
              }}
            >
              {t('Add to chat context')}
            </button>
          )}
          {menu.kind !== 'root' && (
            <button
              className="project-menu-item"
              onClick={() => {
                if (menu.kind === 'file') void reloadFile(project, menu.path)
                else void reloadDir(project, menu.path)
                setMenu(null)
              }}
            >
              {t('Refresh')}
            </button>
          )}
          {menu.kind !== 'file' && (
            <button
              className="project-menu-item"
              onClick={() => {
                setDialog({ mode: 'newDir', path: menu.path, value: '' })
                setMenu(null)
              }}
            >
              {t('New folder')}
            </button>
          )}
          {menu.kind !== 'file' && (
            <button
              className="project-menu-item"
              onClick={() => {
                setDialog({ mode: 'newFile', path: menu.path, value: '' })
                setMenu(null)
              }}
            >
              {t('New file')}
            </button>
          )}
        </div>
      )}
      {dialog !== null && (
        <div
          className="files-rename-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDialog(null)
          }}
        >
          <div className="files-rename-box">
            <div className="files-rename-title">
              {dialog.mode === 'rename' ? t('Rename') : dialog.mode === 'newDir' ? t('New folder') : t('New file')}
            </div>
            <input
              autoFocus
              value={dialog.value}
              onChange={(e) => setDialog({ ...dialog, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitDialog()
                if (e.key === 'Escape') setDialog(null)
              }}
              onFocus={(e) => e.target.select()}
            />
            <div className="files-rename-actions">
              <button onClick={() => setDialog(null)}>{t('Cancel')}</button>
              <button className="primary" onClick={() => void submitDialog()}>
                {dialog.mode === 'rename' ? t('Rename') : t('Create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )

  async function submitDialog(): Promise<void> {
    if (dialog === null || project === null) return
    const value = dialog.value.trim()
    if (value.length === 0 || value === '.' || value === '..' || /[\\/]/.test(value)) return
    if (dialog.mode === 'rename') {
      if (value === dialog.path.slice(dialog.path.lastIndexOf('/') + 1)) {
        setDialog(null)
        return
      }
      if (await rename(project, dialog.path, value)) setDialog(null)
      return
    }
    const ok =
      dialog.mode === 'newDir'
        ? await createDir(project, dialog.path, value)
        : await createFile(project, dialog.path, value)
    if (ok) setDialog(null)
  }
}
