import { editTexts, toolHeader } from '../lib/tool-blocks'
import type { ToolCall, ToolResult } from '../../../shared/agent-events'

/** Тул-блок: свёрнутая шапка (иконка, команда/путь), тело — вывод, патч или тексты правки. */
export function ToolBlock({ call, partial, result }: { call: ToolCall; partial: string; result: ToolResult | null }): React.JSX.Element {
  const header = toolHeader(call)
  const status = result === null ? (partial.length > 0 ? 'running…' : 'running…') : result.isError ? 'error' : 'done'
  const edits = editTexts(call)
  const body = result !== null ? result.text : partial
  return (
    <details className={`tool-block ${result?.isError ? 'error' : ''}`}>
      <summary>
        <span className="tool-icon">{header.icon}</span>
        <span className="tool-title">{header.title}</span>
        {header.detail.length > 0 && <span className="tool-detail">{header.detail}</span>}
        <span className={`tool-status ${status}`}>{status}</span>
      </summary>
      <div className="tool-body">
        {edits !== null && (
          <div className="edit-texts">
            <pre className="edit-old">{edits[0]}</pre>
            <pre className="edit-new">{edits[1]}</pre>
          </div>
        )}
        {result?.patch != null && <pre className="tool-patch">{result.patch}</pre>}
        {body.length > 0 && <pre className="tool-output">{body}</pre>}
      </div>
    </details>
  )
}
