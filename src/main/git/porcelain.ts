/** Парсер `git status --porcelain=v2 --branch`. Формат: строки `# branch.*` — заголовок,
 *  `1` — обычные записи, `2` — переименования (`path<TAB>origPath`), `?` — untracked,
 *  `!` — ignored (пропускаем). Путь — последний столбец (может содержать пробелы),
 *  спецсимволы — в C-кавычках. */
import type { GitFileEntry, GitStatus } from '../../shared/ipc-contracts'

/** C-раскавычивание пути git (`"a\\b\tc"` → `a\b<c>`, `\NNN` — байты UTF-8). */
export function unquoteGitPath(path: string): string {
  if (!path.startsWith('"') || !path.endsWith('"') || path.length < 2) return path
  const body = path.slice(1, -1)
  const bytes: number[] = []
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch !== '\\') {
      bytes.push(...Buffer.from(ch, 'utf8'))
      continue
    }
    const next = body[++i]
    if (next === undefined) break
    if (next === 'n') bytes.push(0x0a)
    else if (next === 't') bytes.push(0x09)
    else if (next === 'r') bytes.push(0x0d)
    else if (next === '"') bytes.push(0x22)
    else if (next === '\\') bytes.push(0x5c)
    else if (next >= '0' && next <= '7') {
      let value = 0
      let digits = 0
      while (digits < 3 && i < body.length && body[i] >= '0' && body[i] <= '7') {
        value = value * 8 + (body.charCodeAt(i) - 0x30)
        i++
        digits++
      }
      i--
      bytes.push(value & 0xff)
    } else bytes.push(next.charCodeAt(0))
  }
  return Buffer.from(bytes).toString('utf8')
}

function statusChar(value: string | undefined): string {
  return value === undefined || value.length !== 1 ? '.' : value
}

export function parseStatusOutput(output: string): GitStatus {
  const status: GitStatus = {
    branch: null,
    upstream: null,
    ahead: null,
    behind: null,
    detached: false,
    entries: []
  }
  for (const rawLine of output.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line.length === 0) continue
    if (line.startsWith('# branch.head ')) {
      const name = line.slice('# branch.head '.length)
      status.detached = name === '(detached)'
      status.branch = status.detached ? null : name
      continue
    }
    if (line.startsWith('# branch.upstream ')) {
      status.upstream = line.slice('# branch.upstream '.length)
      continue
    }
    if (line.startsWith('# branch.ab ')) {
      const match = line.match(/\+(\d+) -(\d+)/)
      if (match !== null) {
        status.ahead = Number(match[1])
        status.behind = Number(match[2])
      }
      continue
    }
    if (line.startsWith('! ')) continue
    if (line.startsWith('? ')) {
      const entry: GitFileEntry = {
        path: unquoteGitPath(line.slice(2)),
        origPath: null,
        index: '.',
        worktree: '?',
        untracked: true
      }
      status.entries.push(entry)
      continue
    }
    if (line.startsWith('1 ')) {
      const fields = line.split(' ')
      // 1 XY sub mH mI mW hH hI <path с пробелами>
      const path = unquoteGitPath(fields.slice(8).join(' '))
      status.entries.push({
        path,
        origPath: null,
        index: statusChar(fields[1]?.[0]),
        worktree: statusChar(fields[1]?.[1]),
        untracked: false
      })
      continue
    }
    if (line.startsWith('2 ')) {
      const fields = line.split(' ')
      // 2 XY sub mH mI mW hH hI Xscore <path>\t<origPath>
      const tail = fields.slice(9).join(' ')
      const tab = tail.indexOf('\t')
      const path = unquoteGitPath(tab < 0 ? tail : tail.slice(0, tab))
      const origPath = tab < 0 ? null : unquoteGitPath(tail.slice(tab + 1))
      status.entries.push({
        path,
        origPath,
        index: statusChar(fields[1]?.[0]),
        worktree: statusChar(fields[1]?.[1]),
        untracked: false
      })
    }
  }
  return status
}

/** `git log --oneline`: `<hash> <subject>` — subject может содержать пробелы. */
export function parseLogOneline(output: string): { hash: string; subject: string }[] {
  const entries: { hash: string; subject: string }[] = []
  for (const rawLine of output.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line.length === 0) continue
    const space = line.indexOf(' ')
    if (space <= 0) continue
    entries.push({ hash: line.slice(0, space), subject: line.slice(space + 1) })
  }
  return entries
}

/** `git log --pretty=format:%H%x1f%an%x1f%at%x1f%s%x1f%P%x1f%D%x1e`: записи через \x1e,
 *  поля через \x1f. %D — имена ref'ов через запятую (`HEAD -> main, origin/main, v1`). */
export function parseLogRich(output: string): {
  hash: string
  subject: string
  author: string
  date: number
  parents: string[]
  refs: string[]
}[] {
  const entries: {
    hash: string
    subject: string
    author: string
    date: number
    parents: string[]
    refs: string[]
  }[] = []
  for (const rawRecord of output.split('\x1e')) {
    const record = rawRecord.replace(/^\r?\n/, '')
    if (record.trim().length === 0) continue
    const f = record.split('\x1f')
    if (f.length < 6 || f[0]!.length === 0) continue
    entries.push({
      hash: f[0]!,
      author: f[1]!,
      date: Number(f[2]) || 0,
      subject: f[3]!,
      parents: f[4]!.length > 0 ? f[4]!.split(' ') : [],
      refs: f[5]!
        .split(',')
        .map((r) => r.trim())
        .filter((r) => r.length > 0)
    })
  }
  return entries
}

/** `git diff-tree --no-commit-id --name-status -r`: строки `<status>\t<path>[\t<origPath>]`. */
export function parseNameStatus(output: string): { status: string; path: string; origPath: string | null }[] {
  const entries: { status: string; path: string; origPath: string | null }[] = []
  for (const rawLine of output.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line.length === 0) continue
    const parts = line.split('\t')
    if (parts.length < 2) continue
    const status = parts[0]!
    if (status.length === 0) continue
    // R/C: status100\t<oldPath>\t<newPath>
    const isRenameCopy = status.length > 1 && (status[0] === 'R' || status[0] === 'C')
    if (isRenameCopy && parts.length >= 3) {
      entries.push({ status: status[0]!, path: parts[2]!, origPath: parts[1] ?? null })
    } else {
      entries.push({ status, path: parts[1]!, origPath: null })
    }
  }
  return entries
}
