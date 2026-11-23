/** KanbanService: резолв корня (git/не-git/worktree), CRUD через сервис, CAS-конфликт, вложения. */
import { afterAll, describe, expect, it } from 'vitest'
import { promises as fs, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, win32 } from 'node:path'
import { tmpdir } from 'node:os'
import { KanbanService } from '../src/main/kanban/kanban-service'
import { DEFAULT_SETTINGS } from '../src/main/settings/settings'
import { parseKanbanBoard } from '../src/shared/kanban'
import type { ProjectEntry } from '../src/shared/ipc-contracts'

const dirs: string[] = []

function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `piwright-kanban-${prefix}-`))
  dirs.push(dir)
  return dir
}

function native(dir: string): ProjectEntry {
  return { kind: 'native', dir }
}

function git(args: string, cwd: string): void {
  execSync(args, { cwd, stdio: 'pipe' })
}

function readBoardFile(file: string): ReturnType<typeof parseKanbanBoard> {
  return parseKanbanBoard(JSON.parse(readFileSync(file, 'utf8')))
}

const service = new KanbanService(() => DEFAULT_SETTINGS)

afterAll(async () => {
  for (const dir of dirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})

describe('resolveKanbanRoot', () => {
  it('не-git проект → корень = каталог проекта', async () => {
    const dir = tmpDir('nogit')
    expect(await service.resolveKanbanRoot(native(dir))).toBe(dir)
  })

  it('обычный репозиторий → корень репозитория', async () => {
    const dir = tmpDir('repo')
    git('git init', dir)
    expect(win32.basename(await service.resolveKanbanRoot(native(dir)))).toBe(win32.basename(dir))
  })

  it('worktree → корень ГЛАВНОГО репозитория', async () => {
    const main = tmpDir('wtmain')
    git('git init', main)
    git('git config user.email t@t', main)
    git('git config user.name t', main)
    writeFileSync(join(main, 'a.txt'), 'x')
    git('git add .', main)
    git('git commit -m init', main)
    const wt = join(tmpDir('wtlink'), 'wt')
    fs.mkdir(win32.dirname(wt), { recursive: true })
    git(`git worktree add "${wt}" -b wt-branch`, main)
    const root = await service.resolveKanbanRoot(native(wt))
    expect(win32.basename(root)).toBe(win32.basename(main))
    expect(root).not.toBe(wt)
  })
})

describe('CRUD через сервис', () => {
  it('createBoard → getBoard → listBoards → renameBoard → deleteBoard', async () => {
    const project = native(tmpDir('crud'))
    const created = await service.createBoard(project, '  My Board  ')
    expect(created.ok).toBe(true)
    expect(created.board?.name).toBe('My Board')
    expect(created.board?.columns.map((column) => column.name)).toEqual(['Backlog', 'Todo', 'In Progress', 'Review', 'Done'])
    const boardId = created.board!.id

    const got = await service.getBoard(project, boardId)
    expect(got.ok).toBe(true)
    expect(got.board?.rev).toBe(0)

    const listed = await service.listBoards(project)
    expect(listed.ok).toBe(true)
    expect(listed.boards).toHaveLength(1)
    expect(listed.boards[0]).toMatchObject({ id: boardId, name: 'My Board', cards: 0 })

    const renamed = await service.renameBoard(project, boardId, 'Renamed')
    expect(renamed.ok).toBe(true)
    expect(renamed.board?.name).toBe('Renamed')
    expect(renamed.board?.rev).toBe(1)

    expect((await service.getBoard(project, 'b-00000000')).ok).toBe(false)
    expect((await service.renameBoard(project, boardId, '   ')).ok).toBe(false)

    expect((await service.deleteBoard(project, boardId)).ok).toBe(true)
    expect((await service.listBoards(project)).boards).toHaveLength(0)
    expect((await service.deleteBoard(project, boardId)).ok).toBe(true)
  })

  it('карточки: create/update/move/comment', async () => {
    const project = native(tmpDir('cards'))
    const board = (await service.createBoard(project, 'B')).board!
    const boardId = board.id
    const todo = board.columns.find((column) => column.name === 'Todo')!
    const progress = board.columns.find((column) => column.name === 'In Progress')!

    const card = await service.cardCreate(project, boardId, { title: 'Task', description: 'Do it' })
    expect(card.ok).toBe(true)
    const cardId = card.board!.cards[0].id
    expect(card.board!.cards[0].columnId).toBe(board.columns[0].id)

    const updated = await service.cardUpdate(project, boardId, { id: cardId, title: 'Task 2' })
    expect(updated.board!.cards[0].title).toBe('Task 2')

    const moved = await service.cardMove(project, boardId, { id: cardId, columnId: progress.id })
    expect(moved.board!.cards[0].columnId).toBe(progress.id)

    const commented = await service.cardComment(project, boardId, {
      cardId,
      text: 'note',
      session: { id: 's1', title: 'session' },
      commits: [{ hash: 'abc1234', message: 'fix' }]
    })
    const comment = commented.board!.cards[0].comments[0]
    expect(comment.author).toBe('user')
    expect(comment.text).toBe('note')
    expect(comment.session).toEqual({ id: 's1', title: 'session' })
    expect(comment.commits).toEqual([{ hash: 'abc1234', message: 'fix' }])

    expect((await service.cardCreate(project, boardId, { title: '' })).ok).toBe(false)
    expect((await service.cardComment(project, boardId, { cardId, text: '' })).ok).toBe(false)
    expect((await service.cardMove(project, boardId, { id: 'c-00000000', columnId: todo.id })).ok).toBe(false)
  })

  it('комментарии: update/delete только своих', async () => {
    const project = native(tmpDir('comments'))
    const board = (await service.createBoard(project, 'B')).board!
    const boardId = board.id
    const cardId = (await service.cardCreate(project, boardId, { title: 'T' })).board!.cards[0].id
    const commentId = (
      await service.cardComment(project, boardId, { cardId, text: 'draft' })
    ).board!.cards[0].comments[0].id

    const updated = await service.commentUpdate(project, boardId, { cardId, commentId, text: 'edited' })
    expect(updated.board!.cards[0].comments[0].text).toBe('edited')

    expect((await service.commentUpdate(project, boardId, { cardId, commentId, text: '' })).ok).toBe(false)
    expect(
      (await service.commentUpdate(project, boardId, { cardId, commentId: 'm-00000000', text: 'x' })).ok
    ).toBe(false)
    expect((await service.commentUpdate(project, boardId, { cardId: 'c-00000000', commentId, text: 'x' })).ok).toBe(false)

    expect((await service.commentDelete(project, boardId, cardId, commentId)).board!.cards[0].comments).toHaveLength(0)
    expect((await service.commentDelete(project, boardId, cardId, commentId)).ok).toBe(false)

    const agentCommentId = 'm-deadbeef'
    const boardFile = join(project.dir, '.pi', 'kanban', `${boardId}.json`)
    const raw = JSON.parse(await fs.readFile(boardFile, 'utf8'))
    raw.cards[0].comments.push({ id: agentCommentId, author: 'agent', text: 'agent says', images: [], at: raw.cards[0].createdAt })
    await fs.writeFile(boardFile, JSON.stringify(raw), 'utf8')
    expect((await service.commentUpdate(project, boardId, { cardId, commentId: agentCommentId, text: 'hack' })).ok).toBe(false)
    expect((await service.commentDelete(project, boardId, cardId, agentCommentId)).ok).toBe(false)
  })

  it('колонки и workflow', async () => {
    const project = native(tmpDir('columns'))
    const board = (await service.createBoard(project, 'B')).board!
    const boardId = board.id

    const created = await service.columnCreate(project, boardId, 'Extra')
    expect(created.board!.columns).toHaveLength(6)
    const extra = created.board!.columns[5]

    const renamed = await service.columnRename(project, boardId, extra.id, 'Extra 2')
    expect(renamed.board!.columns[5].name).toBe('Extra 2')

    const moved = await service.columnMove(project, boardId, extra.id, 0)
    expect(moved.board!.columns[0].name).toBe('Extra 2')

    const deleted = await service.columnDelete(project, boardId, extra.id)
    expect(deleted.board!.columns).toHaveLength(5)

    const workflow = await service.workflowSet(project, boardId, 'custom workflow')
    expect(workflow.board!.workflow).toBe('custom workflow')
    expect(workflow.board!.rev).toBe(5)

    expect((await service.columnDelete(project, boardId, board.columns[0].id)).ok).toBe(true)
    let current = (await service.getBoard(project, boardId)).board!
    while (current.columns.length > 1) {
      expect((await service.columnDelete(project, boardId, current.columns[0].id)).ok).toBe(true)
      current = (await service.getBoard(project, boardId)).board!
    }
    expect((await service.columnDelete(project, boardId, current.columns[0].id)).ok).toBe(false)
  })
})

describe('CAS', () => {
  it('внешняя запись между чтением и мутацией — retry поверх свежих данных', async () => {
    const project = native(tmpDir('cas'))
    const dir = win32.join(await service.resolveKanbanRoot(project), '.pi', 'kanban')
    const board = (await service.createBoard(project, 'B')).board!
    const boardId = board.id
    const file = win32.join(dir, `${boardId}.json`)

    const card = await service.cardCreate(project, boardId, { title: 'First' })
    expect(card.ok).toBe(true)
    const cardId = card.board!.cards[0].id

    const external = readBoardFile(file)!
    await fs.writeFile(
      file,
      JSON.stringify({ ...external, rev: external.rev + 10 }),
      'utf8'
    )

    const renamed = await service.cardUpdate(project, boardId, { id: cardId, title: 'After conflict' })
    expect(renamed.ok).toBe(true)
    const onDisk = readBoardFile(file)!
    expect(onDisk.rev).toBe(external.rev + 11)
    expect(onDisk.cards[0].title).toBe('After conflict')
  })

  it('параллельные мутации: все применены, rev сходится, мусорных tmp/lock нет', async () => {
    const project = native(tmpDir('cas-parallel'))
    const dir = win32.join(await service.resolveKanbanRoot(project), '.pi', 'kanban')
    const board = (await service.createBoard(project, 'B')).board!
    const boardId = board.id
    const file = win32.join(dir, `${boardId}.json`)
    const baseRev = readBoardFile(file)!.rev

    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => service.cardCreate(project, boardId, { title: `Card ${i}` }))
    )
    expect(results.map((r) => r.error).filter((e) => e !== null)).toEqual([])
    expect(results.every((r) => r.ok)).toBe(true)

    const onDisk = readBoardFile(file)!
    expect(onDisk.rev).toBe(baseRev + 12)
    expect(onDisk.cards).toHaveLength(12)
    for (const name of await fs.readdir(dir)) {
      expect(name.endsWith('.tmp')).toBe(false)
      expect(name.endsWith('.lock')).toBe(false)
    }
  })
})

