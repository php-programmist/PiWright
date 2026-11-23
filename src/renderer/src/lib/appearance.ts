/** Применение оформления: атрибут темы на <html>, размер шрифта чата, темы Monaco и xterm. */
import * as monaco from 'monaco-editor'
import type { CSSProperties } from 'react'
import type { Theme } from '../../../shared/ipc-contracts'
import type { KanbanTheme } from '../../../shared/kanban-theme'
import { kanbanThemeAccent } from '../../../shared/kanban-theme'
import { applyTermTheme } from '../views/terminal/term-registry'

export function applyAppearance(theme: Theme, chatFontSize: number): void {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.setProperty('--chat-font-size', `${chatFontSize}px`)
  monaco.editor.setTheme(theme === 'light' ? 'vs' : 'vs-dark')
  applyTermTheme(theme)
}

const KANBAN_THEME_VARS = ['--kb-column-tint', '--kb-column-border', '--kb-card-tint', '--kb-card-border', '--kb-badge'] as const

/** Палитра темы канбана в CSS-переменных :root; null — вернуть системные цвета. */
export function applyKanbanTheme(theme: KanbanTheme | null): void {
  const style = document.documentElement.style
  if (theme === null) {
    for (const name of KANBAN_THEME_VARS) style.removeProperty(name)
    return
  }
  style.setProperty('--kb-column-tint', theme.columnTint)
  style.setProperty('--kb-column-border', theme.columnBorder)
  style.setProperty('--kb-card-tint', theme.cardTint)
  style.setProperty('--kb-card-border', theme.cardBorder)
  style.setProperty('--kb-badge', theme.badge)
}

/** Стиль колонки: акцент палитры по её индексу (циклично). */
export function kanbanColumnStyle(theme: KanbanTheme | null, index: number): CSSProperties {
  if (theme === null) return {}
  return { '--kb-accent': kanbanThemeAccent(theme, index) } as CSSProperties
}
