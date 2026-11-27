/** KanbanThemeService: пользовательские темы досок в `%APPDATA%\PiWright\kanban-themes.json`.
 *  Дефолтные темы живут в коде (shared/kanban-theme.ts), здесь — только импортированные.
 *  Импорт/экспорт — через нативные диалоги (как выбор звуков в sounds.ts). */
import { dialog } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname } from 'node:path'
import type { KanbanThemeExportDataResult, KanbanThemeExportResult, KanbanThemeImportResult, KanbanThemeListResult } from '../../shared/ipc-contracts'
import { findKanbanTheme, isBuiltinKanbanThemeId, parseKanbanThemeDoc, serializeKanbanThemeDoc } from '../../shared/kanban-theme'
import type { KanbanTheme } from '../../shared/kanban-theme'
import { errorMessage } from '../../shared/errors'

const MAX_THEME_FILE_BYTES = 512 * 1024

function errorText(err: unknown): string {
  return errorMessage(err)
}

/** Чтение списка тем из JSON-файла (main и тесты); битый файл — пустой список. */
export function readKanbanThemes(file: string): KanbanTheme[] {
  if (!existsSync(file)) return []
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return parseKanbanThemeDoc(raw)
  } catch {
    return []
  }
}

/** Атомарная запись (tmp + rename) с бэкапом `.bak`. */
export function writeKanbanThemes(file: string, themes: readonly KanbanTheme[]): void {
  mkdirSync(dirname(file), { recursive: true })
  if (existsSync(file)) copyFileSync(file, `${file}.bak`)
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify(serializeKanbanThemeDoc(themes), null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
}

/** Слияние импортируемых тем со списком: своя тема с тем же id заменяется, дефолтные id недоступны. */
export function mergeKanbanThemes(current: readonly KanbanTheme[], incoming: readonly KanbanTheme[]): KanbanTheme[] {
  const out = [...current]
  for (const theme of incoming) {
    if (isBuiltinKanbanThemeId(theme.id)) continue
    const at = out.findIndex((item) => item.id === theme.id)
    if (at >= 0) out[at] = theme
    else out.push(theme)
  }
  return out
}

export class KanbanThemeService {
  constructor(private readonly filePath: string) {}

  get path(): string {
    return this.filePath
  }

  list(): KanbanThemeListResult {
    try {
      return { ok: true, error: null, themes: readKanbanThemes(this.filePath) }
    } catch (err) {
      return { ok: false, error: errorText(err), themes: [] }
    }
  }

  remove(id: string): KanbanThemeListResult {
    const current = readKanbanThemes(this.filePath)
    const next = current.filter((theme) => theme.id !== id)
    if (next.length === current.length) return { ok: false, error: 'Theme not found', themes: current }
    writeKanbanThemes(this.filePath, next)
    return { ok: true, error: null, themes: next }
  }

  /** Диалог «Открыть» → разбор JSON (одна тема, массив или { version, themes }) → слияние в файл. */
  async importWithDialog(): Promise<KanbanThemeImportResult> {
    const failed: KanbanThemeImportResult = { ok: false, error: null, themes: [], imported: 0, skipped: 0 }
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return { ...failed, error: 'cancelled' }
    const source = result.filePaths[0]
    try {
      if (statSync(source).size > MAX_THEME_FILE_BYTES) return { ...failed, error: 'Theme file is too large' }
      return this.importFromJson(readFileSync(source, 'utf8'))
    } catch (err) {
      return { ...failed, error: errorText(err) }
    }
  }

  /** Импорт из строки (веб-режим: файл выбран в браузере, содержимое пришло по RPC). */
  importFromJson(json: string): KanbanThemeImportResult {
    const failed: KanbanThemeImportResult = { ok: false, error: null, themes: [], imported: 0, skipped: 0 }
    if (json.length > MAX_THEME_FILE_BYTES) return { ...failed, error: 'Theme file is too large' }
    try {
      const raw: unknown = JSON.parse(json)
      const incoming = parseKanbanThemeDoc(raw)
      if (incoming.length === 0) return { ...failed, error: 'No valid themes in file' }
      const current = readKanbanThemes(this.filePath)
      const known = new Set(current.map((theme) => theme.id))
      const next = mergeKanbanThemes(current, incoming)
      writeKanbanThemes(this.filePath, next)
      return {
        ok: true,
        error: null,
        themes: next,
        imported: incoming.filter((theme) => !known.has(theme.id)).length,
        skipped: incoming.length - incoming.filter((theme) => !known.has(theme.id)).length
      }
    } catch (err) {
      return { ...failed, error: errorText(err) }
    }
  }

  /** Диалог «Сохранить» → экспорт одной темы (`*` — все пользовательские). Дефолтные темы берутся из кода. */
  async exportWithDialog(id: string): Promise<KanbanThemeExportResult> {
    const failed: KanbanThemeExportResult = { ok: false, error: null, path: '' }
    const payload = this.exportPayload(id)
    if (payload === null) return { ...failed, error: 'Theme not found' }
    const suggested = id === '*' ? 'kanban-themes.json' : `${id}.json`
    const result = await dialog.showSaveDialog({
      defaultPath: suggested,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || result.filePath === undefined) return { ...failed, error: 'cancelled' }
    const target = extname(result.filePath).length === 0 ? `${result.filePath}.json` : result.filePath
    try {
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, this.serializeExport(payload), 'utf8')
      return { ok: true, error: null, path: target }
    } catch (err) {
      return { ...failed, error: errorText(err) }
    }
  }

  /** Экспорт строкой (веб-режим): браузер скачивает файл сам. */
  exportToJson(id: string): KanbanThemeExportDataResult {
    const failed: KanbanThemeExportDataResult = { ok: false, error: null, name: '', json: '' }
    const payload = this.exportPayload(id)
    if (payload === null) return { ...failed, error: 'Theme not found' }
    return {
      ok: true,
      error: null,
      name: id === '*' ? 'kanban-themes.json' : `${id}.json`,
      json: this.serializeExport(payload)
    }
  }

  /** Темы для экспорта: свои по id, `*` — все пользовательские; дефолтная — из кода. */
  private exportPayload(id: string): KanbanTheme[] | null {
    const themes = readKanbanThemes(this.filePath)
    const payload = id === '*' ? themes : themes.filter((theme) => theme.id === id)
    if (payload.length === 0) {
      const builtin = findKanbanTheme(id)
      if (builtin !== undefined) payload.push(builtin)
    }
    return payload.length === 0 ? null : payload
  }

  private serializeExport(payload: readonly KanbanTheme[]): string {
    return `${JSON.stringify(serializeKanbanThemeDoc(payload), null, 2)}\n`
  }
}
