/** GitService: git CLI на стороне бэкенда проекта. native — spawn git с cwd проекта;
 *  wsl — `wsl.exe -d <distro> --cd <wslCwd> --exec bash -lic 'git …'` (порт схемы спавна
 *  `exec/WslShell.kt`). Сообщение коммита генерирует одноразовый `PiConnection` с
 *  `--no-session` (файл сессии не создаётся, история не засоряется). */
import { readFile, readdir, stat, writeFile, unlink } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  GitBranchesResult,
  GitCommitFileDiffResult,
  GitCommitFilesResult,
  GitFileDiffResult,
  GitLogFilter,
  GitLogResult,
  GitMessageResult,
  GitOpResult,
  GitStatusResult,
  ProjectEntry,
  Settings,
  WorktreeCreateResult,
  WorktreeRemoveResult
} from '../../shared/ipc-contracts'
import { PiConnection } from '../pi/connection'
import { obj, str } from '../pi/event-translator'
import { createPiBackend } from '../pi/backends/factory'
import { buildBashCommand, buildWslSpawnArgs, buildWslUncPath } from '../pi/backends/shell'
import { listWslDistros, wslPathFor } from '../pi/backends/wsl'
import { buildCommitPrompt, cleanCommitMessage } from './commit-message'
import { parseLogRich, parseNameStatus, parseStatusOutput } from './porcelain'
import {
  hasWorktreeNamed,
  isUncommittedChangesError,
  splitWorktreeHostDir,
  validateWorktreeName,
  worktreeBranchFor,
  worktreePathFor
} from '../../shared/worktree'

const GIT_TIMEOUT_MS = 30_000
const PUSH_TIMEOUT_MS = 120_000
const FETCH_TIMEOUT_MS = 120_000
const GEN_TIMEOUT_MS = 240_000
export const GIT_LOG_PAGE_SIZE = 50
const BINARY_PLACEHOLDER = '(binary file)'
const HASH_RE = /^[0-9a-f]{4,40}$/i
const RESET_MODES = new Set(['soft', 'mixed', 'hard'])

interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

function errorOf(result: ExecResult, args: string[]): string {
  const stderr = result.stderr.trim()
  if (stderr.length > 0) return stderr.split('\n').slice(-10).join('\n')
  const stdout = result.stdout.trim()
  if (stdout.length > 0) return stdout.split('\n').slice(-10).join('\n')
  return `git ${args[0] ?? ''} exited with code ${result.code}`
}

const OK: GitOpResult = { ok: true, error: null }

/** Результат синка worktree-ветки с базовой (worktreeMergeBase). */
export interface WorktreeSyncResult {
  ok: boolean
  error: string | null
}

export class GitService {
  constructor(private readonly getSettings: () => Settings) {}

