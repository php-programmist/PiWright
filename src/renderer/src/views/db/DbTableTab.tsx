/** Вкладка данных таблицы БД: грид (общий DbGrid), пагинация LIMIT/OFFSET (50/100/200),
 *  сортировка кликом по заголовку (asc → desc → без сортировки), фильтры per-column
 *  (значение уходит только параметром запроса, идентификаторы квотирует драйвер).
 *  Число строк — count(*) с таймаутом на бэкенде; total === null → «≥ N» (увидено строк).
 *  Редактирование (как в DataGrip): правки копятся в буфере (stores/db.pendingByTable),
 *  зелёная стрелка — превью SQL (флаг dbSqlPreview) и выполнение одной транзакцией,
 *  ↺ — отмена буфера. Без PK у таблицы редактирование запрещено (read-only). */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useT } from '../../lib/i18n'
import type { DbPendingChange, DbTableDataResult, DbTableOrder } from '../../../../shared/ipc-contracts'
import type { ProjectTab } from '../../stores/tabs'
import { dbTableKey, useDbStore } from '../../stores/db'
import { useSessionsStore } from '../../stores/sessions'
import { DbGrid, type DbCellTarget } from './DbGrid'

const PAGE_SIZES = [50, 100, 200]

/** Значения PK-колонок строки данных (строки — для сравнения с буфером). */
function rowKeys(primaryKeys: string[], columns: string[], row: unknown[]): Record<string, string | null> {
  const keys: Record<string, string | null> = {}
  for (const pk of primaryKeys) {
    const index = columns.indexOf(pk)
    const value = index >= 0 ? row[index] : null
    keys[pk] = value === null || value === undefined ? null : String(value)
  }
  return keys
}

function keysEqual(a: Record<string, string | null>, b: Record<string, string | null>): boolean {
  const names = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const name of names) {
    if (a[name] !== b[name]) return false
  }
  return true
}

/** Индекс n-го изменения заданного kind в буфере (или -1). */
function nthChangeIndex(changes: DbPendingChange[], kind: DbPendingChange['kind'], nth: number): number {
  let seen = -1
  for (let index = 0; index < changes.length; index++) {
    if (changes[index].kind !== kind) continue
    seen++
    if (seen === nth) return index
  }
  return -1
}

