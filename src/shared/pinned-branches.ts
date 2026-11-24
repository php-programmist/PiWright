/** Закреплённые ветки проекта (ключ projectKey) — всегда вверху списка переключателя веток.
 *  Хранятся в settings.pinnedBranches, переживают перезапуск. */
import type { Settings } from './ipc-contracts'

/** Закреплённые из файла/settings:set поверх дефолтов: строковые ключи, массивы непустых строк. */
export function mergePinnedBranches(value: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return out
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (key.length === 0 || !Array.isArray(raw)) continue
    const names: string[] = []
    for (const item of raw) {
      if (typeof item === 'string' && item.length > 0 && !names.includes(item)) names.push(item)
    }
    if (names.length > 0) out[key] = names
  }
  return out
}

/** pinnedBranches в настройки; null — удалить ключ. */
export function setPinnedBranches(settings: Settings, key: string, names: string[] | null): Partial<Settings> {
  const next = { ...settings.pinnedBranches }
  if (names === null || names.length === 0) delete next[key]
  else next[key] = names
  return { pinnedBranches: next }
}

/** Порядок списка веток: закреплённые (в порядке закрепления) → main/master → остальные по алфавиту. */
export function sortBranches(branches: string[], pinned: readonly string[]): string[] {
  const pinIndex = new Map(pinned.map((name, index) => [name, index]))
  const isDefault = (name: string): boolean => name === 'main' || name === 'master'
  return [...branches].sort((a, b) => {
    const pa = pinIndex.get(a)
    const pb = pinIndex.get(b)
    if (pa !== undefined || pb !== undefined) {
      if (pa === undefined) return 1
      if (pb === undefined) return -1
      return pa - pb
    }
    const da = isDefault(a) ? 0 : 1
    const db = isDefault(b) ? 0 : 1
    if (da !== db) return da - db
    return a.localeCompare(b)
  })
}
