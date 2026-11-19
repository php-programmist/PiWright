/** Просмотрщик файлов поверх ленты чата (паттерн DiffOverlay): вкладки открытых файлов,
 *  крестик вкладки закрывает её, крестик справа — обратно к чату (вкладки сохраняются). */
import { useMemo } from 'react'
import { FileEditor } from '../../components/FileEditor'
import { useFilesStore } from '../../stores/files'
import { useSessionsStore } from '../../stores/sessions'
import { baseName } from '../git/GitPanel'

export function FileViewer(): React.JSX.Element | null {
  const activeHostId = useSessionsStore((s) => s.activeHostId)
  const active = useSessionsStore((s) => s.active)
  const project = useMemo(() => active.find((r) => r.hostId === activeHostId)?.project ?? null, [active, activeHostId])
  const viewerOpen = useFilesStore((s) => s.viewerOpen)
  const tabs = useFilesStore((s) => s.tabs)
  const activePath = useFilesStore((s) => s.activePath)
  const contents = useFilesStore((s) => s.contents)
  const error = useFilesStore((s) => s.error)
  const setActiveTab = useFilesStore((s) => s.setActiveTab)
  const closeTab = useFilesStore((s) => s.closeTab)
  const closeViewer = useFilesStore((s) => s.closeViewer)
  const setError = useFilesStore((s) => s.setError)

  if (!viewerOpen || project === null || activePath === null) return null

  return (
    <div className="file-overlay">
      <div className="file-tabs">
        {tabs.map((tab) => (
          <div key={tab} className={`file-tab${tab === activePath ? ' active' : ''}`} title={tab} onClick={() => setActiveTab(tab)}>
            <span className="file-tab-name">{baseName(tab)}</span>
            <button
              className="icon"
              title="Close tab"
              onClick={(e) => {
                e.stopPropagation()
                closeTab(project, tab)
              }}
            >
              ×
            </button>
          </div>
        ))}
        <span className="spacer" />
        <button className="icon file-close" title="Close viewer (back to chat)" onClick={closeViewer}>×</button>
      </div>
      {error !== null && (
        <div className="files-error">
          <span>{error}</span>
          <button className="icon" onClick={() => setError(null)}>×</button>
        </div>
      )}
      <div className="file-body">
        <FileEditor path={activePath} content={contents[activePath] ?? ''} />
      </div>
    </div>
  )
}
