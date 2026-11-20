import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { BrowserWindow } from 'electron'

export interface WindowState {
  width: number
  height: number
  maximized: boolean
}

export const DEFAULT_WINDOW_STATE: WindowState = { width: 1100, height: 800, maximized: false }

const MIN_SIZE = 200

/** raw из файла → валидный WindowState: finite, не меньше MIN_SIZE, не больше workArea. */
export function sanitizeWindowState(raw: unknown, workArea: { width: number; height: number }): WindowState {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const pick = (key: string, fallback: number): number => {
    const value = source[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
    return Math.round(value)
  }
  return {
    width: Math.min(workArea.width, Math.max(MIN_SIZE, pick('width', DEFAULT_WINDOW_STATE.width))),
    height: Math.min(workArea.height, Math.max(MIN_SIZE, pick('height', DEFAULT_WINDOW_STATE.height))),
    maximized: source['maximized'] === true
  }
}

export function loadWindowState(filePath: string, workArea: { width: number; height: number }): WindowState {
  if (!existsSync(filePath)) return { ...DEFAULT_WINDOW_STATE }
  try {
    return sanitizeWindowState(JSON.parse(readFileSync(filePath, 'utf8')), workArea)
  } catch {
    return { ...DEFAULT_WINDOW_STATE }
  }
}

/** Обычные (не максимизированные) границы + флаг максимизации; запись tmp+rename. */
export function saveWindowState(filePath: string, win: BrowserWindow): void {
  const bounds = win.getNormalBounds()
  const state: WindowState = { width: bounds.width, height: bounds.height, maximized: win.isMaximized() }
  mkdirSync(dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, JSON.stringify(state), 'utf8')
  renameSync(tmp, filePath)
}
