import { mkdtempSync, rmSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { applyCardCreate, casMutate, KanbanConflictError, type KanbanBoardStore } from '../resources/kanban/lib/core'
import { createFsStore, findBoard, readBoard, boardsDir } from '../resources/kanban/lib/store'
import {
  kanbanColumn,
  kanbanComment,
  kanbanCreateCard,
  kanbanGetCard,
  kanbanListCards,
  kanbanMove,
  kanbanPickTask,
  kanbanSearch,
  kanbanUpdateCard,
  kanbanWorkflow,
  type KanbanToolEnv
} from '../resources/kanban/lib/tools'

/** Туы карточек канбана: execute поверх tmp-fs (не-git каталог → корень = cwd). */

const dirs: string[] = []

function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

function env(dir: string, session?: { id: string; name?: string }): KanbanToolEnv {
  return { cwd: dir, session }
}

async function cardIdByTitle(dir: string, title: string): Promise<string> {
  const root = dir
  const board = await findBoard(root)
  const card = board.cards.find((item) => item.title === title)
  expect(card).toBeDefined()
  return card!.id
}

describe('kanban_pick_task', () => {
  it('returns a message when there are no cards', async () => {
    const dir = tmpDir('piwright-kanban-tool-')
    const result = await kanbanPickTask(env(dir), {})
    expect(result.text).toContain('No cards to pick')
    expect(result.details).toEqual({ picked: false })
  })

  it('claims the first Todo card, then Backlog, then nothing', async () => {
    const dir = tmpDir('piwright-kanban-tool-')
    await kanbanCreateCard(env(dir), { title: 'Backlog task', column: 'Backlog' })
    await kanbanCreateCard(env(dir), { title: 'Todo task', column: 'Todo' })
    const first = await kanbanPickTask(env(dir), {})
    expect(first.text).toContain('Todo task')
    expect(first.text).toContain('In Progress')
    expect(first.text).toContain('Board workflow:')
    expect(first.details).toMatchObject({ picked: true, title: 'Todo task' })
    const second = await kanbanPickTask(env(dir), {})
    expect(second.text).toContain('Backlog task')
    const third = await kanbanPickTask(env(dir), {})
    expect(third.text).toContain('No cards to pick')
  })

  it('fails with a clear message for an unknown board', async () => {
    const dir = tmpDir('piwright-kanban-tool-')
    const result = await kanbanPickTask(env(dir), { board: 'b-00000000' })
    expect(result.text).toContain('Board not found: b-00000000')
  })

  it('returns card images of the picked card as inline blocks', async () => {
    const dir = tmpDir('piwright-kanban-tool-')
    const imagePath = join(dir, 'shot.png')
    writeFileSync(imagePath, 'png-bytes', 'utf8')
    await kanbanCreateCard(env(dir), { title: 'Task with card image' })
    const id = await cardIdByTitle(dir, 'Task with card image')
    const attachmentsDir = join(dir, '.pi', 'kanban', 'attachments')
    mkdirSync(attachmentsDir, { recursive: true })
    copyFileSync(imagePath, join(attachmentsDir, 'shot.png'))
    const board = await findBoard(dir)
    const boardFile = join(dir, '.pi', 'kanban', `${board.id}.json`)
    const raw = JSON.parse(readFileSync(boardFile, 'utf8'))
    raw.cards.find((c: { id: string }) => c.id === id).images = ['attachments/shot.png']
    writeFileSync(boardFile, JSON.stringify(raw))
    const result = await kanbanPickTask(env(dir), {})
    expect(result.text).toContain('Attached images (in order): #1')
    expect(result.images).toHaveLength(1)
    expect(result.images![0].mimeType).toBe('image/png')
  })

  it('returns comments with inline images of the picked card', async () => {
    const dir = tmpDir('piwright-kanban-tool-')
    const imagePath = join(dir, 'shot.png')
    writeFileSync(imagePath, 'png-bytes', 'utf8')
    await kanbanCreateCard(env(dir), { title: 'Task with shots', description: 'Look at screens' })
    const id = await cardIdByTitle(dir, 'Task with shots')
    await kanbanComment(env(dir), { id, text: 'Screenshot attached', images: [imagePath] })
    const result = await kanbanPickTask(env(dir), {})
    expect(result.text).toContain('Task with shots')
    expect(result.text).toContain('Comments (1):')
    expect(result.text).toContain('Screenshot attached')
    expect(result.text).toContain('images: attachments/shot.png')
    expect(result.images).toHaveLength(1)
    expect(result.images![0].mimeType).toBe('image/png')
    expect(result.images![0].data).toBe(Buffer.from('png-bytes', 'utf8').toString('base64'))
  })
})

describe('kanban_list_cards', () => {
  it('renders all columns and a single column with limit', async () => {
    const dir = tmpDir('piwright-kanban-tool-')
    for (let i = 1; i <= 3; i += 1) await kanbanCreateCard(env(dir), { title: `Task ${i}`, column: 'Todo' })
    const all = await kanbanListCards(env(dir), {})
    expect(all.text).toContain('Board "Default"')
    expect(all.text).toContain('## Todo (3)')
    expect(all.text).toContain('## Review (0)')
    const single = await kanbanListCards(env(dir), { column: 'todo', limit: 2 })
    expect(single.text).toContain('column "Todo" (2)')
    expect(single.text).toContain('Task 1')
    expect(single.text).not.toContain('Task 3')
    const missing = await kanbanListCards(env(dir), { column: 'Nope' })
    expect(missing.text).toContain('Column not found: "Nope"')
    expect(missing.text).toContain('Backlog, Todo')
  })
})

describe('kanban_search', () => {
  it('ranks title matches above description matches', async () => {
    const dir = tmpDir('piwright-kanban-tool-')
    await kanbanCreateCard(env(dir), { title: 'Fix login bug', description: 'session cookie expired' })
    await kanbanCreateCard(env(dir), { title: 'Add dark theme', description: 'login page colors' })
    const result = await kanbanSearch(env(dir), { query: 'login' })
    expect(result.details).toMatchObject({ count: 2 })
    const lines = result.text.split('\n').filter((line) => line.startsWith('- c-'))
    expect(lines[0]).toContain('Fix login bug')
    const none = await kanbanSearch(env(dir), { query: 'nonexistent' })
    expect(none.details).toMatchObject({ count: 0 })
  })
})

describe('kanban_get_card', () => {
  it('renders description and comments, unknown id fails', async () => {
    const dir = tmpDir('piwright-kanban-tool-')
    await kanbanCreateCard(env(dir), { title: 'Task', description: 'Do the thing' })
    const id = await cardIdByTitle(dir, 'Task')
    await kanbanComment(env(dir), { id, text: 'Started work' })
    const result = await kanbanGetCard(env(dir), { id })
    expect(result.text).toContain(`c-${id.slice(2)} "Task"`)
    expect(result.text).toContain('Do the thing')
    expect(result.text).toContain('[agent')
    expect(result.text).toContain('Started work')
    const missing = await kanbanGetCard(env(dir), { id: 'c-00000000' })
    expect(missing.text).toContain('Card not found: c-00000000')
    const bad = await kanbanGetCard(env(dir), { id: 'nope' })
    expect(bad.text).toContain('Invalid card id')
  })

  it('returns card and comment images as inline blocks, notes missing files', async () => {
    const dir = tmpDir('piwright-kanban-tool-')
    const imagePath = join(dir, 'pic.png')
    writeFileSync(imagePath, 'png-bytes', 'utf8')
    const gonePath = join(dir, 'gone.png')
    writeFileSync(gonePath, 'gone-bytes', 'utf8')
    await kanbanCreateCard(env(dir), { title: 'Task' })
    const id = await cardIdByTitle(dir, 'Task')
    await kanbanComment(env(dir), { id, text: 'with picture', images: [imagePath, gonePath] })
    rmSync(join(dir, '.pi', 'kanban', 'attachments', 'gone.png'))
    const result = await kanbanGetCard(env(dir), { id })
    expect(result.text).toContain('with picture')
    expect(result.text).toContain('images: attachments/pic.png')
    expect(result.text).toContain('Images not loaded: attachments/gone.png')
    expect(result.images).toHaveLength(1)
    expect(result.images![0].mimeType).toBe('image/png')
  })
})

describe('kanban_create_card', () => {
  it('creates in Backlog by default and in a named column', async () => {
    const dir = tmpDir('piwright-kanban-tool-')
    const first = await kanbanCreateCard(env(dir), { title: 'Default place' })
    expect(first.text).toContain('in column "Backlog"')
    expect(first.details).toBeDefined()
    const second = await kanbanCreateCard(env(dir), { title: 'Planned', column: 'Todo' })
    expect(second.text).toContain('in column "Todo"')
    const badColumn = await kanbanCreateCard(env(dir), { title: 'X', column: 'Nope' })
    expect(badColumn.text).toContain('Column not found')
    const badTitle = await kanbanCreateCard(env(dir), { title: '   ' })
    expect(badTitle.text).toContain('Invalid card title')
  })
})

describe('kanban_update_card', () => {
  it('updates title and description, persists to disk', async () => {
    const dir = tmpDir('piwright-kanban-tool-')
    await kanbanCreateCard(env(dir), { title: 'Old title' })
    const id = await cardIdByTitle(dir, 'Old title')
    const result = await kanbanUpdateCard(env(dir), { id, title: 'New title', description: 'Updated' })
    expect(result.text).toContain('Updated card')
    const board = await findBoard(dir)
    const card = board.cards.find((item) => item.id === id)!
    expect(card.title).toBe('New title')
    expect(card.description).toBe('Updated')
    const badTitle = await kanbanUpdateCard(env(dir), { id, title: '   ' })
    expect(badTitle.text).toContain('Invalid card title')
  })
})

describe('kanban_comment', () => {
  it('adds an agent comment with session ref, commits and copied images', async () => {
    const dir = tmpDir('piwright-kanban-tool-')
    const imagePath = join(dir, 'shot.png')
    writeFileSync(imagePath, 'png-bytes', 'utf8')
    await kanbanCreateCard(env(dir), { title: 'Task' })
    const id = await cardIdByTitle(dir, 'Task')
    const result = await kanbanComment(env(dir, { id: 'sess-1' }), {
      id,
      text: 'Done, see commits',
      sessionName: 'my-session',
      commits: [{ hash: 'abc1234', message: 'fix' }, { hash: '  ', message: 'dropped' }],
      images: [imagePath, join(dir, 'missing.png')]
    })
    expect(result.text).toContain('Comment added to card')
    expect(result.text).toContain('Attached: attachments/shot.png')
    expect(result.text).toContain('Failed to attach')
    const board = await findBoard(dir)
    const card = board.cards.find((item) => item.id === id)!
    expect(card.comments).toHaveLength(1)
    const comment = card.comments[0]
    expect(comment.author).toBe('agent')
    expect(comment.session).toEqual({ id: 'sess-1', title: 'my-session' })
    expect(comment.commits).toEqual([{ hash: 'abc1234', message: 'fix' }])
    expect(comment.images).toEqual(['attachments/shot.png'])
    expect(card.sessions).toEqual([{ id: 'sess-1', title: 'my-session', at: comment.at }])
    expect(card.commits).toEqual([{ hash: 'abc1234', message: 'fix', at: comment.at }])
    const bad = await kanbanComment(env(dir), { id, text: '   ' })
    expect(bad.text).toContain('Invalid comment text')
  })

  it('falls back to the current session name', async () => {
    const dir = tmpDir('piwright-kanban-tool-')
    await kanbanCreateCard(env(dir), { title: 'Task' })
    const id = await cardIdByTitle(dir, 'Task')
    await kanbanComment(env(dir, { id: 'sess-9', name: 'auto name' }), { id, text: 'note' })
    const board = await findBoard(dir)
    expect(board.cards[0].comments[0].session).toEqual({ id: 'sess-9', title: 'auto name' })
  })
})

describe('kanban_move', () => {
  it('moves the card and adds a comment atomically', async () => {
    const dir = tmpDir('piwright-kanban-tool-')
    await kanbanCreateCard(env(dir), { title: 'Task' })
    const id = await cardIdByTitle(dir, 'Task')
    const result = await kanbanMove(env(dir), { id, column: 'Review', comment: 'ready for review' })
    expect(result.text).toContain('moved to column "Review"')
    expect(result.text).toContain('Comment added.')
    const board = await findBoard(dir)
    const card = board.cards.find((item) => item.id === id)!
    expect(card.columnId).toBe(board.columns.find((column) => column.name === 'Review')!.id)
    expect(card.comments.map((comment) => comment.text)).toEqual(['ready for review'])
    const missing = await kanbanMove(env(dir), { id, column: 'Nope' })
    expect(missing.text).toContain('Column not found')
  })
})

describe('kanban_column', () => {
  it('creates, renames, moves and deletes a column', async () => {
    const dir = tmpDir('piwright-kanban-tool-')
    const created = await kanbanColumn(env(dir), { action: 'create', name: 'Blocked' })
    expect(created.text).toContain('Created column "Blocked"')
    expect(created.details).toMatchObject({ action: 'create' })
    expect(created.text).toContain('6. Blocked')

    const renamed = await kanbanColumn(env(dir), { action: 'rename', name: 'Blocked', newName: 'Paused' })
    expect(renamed.text).toContain('Renamed column "Blocked"')
    expect(renamed.text).toContain('Paused')

    const moved = await kanbanColumn(env(dir), { action: 'move', name: 'Paused', afterColumn: 'Backlog' })
    expect(moved.text).toContain('Moved column "Paused"')
    expect(moved.text).toMatch(/1\. Backlog[\s\S]*2\. Paused/)

    await kanbanCreateCard(env(dir), { title: 'Doomed', column: 'Paused' })
    const deleted = await kanbanColumn(env(dir), { action: 'delete', name: 'Paused' })
    expect(deleted.text).toContain('Deleted column "Paused"')
    const board = await findBoard(dir)
    expect(board.columns.map((column) => column.name)).not.toContain('Paused')
    const card = board.cards.find((item) => item.title === 'Doomed')!
    expect(card.columnId).toBe(board.columns.find((column) => column.name === 'Backlog')!.id)
  })

  it('validates action, missing newName, unknown columns and last column', async () => {
    const dir = tmpDir('piwright-kanban-tool-')
    const badAction = await kanbanColumn(env(dir), { action: 'purge', name: 'Todo' })
    expect(badAction.text).toContain('Invalid action: "purge"')
    const badRename = await kanbanColumn(env(dir), { action: 'rename', name: 'Todo' })
    expect(badRename.text).toContain('newName is required')
    const badColumn = await kanbanColumn(env(dir), { action: 'rename', name: 'Nope', newName: 'X' })
    expect(badColumn.text).toContain('Column not found: "Nope"')
    const badAfter = await kanbanColumn(env(dir), { action: 'move', name: 'Todo', afterColumn: 'Nope' })
    expect(badAfter.text).toContain('Column not found: "Nope"')
    const last = await kanbanColumn(env(dir), { action: 'delete', name: 'Done' })
    expect(last.text).not.toBe('')
    for (const name of ['Backlog', 'Todo', 'In Progress', 'Review', 'Done']) {
      await kanbanColumn(env(dir), { action: 'delete', name })
    }
    const board = await findBoard(dir)
    expect(board.columns).toHaveLength(1)
    const lastDeleted = await kanbanColumn(env(dir), { action: 'delete', name: board.columns[0].name })
    expect(lastDeleted.text).toContain('Cannot delete the last column')
  })
})

describe('kanban_workflow', () => {
  it('returns the workflow without text and replaces it with text', async () => {
    const dir = tmpDir('piwright-kanban-tool-')
    const before = await kanbanWorkflow(env(dir), {})
    expect(before.text).toContain('Workflow of board "Default":')
    expect(before.text.length).toBeGreaterThan('Workflow of board "Default":'.length)
    const updated = await kanbanWorkflow(env(dir), { text: 'Custom workflow: do things slowly.' })
    expect(updated.text).toContain('updated')
    const after = await kanbanWorkflow(env(dir), {})
    expect(after.text).toContain('Custom workflow: do things slowly.')
    expect(after.details).toMatchObject({ workflow: 'Custom workflow: do things slowly.' })
    const blank = await kanbanWorkflow(env(dir), { text: '   ' })
    expect(blank.text).toContain('Workflow of board "Default":')
  })
})

describe('createFsStore CAS', () => {
  it('rejects a stale write and accepts a matching one', async () => {
    const dir = tmpDir('piwright-kanban-tool-')
    await kanbanCreateCard(env(dir), { title: 'Task' })
    const root = dir
    const boardId = (await findBoard(root)).id
    const store: KanbanBoardStore = createFsStore(boardsDir(root))
    const board = (await store.read(boardId))!
    await expect(store.write({ ...board, rev: board.rev + 10 })).rejects.toThrow(KanbanConflictError)
    await store.write({ ...board, rev: board.rev + 1 })
    expect((await readBoard(boardsDir(root), boardId))!.rev).toBe(board.rev + 1)
  })

  it('parallel casMutate from two stores: no lost updates, no lock/tmp leftovers', async () => {
    const dir = tmpDir('piwright-kanban-tool-')
    await kanbanCreateCard(env(dir), { title: 'Seed' })
    const root = dir
    const boardId = (await findBoard(root)).id
    const baseRev = (await readBoard(boardsDir(root), boardId))!.rev
    const storeA = createFsStore(boardsDir(root))
    const storeB = createFsStore(boardsDir(root))
    const results = await Promise.all([
      ...Array.from({ length: 6 }, (_, i) =>
        casMutate(storeA, boardId, (board) => ({
          board: applyCardCreate(board, { title: `A${i}` }),
          value: true
        }))
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        casMutate(storeB, boardId, (board) => ({
          board: applyCardCreate(board, { title: `B${i}` }),
          value: true
        }))
      )
    ])
    expect(results.every((r) => r === true)).toBe(true)
    const final = (await readBoard(boardsDir(root), boardId))!
    expect(final.rev).toBe(baseRev + 12)
    for (let i = 0; i < 6; i += 1) {
      expect(final.cards.some((c) => c.title === `A${i}`)).toBe(true)
      expect(final.cards.some((c) => c.title === `B${i}`)).toBe(true)
    }
    const names = await readdir(boardsDir(root))
    expect(names.some((n) => n.endsWith('.tmp'))).toBe(false)
    expect(names.some((n) => n.endsWith('.lock'))).toBe(false)
  })
})

describe('findBoard', () => {
  it('resolves by id, by name (case-insensitive) and falls back to default', async () => {
    const dir = tmpDir('piwright-kanban-tool-')
    const created = await kanbanCreateCard(env(dir), { title: 'Task' })
    void created
    const board = await findBoard(dir)
    expect((await findBoard(dir, board.id)).id).toBe(board.id)
    expect((await findBoard(dir, 'default')).id).toBe(board.id)
    expect((await findBoard(dir, undefined)).id).toBe(board.id)
    await expect(findBoard(dir, 'b-00000000')).rejects.toThrow(/Board not found: b-00000000/)
  })

  it('throws with existing board names for an unknown name', async () => {
    const dir = tmpDir('piwright-kanban-tool-')
    await kanbanCreateCard(env(dir), { title: 'Task' })
    await expect(findBoard(dir, 'Missing')).rejects.toThrow(/Board not found: Missing/)
  })
})
