/** Общий грид результатов БД (DbTableTab и DbConsoleTab): колонки/строки, NULL — приглушённый,
 *  объекты — JSON, длинные значения — ellipsis + title. Сортировка/фильтры — опциональны
 *  (onSort + sortOrder для заголовков DbTableTab, filterRow — вторая строка thead).
 *  Режим редактирования (editable): клик по ячейке — инпут (Enter/blur — применить в буфер,
 *  Escape — отмена), ПКМ — контекстное меню ячейки/строки через onCellContextMenu. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { DbColumn, DbTableOrder } from '../../../../shared/ipc-contracts'

export function cellText(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** Цель правки: строка данных (row) или добавленная строка буфера (insert). */
export interface DbCellTarget {
  row?: number
  insert?: number
  column: string
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
  /** Редактирование включено (у таблицы есть PK). */
  editable?: boolean
  /** Буфер правок строки данных: переопределённые значения + флаг удаления. */
  pendingForRow?: (row: number) => { values: Record<string, string | null>; deleted: boolean } | null
  /** Добавленные строки буфера (рендерятся после данных). */
  insertRows?: Record<string, string | null>[]
  /** Применить правку ячейки в буфер (value — текст; null не приходит — NULL ставится через ПКМ). */
  onCellCommit?: (target: DbCellTarget, value: string) => void
  /** ПКМ по ячейке (координаты события + цель). */
  onCellContextMenu?: (e: React.MouseEvent, target: DbCellTarget) => void
}

export function DbGrid({ columns, rows, loading, emptyText, onSort, sortOrder, filterRow, editable, pendingForRow, insertRows, onCellCommit, onCellContextMenu }: DbGridProps): React.JSX.Element {
  const [editing, setEditing] = useState<DbCellTarget | null>(null)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (editing !== null) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const startEdit = (target: DbCellTarget, value: string | null): void => {
    setEditing(target)
    setDraft(value === null ? '' : cellText(value))
  }

  const finishEdit = (commit: boolean): void => {
    if (editing !== null && commit) onCellCommit?.(editing, draft)
    setEditing(null)
  }

  const displayValue = (target: DbCellTarget, original: unknown): string | null => {
    const pending = target.insert === undefined ? pendingForRow?.(target.row ?? -1) ?? null : null
    const values = target.insert !== undefined ? insertRows?.[target.insert] : pending?.values
    const overridden = values !== undefined && Object.hasOwn(values, target.column) ? values[target.column] : undefined
    if (overridden !== undefined) return overridden
    if (original === null || original === undefined) return null
    return cellText(original)
  }

  const cellClasses = (target: DbCellTarget, original: unknown, deleted: boolean): string | undefined => {
    const classes: string[] = []
    if (original === null || original === undefined) classes.push('null')
    const pending = target.insert === undefined ? pendingForRow?.(target.row ?? -1) ?? null : null
    const values = target.insert !== undefined ? insertRows?.[target.insert] : pending?.values
    if (values !== undefined && Object.hasOwn(values, target.column)) classes.push('db-cell-pending')
    if (deleted) classes.push('db-cell-deleted')
    return classes.length > 0 ? classes.join(' ') : undefined
  }

  const renderCell = (target: DbCellTarget, original: unknown): React.JSX.Element => {
    const isEditing = editing !== null && editing.row === target.row && editing.insert === target.insert && editing.column === target.column
    const value = displayValue(target, original)
    if (isEditing) {
      return (
        <input
          ref={inputRef}
          className="db-cell-input"
          value={draft}
          placeholder="NULL"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => finishEdit(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') finishEdit(true)
            if (e.key === 'Escape') finishEdit(false)
            e.stopPropagation()
          }}
        />
      )
    }
    return <span className="db-cell-text">{value === null ? 'NULL' : value}</span>
  }

  const cellProps = (target: DbCellTarget, original: unknown, deleted: boolean) => ({
    key: target.column,
    className: cellClasses(target, original, deleted),
    title: cellText(original),
    onClick: editable ? () => startEdit(target, displayValue(target, original)) : undefined,
    onContextMenu: editable
      ? (e: React.MouseEvent) => {
          e.preventDefault()
          if (editing !== null) finishEdit(true)
          onCellContextMenu?.(e, target)
        }
      : undefined
  })

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
        {rows.map((row, index) => {
          const pending = pendingForRow?.(index) ?? null
          const deleted = pending?.deleted === true
          return (
            <tr key={index} className={deleted ? 'db-row-deleted' : undefined}>
              {columns.map((column, cell) => {
                const target: DbCellTarget = { row: index, column: column.name }
                return <td {...cellProps(target, row[cell], deleted)}>{renderCell(target, row[cell])}</td>
              })}
            </tr>
          )
        })}
        {(insertRows ?? []).map((_values, index) => (
          <tr key={`insert-${index}`} className="db-row-insert">
            {columns.map((column) => {
              const target: DbCellTarget = { insert: index, column: column.name }
              return <td {...cellProps(target, null, false)}>{renderCell(target, null)}</td>
            })}
          </tr>
        ))}
        {rows.length === 0 && (insertRows ?? []).length === 0 && !loading && (
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