describe('putAttachment', () => {
  it('base64 → файл + относительный путь + .gitignore', async () => {
    const project = native(tmpDir('att'))
    const result = await service.putAttachment(project, 'shot.png', Buffer.from('png-bytes').toString('base64'))
    expect(result.ok).toBe(true)
    expect(result.path).toBe(`attachments/${result.name}`)

    const root = await service.resolveKanbanRoot(project)
    const written = await fs.readFile(win32.join(root, '.pi', 'kanban', 'attachments', result.name))
    expect(written.toString()).toBe('png-bytes')

    const gitignore = await fs.readFile(win32.join(root, '.gitignore'), 'utf8')
    expect(gitignore).toContain('.pi/kanban/attachments/')

    const again = await service.putAttachment(project, 'shot.png', Buffer.from('x').toString('base64'))
    expect(again.name).not.toBe(result.name)
    expect(again.name.startsWith('shot-')).toBe(true)
  })
})

describe('stale rev и quarantine', () => {
  it('stale rev из UI: мутация с полными заменами отклонена, доска не тронута', async () => {
    const project = native(tmpDir('stale-rev'))
    const boardId = (await service.createBoard(project, 'B')).board!.id
    const cardId = (await service.cardCreate(project, boardId, { title: 'T', description: 'agent text' })).board!.cards[0].id

    const stale = (await service.getBoard(project, boardId)).board!.rev - 1
    const rejected = await service.cardUpdate(project, boardId, { id: cardId, description: 'ui text', rev: stale })
    expect(rejected.ok).toBe(false)
    expect(rejected.error).toContain('Board has changed')
    expect(rejected.error).toContain('refresh the board')
    let onDisk = readBoardFile(join(project.dir, '.pi', 'kanban', `${boardId}.json`))!
    expect(onDisk.cards[0].description).toBe('agent text')

    const commentId = (await service.cardComment(project, boardId, { cardId, text: 'note' })).board!.cards[0].comments[0].id
    const staleComment = (await service.getBoard(project, boardId)).board!.rev - 1
    const rejectedComment = await service.commentUpdate(project, boardId, { cardId, commentId, text: 'hack', rev: staleComment })
    expect(rejectedComment.ok).toBe(false)
    expect(rejectedComment.error).toContain('Board has changed')
    onDisk = readBoardFile(join(project.dir, '.pi', 'kanban', `${boardId}.json`))!
    expect(onDisk.cards[0].comments[0].text).toBe('note')

    const fresh = (await service.getBoard(project, boardId)).board!.rev
    const applied = await service.cardUpdate(project, boardId, { id: cardId, title: 'Renamed', rev: fresh })
    expect(applied.ok).toBe(true)
  })

  it('битый файл доски: quarantine, getBoard с явной ошибкой, listBoards его скрывает', async () => {
    const project = native(tmpDir('corrupt'))
    const boardId = (await service.createBoard(project, 'B')).board!.id
    const file = join(project.dir, '.pi', 'kanban', `${boardId}.json`)
    await fs.writeFile(file, '{broken json', 'utf8')

    const got = await service.getBoard(project, boardId)
    expect(got.ok).toBe(false)
    expect(got.error).toContain('corrupted, quarantined')
    expect(existsSync(file)).toBe(false)
    const quarantined = (await fs.readdir(join(project.dir, '.pi', 'kanban'))).filter((name) => name.includes('.corrupt-'))
    expect(quarantined).toHaveLength(1)
    expect((await fs.readFile(join(project.dir, '.pi', 'kanban', quarantined[0]))).toString()).toBe('{broken json')

    const listed = await service.listBoards(project)
    expect(listed.ok).toBe(true)
    expect(listed.boards).toHaveLength(0)
  })

  it('параллельные putAttachment с одним именем: оба успешны, файлы разные', async () => {
    const project = native(tmpDir('att-race'))
    const results = await Promise.all(
      Array.from({ length: 6 }, () => service.putAttachment(project, 'shot.png', Buffer.from('x').toString('base64')))
    )
    expect(results.every((r) => r.ok)).toBe(true)
    expect(new Set(results.map((r) => r.name)).size).toBe(6)
  })
})