export function DbTableTab({ tab }: { tab: ProjectTab }): React.JSX.Element {
  const t = useT()
  // db-table вкладка всегда несёт payload (tabId требует); '' — только для типов.
  const connectionId = tab.connectionId ?? ''
  const schema = tab.schema ?? ''
  const table = tab.table ?? ''
  const pendingKey = dbTableKey(connectionId, schema, table)
  const pending = useDbStore((s) => s.pendingByTable[pendingKey])
  const dbPendingSet = useDbStore((s) => s.dbPendingSet)
  const dbPendingClear = useDbStore((s) => s.dbPendingClear)
  const sqlPreview = useSessionsStore((s) => s.settings?.dbSqlPreview ?? true)
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0])
  const [offset, setOffset] = useState(0)
  const [orderBy, setOrderBy] = useState<DbTableOrder | null>(null)
  const [filterDrafts, setFilterDrafts] = useState<Record<string, string>>({})
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [data, setData] = useState<DbTableDataResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [menu, setMenu] = useState<{ x: number; y: number; target: DbCellTarget } | null>(null)
  const [previewStatements, setPreviewStatements] = useState<string[] | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const seqRef = useRef(0)

  useEffect(() => {
    const seq = ++seqRef.current
    void (async () => {
      setLoading(true)
      const filterList = Object.entries(filters)
        .filter(([, value]) => value.length > 0)
        .map(([column, value]) => ({ column, value }))
      try {
        const result = await window.piwright.dbTableData({
          connectionId,
          schema,
          table,
          limit: pageSize,
          offset,
          orderBy,
          filters: filterList
        })
        if (seqRef.current !== seq) return
        setLoading(false)
        if (result.ok) {
          setData(result)
          setError(null)
        } else {
          setError(result.error)
        }
      } catch (err) {
        if (seqRef.current !== seq) return
        setLoading(false)
        setError(err instanceof Error ? err.message : String(err))
      }
    })()
  }, [connectionId, schema, table, pageSize, offset, orderBy, filters])

  // Контекстное меню ячейки закрывается кликом вне и Escape.
  useEffect(() => {
    if (menu === null) return
    const close = (): void => setMenu(null)
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menu])

  const columns = useMemo(() => (data?.ok === true ? data.columns : []), [data])
  const columnNames = useMemo(() => columns.map((c) => c.name), [columns])
  const rows = data?.ok === true ? data.rows : []
  const primaryKeys = data?.ok === true ? data.primaryKeys : []
  const editable = primaryKeys.length > 0
  const total = data?.ok === true ? data.total : null
  const shown = offset + rows.length
  const hasMore = rows.length >= pageSize
  const hasFilters = Object.values(filters).some((value) => value.length > 0)
  const changes = useMemo(() => pending ?? [], [pending])
  const insertRows = useMemo(() => changes.filter((c) => c.kind === 'insert').map((c) => c.values), [changes])

  const pendingForRow = (row: number): { values: Record<string, string | null>; deleted: boolean } | null => {
    if (row < 0 || row >= rows.length) return null
    const keys = rowKeys(primaryKeys, columnNames, rows[row])
    const update = changes.find((c) => c.kind === 'update' && keysEqual(c.keys, keys))
    const deleted = changes.some((c) => c.kind === 'delete' && keysEqual(c.keys, keys))
    if (update === undefined && !deleted) return null
    return { values: update?.values ?? {}, deleted }
  }

  const reload = (): void => {
    seqRef.current++
    setFilters((current) => ({ ...current }))
  }

  const commitCell = (target: DbCellTarget, value: string): void => {
    const next = [...changes]
    if (target.insert !== undefined) {
      const changeIndex = nthChangeIndex(changes, 'insert', target.insert)
      if (changeIndex < 0) return
      next[changeIndex] = { ...next[changeIndex], values: { ...next[changeIndex].values, [target.column]: value } }
      dbPendingSet(pendingKey, next)
      return
    }
    const rowIndex = target.row ?? -1
    if (rowIndex < 0 || rowIndex >= rows.length) return
    const keys = rowKeys(primaryKeys, columnNames, rows[rowIndex])
    if (changes.some((c) => c.kind === 'delete' && keysEqual(c.keys, keys))) return
    const original = rows[rowIndex][columnNames.indexOf(target.column)]
    const originalText = original === null || original === undefined ? null : String(original)
    if (value === originalText || (originalText === null && value === '')) {
      // Правка вернула исходное значение — убрать переопределение колонки.
      const existingIndex = next.findIndex((c) => c.kind === 'update' && keysEqual(c.keys, keys))
      if (existingIndex >= 0) {
        const values = { ...next[existingIndex].values }
        delete values[target.column]
        if (Object.keys(values).length === 0) next.splice(existingIndex, 1)
        else next[existingIndex] = { ...next[existingIndex], values }
        dbPendingSet(pendingKey, next)
      }
      return
    }
    const existingIndex = next.findIndex((c) => c.kind === 'update' && keysEqual(c.keys, keys))
    if (existingIndex >= 0) {
      next[existingIndex] = { ...next[existingIndex], values: { ...next[existingIndex].values, [target.column]: value } }
    } else {
      next.push({ kind: 'update', keys, values: { [target.column]: value } })
    }
    dbPendingSet(pendingKey, next)
  }

  const setCellNull = (target: DbCellTarget): void => {
    const next = [...changes]
    if (target.insert !== undefined) {
      const changeIndex = nthChangeIndex(changes, 'insert', target.insert)
      if (changeIndex < 0) return
      next[changeIndex] = { ...next[changeIndex], values: { ...next[changeIndex].values, [target.column]: null } }
      dbPendingSet(pendingKey, next)
      return
    }
    const rowIndex = target.row ?? -1
    if (rowIndex < 0 || rowIndex >= rows.length) return
    const keys = rowKeys(primaryKeys, columnNames, rows[rowIndex])
    if (changes.some((c) => c.kind === 'delete' && keysEqual(c.keys, keys))) return
    const existingIndex = next.findIndex((c) => c.kind === 'update' && keysEqual(c.keys, keys))
    if (existingIndex >= 0) {
      next[existingIndex] = { ...next[existingIndex], values: { ...next[existingIndex].values, [target.column]: null } }
    } else {
      next.push({ kind: 'update', keys, values: { [target.column]: null } })
    }
    dbPendingSet(pendingKey, next)
  }

  const addInsertRow = (): void => {
    dbPendingSet(pendingKey, [...changes, { kind: 'insert', keys: {}, values: {} }])
  }

  const removeInsertRow = (insert: number): void => {
    const inserts = changes.filter((c) => c.kind === 'insert')
    if (insert < 0 || insert >= inserts.length) return
    dbPendingSet(pendingKey, changes.filter((c) => c !== inserts[insert]))
  }

  const toggleDeleteRow = (row: number): void => {
    if (row < 0 || row >= rows.length) return
    const keys = rowKeys(primaryKeys, columnNames, rows[row])
    const deleted = changes.some((c) => c.kind === 'delete' && keysEqual(c.keys, keys))
    if (deleted) {
      dbPendingSet(pendingKey, changes.filter((c) => !(c.kind === 'delete' && keysEqual(c.keys, keys))))
      return
    }
    const next = changes.filter((c) => !(c.kind === 'update' && keysEqual(c.keys, keys)))
    next.push({ kind: 'delete', keys, values: {} })
    dbPendingSet(pendingKey, next)
  }

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    try {
      const result = await window.piwright.dbSubmit({
        connectionId,
        schema,
        table,
        primaryKeys,
        changes
      })
      if (result.ok) {
        dbPendingClear(pendingKey)
        setPreviewStatements(null)
        reload()
      } else {
        setError(result.error)
        setPreviewStatements(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPreviewStatements(null)
    } finally {
      setSubmitting(false)
    }
  }

  const submitClick = async (): Promise<void> => {
    if (changes.length === 0 || submitting) return
    if (!sqlPreview) {
      await submit()
      return
    }
    setSubmitting(true)
    try {
      const result = await window.piwright.dbSubmitPreview({ connectionId, schema, table, primaryKeys, changes })
      if (result.ok) setPreviewStatements(result.statements)
      else setError(result.error)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const clickSort = (column: string): void => {
    setOrderBy((current) => {
      if (current === null || current.column !== column) return { column, desc: false }
      if (!current.desc) return { column, desc: true }
      return null
    })
    setOffset(0)
  }

  const applyFilters = (): void => {
    setFilters({ ...filterDrafts })
    setOffset(0)
  }

  const clearFilters = (): void => {
    setFilterDrafts({})
    setFilters({})
    setOffset(0)
  }

  const changePageSize = (size: number): void => {
    setPageSize(size)
    setOffset(0)
  }

  const menuItems = (): { label: string; action: () => void; danger?: boolean }[] => {
    if (menu === null) return []
    const target = menu.target
    if (target.insert !== undefined) {
      const items: { label: string; action: () => void; danger?: boolean }[] = [{ label: t('Set NULL'), action: () => setCellNull(target) }]
      items.push({ label: t('Drop row'), action: () => removeInsertRow(target.insert ?? -1), danger: true })
      return items
    }
    const rowIndex = target.row ?? -1
    const keys = rowIndex >= 0 && rowIndex < rows.length ? rowKeys(primaryKeys, columnNames, rows[rowIndex]) : {}
    const deleted = changes.some((c) => c.kind === 'delete' && keysEqual(c.keys, keys))
    if (deleted) return [{ label: t('Restore row'), action: () => toggleDeleteRow(rowIndex) }]
    const items: { label: string; action: () => void; danger?: boolean }[] = [{ label: t('Set NULL'), action: () => setCellNull(target) }]
    items.push({ label: t('Delete row'), action: () => toggleDeleteRow(rowIndex), danger: true })
    return items
  }

  const rowsInfo =
    rows.length === 0
      ? t('no rows')
      : total !== null
        ? t('rows {shown} of {total}', { shown: String(shown), total: String(total) })
        : rows.length < pageSize
          ? t('rows {shown} of {total}', { shown: String(shown), total: String(shown) })
          : t('rows ≥ {count}', { count: String(shown) })

  return (
    <div className="db-table-tab">
      <div className="db-table-tab-head">
        <span>
          {schema}.{table}
        </span>
        <span className="spacer" />
        <button
          className="icon"
          title={t('Refresh')}
          onClick={() => {
            seqRef.current++
            setFilters((current) => ({ ...current }))
          }}
        >
          ⟲
        </button>
      </div>
      {error !== null && (
        <div className="git-error">
          <span>{error}</span>
          <button className="icon" onClick={() => setError(null)}>×</button>
        </div>
      )}
      <div className="db-table-toolbar">
        <span>{rowsInfo}</span>
        {loading && <span className="db-table-loading">{t('loading…')}</span>}
        <span className="spacer" />
        {hasFilters && (
          <button className="db-table-clear" onClick={clearFilters}>
            {t('Clear filters')} ×
          </button>
        )}
        {editable && (
          <button className="icon" title={t('Add row')} onClick={addInsertRow}>
            +
          </button>
        )}
        {changes.length > 0 && (
          <>
            <button className="icon" title={t('Revert pending changes')} onClick={() => dbPendingClear(pendingKey)}>
              ↺
            </button>
            <button className="icon db-submit-btn" title={t('Apply changes')} disabled={submitting} onClick={() => void submitClick()}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 13V3" />
                <path d="M3.5 7.5 8 3l4.5 4.5" />
              </svg>
              {changes.length}
            </button>
          </>
        )}
        <label className="db-table-size">
          {t('Page size')}
          <select value={pageSize} onChange={(e) => changePageSize(Number(e.target.value))}>
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <button className="icon" disabled={offset === 0} title={t('Previous page')} onClick={() => setOffset(Math.max(0, offset - pageSize))}>
          ‹
        </button>
        <button className="icon" disabled={!hasMore} title={t('Next page')} onClick={() => setOffset(offset + pageSize)}>
          ›
        </button>
      </div>
      <div className="db-table-scroll">
        {columns.length > 0 ? (
          <DbGrid
            columns={columns}
            rows={rows}
            loading={loading}
            emptyText={t('no rows')}
            onSort={clickSort}
            sortOrder={orderBy}
            editable={editable}
            pendingForRow={pendingForRow}
            insertRows={insertRows}
            onCellCommit={commitCell}
            onCellContextMenu={(e, target) => setMenu({ x: e.clientX, y: e.clientY, target })}
            filterRow={
              <tr className="db-grid-filters">
                {columns.map((column) => (
                  <th key={column.name}>
                    <input
                      value={filterDrafts[column.name] ?? ''}
                      title={`${t('Filter')}: ${column.name}`}
                      placeholder={filters[column.name]}
                      onChange={(e) => setFilterDrafts((current) => ({ ...current, [column.name]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') applyFilters()
                        if (e.key === 'Escape') setFilterDrafts((current) => ({ ...current, [column.name]: filters[column.name] ?? '' }))
                      }}
                    />
                  </th>
                ))}
              </tr>
            }
          />
        ) : (
          !loading && <div className="panel-hint">{error ?? t('no rows')}</div>
        )}
      </div>
      {menu !== null && (
        <div className="tab-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          {menuItems().map((item) => (
            <button
              key={item.label}
              className={'tab-menu-item' + (item.danger === true ? ' danger' : '')}
              onClick={() => {
                setMenu(null)
                item.action()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      {previewStatements !== null && (
        <div className="db-preview-overlay" onMouseDown={() => setPreviewStatements(null)}>
          <div className="db-preview-box" onMouseDown={(e) => e.stopPropagation()}>
            <div className="db-preview-head">
              <span>{t('Pending SQL')}</span>
              <span className="spacer" />
              <button className="icon" onClick={() => setPreviewStatements(null)}>×</button>
            </div>
            <pre className="db-preview-sql">
              {previewStatements.map((statement, index) => (
                <div key={index} className="db-preview-statement">
                  {statement};
                </div>
              ))}
            </pre>
            <div className="db-preview-actions">
              <button onClick={() => setPreviewStatements(null)}>{t('Cancel')}</button>
              <button className="db-preview-run" disabled={submitting} onClick={() => void submit()}>
                {t('Execute')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