  /** Прогон git на стороне бэкенда: native — прямой spawn, wsl — bash -lic внутри дистрибутива.
   *  cwd — рабочий каталог git (по умолчанию каталог проекта; вложенные репо — их подкаталог). */
  private async exec(
    project: ProjectEntry,
    args: string[],
    timeoutMs: number,
    cwd = project.dir,
    env?: NodeJS.ProcessEnv
  ): Promise<ExecResult> {
    const settings = this.getSettings()
    let child: ChildProcess
    if (project.kind === 'native') {
      child = spawn('git', args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env })
    } else {
      const distro = settings.wslDistro.trim() || (await listWslDistros())[0]
      if (distro === undefined) throw new Error('No WSL distro available. Set it in settings.')
      const wslCwd = await wslPathFor(distro, cwd)
      child = spawn('wsl.exe', buildWslSpawnArgs(distro, wslCwd, buildBashCommand('git', args)), {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    }
    return await new Promise<ExecResult>((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      let settled = false
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          reject(new Error(`git ${args[0] ?? ''} timed out after ${Math.round(timeoutMs / 1000)}s`))
          child.kill()
        }
      }, timeoutMs)
      timer.unref()
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        stdout += chunk
      })
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string) => {
        stderr += chunk
      })
      child.on('error', (err: Error) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(err)
        }
      })
      child.on('close', (code) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          resolve({ code: code ?? -1, stdout, stderr })
        }
      })
    })
  }

  private async run(
    project: ProjectEntry,
    args: string[],
    timeoutMs = GIT_TIMEOUT_MS,
    cwd?: string,
    env?: NodeJS.ProcessEnv
  ): Promise<ExecResult> {
    try {
      return await this.exec(project, args, timeoutMs, cwd, env)
    } catch (err) {
      return { code: -1, stdout: '', stderr: err instanceof Error ? err.message : String(err) }
    }
  }

  /** Прямые подкаталоги проекта со своим .git-КАТАЛОГОМ — вложенные репозитории (баг 8).
   *  .git-файл — submodule, его внешний git и так показывает сам. */
  private async nestedRepos(project: ProjectEntry): Promise<string[]> {
    let children
    try {
      children = await readdir(project.dir, { withFileTypes: true })
    } catch {
      return []
    }
    const names: string[] = []
    for (const child of children) {
      if (!child.isDirectory() || child.name.startsWith('.')) continue
      try {
        if ((await stat(join(project.dir, child.name, '.git'))).isDirectory()) names.push(child.name)
      } catch {
        // нет .git — не репозиторий
      }
    }
    return names
  }

  /** Разложить пути по репозиториям: путь с префиксом вложенного репо уходит в его каталог. */
  private async groupByRepo(project: ProjectEntry, paths: string[]): Promise<Map<string, string[]>> {
    const nested = await this.nestedRepos(project)
    const groups = new Map<string, string[]>()
    for (const path of paths) {
      const name = nested.find((n) => path.startsWith(`${n}/`))
      const dir = name !== undefined ? join(project.dir, name) : project.dir
      const rel = name !== undefined ? path.slice(name.length + 1) : path
      const group = groups.get(dir)
      if (group === undefined) groups.set(dir, [rel])
      else group.push(rel)
    }
    return groups
  }

  async status(project: ProjectEntry): Promise<GitStatusResult> {
    const result = await this.run(project, ['status', '--porcelain=v2', '--branch', '-uall'])
    if (result.code !== 0) return { ok: false, error: errorOf(result, ['status']), status: null }
    const status = parseStatusOutput(result.stdout)
    // Внешний git игнорирует/схлопывает вложенные репозитории — досматриваем каждый сам (баг 8);
    // его собственная untracked-запись на каталог вложенного репо (`? spec/`) — лишняя.
    const nested = await this.nestedRepos(project)
    status.entries = status.entries.filter((e) => !nested.includes(e.path))
    for (const name of nested) {
      const dir = join(project.dir, name)
      const sub = await this.run(project, ['status', '--porcelain=v2', '-uall'], GIT_TIMEOUT_MS, dir)
      if (sub.code !== 0) continue
      for (const entry of parseStatusOutput(sub.stdout).entries) {
        status.entries.push({
          ...entry,
          path: `${name}/${entry.path}`,
          origPath: entry.origPath !== null ? `${name}/${entry.origPath}` : null,
          repoRoot: dir
        })
      }
    }
    status.entries.sort((a, b) => a.path.localeCompare(b.path))
    return { ok: true, error: null, status }
  }

  /** Содержимое HEAD-версии файла; untracked/новых файлов в HEAD нет — пусто. */
  async headFile(project: ProjectEntry, path: string, repoDir = project.dir): Promise<string> {
    const result = await this.run(project, ['show', `HEAD:${path}`], GIT_TIMEOUT_MS, repoDir)
    return result.code === 0 ? result.stdout : ''
  }

  /** Файл на диске (хост-путь: Windows-каталог или UNC WSL); удалён — пусто. */
  private async diskFile(repoDir: string, path: string): Promise<string> {
    try {
      return await readFile(join(repoDir, ...path.split('/')), 'utf8')
    } catch {
      return ''
    }
  }

  async fileDiff(project: ProjectEntry, path: string): Promise<GitFileDiffResult> {
    const status = await this.status(project)
    if (!status.ok || status.status === null) return { ok: false, error: status.error, original: '', modified: '' }
    const entry = status.status.entries.find((e) => e.path === path)
    const repoDir = entry?.repoRoot ?? project.dir
    // У вложенного репо первый сегмент пути — имя подкаталога, внутри репо путь короче.
    const rel = entry?.repoRoot !== undefined ? path.slice(path.indexOf('/') + 1) : path
    const original = entry !== undefined && (entry.untracked || entry.index === 'A') ? '' : await this.headFile(project, rel, repoDir)
    const modified = await this.diskFile(repoDir, rel)
    const clean = (text: string): string => (text.includes('\0') ? BINARY_PLACEHOLDER : text)
    return { ok: true, error: null, original: clean(original), modified: clean(modified) }
  }

  async stage(project: ProjectEntry, paths: string[]): Promise<GitOpResult> {
    if (paths.length === 0) return { ok: false, error: 'No files to stage' }
    for (const [dir, rels] of await this.groupByRepo(project, paths)) {
      const result = await this.run(project, ['add', '--', ...rels], GIT_TIMEOUT_MS, dir)
      if (result.code !== 0) return { ok: false, error: errorOf(result, ['add']) }
    }
    return OK
  }

  async unstage(project: ProjectEntry, paths: string[]): Promise<GitOpResult> {
    if (paths.length === 0) return { ok: false, error: 'No files to unstage' }
    for (const [dir, rels] of await this.groupByRepo(project, paths)) {
      const result = await this.run(project, ['restore', '--staged', '--', ...rels], GIT_TIMEOUT_MS, dir)
      if (result.code !== 0) return { ok: false, error: errorOf(result, ['restore']) }
    }
    return OK
  }

  /** Индексы репозиториев независимы: коммит с одним сообщением — в каждом репо со staged-файлами. */
  async commit(project: ProjectEntry, message: string): Promise<GitOpResult> {
    const status = await this.status(project)
    if (!status.ok || status.status === null) return { ok: false, error: status.error }
    const dirs = new Set<string>()
    for (const entry of status.status.entries) {
      if (entry.index !== '.') dirs.add(entry.repoRoot ?? project.dir)
    }
    if (dirs.size === 0) {
      // Каноничная ошибка git «nothing added to commit» — как и раньше из главного репо.
      const result = await this.run(project, ['commit', '-m', message])
      return result.code === 0 ? OK : { ok: false, error: errorOf(result, ['commit']) }
    }
    for (const dir of dirs) {
      const result = await this.run(project, ['commit', '-m', message], GIT_TIMEOUT_MS, dir)
      if (result.code !== 0) return { ok: false, error: errorOf(result, ['commit']) }
    }
    return OK
  }

  async push(project: ProjectEntry): Promise<GitOpResult> {
    const upstream = await this.run(project, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
    const args = upstream.code === 0 ? ['push'] : ['push', '-u', 'origin', 'HEAD']
    const result = await this.run(project, args, PUSH_TIMEOUT_MS)
    return result.code === 0 ? OK : { ok: false, error: errorOf(result, args) }
  }

  /** Забрать изменения с удалений; ошибки (нет сети/remote) — обычный GitOpResult, не throw. */
  async fetch(project: ProjectEntry): Promise<GitOpResult> {
    const result = await this.run(project, ['fetch', '--quiet'], FETCH_TIMEOUT_MS)
    return result.code === 0 ? OK : { ok: false, error: errorOf(result, ['fetch']) }
  }

  /** Страница лога для дока истории: page считается с 0, порядок по датам. Фильтр — подстрока
   *  сообщения (--grep, без регистра) и/или ветка; query из 4+ hex-символов дополнительно
   *  резолвится как префикс хэша и такой коммит добавляется в начало первой страницы. */
  async log(project: ProjectEntry, page = 0, filter?: GitLogFilter): Promise<GitLogResult> {
    const query = filter?.query?.trim() ?? ''
    const args = [
      'log',
      '--skip',
      String(Math.max(0, page) * GIT_LOG_PAGE_SIZE),
      '-n',
      String(GIT_LOG_PAGE_SIZE + 1),
      '--date-order',
      '--pretty=format:%H%x1f%an%x1f%at%x1f%s%x1f%P%x1f%D%x1e'
    ]
    // Все ветки: globs вместо --all — исключает stash/notes, HEAD — на случай detached.
    if (filter?.all === true) args.push('--glob=refs/heads', '--glob=refs/remotes', '--glob=refs/tags', 'HEAD')
    else if (filter?.branch) args.push(filter.branch)
    if (query.length > 0) args.push('-i', '--fixed-strings', '--grep', query)
    const result = await this.run(project, args)
    if (result.code !== 0) return { ok: true, error: null, entries: [], hasMore: false }
    const entries = parseLogRich(result.stdout)
    const hasMore = entries.length > GIT_LOG_PAGE_SIZE
    const pageEntries = entries.slice(0, GIT_LOG_PAGE_SIZE)
    if (page === 0 && query.length >= 4 && HASH_RE.test(query)) {
      const known = pageEntries.map((e) => e.hash)
      const alreadyShown = known.some((h) => h.startsWith(query.toLowerCase()))
      if (!alreadyShown) {
        const resolved = await this.run(project, ['rev-parse', '--verify', `${query}^{commit}`])
        if (resolved.code === 0) {
          const hash = resolved.stdout.trim()
          if (!known.includes(hash)) {
            const one = await this.run(project, [
              'log',
              '-n',
              '1',
              '--pretty=format:%H%x1f%an%x1f%at%x1f%s%x1f%P%x1f%D%x1e',
              hash
            ])
            const [entry] = one.code === 0 ? parseLogRich(one.stdout) : []
            if (entry !== undefined) pageEntries.unshift(entry)
          }
        }
      }
    }
    return { ok: true, error: null, entries: pageEntries.slice(0, GIT_LOG_PAGE_SIZE), hasMore }
  }

  /** Изменённые файлы коммита: diff против первого родителя (merge — только первая ветка),
 *  --root покрывает первый коммит. */
  async commitFiles(project: ProjectEntry, hash: string): Promise<GitCommitFilesResult> {
    if (!/^[0-9a-f]{4,40}$/i.test(hash)) return { ok: false, error: 'Invalid commit hash', files: [] }
    const args = ['diff-tree', '--no-commit-id', '--name-status', '-r', '--root', '-m', '--first-parent', hash]
    const result = await this.run(project, args)
    if (result.code !== 0) return { ok: false, error: errorOf(result, ['diff-tree']), files: [] }
    return { ok: true, error: null, files: parseNameStatus(result.stdout) }
  }

  /** Дифф файла в коммите: original — родительская версия, modified — версия коммита.
 *  У корневого коммита родителя нет — original пуст; удалённый файл — modified пуст. */
  async commitFileDiff(project: ProjectEntry, hash: string, path: string): Promise<GitCommitFileDiffResult> {
    if (!/^[0-9a-f]{4,40}$/i.test(hash) || path.length === 0) {
      return { ok: false, error: 'Invalid request', original: '', modified: '' }
    }
    const parents = await this.run(project, ['rev-list', '--parents', '-n', '1', hash])
    if (parents.code !== 0) return { ok: false, error: errorOf(parents, ['rev-list']), original: '', modified: '' }
    const tokens = parents.stdout.trim().split(/\s+/).filter((t) => t.length > 0)
    const parent = tokens.length > 1 ? tokens[1]! : null
    const clean = (text: string): string => (text.includes('\0') ? BINARY_PLACEHOLDER : text)
    const missingRevision = /exists on disk, but not in|does not exist|can't be found|unknown revision/i
    let originalText = ''
    if (parent !== null) {
      const original = await this.run(project, ['show', `${parent}:${path}`])
      if (original.code !== 0 && !missingRevision.test(original.stderr + original.stdout)) {
        return { ok: false, error: errorOf(original, ['show']), original: '', modified: '' }
      }
      if (original.code === 0) originalText = original.stdout
    }
    const modified = await this.run(project, ['show', `${hash}:${path}`])
    if (modified.code !== 0 && !missingRevision.test(modified.stderr + modified.stdout)) {
      return { ok: false, error: errorOf(modified, ['show']), original: '', modified: '' }
    }
    return {
      ok: true,
      error: null,
      original: clean(originalText),
      modified: clean(modified.code === 0 ? modified.stdout : '')
    }
  }

  async branches(project: ProjectEntry, all = false): Promise<GitBranchesResult> {
    const args = all
      ? ['branch', '--all', '--format=%(refname:short)']
      : ['branch', '--list', '--format=%(refname:short)']
    const result = await this.run(project, args)
    if (result.code !== 0) return { ok: false, error: errorOf(result, ['branch']), branches: [] }
    const branches = result.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && l !== 'HEAD')
    return { ok: true, error: null, branches }
  }

  async checkout(project: ProjectEntry, name: string, create: boolean, startPoint?: string): Promise<GitOpResult> {
    const trimmed = name.trim()
    if (trimmed.length === 0 || /\s/.test(trimmed)) return { ok: false, error: 'Invalid branch name' }
    const start = startPoint?.trim() ?? ''
    if (start.length > 0 && /\s/.test(start)) return { ok: false, error: 'Invalid branch name' }
    const args = create ? ['checkout', '-b', trimmed, ...(start.length > 0 ? [start] : [])] : ['checkout', trimmed]
    const result = await this.run(project, args)
    return result.code === 0 ? OK : { ok: false, error: errorOf(result, args) }
  }

  async renameBranch(project: ProjectEntry, oldName: string, newName: string): Promise<GitOpResult> {
    const from = oldName.trim()
    const to = newName.trim()
    if (from.length === 0 || to.length === 0 || /\s/.test(from) || /\s/.test(to)) {
      return { ok: false, error: 'Invalid branch name' }
    }
    const args = ['branch', '-m', from, to]
    const result = await this.run(project, args)
    return result.code === 0 ? OK : { ok: false, error: errorOf(result, args) }
  }

  async deleteBranch(project: ProjectEntry, name: string): Promise<GitOpResult> {
    const trimmed = name.trim()
    if (trimmed.length === 0 || /\s/.test(trimmed)) return { ok: false, error: 'Invalid branch name' }
    const args = ['branch', '-d', trimmed]
    const result = await this.run(project, args)
    return result.code === 0 ? OK : { ok: false, error: errorOf(result, args) }
  }

  async cherryPick(project: ProjectEntry, hash: string): Promise<GitOpResult> {
    if (!HASH_RE.test(hash)) return { ok: false, error: 'Invalid commit hash' }
    const args = ['cherry-pick', hash]
    const result = await this.run(project, args)
    return result.code === 0 ? OK : { ok: false, error: errorOf(result, args) }
  }

  async revertCommit(project: ProjectEntry, hash: string): Promise<GitOpResult> {
    if (!HASH_RE.test(hash)) return { ok: false, error: 'Invalid commit hash' }
    const args = ['revert', '--no-edit', hash]
    const result = await this.run(project, args)
    return result.code === 0 ? OK : { ok: false, error: errorOf(result, args) }
  }

  async resetBranch(project: ProjectEntry, hash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<GitOpResult> {
    if (!HASH_RE.test(hash) || !RESET_MODES.has(mode)) return { ok: false, error: 'Invalid request' }
    const args = ['reset', `--${mode}`, hash]
    const result = await this.run(project, args)
    return result.code === 0 ? OK : { ok: false, error: errorOf(result, args) }
  }

  async tagCreate(project: ProjectEntry, name: string, hash: string): Promise<GitOpResult> {
    const trimmed = name.trim()
    if (trimmed.length === 0 || /\s/.test(trimmed) || trimmed.startsWith('-')) {
      return { ok: false, error: 'Invalid tag name' }
    }
    if (!HASH_RE.test(hash)) return { ok: false, error: 'Invalid commit hash' }
    const args = ['tag', trimmed, hash]
    const result = await this.run(project, args)
    return result.code === 0 ? OK : { ok: false, error: errorOf(result, args) }
  }

  /** Выкинуть коммит из истории текущей ветки: rebase --onto <hash>^ <hash> (без редактора).
   *  Конфликты не разрешаем автоматически — ошибка git уходит в UI, пользователь разбирается сам. */
  async dropCommit(project: ProjectEntry, hash: string): Promise<GitOpResult> {
    if (!HASH_RE.test(hash)) return { ok: false, error: 'Invalid commit hash' }
    const full = await this.run(project, ['rev-parse', '--verify', `${hash}^{commit}`])
    if (full.code !== 0) return { ok: false, error: errorOf(full, ['rev-parse']) }
    const resolved = full.stdout.trim()
    if (!(await this.hasParent(project, resolved))) return { ok: false, error: 'Root commit cannot be dropped' }
    const args = ['rebase', '--autostash', '--onto', `${resolved}^`, resolved]
    const result = await this.run(project, args)
    return result.code === 0 ? OK : { ok: false, error: errorOf(result, args) }
  }

  /** Новое сообщение коммита: HEAD — `commit --amend --only` (индекс не трогается),
   *  более старый — неинтерактивный rebase -i с reword целевого коммита. */
  async editCommitMessage(project: ProjectEntry, hash: string, message: string): Promise<GitOpResult> {
    const trimmed = message.trim()
    if (!HASH_RE.test(hash) || trimmed.length === 0) return { ok: false, error: 'Invalid request' }
    const full = await this.run(project, ['rev-parse', '--verify', `${hash}^{commit}`])
    if (full.code !== 0) return { ok: false, error: errorOf(full, ['rev-parse']) }
    const resolved = full.stdout.trim()
    const head = await this.run(project, ['rev-parse', 'HEAD'])
    if (head.code === 0 && head.stdout.trim() === resolved) {
      const args = ['commit', '--amend', '--only', '-m', message]
      const result = await this.run(project, args)
      return result.code === 0 ? OK : { ok: false, error: errorOf(result, ['commit']) }
    }
    if (!(await this.hasParent(project, resolved))) {
      return { ok: false, error: 'Cannot reword the root commit' }
    }
    return await this.rebaseEdit(project, 'reword', resolved, message)
  }

  /** Уплотнить коммит в родительский с новым сообщением: rebase -i от родителя родителя,
   *  pick родителя + squash цели. Родитель должен сам иметь родителя (не быть корнем). */
  async squashInto(project: ProjectEntry, hash: string, message: string): Promise<GitOpResult> {
    const trimmed = message.trim()
    if (!HASH_RE.test(hash) || trimmed.length === 0) return { ok: false, error: 'Invalid request' }
    const full = await this.run(project, ['rev-parse', '--verify', `${hash}^{commit}`])
    if (full.code !== 0) return { ok: false, error: errorOf(full, ['rev-parse']) }
    const resolved = full.stdout.trim()
    if (!(await this.hasParent(project, resolved))) {
      return { ok: false, error: 'Root commit has no parent to squash into' }
    }
    const parent = (await this.run(project, ['rev-parse', `${resolved}^`])).stdout.trim()
    if (!(await this.hasParent(project, parent))) {
      return { ok: false, error: 'Cannot squash into the root commit' }
    }
    return await this.rebaseEdit(project, 'squash', resolved, message)
  }

  private async hasParent(project: ProjectEntry, resolved: string): Promise<boolean> {
    const parents = await this.run(project, ['rev-list', '--parents', '-n', '1', resolved])
    if (parents.code !== 0) return false
    return parents.stdout.trim().split(/\s+/).filter((t) => t.length > 0).length > 1
  }

  /** Неинтерактивный `git rebase -i`: sequence.editor помечает целевой коммит (reword/squash),
   *  core.editor подставляет готовое сообщение из файла. native — node-скрипты через
   *  process.execPath (ELECTRON_RUN_AS_NODE), wsl — sed/cp с временным файлом в каталоге проекта. */
  private async rebaseEdit(
    project: ProjectEntry,
    verb: 'reword' | 'squash',
    hash: string,
    message: string
  ): Promise<GitOpResult> {
    const short = hash.slice(0, 7)
    const args: string[] = []
    const cleanup: string[] = []
    let env: NodeJS.ProcessEnv | undefined
    try {
      if (project.kind === 'native') {
        const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const msgPath = join(tmpdir(), `piwright-msg-${stamp}.txt`)
        const seqPath = join(tmpdir(), `piwright-seq-${stamp}.js`)
        const editorPath = join(tmpdir(), `piwright-editor-${stamp}.js`)
        const seqScript = [
          "const fs = require('fs')",
          'const [short, verb, file] = process.argv.slice(2)',
          "let text = fs.readFileSync(file, 'utf8')",
          "text = text.replace(new RegExp('^pick (' + short + '[0-9a-f]*)', 'm'), verb + ' $1')",
          "fs.writeFileSync(file, text)",
          ''
        ].join('\n')
        const editorScript = [
          "const fs = require('fs')",
          'const [src, dst] = process.argv.slice(2)',
          'fs.copyFileSync(src, dst)',
          ''
        ].join('\n')
        await writeFile(msgPath, message, 'utf8')
        await writeFile(seqPath, seqScript, 'utf8')
        await writeFile(editorPath, editorScript, 'utf8')
        cleanup.push(msgPath, seqPath, editorPath)
        const execPath = process.execPath.replace(/\\/g, '/')
        const seqCmd = `"${execPath}" "${seqPath.replace(/\\/g, '/')}" ${short} ${verb}`
        const editorCmd = `"${execPath}" "${editorPath.replace(/\\/g, '/')}" "${msgPath.replace(/\\/g, '/')}"`
        args.push('-c', `sequence.editor=${seqCmd}`, '-c', `core.editor=${editorCmd}`)
        env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
      } else {
        const msgName = '.piwright-rebase-msg.tmp'
        await writeFile(join(project.dir, msgName), message, 'utf8')
        cleanup.push(join(project.dir, msgName))
        args.push(
          '-c',
          `sequence.editor=sed -i "s/^pick \\(${short}[0-9a-f]*\\)/${verb} \\1/"`,
          '-c',
          `core.editor=cp ${msgName}`
        )
      }
      args.push('rebase', '--autostash', '-i', verb === 'squash' ? `${hash}^^` : `${hash}^`)
      const result = await this.run(project, args, GIT_TIMEOUT_MS, undefined, env)
      return result.code === 0 ? OK : { ok: false, error: errorOf(result, ['rebase']) }
    } finally {
      for (const path of cleanup) {
        try {
          await unlink(path)
        } catch {
          // файла уже нет
        }
      }
    }
  }

  private async worktreeRepoRoot(project: ProjectEntry): Promise<string | null> {
    const result = await this.run(project, ['rev-parse', '--show-toplevel'])
    return result.code === 0 ? result.stdout.trim() || null : null
  }

  /** Хост-каталог worktree для сессий: native — путь как есть, wsl — UNC дистрибутива. */
  private async worktreeHostDir(project: ProjectEntry, backendPath: string): Promise<string> {
    if (project.kind !== 'wsl') return backendPath
    const settings = this.getSettings()
    const distro = settings.wslDistro.trim() || (await listWslDistros())[0]
    return distro === undefined ? backendPath : buildWslUncPath(distro, backendPath)
  }

  /** Присоединиться к worktree или создать: существующий worktree → без git-операции,
   *  ветка worktree-<name> есть → add без -b, иначе add -b от HEAD. Порт WorktreeManager.create. */
  async worktreeCreate(project: ProjectEntry, name: string): Promise<WorktreeCreateResult> {
    const trimmed = name.trim()
    const branch = validateWorktreeName(trimmed) ? worktreeBranchFor(trimmed) : null
    if (branch === null) return { ok: false, error: 'Invalid worktree name', dir: null, name: trimmed, branch: null }
    const root = await this.worktreeRepoRoot(project)
    if (root === null) return { ok: false, error: 'Not a git repository', dir: null, name: trimmed, branch }
    const listed = await this.run(project, ['worktree', 'list', '--porcelain'])
    if (listed.code !== 0) {
      return { ok: false, error: errorOf(listed, ['worktree', 'list']), dir: null, name: trimmed, branch }
    }
    if (!hasWorktreeNamed(listed.stdout, trimmed)) {
      const branchOut = await this.run(project, ['branch', '--list', branch])
      const branchExists = branchOut.code === 0 && branchOut.stdout.trim().length > 0
      const path = worktreePathFor(root, trimmed)
      const args = branchExists ? ['worktree', 'add', path, branch] : ['worktree', 'add', '-b', branch, path, 'HEAD']
      const out = await this.run(project, args)
      if (out.code !== 0) return { ok: false, error: errorOf(out, args), dir: null, name: trimmed, branch }
    }
    return { ok: true, error: null, dir: await this.worktreeHostDir(project, worktreePathFor(root, trimmed)), name: trimmed, branch }
  }

  /** `git worktree remove [--force]`; ветку не трогаем. Порт WorktreeManager.remove.
   *  project может быть самим worktree (кнопка в шапке чата) — root считаем от родительского репо. */
  async worktreeRemove(project: ProjectEntry, name: string, force: boolean): Promise<WorktreeRemoveResult> {
    const trimmed = name.trim()
    if (!validateWorktreeName(trimmed)) return { ok: false, error: 'Invalid worktree name', uncommitted: false }
    const wt = splitWorktreeHostDir(project.dir)
    const baseDir = wt !== null ? { ...project, dir: wt.root } : project
    const root = await this.worktreeRepoRoot(baseDir)
    if (root === null) return { ok: false, error: 'Not a git repository', uncommitted: false }
    const args = ['worktree', 'remove', ...(force ? ['--force'] : []), worktreePathFor(root, trimmed)]
    // cwd — родительский репо: git не может удалить каталог, который сам является его cwd.
    const out = await this.run(baseDir, args)
    if (out.code === 0) return { ok: true, error: null, uncommitted: false }
    const message = out.stderr.trim() || out.stdout.trim() || `git worktree remove failed (exit ${out.code})`
    return { ok: false, error: message, uncommitted: isUncommittedChangesError(message) }
  }

  /** Синк worktree-ветки с базовой перед новой итерацией петли: merge ветки, которая checkout
   *  в корневом репо, в worktree-<name>. Без синка агент итерации видит устаревший код и может
   *  выйти из worktree (создать свой). Конфликт/отказ → merge --abort, ok:false — вызыватель
   *  спавнит итерацию как есть и показывает уведомление. */
  async worktreeMergeBase(project: ProjectEntry): Promise<WorktreeSyncResult> {
    const wt = splitWorktreeHostDir(project.dir)
    if (wt === null) return { ok: true, error: null }
    const baseOut = await this.run(project, ['branch', '--show-current'], GIT_TIMEOUT_MS, wt.root)
    const base = baseOut.stdout.trim()
    if (baseOut.code !== 0) return { ok: false, error: errorOf(baseOut, ['branch']) }
    if (base.length === 0) return { ok: false, error: 'Base branch not found (detached HEAD in the root checkout?)' }
    const merge = await this.run(project, ['merge', '--no-edit', base])
    if (merge.code === 0) return { ok: true, error: null }
    // Конфликт оставляет merge в процессе — откатываем, чтобы не оставить поломанное дерево.
    await this.run(project, ['merge', '--abort'])
    return { ok: false, error: errorOf(merge, ['merge']) }
  }

  /** Сообщение коммита: `git diff --staged` всех репо со staged-файлами → промпт → одноразовый pi
   *  (RPC, без сессии и расширений) → текст ответа. Ход завершается по `agent_settled`. */
  async generateCommitMessage(project: ProjectEntry): Promise<GitMessageResult> {
    const status = await this.status(project)
    if (!status.ok || status.status === null) return { ok: false, error: status.error, message: '' }
    const dirs = new Set<string>()
    for (const entry of status.status.entries) {
      if (entry.index !== '.') dirs.add(entry.repoRoot ?? project.dir)
    }
    const parts: string[] = []
    for (const dir of dirs.size > 0 ? dirs : [project.dir]) {
      const diff = await this.run(project, ['diff', '--staged'], GIT_TIMEOUT_MS, dir)
      if (diff.code !== 0) return { ok: false, error: errorOf(diff, ['diff']), message: '' }
      if (diff.stdout.trim().length > 0) parts.push(diff.stdout)
    }
    const combined = parts.join('\n')
    if (combined.trim().length === 0) return { ok: false, error: 'No staged changes', message: '' }

    const created = await createPiBackend(project, this.getSettings())
    if (created.backend === null) return { ok: false, error: created.error, message: '' }

    return await new Promise<GitMessageResult>((resolve) => {
      let text = ''
      let done = false
      let timer: NodeJS.Timeout | null = null
      const finish = (result: GitMessageResult): void => {
        if (done) return
        done = true
        if (timer !== null) clearTimeout(timer)
        conn.close()
        resolve(result)
      }
      const conn = new PiConnection(created.backend!.spawner, {
        onEvent: (type, payload) => {
          if (type === 'message_update') {
            const event = obj(payload, 'assistantMessageEvent')
            if (str(event, 'type') === 'text_delta') text += str(event, 'delta') ?? ''
            return
          }
          if (type === 'agent_settled') {
            const message = cleanCommitMessage(text)
            finish(
              message.length > 0
                ? { ok: true, error: null, message }
                : { ok: false, error: 'Model returned an empty message', message: '' }
            )
          }
        },
        onExtensionUiRequest: () => {},
        onDisconnected: (cause, exitCode, stderrTail) =>
          finish({ ok: false, error: `pi exited (code ${exitCode ?? '?'}). stderr: ${stderrTail || cause || '—'}`, message: '' })
      })
      timer = setTimeout(() => finish({ ok: false, error: 'Commit message generation timed out', message: '' }), GEN_TIMEOUT_MS)
      timer.unref()
      void (async () => {
        try {
          const args = ['--mode', 'rpc', '--no-session', '--no-extensions', '--no-tools', '--no-mcp']
          await conn.start({ cwd: project.dir, args })
          await conn.request('get_state')
          const response = await conn.request('prompt', { message: buildCommitPrompt(combined) })
          if (!response.success) finish({ ok: false, error: `prompt failed: ${response.error ?? 'no details'}`, message: '' })
        } catch (err) {
          finish({ ok: false, error: err instanceof Error ? err.message : String(err), message: '' })
        }
      })()
    })
  }
}
