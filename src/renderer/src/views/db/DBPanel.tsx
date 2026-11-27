/** DB-панель (правый рельс): дерево подключение → схемы → таблицы. Схемы и таблицы
 *  раскрываются лениво; чекбоксы схем задают видимые в дереве схемы (персист в
 *  DbConnectionEntry.selectedSchemas, пусто/undefined — все). Клик по таблице открывает
 *  центральную вкладку данных. */
import { useEffect } from 'react'
import { useCenterProject, parentTabKey, useTabsStore } from '../../stores/tabs'
import { dbTablesKey, useDbStore } from '../../stores/db'
import { persistPanel } from '../../stores/panels-prefs'
import { useT } from '../../lib/i18n'
import type { DbConnectionEntry } from '../../../../shared/ipc-contracts'

const CHEVRON_CLOSED = '▸'
const CHEVRON_OPEN = '▾'

function ErrorBanner(): React.JSX.Element | null {
  const error = useDbStore((s) => s.error)
  const setError = useDbStore((s) => s.setError)
  if (error === null) return null
  return (
    <div className="git-error">
      <span>{error}</span>
      <button className="icon" onClick={() => setError(null)}>×</button>
    </div>
  )
}

function TableRows({ connectionId, schema }: { connectionId: string; schema: string }): React.JSX.Element {
  const t = useT()
  const project = useCenterProject()
  const key = dbTablesKey(connectionId, schema)
  const tables = useDbStore((s) => s.tablesBySchema[key])
  const loading = useDbStore((s) => s.tablesLoading[key] === true)
  if (loading && tables === undefined) return <div className="db-tree-hint">{t('loading…')}</div>
  if (tables !== undefined && tables.length === 0) return <div className="db-tree-hint">{t('no tables')}</div>
  return (
    <>
      {(tables ?? []).map((table) => (
        <div
          key={table}
          className="db-tree-table"
          style={{ paddingLeft: 46 }}
          title={t('Open table data')}
          onClick={() => {
            if (project === null) return
            useTabsStore.getState().openTab(project, {
              kind: 'db-table',
              connectionId,
              schema,
              table,
              title: `${schema}.${table}`
            })
          }}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="1.5" y="2.5" width="13" height="11" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <line x1="1.5" y1="6" x2="14.5" y2="6" stroke="currentColor" strokeWidth="1.2" />
            <line x1="6" y1="6" x2="6" y2="13.5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
          <span>{table}</span>
        </div>
      ))}
    </>
  )
}

function SchemaRow({ connection, schema }: { connection: DbConnectionEntry; schema: string }): React.JSX.Element {
  const t = useT()
  const expanded = useDbStore((s) => s.expandedSchemas.has(dbTablesKey(connection.id, schema)))
  const selected = connection.selectedSchemas
  const checked = selected === undefined || selected.includes(schema)
  const toggle = (): void => {
    useDbStore.getState().toggleSchema(connection.id, schema)
  }
  const patchSelected = (nextChecked: boolean): void => {
    const store = useDbStore.getState()
    const all = store.schemasByConnection[connection.id] ?? []
    // Пустой список sanitizer настроек превращает в «все схемы» — последнюю схему не снимаем.
    if (!nextChecked) {
      const base = selected ?? all
      const next = base.filter((s) => s !== schema)
      store.setSelectedSchemas(connection.id, next.length > 0 && next.length < all.length ? next : undefined)
      return
    }
    if (selected === undefined) return
    const next = [...selected, schema]
    store.setSelectedSchemas(connection.id, next.length >= all.length ? undefined : next)
  }
  return (
    <>
      <div className="db-tree-schema" style={{ paddingLeft: 24 }}>
        <input
          type="checkbox"
          className="db-schema-check"
          checked={checked}
          title={t('Show schema in the tree')}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => patchSelected(e.target.checked)}
        />
        <button className="db-tree-chevron" onClick={toggle}>{expanded ? CHEVRON_OPEN : CHEVRON_CLOSED}</button>
        <span className="db-tree-name" onClick={toggle}>{schema}</span>
      </div>
      {expanded && <TableRows connectionId={connection.id} schema={schema} />}
    </>
  )
}

