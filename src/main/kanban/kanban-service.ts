/** KanbanService: доски проекта в `<gitCommonRoot>/.pi/kanban/` (spec/kanban-plan.md §1, §3).
 *  Корень резолвится через git-бэкенд проекта (native spawn / wsl.exe), fs — напрямую
 *  (для WSL — по UNC). Все мутации — CAS через casMutate из shared/kanban.ts. */
import { promises as fs } from 'node:fs'
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

function okBoard(board: KanbanBoard): KanbanMutationResult {
  return { ok: true, error: null, board }
}

function failBoard(error: string): KanbanMutationResult {
  return { ok: false, error, board: null }
}

async function ensureGitignore(root: string): Promise<void> {
  const path = win32.join(root, '.gitignore')
  let current = ''
  try {
    current = await fs.readFile(path, 'utf8')
  } catch {
    current = ''
  }
  if (current.split(/\r?\n/).some((line) => line.trim() === GITIGNORE_ENTRY)) return
  const prefix = current.length > 0 && !current.endsWith('\n') ? '\n' : ''
  await fs.writeFile(path, `${current}${prefix}${GITIGNORE_ENTRY}\n`, 'utf8')
}

export class KanbanService {
  private readonly rootCache = new Map<string, string>()

  constructor(private readonly getSettings: () => Settings) {}

  private async execGit(project: ProjectEntry, args: string[]): Promise<ExecResult> {
    const settings = this.getSettings()
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
   *  общую доску); не-git проект → каталог проекта. Для WSL — UNC-путь. */
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
            ? win32.dirname(win32.resolve(project.dir, out))
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

  private kanbanDir(root: string): string {
    return win32.join(root, '.pi', 'kanban')
  }

  private boardFile(dir: string, boardId: string): string {
    return win32.join(dir, `${boardId}.json`)
  }

  /** CAS-стор досок проекта. read — null если файла нет или JSON битый. */
  private async store(project: ProjectEntry): Promise<{ dir: string; store: KanbanBoardStore }> {
    const dir = this.kanbanDir(await this.resolveKanbanRoot(project))
    const store: KanbanBoardStore = {
      read: async (boardId) => {
        let text: string
        try {
          text = await fs.readFile(this.boardFile(dir, boardId), 'utf8')
        } catch {
          return null
        }
        try {
          return parseKanbanBoard(JSON.parse(text))
        } catch {
          return null
        }
      },
      write: async (board) => {
        const file = this.boardFile(dir, board.id)
        let currentRev: number | null = null
        try {
          const parsed = parseKanbanBoard(JSON.parse(await fs.readFile(file, 'utf8')))
          if (parsed !== null) currentRev = parsed.rev
        } catch {
          // Файла нет — первая запись.
        }
        if (currentRev !== null && currentRev !== board.rev - 1) throw new KanbanConflictError()
        await fs.mkdir(dir, { recursive: true })
        const tmp = `${file}.tmp`
        await fs.writeFile(tmp, JSON.stringify(board, null, 2), 'utf8')
        await fs.rename(tmp, file)
      }
    }
    return { dir, store }
  }

