/** Вкладка данных таблицы БД: грид колонки/строки, пагинация LIMIT/OFFSET (50/100/200),
 *  сортировка кликом по заголовку (asc → desc → без сортировки), фильтры per-column
 *  (значение уходит только параметром запроса, идентификаторы квотирует драйвер).
 *  Число строк — count(*) с таймаутом на бэкенде; total === null → «≥ N» (увидено строк). */
import { useEffect, useRef, useState } from 'react'
import { useT } from '../../lib/i18n'
import type { DbTableDataResult, DbTableOrder } from '../../../../shared/ipc-contracts'
import type { ProjectTab } from '../../stores/tabs'

const PAGE_SIZES = [50, 100, 200]

function cellText(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function sortIndicator(order: DbTableOrder | null, column: string): string {
  if (order === null || order.column !== column) return '↕'
  return order.desc ? '▼' : '▲'
}

export function DbTableTab({ tab }: { tab: ProjectTab }): React.JSX.Element {
  const t = useT()
  // db-table вкладка всегда несёт payload (tabId требует); '' — только для типов.
  const connectionId = tab.connectionId ?? ''
  const schema = tab.schema ?? ''
  const table = tab.table ?? ''
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0])
  const [offset, setOffset] = useState(0)
  const [orderBy, setOrderBy] = useState<DbTableOrder | null>(null)
  const [filterDrafts, setFilterDrafts] = useState<Record<string, string>>({})
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [data, setData] = useState<DbTableDataResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
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

  const columns = data?.ok === true ? data.columns : []
  const rows = data?.ok === true ? data.rows : []
  const total = data?.ok === true ? data.total : null
  const shown = offset + rows.length
  const hasMore = rows.length >= pageSize
  const hasFilters = Object.values(filters).some((value) => value.length > 0)

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
          <table className={'db-grid' + (loading ? ' db-grid-loading' : '')}>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.name} onClick={() => clickSort(column.name)} title={column.type ?? column.name}>
                    {column.name} <span className="db-grid-sort">{sortIndicator(orderBy, column.name)}</span>
                  </th>
                ))}
              </tr>
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
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  {row.map((value, cell) => (
                    <td key={cell} className={value === null || value === undefined ? 'null' : undefined} title={cellText(value)}>
                      {cellText(value)}
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={columns.length} className="db-grid-empty">
                    {t('no rows')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          !loading && <div className="panel-hint">{error ?? t('no rows')}</div>
        )}
      </div>
    </div>
  )
}