function ConnectionNode({ connection }: { connection: DbConnectionEntry }): React.JSX.Element {
  const t = useT()
  const project = useCenterProject()
  const expanded = useDbStore((s) => s.expandedConnections.has(connection.id))
  const schemas = useDbStore((s) => s.schemasByConnection[connection.id])
  const loading = useDbStore((s) => s.schemasLoading[connection.id] === true)
  const visible =
    schemas === undefined
      ? []
      : connection.selectedSchemas !== undefined && connection.selectedSchemas.length > 0
        ? schemas.filter((s) => connection.selectedSchemas?.includes(s))
        : schemas
  return (
    <>
      <div className="db-tree-connection" onClick={() => useDbStore.getState().toggleConnection(connection.id)}>
        <button className="db-tree-chevron">{expanded ? CHEVRON_OPEN : CHEVRON_CLOSED}</button>
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <ellipse cx="8" cy="3.8" rx="5.5" ry="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M2.5 3.8v8.4c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2V3.8" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M2.5 8c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
        <span className="db-tree-name">{connection.name}</span>
        <span className="db-tree-meta">{connection.kind === 'postgres' ? 'PostgreSQL' : 'MySQL'}</span>
        <span className="spacer" />
        <button
          className="icon"
          title={t('Open console')}
          onClick={(e) => {
            e.stopPropagation()
            if (project === null) return
            useTabsStore.getState().openTab(project, {
              kind: 'db-console',
              connectionId: connection.id,
              title: connection.name
            })
          }}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="1.5" y="2.5" width="13" height="11" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <path d="M4 6l2.4 2L4 10M8 10.2h4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {expanded && (
        <>
          {loading && schemas === undefined && <div className="db-tree-hint" style={{ paddingLeft: 34 }}>{t('loading…')}</div>}
          {schemas !== undefined && visible.length === 0 && (
            <div className="db-tree-hint" style={{ paddingLeft: 34 }}>{t('no schemas')}</div>
          )}
          {visible.map((schema) => (
            <SchemaRow key={schema} connection={connection} schema={schema} />
          ))}
        </>
      )}
    </>
  )
}

export function DBPanel(): React.JSX.Element {
  const t = useT()
  const width = useDbStore((s) => s.width)
  const setWidth = useDbStore((s) => s.setWidth)
  const connections = useDbStore((s) => s.connections)
  const loaded = useDbStore((s) => s.connectionsLoaded)
  const loading = useDbStore((s) => s.connectionsLoading)
  const project = useCenterProject()
  const key = project !== null ? parentTabKey(project) : null

  useEffect(() => {
    if (key !== null) void useDbStore.getState().load(key)
  }, [key])

  const startResize = (down: React.MouseEvent): void => {
    down.preventDefault()
    const move = (e: MouseEvent): void => setWidth(window.innerWidth - e.clientX)
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      persistPanel('db', { width: useDbStore.getState().width })
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <aside className="git-panel db-panel" style={{ width }} data-testid="db-panel">
      <div className="git-resizer" onMouseDown={startResize} />
      <div className="git-head">
        <span>{t('Databases')}</span>
        <span className="spacer" />
        <button
          className="icon"
          title={t('Add connection')}
          disabled={project === null}
          onClick={() => {
            if (project === null) return
            useDbStore.getState().requestAddEditor()
            useTabsStore.getState().openTab(project, { kind: 'db-settings' })
          }}
        >
          +
        </button>
        <button
          className="icon"
          title={t('Refresh')}
          disabled={key === null}
          onClick={() => {
            if (key !== null) void useDbStore.getState().refresh(key)
          }}
        >
          ⟲
        </button>
        <button
          className="icon"
          title={t('Collapse panel')}
          onClick={() => {
            useDbStore.getState().toggleOpen()
            persistPanel('db', { open: false })
          }}
        >
          −
        </button>
      </div>
      <ErrorBanner />
      <div className="git-body">
        {!loaded && loading && <div className="panel-hint">{t('loading…')}</div>}
        {loaded && connections.length === 0 && (
          <div className="panel-hint">{t('No connections yet — add one with the + button above')}</div>
        )}
        {connections.map((connection) => (
          <ConnectionNode key={connection.id} connection={connection} />
        ))}
      </div>
    </aside>
  )
}
