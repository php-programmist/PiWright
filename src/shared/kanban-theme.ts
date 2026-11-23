/** Темы оформления канбан-доски: акценты колонок + тонировка карточек.
 *  Тема — набор CSS-цветов; применяются как CSS-переменные в renderer (lib/kanban-theme.ts).
 *  Дефолтные темы живут в коде, пользовательские — в `%APPDATA%\PiWright\kanban-themes.json`. */

/** Палитра одной темы. Прозрачные (rgba) фоны выбраны так, чтобы читаться и на тёмной, и на светлой теме приложения. */
export interface KanbanTheme {
  /** Стабильный slug: `[a-z0-9][a-z0-9._-]{1,31}`. Занятые дефолтные id для импорта закрыты. */
  id: string
  /** Отображаемое имя. */
  name: string
  /** Акценты колонок по индексу (циклично), 1–12 цветов. */
  accents: string[]
  /** Фон колонки (обычно полупрозрачный). */
  columnTint: string
  columnBorder: string
  /** Фон карточки (обычно полупрозрачный). */
  cardTint: string
  cardBorder: string
  /** Цвет бейджей и счётчиков. */
  badge: string
}

export interface KanbanThemeDoc {
  version: 1
  themes: KanbanTheme[]
}

export const KANBAN_THEME_DOC_VERSION = 1
export const KANBAN_DEFAULT_THEME_ID = 'slate'
export const KANBAN_THEME_ACCENTS_MAX = 12
export const KANBAN_THEME_MAX = 200

const THEME_ID_REGEX = /^[a-z0-9][a-z0-9._-]{1,31}$/

/** Только безопасные CSS-цвета: hex, rgb()/rgba(), hsl()/hsla(), именованные. Иначе значение попадает в CSS-переменную. */
const COLOR_REGEX = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+%?\s*)?\)|hsla?\(\s*[\d.]+(deg)?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+%?\s*)?\)|[a-z]{3,20})$/

export const KANBAN_BUILTIN_THEMES: readonly KanbanTheme[] = [
  {
    id: 'slate',
    name: 'Slate',
    accents: ['#6f8bb5', '#8a93a0', '#5aa2e0', '#7f8fa6', '#9aa3ad'],
    columnTint: 'rgba(138, 147, 160, 0.10)',
    columnBorder: 'rgba(138, 147, 160, 0.30)',
    cardTint: 'rgba(138, 147, 160, 0.07)',
    cardBorder: 'rgba(138, 147, 160, 0.24)',
    badge: '#8a93a0'
  },
  {
    id: 'ocean',
    name: 'Ocean',
    accents: ['#3b9dd6', '#2fb3c9', '#5aa2e0', '#4fc3a1', '#7b8ff0'],
    columnTint: 'rgba(59, 157, 214, 0.12)',
    columnBorder: 'rgba(59, 157, 214, 0.32)',
    cardTint: 'rgba(59, 157, 214, 0.08)',
    cardBorder: 'rgba(59, 157, 214, 0.26)',
    badge: '#4a9dc4'
  },
  {
    id: 'forest',
    name: 'Forest',
    accents: ['#3fae62', '#67b93f', '#2fb39a', '#8fbf3f', '#4a9d7f'],
    columnTint: 'rgba(63, 174, 98, 0.12)',
    columnBorder: 'rgba(63, 174, 98, 0.32)',
    cardTint: 'rgba(63, 174, 98, 0.08)',
    cardBorder: 'rgba(63, 174, 98, 0.26)',
    badge: '#4fa86a'
  },
  {
    id: 'sunset',
    name: 'Sunset',
    accents: ['#e0873e', '#e0b23e', '#e05a7a', '#d0603f', '#c98fae'],
    columnTint: 'rgba(224, 135, 62, 0.12)',
    columnBorder: 'rgba(224, 135, 62, 0.32)',
    cardTint: 'rgba(224, 135, 62, 0.08)',
    cardBorder: 'rgba(224, 135, 62, 0.26)',
    badge: '#c98f5a'
  }
]

export function isBuiltinKanbanThemeId(id: unknown): id is string {
  return typeof id === 'string' && KANBAN_BUILTIN_THEMES.some((theme) => theme.id === id)
}

export function findKanbanTheme(id: string): KanbanTheme | undefined {
  return KANBAN_BUILTIN_THEMES.find((theme) => theme.id === id)
}

/** Тема по id: сначала пользовательские, затем дефолтные; битый/удалённый id — дефолтная. */
export function resolveKanbanTheme(custom: readonly KanbanTheme[], id: string): KanbanTheme {
  return (
    custom.find((theme) => theme.id === id) ??
    findKanbanTheme(id) ??
    KANBAN_BUILTIN_THEMES[0]
  )
}

/** Акцент колонки по индексу (палитра циклична). */
export function kanbanThemeAccent(theme: KanbanTheme, index: number): string {
  if (theme.accents.length === 0) return '#8a93a0'
  return theme.accents[((index % theme.accents.length) + theme.accents.length) % theme.accents.length]
}

export function isKanbanThemeColor(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 48 && COLOR_REGEX.test(value.trim().toLowerCase())
}

function sanitizeName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (trimmed.length === 0) return fallback
  return trimmed.slice(0, 40)
}

/** Тема из внешнего JSON (импорт); null — не тема или цвета не прошли валидацию. */
export function parseKanbanTheme(raw: unknown): KanbanTheme | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const rec = raw as Record<string, unknown>
  const id = typeof rec['id'] === 'string' ? rec['id'].trim().toLowerCase() : ''
  if (!THEME_ID_REGEX.test(id) || isBuiltinKanbanThemeId(id)) return null

  const rawAccents = rec['accents']
  if (!Array.isArray(rawAccents) || rawAccents.length === 0 || rawAccents.length > KANBAN_THEME_ACCENTS_MAX) return null
  const accents: string[] = []
  for (const accent of rawAccents) {
    if (!isKanbanThemeColor(accent)) return null
    accents.push(accent.trim())
  }

  const colors: string[] = []
  for (const key of ['columnTint', 'columnBorder', 'cardTint', 'cardBorder', 'badge'] as const) {
    if (!isKanbanThemeColor(rec[key])) return null
    colors.push(String(rec[key]).trim())
  }

  return {
    id,
    name: sanitizeName(rec['name'], id),
    accents,
    columnTint: colors[0],
    columnBorder: colors[1],
    cardTint: colors[2],
    cardBorder: colors[3],
    badge: colors[4]
  }
}

/** Импортный документ: тема, массив тем или `{ version, themes }`. Пустой/битый — пустой список. */
export function parseKanbanThemeDoc(raw: unknown): KanbanTheme[] {
  const list = Array.isArray(raw)
    ? raw
    : raw !== null && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>)['themes'])
      ? ((raw as Record<string, unknown>)['themes'] as unknown[])
      : [raw]
  const out: KanbanTheme[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const theme = parseKanbanTheme(item)
    if (theme === null || seen.has(theme.id)) continue
    seen.add(theme.id)
    out.push(theme)
    if (out.length >= KANBAN_THEME_MAX) break
  }
  return out
}

export function serializeKanbanThemeDoc(themes: readonly KanbanTheme[]): KanbanThemeDoc {
  return { version: KANBAN_THEME_DOC_VERSION, themes: [...themes] }
}
