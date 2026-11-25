/** Чекпоинты кода для отката (rewind): карта «слот user-промпта → sha снапшота рабочего дерева»
 *  с персистентностью JSON-файлом на сессию (переживает перезапуск приложения). Снятие снапшота
 *  и восстановление — в GitService (checkpointCapture/checkpointRestore). */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProjectEntry } from '../../shared/ipc-contracts'
import type { GitService } from './git-service'

export interface CheckpointEntry {
  sha: string
  ts: number
}

interface CheckpointFile {
  slots: Record<string, CheckpointEntry>
}

export class CodeCheckpoints {
  constructor(
    private readonly git: GitService,
    /** Каталог хранения (userData/checkpoints); null — карта только в памяти. */
    private readonly dir: string | null
  ) {}

  capture(project: ProjectEntry): Promise<{ ok: boolean; error: string | null; sha: string | null }> {
    return this.git.checkpointCapture(project)
  }

  restore(project: ProjectEntry, sha: string): Promise<{ ok: boolean; error: string | null }> {
    return this.git.checkpointRestore(project, sha)
  }

  /** Карта чекпоинтов сессии; нет файла или битый JSON — пустая карта. */
  async load(sessionFile: string): Promise<Map<number, CheckpointEntry>> {
    const map = new Map<number, CheckpointEntry>()
    if (this.dir === null) return map
    let raw: string
    try {
      raw = await readFile(this.fileFor(sessionFile), 'utf8')
    } catch {
      return map
    }
    try {
      const parsed = JSON.parse(raw) as Partial<CheckpointFile>
      if (parsed.slots !== null && typeof parsed.slots === 'object') {
        for (const [slot, entry] of Object.entries(parsed.slots)) {
          const index = Number(slot)
          if (Number.isInteger(index) && index >= 0 && typeof entry?.sha === 'string' && typeof entry?.ts === 'number') {
            map.set(index, { sha: entry.sha, ts: entry.ts })
          }
        }
      }
    } catch {
      // битый файл — стартуем с пустой карты
    }
    return map
  }

  async save(sessionFile: string, map: Map<number, CheckpointEntry>): Promise<void> {
    if (this.dir === null) return
    const slots: Record<string, CheckpointEntry> = {}
    for (const [slot, entry] of map) slots[String(slot)] = entry
    const file = this.fileFor(sessionFile)
    await mkdir(this.dir, { recursive: true })
    const temp = `${file}.tmp`
    await writeFile(temp, JSON.stringify({ slots } satisfies CheckpointFile), 'utf8')
    await rename(temp, file)
  }

  /** Удалить карту сессии (вместе с историей сессии). */
  async drop(sessionFile: string): Promise<void> {
    if (this.dir === null) return
    try {
      await unlink(this.fileFor(sessionFile))
    } catch {
      // файла нет
    }
  }

  private fileFor(sessionFile: string): string {
    return join(this.dir as string, `${createHash('sha256').update(sessionFile).digest('hex')}.json`)
  }
}