describe('getAttachment и картинки в карточке/комментарии', () => {
  it('getAttachment: dataUrl по валидному пути, ошибка на чужом/битом пути', async () => {
    const project = native(tmpDir('attget'))
    const put = await service.putAttachment(project, 'pic.png', Buffer.from('png-bytes').toString('base64'))
    expect(put.ok).toBe(true)

    const got = await service.getAttachment(project, put.path)
    expect(got.ok).toBe(true)
    expect(got.dataUrl).toBe(`data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`)

    expect((await service.getAttachment(project, '../evil.png')).ok).toBe(false)
    expect((await service.getAttachment(project, 'attachments/missing.png')).ok).toBe(false)
    expect((await service.getAttachment(project, 'attachments/note.txt')).ok).toBe(false)
  })

  it('cardUpdate images и cardComment images: валидные пути сохраняются, мусор отфильтрован', async () => {
    const project = native(tmpDir('cardimg'))
    const boardId = (await service.createBoard(project, 'B')).board!.id
    const cardId = (await service.cardCreate(project, boardId, { title: 'T' })).board!.cards[0].id

    const updated = await service.cardUpdate(project, boardId, {
      id: cardId,
      images: ['attachments/a.png', '../evil.png'],
    })
    expect(updated.board!.cards[0].images).toEqual(['attachments/a.png'])

    const commented = await service.cardComment(project, boardId, {
      cardId,
      text: 'with pic',
      images: ['attachments/b.jpg', '/abs.png'],
    })
    expect(commented.board!.cards[0].comments[0].images).toEqual(['attachments/b.jpg'])
  })
})
