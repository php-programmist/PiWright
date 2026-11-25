/** Обнаружение установленного обновления: версия прошлого запуска хранится в
 *  userData/update-state.json; не совпала с текущей — приложение обновилось. */
import { join } from 'path'
import { readFile, writeFile, mkdir } from 'fs/promises'

export interface UpdateState {
  lastVersion: string
}

export function updateStatePath(userDataDir: string): string {
  return join(userDataDir, 'update-state.json')
}

async function readState(userDataDir: string): Promise<UpdateState | null> {
  try {
    const raw = await readFile(updateStatePath(userDataDir), 'utf8')
    const parsed = JSON.parse(raw) as Partial<UpdateState>
    return typeof parsed.lastVersion === 'string' && parsed.lastVersion.length > 0 ? { lastVersion: parsed.lastVersion } : null
  } catch {
    return null
  }
}

/** Сравнивает версию прошлого запуска с текущей и записывает текущую.
 *  updatedFrom — версия, с которой обновились (null — первый запуск или без изменений). */
export async function consumeUpdateInfo(userDataDir: string, currentVersion: string): Promise<{ updatedFrom: string | null }> {
  const state = await readState(userDataDir)
  await mkdir(userDataDir, { recursive: true })
  await writeFile(updateStatePath(userDataDir), JSON.stringify({ lastVersion: currentVersion } satisfies UpdateState), 'utf8')
  const updatedFrom = state !== null && state.lastVersion !== currentVersion ? state.lastVersion : null
  return { updatedFrom }
}
