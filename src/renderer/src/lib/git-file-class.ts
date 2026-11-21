import type { GitFileEntry } from '../../../shared/ipc-contracts'

export const BADGE_CLASS: Record<string, string> = {
  M: 'mod',
  A: 'add',
  D: 'del',
  R: 'ren',
  C: 'ren',
  T: 'mod',
  U: 'conflict',
  '?': 'unt'
}

/** Класс цвета имени файла по git-статусу ('' — без изменений). */
export function fileStatusClass(entry: GitFileEntry): string {
  if (entry.untracked) return 'unt'
  if (entry.worktree !== '.') return BADGE_CLASS[entry.worktree] ?? 'mod'
  if (entry.index !== '.') return BADGE_CLASS[entry.index] ?? 'mod'
  return ''
}
