/** Общий грид результатов БД (DbTableTab и DbConsoleTab): колонки/строки, NULL — приглушённый,
 *  объекты — JSON, длинные значения — ellipsis + title. Сортировка/фильтры — опциональны
 *  (onSort + sortOrder для заголовков DbTableTab, filterRow — вторая строка thead). */
import type { ReactNode } from 'react'
import type { DbColumn, DbTableOrder } from '../../../../shared/ipc-contracts'

export function cellText(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function sortIndicator(order: DbTableOrder | null, column: string): string {
  if (order === null || order.column !== column) return '↕'
  return order.desc ? '▼' : '▲'
}

interface DbGridProps {
  columns: DbColumn[]
  rows: unknown[][]
  loading?: boolean
  emptyText: string
  onSort?: (column: string) => void
  sortOrder?: DbTableOrder | null
  filterRow?: ReactNode
}

export function DbGrid({ columns, rows, loading, emptyText, onSort, sortOrder, filterRow }: DbGridProps): React.JSX.Element {
  return (
    <table className={'db-grid' + (loading ? ' db-grid-loading' : '')}>
      <thead>
        <tr>
          {columns.map((column) =>
            onSort ? (
              <th key={column.name} onClick={() => onSort(column.name)} title={column.type ?? column.name}>
                {column.name} <span className="db-grid-sort">{sortIndicator(sortOrder ?? null, column.name)}</span>
              </th>
            ) : (
              <th key={column.name} title={column.type ?? column.name}>
                {column.name}
              </th>
            )
          )}
        </tr>
        {filterRow}
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
            <td colSpan={Math.max(columns.length, 1)} className="db-grid-empty">
              {emptyText}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}
