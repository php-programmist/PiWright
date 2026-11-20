/** Чистые функции worktree-механики — порт `WorktreeManager.kt` (jb-pi).
 *  Пути здесь — на стороне бэкенда проекта (native — Windows, wsl — POSIX). */

const WORKTREE_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/

const WORKTREE_DIR_MARKER = '/.pi/worktrees/'

/** Латиница/цифры/дефис, не с дефиса, не пусто. */
export function validateWorktreeName(name: string): boolean {
  return WORKTREE_NAME_REGEX.test(name)
}

export function worktreeBranchFor(name: string): string {
  return `worktree-${name}`
}

export function worktreePathFor(repoRoot: string, name: string): string {
  return `${repoRoot.replace(/\/+$/, '')}${WORKTREE_DIR_MARKER}${name}`
}

/** Имя worktree, если cwd = <repoRoot>/.pi/worktrees/<name> (без вложенных сегментов). Иначе null. */
export function worktreeNameFromCwd(cwd: string): string | null {
  const normalized = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  const idx = normalized.lastIndexOf(WORKTREE_DIR_MARKER)
  if (idx < 0) return null
  const name = normalized.slice(idx + WORKTREE_DIR_MARKER.length)
  if (name.length === 0 || name.includes('/')) return null
  return name
}

/** Есть ли в выводе `worktree list --porcelain` worktree с каталогом …/.pi/worktrees/<name>. */
export function hasWorktreeNamed(porcelainOutput: string, name: string): boolean {
  return porcelainOutput
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim().replace(/\/+$/, ''))
    .some((path) => path.endsWith(WORKTREE_DIR_MARKER + name))
}

/** Отказ `git worktree remove` из-за незакоммиченных/неотслеживаемых файлов. */
export function isUncommittedChangesError(stderr: string): boolean {
  const s = stderr.toLowerCase()
  return s.includes('contains modified or untracked files') || s.includes('use --force')
}

/** Хост-каталог сессии worktree → { root, name } (слэши любые); не worktree — null. */
export function splitWorktreeHostDir(dir: string): { root: string; name: string } | null {
  const name = worktreeNameFromCwd(dir)
  if (name === null) return null
  const normalized = dir.replace(/\\/g, '/').trimEnd()
  return { root: normalized.slice(0, normalized.length - (WORKTREE_DIR_MARKER + name).length), name }
}

/** UNC-префикс WSL (`//wsl.localhost/…`, `//wsl$/…`) → POSIX-путь; иначе как есть (слэши вперёд). */
function normalizeDir(dir: string): string {
  const slashed = dir.replace(/\\/g, '/').replace(/\/+$/, '')
  const lower = slashed.toLowerCase()
  for (const prefix of ['//wsl.localhost/', '//wsl$/']) {
    if (lower.startsWith(prefix)) {
      const afterDistro = slashed.slice(prefix.length)
      const slash = afterDistro.indexOf('/')
      return slash < 0 ? '/' : afterDistro.slice(slash)
    }
  }
  return slashed
}

/** Равенство каталогов проекта: UNC WSL схлопывается в POSIX, слэши и хвостовые «/» не важны. */
export function sameProjectDir(a: string, b: string): boolean {
  return normalizeDir(a) === normalizeDir(b)
}
