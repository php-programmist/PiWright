/** DB-панель (правый рельс): дерево подключение → схемы → таблицы. Схемы и таблицы
 *  раскрываются лениво; чекбоксы схем задают видимые в дереве схемы (персист в
 *  DbConnectionEntry.selectedSchemas, пусто/undefined — все). Клик по таблице открывает
 *  центральную вкладку данных. */
import { useEffect, useRef, useState } from 'react'
import { useCenterProject, parentTabKey, useTabsStore } from '../../stores/tabs'
import { dbTablesKey, useDbStore } from '../../stores/db'
import { persistPanel } from '../../stores/panels-prefs'
import { useSessionsStore } from '../../stores/sessions'
import { useT } from '../../lib/i18n'
import type { DbConnectionEntry } from '../../../../shared/ipc-contracts'

const CHEVRON_CLOSED = '▸'
const CHEVRON_OPEN = '▾'

type T = (key: string, params?: Record<string, string | number>) => string

/** «Проверить» из контекстного меню панели: реальный коннект с сохранёнными секретами. */
async function runConnectionTest(connection: DbConnectionEntry, t: T): Promise<void> {
  useDbStore.getState().setPanelTest(connection.id, { running: true, ok: false, text: '' })
  try {
    const result = await window.piwright.dbConnectionTest(connection, null)
    const text = result.ok ? `${t('Connected')} · ${result.serverVersion ?? ''}` : (result.error ?? t('Connection failed'))
    useDbStore.getState().setPanelTest(connection.id, { running: false, ok: result.ok, text })
  } catch (err) {
    useDbStore.getState().setPanelTest(connection.id, { running: false, ok: false, text: err instanceof Error ? err.message : String(err) })
  }
}

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
          <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
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

function ConnectionNode({ connection, onMenu }: {
  connection: DbConnectionEntry
  onMenu: (connection: DbConnectionEntry, x: number, y: number) => void
}): React.JSX.Element {
  const t = useT()
  const project = useCenterProject()
  const expanded = useDbStore((s) => s.expandedConnections.has(connection.id))
  const schemas = useDbStore((s) => s.schemasByConnection[connection.id])
  const loading = useDbStore((s) => s.schemasLoading[connection.id] === true)
  const testResult = useDbStore((s) => s.panelTests[connection.id])
  const visible =
    schemas === undefined
      ? []
      : connection.selectedSchemas !== undefined && connection.selectedSchemas.length > 0
        ? schemas.filter((s) => connection.selectedSchemas?.includes(s))
        : schemas
  return (
    <>
      <div
        className="db-tree-connection"
        onClick={() => useDbStore.getState().toggleConnection(connection.id)}
        onContextMenu={(e) => {
          e.preventDefault()
          onMenu(connection, e.clientX, e.clientY)
        }}
      >
        <button className="db-tree-chevron">{expanded ? CHEVRON_OPEN : CHEVRON_CLOSED}</button>
        <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
          <ellipse cx="8" cy="3.8" rx="5.5" ry="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M2.5 3.8v8.4c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2V3.8" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M2.5 8c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
        <span className="db-tree-name">{connection.name}</span>
        <span className="db-tree-meta">{connection.kind === 'postgres' ? 'PostgreSQL' : 'MySQL'}</span>
        <span className="spacer" />
        <button
          className="icon"
          title={t('Edit connection')}
          onClick={(e) => {
            e.stopPropagation()
            if (project === null) return
            useTabsStore.getState().openTab(project, {
              kind: 'db-settings',
              connectionId: connection.id,
              title: connection.name
            })
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
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
          <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="1.5" y="2.5" width="13" height="11" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <path d="M4 6l2.4 2L4 10M8 10.2h4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {testResult?.running === true && <div className="db-tree-hint" style={{ paddingLeft: 34 }}>{t('loading…')}</div>}
      {testResult !== undefined && !testResult.running && (
        <div className={`ssh-test-result ${testResult.ok ? 'ok' : 'err'}`} style={{ paddingLeft: 26 }}>{testResult.text}</div>
      )}
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
  const [menu, setMenu] = useState<{ x: number; y: number; connection: DbConnectionEntry } | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (key !== null) void useDbStore.getState().load(key)
  }, [key])

  useEffect(() => {
    if (menu === null) return
    const onDown = (e: MouseEvent): void => {
      if (menuRef.current !== null && !menuRef.current.contains(e.target as Node)) setMenu(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const openEditor = (connection: DbConnectionEntry): void => {
    setMenu(null)
    if (project === null) return
    useTabsStore.getState().openTab(project, { kind: 'db-settings', connectionId: connection.id, title: connection.name })
  }

  const openConsole = (connection: DbConnectionEntry): void => {
    setMenu(null)
    if (project === null) return
    useTabsStore.getState().openTab(project, { kind: 'db-console', connectionId: connection.id, title: connection.name })
  }

  const removeConnection = async (connection: DbConnectionEntry): Promise<void> => {
    setMenu(null)
    if (project === null || key === null) return
    const result = await window.piwright.dbConnectionDelete(key, connection.id)
    if (!result.ok) return
    const current = useSessionsStore.getState().settings
    if (current !== null) {
      const next = await window.piwright.setSettings({
        projectDbConnections: { ...current.projectDbConnections, [key]: result.connections }
      })
      useSessionsStore.getState().setSettings(next)
    }
    useDbStore.getState().setPanelTest(connection.id, undefined)
    void useDbStore.getState().refresh(key)
  }

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
          <ConnectionNode
            key={connection.id}
            connection={connection}
            onMenu={(connection, x, y) => setMenu({ x, y, connection })}
          />
        ))}
      </div>
      {menu !== null && (
        <div className="tab-menu" style={{ left: menu.x, top: menu.y }} ref={menuRef}>
          <button className="tab-menu-item" onClick={() => openEditor(menu.connection)}>{t('Edit')}</button>
          <button
            className="tab-menu-item"
            onClick={() => {
              setMenu(null)
              void runConnectionTest(menu.connection, t)
            }}
          >
            {t('Test')}
          </button>
          <button className="tab-menu-item" onClick={() => openConsole(menu.connection)}>{t('Open console')}</button>
          <button className="tab-menu-item" onClick={() => void removeConnection(menu.connection)}>{t('Delete')}</button>
        </div>
      )}
    </aside>
  )
}
