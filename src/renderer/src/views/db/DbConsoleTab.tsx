/** Вкладка консоли запросов БД: Monaco (язык sql), Ctrl+Enter или кнопка Run — db:query.
 *  SELECT — грид (общий DbGrid), прочее — число затронутых строк; ошибки inline, прошлый
 *  результат не сбрасывается. История запросов — в памяти стора (дропдаун над редактором).
 *  Одна вкладка на подключение (tabId = kind\0connectionId). */
import { useCallback, useEffect, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import { useT } from '../../lib/i18n'
import type { DbQueryResult } from '../../../../shared/ipc-contracts'
import type { ProjectTab } from '../../stores/tabs'
import { useDbStore } from '../../stores/db'
import { DbGrid } from './DbGrid'

export function DbConsoleTab({ tab }: { tab: ProjectTab }): React.JSX.Element {
  const t = useT()
  // db-console вкладка всегда несёт connectionId (tabId требует); '' — только для типов.
  const connectionId = tab.connectionId ?? ''
  const history = useDbStore((s) => s.queryHistory[connectionId])
  const [result, setResult] = useState<DbQueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const runningRef = useRef(false)
  const runRef = useRef<() => void>(() => {})

  const run = useCallback(async (): Promise<void> => {
    const editor = editorRef.current
    if (editor === null || runningRef.current) return
    const sql = editor.getValue().trim()
    if (sql.length === 0) return
    runningRef.current = true
    setRunning(true)
    const started = performance.now()
    try {
      const queryResult = await window.piwright.dbQuery(connectionId, sql)
      if (queryResult.ok) {
        setResult(queryResult)
        setError(null)
        useDbStore.getState().pushQueryHistory(connectionId, sql)
      } else {
        setError(queryResult.error)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      runningRef.current = false
      setRunning(false)
      setElapsed(Math.round(performance.now() - started))
    }
  }, [connectionId])

  useEffect(() => {
    runRef.current = () => void run()
  }, [run])

  useEffect(() => {
    const editor = monaco.editor.create(containerRef.current!, {
      theme: 'vs-dark',
      automaticLayout: true,
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
      fontSize: 12.5
    })
    editorRef.current = editor
    const model = monaco.editor.createModel('', 'sql', monaco.Uri.parse(`inmemory://db-console/${connectionId}`))
    editor.setModel(model)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current())
    return () => {
      model.dispose()
      editor.dispose()
      editorRef.current = null
    }
    // connectionId меняется только с remount вкладки (key=tabId).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const status =
    result !== null && result.ok && elapsed !== null
      ? result.isSelect
        ? t('{count} rows · {ms} ms', { count: String(result.rows.length), ms: String(elapsed) })
        : result.rowsAffected !== null
          ? t('OK · {count} rows affected · {ms} ms', { count: String(result.rowsAffected), ms: String(elapsed) })
          : t('OK · {ms} ms', { ms: String(elapsed) })
      : null

  return (
    <div className="db-console-tab">
      <div className="db-console-toolbar">
        <button className="db-console-run" disabled={running} title={t('Run (Ctrl+Enter)')} onClick={() => void run()}>
          ▶ {t('Run')}
        </button>
        <select
          className="db-console-history"
          value=""
          title={t('Query history')}
          onChange={(e) => {
            if (e.target.value.length > 0) editorRef.current?.setValue(e.target.value)
          }}
        >
          <option value="">{t('History')}</option>
          {(history ?? []).map((sql, index) => (
            <option key={index} value={sql}>
              {sql.length > 80 ? `${sql.slice(0, 80)}…` : sql}
            </option>
          ))}
        </select>
        <span className="spacer" />
        {running && <span className="db-table-loading">{t('loading…')}</span>}
        {status !== null && <span className="db-console-status">{status}</span>}
      </div>
      <div className="db-console-editor">
        <div ref={containerRef} className="db-console-editor-canvas" />
      </div>
      {error !== null && (
        <div className="git-error">
          <span>{error}</span>
          <button className="icon" onClick={() => setError(null)}>×</button>
        </div>
      )}
      <div className="db-console-results">
        {result?.ok === true && result.isSelect ? (
          <DbGrid columns={result.columns} rows={result.rows} emptyText={t('no rows')} />
        ) : result?.ok === true ? (
          <div className="panel-hint">
            {result.rowsAffected !== null
              ? t('OK · {count} rows affected', { count: String(result.rowsAffected) })
              : t('OK')}
          </div>
        ) : (
          <div className="panel-hint">{t('Results will appear here')}</div>
        )}
      </div>
    </div>
  )
}
