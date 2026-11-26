/** KanbanService: доски проекта в `<gitCommonRoot>/.pi/kanban/` (spec/kanban-plan.md §1, §3).
 *  Корень резолвится через git-бэкенд проекта (native spawn / wsl.exe / ssh exec), fs — через
 *  ProjectFs (для WSL — по UNC, для ssh — SFTP). Все мутации — CAS через casMutate из shared/kanban.ts. */
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { posix, win32 } from 'node:path'
import type {
  GitOpResult,
  KanbanAttachmentGetResult,
  KanbanAttachmentResult,
  KanbanBoardResult,
  KanbanBoardsResult,
  KanbanCommentInput,
  KanbanCommentUpdateInput,
  KanbanMutationResult,
  ProjectEntry,
  Settings
} from '../../shared/ipc-contracts'
import type { KanbanBoard, KanbanComment } from '../../shared/kanban'
import {
  applyBoardRename,
  applyCardComment,
  applyCardCreate,
  applyCardDelete,
  applyCardMove,
  applyCardUpdate,
  applyCommentDelete,
  applyCommentUpdate,
  applyColumnCreate,
  applyColumnCardsMove,
  applyColumnClear,
  applyColumnDelete,
  applyColumnMove,
  applyColumnRename,
  applyWorkflowSet,
  casMutate,
  createDefaultBoard,
  isValidKanbanId,
  isValidKanbanImagePath,
  KANBAN_COMMENT_MAX,
  KanbanConflictError,
  KanbanStaleRevError,
  newKanbanId,
  parseKanbanBoard,
  sanitizeKanbanName,
  sanitizeKanbanText,
  sanitizeKanbanTitle
} from '../../shared/kanban'
import type { KanbanBoardStore } from '../../shared/kanban'
import { imageMimeTypeForExtension, sanitizeAttachmentName } from '../../shared/attachments'
import { buildBashCommand, buildWslSpawnArgs } from '../pi/backends/shell'
import { listWslDistros, wslPathFor } from '../pi/backends/wsl'
import { getSshService } from '../ssh/ssh-service'
import { getProjectFs, type ProjectFs } from '../fs/project-fs'

const GITIGNORE_ENTRY = '.pi/kanban/attachments/'
const GIT_TIMEOUT_MS = 10_000
const KANBAN_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024

interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

const LOCK_TIMEOUT_MS = 10_000
const LOCK_STALE_MS = 30_000

/** Кросс-процессная блокировка файла доски на время rev-check + записи: main-процесс и
 *  pi-агент пишут одну доску независимо, check-then-write без лока теряет апдейты и
 *  рвёт JSON. Ловушка через createExclusive ('wx'); зависший лок (краш писателя)
 *  снимается по возрасту. */
async function withBoardLock<T>(pfs: ProjectFs, file: string, fn: () => Promise<T>): Promise<T> {
  const lockFile = `${file}.lock`
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  for (;;) {
    const created = await pfs.createExclusive(lockFile, String(process.pid)).catch(() => false)
    if (!created) {
      try {
        const st = await pfs.stat(lockFile)
        if (st !== null && Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          await pfs.rm(lockFile).catch(() => {})
          continue
        }
      } catch {
        // не смогли прочитать возраст — считаем занятым
      }
      if (Date.now() > deadline) throw new Error(`Kanban board file is locked: ${lockFile}`)
      await new Promise((resolve) => setTimeout(resolve, 25 + Math.random() * 75))
      continue
    }
    try {
      return await fn()
    } finally {
      await pfs.rm(lockFile).catch(() => {})
    }
  }
}

function okBoard(board: KanbanBoard): KanbanMutationResult {
  return { ok: true, error: null, board }
}

function failBoard(error: string): KanbanMutationResult {
  return { ok: false, error, board: null }
}

/** Уникальный tmp + rename (с перезаписью). EPERM/EBUSY на rename (антивирус, индексатор, 9P)
 *  — transient, ретраится с бэкоффом (в HostProjectFs.renameOverwrite). */
