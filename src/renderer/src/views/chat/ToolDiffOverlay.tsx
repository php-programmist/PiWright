/** Дифф вызова инструмента (edit/write) — контент вкладки проекта (вкладками управляет TabBar):
 *  оригинал/изменённый текст из stores/tool-diff (в памяти, вкладка не переживает рестарт),
 *  переключение unified/side-by-side. */
import { useState } from 'react'
import { DiffEditor } from '../../components/DiffEditor'
import { tabId, type ProjectTab } from '../../stores/tabs'
import { useToolDiffStore } from '../../stores/tool-diff'
import { useT } from '../../lib/i18n'
import { baseName } from '../git/GitPanel'

export function ToolDiffOverlay({ tab }: { tab: ProjectTab }): React.JSX.Element | null {
  const t = useT()
  const path = tab.path ?? ''
  const [sideBySide, setSideBySide] = useState(true)
  const content = useToolDiffStore((s) => s.contents[tabId(tab)])
  if (content === undefined) return null
  return (
    <div className="diff-overlay">
      <div className="diff-head">
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
        <DiffEditor path={path} original={content.original} modified={content.modified} sideBySide={sideBySide} />
      </div>
    </div>
  )
}
