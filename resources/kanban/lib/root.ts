import { execFile } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const GIT_TIMEOUT_MS = 10_000

/** Корень досок: корень главного репо (dirname от `git rev-parse --git-common-dir`) —
 *  worktree-сессии видят общую доску; не-git проект или ошибка git — cwd.
 *  Расширение выполняется внутри pi (для WSL — тоже в WSL), поэтому git вызывается напрямую. */
export async function resolveKanbanRoot(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--git-common-dir'], {
      cwd,
      timeout: GIT_TIMEOUT_MS
    })
    const commonDir = stdout.trim()
    if (commonDir.length > 0) return dirname(resolve(cwd, commonDir))
  } catch {
    // не-git проект или git недоступен — доски рядом с проектом
  }
  return cwd
}