  private async mutate(
    project: ProjectEntry,
    boardId: string,
    mutate: (board: KanbanBoard) => KanbanBoard
  ): Promise<KanbanMutationResult> {
    if (!isValidKanbanId(boardId, 'b')) return failBoard('Invalid board id')
    try {
      const { store } = await this.store(project)
      const next = await casMutate(store, boardId, (board) => {
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
      const dir = this.kanbanDir(await this.resolveKanbanRoot(project))
      let names: string[]
      try {
        names = await fs.readdir(dir)
      } catch {
        return { ok: true, error: null, boards: [] }
      }
      const boards: KanbanBoardsResult['boards'] = []
      for (const name of names) {
        if (!name.endsWith('.json') || name.endsWith('.tmp.json')) continue
        try {
          const board = parseKanbanBoard(JSON.parse(await fs.readFile(win32.join(dir, name), 'utf8')))
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
      const { store } = await this.store(project)
      const board = await store.read(boardId)
      return board === null ? { ok: false, error: `Board not found: ${boardId}`, board: null } : { ok: true, error: null, board }
    } catch (err) {
      return { ok: false, error: errorText(err), board: null }
    }
  }

  async createBoard(project: ProjectEntry, name: string): Promise<KanbanBoardResult> {
    try {
      const boardName = sanitizeKanbanName(name) ?? 'Default'
      const dir = this.kanbanDir(await this.resolveKanbanRoot(project))
      await fs.mkdir(dir, { recursive: true })
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const board = createDefaultBoard(boardName)
        try {
          await fs.writeFile(this.boardFile(dir, board.id), JSON.stringify(board, null, 2), 'utf8')
          return { ok: true, error: null, board }
        } catch (err) {
          if (attempt === 4) return { ok: false, error: errorText(err), board: null }
        }
      }
      return { ok: false, error: 'Failed to create board', board: null }
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
      const dir = this.kanbanDir(await this.resolveKanbanRoot(project))
      await fs.unlink(this.boardFile(dir, boardId))
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
    input: { id: string; title?: string; description?: string; images?: string[] }
  ): Promise<KanbanMutationResult> {
    if (!isValidKanbanId(input.id, 'c')) return failBoard('Invalid card id')
    return this.mutate(project, boardId, (board) =>
      applyCardUpdate(board, { id: input.id, title: input.title, description: input.description, images: input.images })
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
    return this.mutate(project, boardId, (board) =>
      applyCommentUpdate(board, { cardId: input.cardId, commentId: input.commentId, text: input.text, images: input.images })
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

  async workflowSet(project: ProjectEntry, boardId: string, text: string): Promise<KanbanMutationResult> {
    if (typeof text !== 'string') return failBoard('Invalid workflow text')
    return this.mutate(project, boardId, (board) => applyWorkflowSet(board, text))
  }

  /** base64 → `.pi/kanban/attachments/`; путь в карточках — `attachments/<name>`. */
  async putAttachment(project: ProjectEntry, suggestedName: string, base64: string): Promise<KanbanAttachmentResult> {
    try {
      const root = await this.resolveKanbanRoot(project)
      const dir = win32.join(this.kanbanDir(root), 'attachments')
      await fs.mkdir(dir, { recursive: true })
      const base = sanitizeAttachmentName(suggestedName)
      const ext = win32.extname(base)
      const stem = ext.length > 0 ? base.slice(0, -ext.length) : base
      let name = base
      for (let i = 1; i < 1000; i += 1) {
        try {
          await fs.access(win32.join(dir, name))
        } catch {
          break
        }
        name = `${stem}-${i}${ext}`
      }
      await fs.writeFile(win32.join(dir, name), Buffer.from(base64, 'base64'))
      await ensureGitignore(root)
      return { ok: true, error: null, name, path: `attachments/${name}` }
    } catch (err) {
      return { ok: false, error: errorText(err), name: '', path: '' }
    }
  }

  /** Картинка вложения → dataUrl для <img>; путь валидируется (только внутри attachments). */
  async getAttachment(project: ProjectEntry, path: string): Promise<KanbanAttachmentGetResult> {
    try {
      if (!isValidKanbanImagePath(path)) return { ok: false, error: 'Invalid attachment path', dataUrl: '' }
      const root = await this.resolveKanbanRoot(project)
      const file = win32.join(this.kanbanDir(root), ...path.split('/'))
      const mime = imageMimeTypeForExtension(win32.extname(file).slice(1))
      if (mime === null) return { ok: false, error: 'Not an image', dataUrl: '' }
      const bytes = await fs.readFile(file)
      if (bytes.byteLength > KANBAN_ATTACHMENT_MAX_BYTES) return { ok: false, error: 'Image too large', dataUrl: '' }
      return { ok: true, error: null, dataUrl: `data:${mime};base64,${bytes.toString('base64')}` }
    } catch (err) {
      return { ok: false, error: errorText(err), dataUrl: '' }
    }
  }
}
