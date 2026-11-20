/** Применение оформления: атрибут темы на <html>, размер шрифта чата, темы Monaco и xterm. */
import * as monaco from 'monaco-editor'
import type { Theme } from '../../../shared/ipc-contracts'
import { applyTermTheme } from '../views/terminal/term-registry'

export function applyAppearance(theme: Theme, chatFontSize: number): void {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.setProperty('--chat-font-size', `${chatFontSize}px`)
  monaco.editor.setTheme(theme === 'light' ? 'vs' : 'vs-dark')
  applyTermTheme(theme)
}
