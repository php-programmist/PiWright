import { bashCommand, editTexts, toolHeader } from '../lib/tool-blocks'
import { useFilesStore } from '../stores/files'
import { useSessionsStore } from '../stores/sessions'
import { useTabsStore } from '../stores/tabs'
import { useT } from '../lib/i18n'
import { toProjectRelative } from '../../../shared/file-paths'
import type { ToolCall, ToolResult } from '../../../shared/agent-events'
import type { ToolEntry } from '../stores/chat'

export function ToolBlock({ call, partial, result, subTools = [] }: { call: ToolCall; partial: string; result: ToolResult | null; subTools?: ToolEntry[] }): React.JSX.Element {
  const header = toolHeader(call)
  const status = result === null ? 'running…' : result.isError ? 'error' : 'done'
  const edits = editTexts(call)
  const body = result !== null ? result.text : partial
  const t = useT()
  const command = bashCommand(call)
  const activeHostId = useSessionsStore((s) => s.activeHostId)
  const project = useSessionsStore((s) => s.active.find((r) => r.hostId === activeHostId)?.project ?? null)
  const openFile = useFilesStore((s) => s.openFile)
  const rawPath = typeof call.args['path'] === 'string' ? call.args['path'] : null
  const relPath = rawPath !== null && project !== null ? toProjectRelative(project.dir, rawPath) : null
  return (
    <details className={`tool-block single ${result?.isError ? 'error' : ''}`}>
      <summary>
        <span className="tool-icon">{header.icon}</span>
        <span className="tool-title">{header.title}</span>
        {header.detail.length > 0 &&
          (relPath !== null && relPath.length > 0 && project !== null ? (
            <span
              className="tool-detail link"
              title={rawPath ?? undefined}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                useTabsStore.getState().openTab(project, { kind: 'file', path: relPath })
                void openFile(project, relPath)
              }}
            >
              {header.detail}
            </span>
          ) : (
            <span className="tool-detail">{header.detail}</span>
          ))}
        <span className={`tool-status ${status}`}>{t(status)}</span>
      </summary>
      <div className="tool-body">
        {command !== null && <pre className="tool-command">{command}</pre>}
        {edits !== null && (
          <div className="edit-texts">
            <pre className="edit-old">{edits[0]}</pre>
            <pre className="edit-new">{edits[1]}</pre>
          </div>
        )}
        {result?.patch != null && <pre className="tool-patch">{result.patch}</pre>}
        {subTools.length > 0 && (
          <div className="tool-children">
            {subTools.map((child) => (
              <ToolBlock key={child.call.id} call={child.call} partial={child.partial} result={child.result} subTools={child.children} />
            ))}
          </div>
        )}
        {body.length > 0 && <pre className="tool-output">{body}</pre>}
      </div>
    </details>
  )
}
