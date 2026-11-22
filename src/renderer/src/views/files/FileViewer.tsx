/** Просмотрщик файла — контент вкладки проекта (вкладками управляет TabBar):
 *  картинки (data URL из files-стора), перенос длинных строк, live-редактирование md,
 *  кэш содержимого в files-сторе. */
import { useEffect } from 'react'
import { FileEditor } from '../../components/FileEditor'
import { MarkdownLive } from '../../components/MarkdownLive'
import { isImageFilePath } from '../../../../shared/attachments'
import { useFilesStore } from '../../stores/files'
import { useT } from '../../lib/i18n'
import type { ProjectTab } from '../../stores/tabs'

export function FileViewer({ tab }: { tab: ProjectTab }): React.JSX.Element {
  const t = useT()
  const contents = useFilesStore((s) => s.contents)
  const images = useFilesStore((s) => s.images)
  const error = useFilesStore((s) => s.error)
  const setError = useFilesStore((s) => s.setError)
  const wordWrap = useFilesStore((s) => s.wordWrap)
  const toggleWordWrap = useFilesStore((s) => s.toggleWordWrap)
  const path = tab.path ?? ''
  const isImage = isImageFilePath(path)

  useEffect(() => {
    const files = useFilesStore.getState()
    files.setProject(tab.project)
    void files.openFile(tab.project, path)
  }, [tab.project, path])

  return (
    <div className="file-view">
      <div className="file-view-head">
        <span className="spacer" />
        {!/\.(md|markdown)$/i.test(path) && !isImage && (
          <button className={`diff-mode${wordWrap ? ' active' : ''}`} title={t('Soft wrap long lines')} onClick={toggleWordWrap}>
            {t('Wrap')}
          </button>
        )}
      </div>
      {error !== null && (
        <div className="files-error">
          <span>{error}</span>
          <button className="icon" onClick={() => setError(null)}>×</button>
        </div>
      )}
      <div className="file-body">
        {isImage ? (
          <div className="file-image">
            {images[path] !== undefined ? (
              <img src={images[path]} alt={path.slice(path.lastIndexOf('/') + 1)} />
            ) : (
              <span className="file-image-empty">{t('Image is not loaded')}</span>
            )}
          </div>
        ) : /\.(md|markdown)$/i.test(path) ? (
          <MarkdownLive key={path} project={tab.project} path={path} content={contents[path] ?? ''} wordWrap={wordWrap} />
        ) : (
          <FileEditor project={tab.project} path={path} content={contents[path] ?? ''} wordWrap={wordWrap} />
        )}
      </div>
    </div>
  )
}
