/** Обзор папок машины хоста для веб-режима (выбор проекта без нативного диалога):
 *  список подкаталогов + родительский каталог. Только каталоги, симлинки не раскрываются. */
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, resolve } from 'node:path'

export interface HostDirListResult {
  ok: boolean
  error: string | null
  path: string
  parent: string | null
  dirs: string[]
}

/** Родительский каталог или null (достигнут корень диска / «/»). */
export function parentOf(dir: string): string | null {
  const parent = dirname(dir)
  if (parent === dir) return null
  return parent
}

export async function listHostDir(rawPath: string): Promise<HostDirListResult> {
  const failed: HostDirListResult = { ok: false, error: null, path: rawPath, parent: null, dirs: [] }
  const trimmed = rawPath.trim()
  if (trimmed.length === 0) return { ...failed, error: 'Empty path' }
  if (!isAbsolute(trimmed)) return { ...failed, error: 'Path must be absolute' }
  const target = resolve(trimmed)
  try {
    const entries = await fs.readdir(target, { withFileTypes: true })
    const dirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
    return { ok: true, error: null, path: target, parent: parentOf(target), dirs }
  } catch (err) {
    return { ...failed, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Стартовый каталог обзора: домашняя папка юзера хоста. */
export function hostBrowseRoot(): string {
  return homedir()
}