async function atomicWrite(pfs: ProjectFs, file: string, data: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await pfs.writeFile(tmp, data)
    await pfs.renameOverwrite(tmp, file)
  } catch (err) {
    await pfs.rm(tmp).catch(() => {})
    throw err
  }
}

const CORRUPT_MARK = '.corrupt-'

/** Битый файл доски → `<board>.json.corrupt-<rev>-<ts>.json`; возвращает новое имя или ''. */
async function quarantineBoardFile(pfs: ProjectFs, file: string, text: string): Promise<string> {
  const rev = /"rev"\s*:\s*(\d+)/.exec(text)?.[1] ?? 'x'
  const target = `${file}${CORRUPT_MARK}${rev}-${Date.now()}.json`
  try {
    await pfs.rename(file, target)
    return target
  } catch {
    return ''
  }
}

/** rev из ввода UI: валидное неотрицательное целое — иначе проверка не выполняется. */
function kanbanRev(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

async function ensureGitignore(pfs: ProjectFs, root: string): Promise<void> {
  const path = pfs.join(root, '.gitignore')
  let current = ''
  try {
    current = await pfs.readText(path)
  } catch {
    current = ''
  }
  if (current.split(/\r?\n/).some((line) => line.trim() === GITIGNORE_ENTRY)) return
  const prefix = current.length > 0 && !current.endsWith('\n') ? '\n' : ''
  await pfs.writeFile(path, `${current}${prefix}${GITIGNORE_ENTRY}\n`)
}

export class KanbanService {
  private readonly rootCache = new Map<string, string>()

  constructor(private readonly getSettings: () => Settings) {}

  private pfs(project: ProjectEntry): ProjectFs {
    return getProjectFs(project, this.getSettings())
  }

  private async execGit(project: ProjectEntry, args: string[]): Promise<ExecResult> {
    const settings = this.getSettings()
    if (project.kind === 'ssh') {
      const server = settings.sshServers.find((s) => s.id === project.serverId)
      if (server === undefined) throw new Error('SSH server for this project is missing. Check settings.')
      const result = await getSshService().exec(server, buildBashCommand('git', args), { cwd: project.dir, timeoutMs: GIT_TIMEOUT_MS })
      return { code: result.code ?? -1, stdout: result.stdout, stderr: result.stderr }
    }
    let child: ChildProcess
    if (project.kind === 'native') {
      child = spawn('git', args, { cwd: project.dir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } else {
      const distro = settings.wslDistro.trim() || (await listWslDistros())[0]
      if (distro === undefined) throw new Error('No WSL distro available. Set it in settings.')
      const wslCwd = await wslPathFor(distro, project.dir)
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
          reject(new Error(`git ${args[0] ?? ''} timed out`))
          child.kill()
        }
      }, GIT_TIMEOUT_MS)
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

  /** Корень досок: dirname(`git rev-parse --git-common-dir`) — главный репо (worktree видит
   *  общую доску); не-git проект → каталог проекта. Для WSL — UNC-путь, для ssh — POSIX. */
  async resolveKanbanRoot(project: ProjectEntry): Promise<string> {
    const cacheKey = `${project.kind}\0${project.dir}`
    const cached = this.rootCache.get(cacheKey)
    if (cached !== undefined) return cached
    let root: string
    try {
      const result = await this.execGit(project, ['rev-parse', '--git-common-dir'])
      const out = result.stdout.trim()
      if (result.code === 0 && out.length > 0) {
        root =
          project.kind === 'native'
            ? process.platform === 'win32'
              ? win32.dirname(win32.resolve(project.dir, out))
              : posix.dirname(posix.resolve(project.dir, out))
            : project.kind === 'ssh'
              ? this.sshRootFromCommonDir(project.dir, out)
              : await this.wslRootFromCommonDir(project, out)
      } else {
        root = project.dir
      }
    } catch {
      root = project.dir
    }
    this.rootCache.set(cacheKey, root)
    return root
  }

  private sshRootFromCommonDir(projectDir: string, commonDir: string): string {
    const common = posix.isAbsolute(commonDir)
      ? posix.normalize(commonDir)
      : posix.normalize(posix.join(projectDir, commonDir))
    return posix.dirname(common)
  }

  private async wslRootFromCommonDir(project: ProjectEntry, commonDir: string): Promise<string> {
    const settings = this.getSettings()
    const distro = settings.wslDistro.trim() || (await listWslDistros())[0]
    if (distro === undefined) return project.dir
    const wslCwd = await wslPathFor(distro, project.dir)
    if (wslCwd === null) return project.dir
    const common = posix.isAbsolute(commonDir)
      ? posix.normalize(commonDir)
      : posix.normalize(posix.join(wslCwd, commonDir))
    return win32.join(`\\\\wsl.localhost\\${distro}`, posix.dirname(common))
  }

  private kanbanDir(pfs: ProjectFs, root: string): string {
    return pfs.join(root, '.pi', 'kanban')
  }

  private boardFile(pfs: ProjectFs, dir: string, boardId: string): string {
    return pfs.join(dir, `${boardId}.json`)
  }

  /** CAS-стор досок проекта. read — null если файла нет; битый JSON — quarantine + null. */
  private async store(project: ProjectEntry): Promise<{ dir: string; pfs: ProjectFs; store: KanbanBoardStore }> {
    const pfs = this.pfs(project)
    const dir = this.kanbanDir(pfs, await this.resolveKanbanRoot(project))
    const store: KanbanBoardStore = {
      read: async (boardId) => {
        const file = this.boardFile(pfs, dir, boardId)
        let text: string
        try {
          text = await pfs.readText(file)
        } catch {
          return null
        }
        let board: KanbanBoard | null = null
        try {
          board = parseKanbanBoard(JSON.parse(text))
        } catch {
          board = null
        }
        if (board === null) {
          const quarantined = await quarantineBoardFile(pfs, file, text)
          console.error(`[kanban] board file corrupted, quarantined: ${quarantined || file}`)
        }
        return board
      },
      write: async (board) => {
        const file = this.boardFile(pfs, dir, board.id)
        await withBoardLock(pfs, file, async () => {
          let currentRev: number | null = null
          try {
            const parsed = parseKanbanBoard(JSON.parse(await pfs.readText(file)))
            if (parsed !== null) currentRev = parsed.rev
          } catch {
            // Файла нет — первая запись.
          }
          if (currentRev !== null && currentRev !== board.rev - 1) throw new KanbanConflictError()
          await pfs.mkdir(dir, { recursive: true })
          await atomicWrite(pfs, file, JSON.stringify(board, null, 2))
        })
      }
    }
    return { dir, pfs, store }
  }

  private async mutate(
    project: ProjectEntry,
    boardId: string,
    mutate: (board: KanbanBoard) => KanbanBoard,
    expectedRev?: number
  ): Promise<KanbanMutationResult> {
    if (!isValidKanbanId(boardId, 'b')) return failBoard('Invalid board id')
    try {
      const { store } = await this.store(project)
      const next = await casMutate(store, boardId, (board) => {
        if (expectedRev !== undefined && board.rev !== expectedRev) throw new KanbanStaleRevError(expectedRev, board.rev)
        const mutated = mutate(board)
        return { board: mutated, value: { ...mutated, rev: board.rev + 1 } }
      })
      return next === null ? failBoard('Mutation returned no changes') : okBoard(next)
    } catch (err) {
      return failBoard(errorText(err))
    }
  }

  async listBoards(project: ProjectEntry): Promise<KanbanBoardsResult> {
    try {
      const pfs = this.pfs(project)
      const dir = this.kanbanDir(pfs, await this.resolveKanbanRoot(project))
      let entries: Awaited<ReturnType<ProjectFs['readdir']>>
      try {
        entries = await pfs.readdir(dir)
      } catch {
        return { ok: true, error: null, boards: [] }
      }
      const boards: KanbanBoardsResult['boards'] = []
      for (const entry of entries) {
        const name = entry.name
        if (entry.isDir || !name.endsWith('.json') || name.endsWith('.tmp.json') || name.includes(CORRUPT_MARK)) continue
        try {
          const board = parseKanbanBoard(JSON.parse(await pfs.readText(pfs.join(dir, name))))
          if (board !== null) {
            boards.push({ id: board.id, name: board.name, rev: board.rev, columns: board.columns.length, cards: board.cards.length })
          }
        } catch {
          continue
        }
      }
      boards.sort((a, b) => a.name.localeCompare(b.name))
      return { ok: true, error: null, boards }
    } catch (err) {
      return { ok: false, error: errorText(err), boards: [] }
    }
  }

  async getBoard(project: ProjectEntry, boardId: string): Promise<KanbanBoardResult> {
    if (!isValidKanbanId(boardId, 'b')) return { ok: false, error: 'Invalid board id', board: null }
    try {
      const { dir, pfs, store } = await this.store(project)
      const board = await store.read(boardId)
      if (board !== null) return { ok: true, error: null, board }
      const corrupt = await this.findQuarantined(pfs, dir, boardId)
      return corrupt.length > 0
        ? { ok: false, error: `Board file is corrupted, quarantined: ${corrupt.join(', ')}`, board: null }
        : { ok: false, error: `Board not found: ${boardId}`, board: null }
    } catch (err) {
      return { ok: false, error: errorText(err), board: null }
    }
  }

  private async findQuarantined(pfs: ProjectFs, dir: string, boardId: string): Promise<string[]> {
    try {
      return (await pfs.readdir(dir)).map((e) => e.name).filter((name) => name.startsWith(`${boardId}.json${CORRUPT_MARK}`))
    } catch {
      return []
    }
  }

  async createBoard(project: ProjectEntry, name: string): Promise<KanbanBoardResult> {
    try {
      const boardName = sanitizeKanbanName(name) ?? 'Default'
      const pfs = this.pfs(project)
      const dir = this.kanbanDir(pfs, await this.resolveKanbanRoot(project))
      await pfs.mkdir(dir, { recursive: true })
      const board = createDefaultBoard(boardName)
      const file = this.boardFile(pfs, dir, board.id)
      await withBoardLock(pfs, file, () => atomicWrite(pfs, file, JSON.stringify(board, null, 2)))
      return { ok: true, error: null, board }
    } catch (err) {
      return { ok: false, error: errorText(err), board: null }
    }
  }

  async renameBoard(project: ProjectEntry, boardId: string, name: string): Promise<KanbanMutationResult> {
    const boardName = sanitizeKanbanName(name)
    if (boardName === null) return failBoard('Invalid board name')
    return this.mutate(project, boardId, (board) => applyBoardRename(board, boardName))
  }

  async deleteBoard(project: ProjectEntry, boardId: string): Promise<GitOpResult> {
    if (!isValidKanbanId(boardId, 'b')) return { ok: false, error: 'Invalid board id' }
    try {
      const pfs = this.pfs(project)
      const dir = this.kanbanDir(pfs, await this.resolveKanbanRoot(project))
      await withBoardLock(pfs, this.boardFile(pfs, dir, boardId), async () => {
        await pfs.rm(this.boardFile(pfs, dir, boardId))
      })
      return { ok: true, error: null }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | null)?.code
      if (code === 'ENOENT') return { ok: true, error: null }
      return { ok: false, error: errorText(err) }
    }
  }

  async cardCreate(
    project: ProjectEntry,
    boardId: string,
    input: { title: string; description?: string; columnId?: string }
  ): Promise<KanbanMutationResult> {
    const title = sanitizeKanbanTitle(input.title)
    if (title === null) return failBoard('Invalid card title')
    return this.mutate(project, boardId, (board) =>
      applyCardCreate(board, { title, description: input.description, columnId: input.columnId })
    )
  }

  async cardUpdate(
    project: ProjectEntry,
    boardId: string,
    input: { id: string; title?: string; description?: string; images?: string[]; rev?: number }
  ): Promise<KanbanMutationResult> {
    if (!isValidKanbanId(input.id, 'c')) return failBoard('Invalid card id')
    return this.mutate(
      project,
      boardId,
      (board) =>
        applyCardUpdate(board, { id: input.id, title: input.title, description: input.description, images: input.images }),
      kanbanRev(input.rev)
    )
  }

  async cardDelete(project: ProjectEntry, boardId: string, cardId: string): Promise<KanbanMutationResult> {
    if (!isValidKanbanId(cardId, 'c')) return failBoard('Invalid card id')
    return this.mutate(project, boardId, (board) => applyCardDelete(board, cardId))
  }

  async cardMove(
    project: ProjectEntry,
    boardId: string,
    input: { id: string; columnId: string; index?: number }
  ): Promise<KanbanMutationResult> {
    if (!isValidKanbanId(input.id, 'c')) return failBoard('Invalid card id')
    return this.mutate(project, boardId, (board) =>
      applyCardMove(board, { id: input.id, columnId: input.columnId, index: input.index })
    )
  }

  async cardComment(project: ProjectEntry, boardId: string, input: KanbanCommentInput): Promise<KanbanMutationResult> {
    if (!isValidKanbanId(input.cardId, 'c')) return failBoard('Invalid card id')
    const text = sanitizeKanbanText(input.text, KANBAN_COMMENT_MAX)
    if (text === null) return failBoard('Invalid comment text')
    const comment: KanbanComment = {
      id: newKanbanId('m'),
      author: 'user',
      text,
      images: Array.isArray(input.images) ? input.images.filter(isValidKanbanImagePath) : [],
      at: new Date().toISOString()
    }
    if (input.session !== null && typeof input.session === 'object') {
      const { id, title } = input.session
      if (typeof id === 'string' && id.length > 0 && typeof title === 'string' && title.length > 0) {
        comment.session = { id, title }
      }
    }
    if (Array.isArray(input.commits)) {
      const commits = input.commits.filter(
        (item) =>
          item !== null &&
          typeof item === 'object' &&
          typeof item.hash === 'string' &&
          item.hash.length > 0 &&
          typeof item.message === 'string'
      )
      if (commits.length > 0) comment.commits = commits.map(({ hash, message }) => ({ hash, message }))
    }
    return this.mutate(project, boardId, (board) => applyCardComment(board, { id: input.cardId, comment }))
  }

  async commentUpdate(project: ProjectEntry, boardId: string, input: KanbanCommentUpdateInput): Promise<KanbanMutationResult> {
    if (!isValidKanbanId(input.cardId, 'c')) return failBoard('Invalid card id')
    if (!isValidKanbanId(input.commentId, 'm')) return failBoard('Invalid comment id')
    return this.mutate(
      project,
      boardId,
      (board) =>
        applyCommentUpdate(board, { cardId: input.cardId, commentId: input.commentId, text: input.text, images: input.images }),
      kanbanRev(input.rev)
    )
  }

  async commentDelete(project: ProjectEntry, boardId: string, cardId: string, commentId: string): Promise<KanbanMutationResult> {
    if (!isValidKanbanId(cardId, 'c')) return failBoard('Invalid card id')
    if (!isValidKanbanId(commentId, 'm')) return failBoard('Invalid comment id')
    return this.mutate(project, boardId, (board) => applyCommentDelete(board, { cardId, commentId }))
  }

  async columnCreate(project: ProjectEntry, boardId: string, name: string): Promise<KanbanMutationResult> {
    const columnName = sanitizeKanbanName(name)
    if (columnName === null) return failBoard('Invalid column name')
    return this.mutate(project, boardId, (board) => applyColumnCreate(board, columnName))
  }

  async columnRename(project: ProjectEntry, boardId: string, columnId: string, name: string): Promise<KanbanMutationResult> {
    const columnName = sanitizeKanbanName(name)
    if (columnName === null) return failBoard('Invalid column name')
    return this.mutate(project, boardId, (board) => applyColumnRename(board, { id: columnId, name: columnName }))
  }

  async columnDelete(project: ProjectEntry, boardId: string, columnId: string): Promise<KanbanMutationResult> {
    return this.mutate(project, boardId, (board) => applyColumnDelete(board, columnId))
  }

  async columnMove(project: ProjectEntry, boardId: string, columnId: string, index: number): Promise<KanbanMutationResult> {
    if (typeof index !== 'number' || !Number.isInteger(index)) return failBoard('Invalid column index')
    return this.mutate(project, boardId, (board) => applyColumnMove(board, { id: columnId, index }))
  }

  async columnClear(project: ProjectEntry, boardId: string, columnId: string): Promise<KanbanMutationResult> {
    return this.mutate(project, boardId, (board) => applyColumnClear(board, columnId))
  }

  async columnCardsMove(
    project: ProjectEntry,
    boardId: string,
    input: { id: string; targetColumnId: string }
  ): Promise<KanbanMutationResult> {
    return this.mutate(project, boardId, (board) => applyColumnCardsMove(board, input))
  }

  async workflowSet(project: ProjectEntry, boardId: string, text: string): Promise<KanbanMutationResult> {
    if (typeof text !== 'string') return failBoard('Invalid workflow text')
    return this.mutate(project, boardId, (board) => applyWorkflowSet(board, text))
  }

  /** base64 → `.pi/kanban/attachments/`; путь в карточках — `attachments/<name>`. Запись через
   *  createExclusive ('wx') — два писателя с одним именем не затирают файл друг друга. */
  async putAttachment(project: ProjectEntry, suggestedName: string, base64: string): Promise<KanbanAttachmentResult> {
    try {
      const pfs = this.pfs(project)
      const root = await this.resolveKanbanRoot(project)
      const dir = pfs.join(this.kanbanDir(pfs, root), 'attachments')
      await pfs.mkdir(dir, { recursive: true })
      const base = sanitizeAttachmentName(suggestedName)
      const ext = base.includes('.') ? base.slice(base.lastIndexOf('.')) : ''
      const stem = ext.length > 0 ? base.slice(0, -ext.length) : base
      const bytes = Buffer.from(base64, 'base64')
      let name = base
      for (let i = 1; i < 1000; i += 1) {
        if (await pfs.createExclusive(pfs.join(dir, name), bytes)) {
          await ensureGitignore(pfs, root)
          return { ok: true, error: null, name, path: `attachments/${name}` }
        }
        name = `${stem}-${i}${ext}`
      }
      return { ok: false, error: 'No free attachment name', name: '', path: '' }
    } catch (err) {
      return { ok: false, error: errorText(err), name: '', path: '' }
    }
  }

  /** Картинка вложения → dataUrl для <img>; путь валидируется (только внутри attachments). */
  async getAttachment(project: ProjectEntry, path: string): Promise<KanbanAttachmentGetResult> {
    try {
      if (!isValidKanbanImagePath(path)) return { ok: false, error: 'Invalid attachment path', dataUrl: '' }
      const pfs = this.pfs(project)
      const root = await this.resolveKanbanRoot(project)
      const file = pfs.join(this.kanbanDir(pfs, root), ...path.split('/'))
      const name = pfs.basename(file)
      const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
      const mime = imageMimeTypeForExtension(ext)
      if (mime === null) return { ok: false, error: 'Not an image', dataUrl: '' }
      const bytes = await pfs.readFile(file)
      if (bytes.byteLength > KANBAN_ATTACHMENT_MAX_BYTES) return { ok: false, error: 'Image too large', dataUrl: '' }
      return { ok: true, error: null, dataUrl: `data:${mime};base64,${bytes.toString('base64')}` }
    } catch (err) {
      return { ok: false, error: errorText(err), dataUrl: '' }
    }
  }
}
