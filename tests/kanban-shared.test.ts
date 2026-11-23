import { describe, expect, it } from 'vitest'
import {
  applyCardComment,
  applyCardCreate,
  applyCardDelete,
  applyCardMove,
  applyCardUpdate,
  applyColumnCreate,
  applyColumnCardsMove,
  applyColumnClear,
  applyColumnDelete,
  applyColumnMove,
  applyColumnRename,
  applyBoardRename,
  applyWorkflowSet,
  casMutate,
  claimNextCard,
  createDefaultBoard,
  isValidKanbanId,
  isValidKanbanImagePath,
  KanbanConflictError,
  newKanbanId,
  parseKanbanBoard,
  pickTask,
  sanitizeKanbanName,
  type KanbanBoard,
  type KanbanBoardStore,
} from '../src/shared/kanban'

const NOW = '2026-11-22T10:00:00.000Z'

function boardWithCards(): KanbanBoard {
  const board = createDefaultBoard('Test', 'b-11111111')
  board.columns = KANBAN_COLUMNS
  board.cards = [
    card('c-00000001', 'col-00000001', 0),
    card('c-00000002', 'col-00000001', 1),
    card('c-00000003', 'col-00000002', 0),
    card('c-00000004', 'col-00000003', 0),
  ]
  return board
}

const KANBAN_COLUMNS = [
  { id: 'col-00000001', name: 'Backlog' },
  { id: 'col-00000002', name: 'Todo' },
  { id: 'col-00000003', name: 'In Progress' },
  { id: 'col-00000004', name: 'Review' },
  { id: 'col-00000005', name: 'Done' },
]

function card(id: string, columnId: string, order: number): KanbanBoard['cards'][number] {
  return {
    id,
    title: `Card ${id}`,
    description: '',
    columnId,
    order,
    createdAt: NOW,
    updatedAt: NOW,
    images: [],
    comments: [],
  }
}

function columnName(board: KanbanBoard, name: string): string {
  return board.columns.find((column) => column.name === name)!.id
}

function cardsIn(board: KanbanBoard, columnId: string): string[] {
  return board.cards
    .filter((item) => item.columnId === columnId)
    .sort((a, b) => a.order - b.order)
    .map((item) => item.id)
}

describe('kanban ids и sanitize', () => {
  it('newKanbanId даёт prefix + 8 hex', () => {
    for (const prefix of ['b', 'col', 'c', 'm'] as const) {
      const id = newKanbanId(prefix)
      expect(isValidKanbanId(id, prefix)).toBe(true)
    }
    expect(isValidKanbanId('c-12345', 'c')).toBe(false)
    expect(isValidKanbanId('c-12345678', 'col')).toBe(false)
    expect(isValidKanbanId('x-12345678', 'c')).toBe(false)
    expect(isValidKanbanId(42, 'c')).toBe(false)
  })

  it('sanitizeKanbanName: trim, пустое и длинное — null', () => {
    expect(sanitizeKanbanName('  My board  ')).toBe('My board')
    expect(sanitizeKanbanName('   ')).toBeNull()
    expect(sanitizeKanbanName('x'.repeat(201))).toBeNull()
    expect(sanitizeKanbanName(123)).toBeNull()
  })

  it('isValidKanbanImagePath отвергает абсолютные пути и ..', () => {
    expect(isValidKanbanImagePath('attachments/abc.png')).toBe(true)
    expect(isValidKanbanImagePath('../etc/passwd')).toBe(false)
    expect(isValidKanbanImagePath('/abs/path.png')).toBe(false)
    expect(isValidKanbanImagePath('C:\\tmp\\x.png')).toBe(false)
    expect(isValidKanbanImagePath('')).toBe(false)
  })
})

describe('createDefaultBoard и parseKanbanBoard', () => {
  it('дефолтная доска: 5 колонок, workflow, rev 0', () => {
    const board = createDefaultBoard()
    expect(board.version).toBe(1)
    expect(board.rev).toBe(0)
    expect(board.name).toBe('Default')
    expect(board.columns.map((column) => column.name)).toEqual(['Backlog', 'Todo', 'In Progress', 'Review', 'Done'])
    expect(board.workflow).toContain('kanban_move to Review')
    expect(board.cards).toEqual([])
  })

  it('parseKanbanBoard принимает валидную доску', () => {
    const board = boardWithCards()
    expect(parseKanbanBoard(JSON.parse(JSON.stringify(board)))).toEqual(board)
  })

  it('parseKanbanBoard отбрасывает мусор', () => {
    expect(parseKanbanBoard(null)).toBeNull()
    expect(parseKanbanBoard({ version: 2 })).toBeNull()
    expect(parseKanbanBoard({ version: 1, id: 'b-11111111', rev: 0, columns: [] })).toBeNull()
    const board = boardWithCards()
    const broken = JSON.parse(JSON.stringify(board)) as Record<string, unknown>
    ;(broken['cards'] as Record<string, unknown>[]).push({ id: 'c-99999999', title: 'Orphan', columnId: 'col-nope', order: 0 })
    const parsed = parseKanbanBoard(broken)!
    expect(parsed.cards.map((item) => item.id)).not.toContain('c-99999999')
    expect(parsed.cards).toHaveLength(4)
  })
})

describe('чистые мутации', () => {
  it('card create: в Backlog по умолчанию, в конец', () => {
    const board = applyCardCreate(boardWithCards(), { title: '  New  ', now: NOW })
    const backlog = columnName(board, 'Backlog')
    const ids = cardsIn(board, backlog)
    expect(ids).toHaveLength(3)
    expect(board.cards.find((item) => item.id === ids[2])!.title).toBe('New')
    expect(board.cards.find((item) => item.id === ids[2])!.order).toBe(2)
  })

  it('card create: пустой заголовок — throw', () => {
    expect(() => applyCardCreate(boardWithCards(), { title: '   ' })).toThrow('Invalid card title')
  })

  it('card update: title и description, updatedAt меняется', () => {
    const board = applyCardUpdate(boardWithCards(), { id: 'c-00000001', title: 'Renamed', description: 'Desc' })
    const updated = board.cards.find((item) => item.id === 'c-00000001')!
    expect(updated.title).toBe('Renamed')
    expect(updated.description).toBe('Desc')
    expect(updated.updatedAt).not.toBe(NOW)
  })

  it('card update: несуществующая карточка — throw', () => {
    expect(() => applyCardUpdate(boardWithCards(), { id: 'c-99999999', title: 'X' })).toThrow('Card not found')
  })

  it('card update: images — замена, фильтрация невалидных, undefined не трогает', () => {
    const withImages = applyCardUpdate(boardWithCards(), {
      id: 'c-00000001',
      images: ['attachments/a.png', '../evil.png', 'attachments/b.jpg', '/abs.png', ''],
    })
    expect(withImages.cards.find((item) => item.id === 'c-00000001')!.images).toEqual(['attachments/a.png', 'attachments/b.jpg'])

    const untouched = applyCardUpdate(boardWithCards(), { id: 'c-00000001', title: 'X' })
    expect(untouched.cards.find((item) => item.id === 'c-00000001')!.images).toEqual([])
  })

  it('card delete убирает карточку', () => {
    const board = applyCardDelete(boardWithCards(), 'c-00000001')
    expect(board.cards.map((item) => item.id)).not.toContain('c-00000001')
  })

  it('card move между колонками с переиндексацией обеих колонок', () => {
    const board = applyCardMove(boardWithCards(), { id: 'c-00000001', columnId: 'col-00000003', index: 0, now: NOW })
    const inProgress = columnName(board, 'In Progress')
    expect(cardsIn(board, inProgress)).toEqual(['c-00000001', 'c-00000004'])
    const backlog = columnName(board, 'Backlog')
    expect(cardsIn(board, backlog)).toEqual(['c-00000002'])
    expect(board.cards.find((item) => item.id === 'c-00000002')!.order).toBe(0)
    expect(board.cards.find((item) => item.id === 'c-00000001')!.order).toBe(0)
    expect(board.cards.find((item) => item.id === 'c-00000004')!.order).toBe(1)
  })

  it('card move внутри колонки переставляет', () => {
    const board = applyCardMove(boardWithCards(), { id: 'c-00000002', columnId: 'col-00000001', index: 0, now: NOW })
    const backlog = columnName(board, 'Backlog')
    expect(cardsIn(board, backlog)).toEqual(['c-00000002', 'c-00000001'])
  })

  it('card comment добавляет комментарий', () => {
    const comment = { id: 'm-00000001', author: 'user' as const, text: 'Hi', images: [], at: NOW }
    const board = applyCardComment(boardWithCards(), { id: 'c-00000001', comment })
    expect(board.cards.find((item) => item.id === 'c-00000001')!.comments).toEqual([comment])
  })

  it('card comment копирует session/commits комментария на карточку без дублей', () => {
    const first = {
      id: 'm-00000001',
      author: 'agent' as const,
      text: 'Done',
      images: [],
      at: NOW,
      session: { id: 's-1', title: 'Fix ux' },
      commits: [{ hash: 'a1b2c3d', message: 'fix' }],
    }
    let board = applyCardComment(boardWithCards(), { id: 'c-00000001', comment: first })
    let card = board.cards.find((item) => item.id === 'c-00000001')!
    expect(card.sessions).toEqual([{ id: 's-1', title: 'Fix ux', at: NOW }])
    expect(card.commits).toEqual([{ hash: 'a1b2c3d', message: 'fix', at: NOW }])
    const second = {
      id: 'm-00000002',
      author: 'agent' as const,
      text: 'More',
      images: [],
      at: '2026-11-22T11:00:00.000Z',
      session: { id: 's-1', title: 'Fix ux' },
      commits: [
        { hash: 'a1b2c3d', message: 'fix' },
        { hash: 'e4f5a6b', message: 'feat' },
      ],
    }
    board = applyCardComment(board, { id: 'c-00000001', comment: second })
    card = board.cards.find((item) => item.id === 'c-00000001')!
    expect(card.sessions).toEqual([{ id: 's-1', title: 'Fix ux', at: NOW }])
    expect(card.commits).toEqual([
      { hash: 'a1b2c3d', message: 'fix', at: NOW },
      { hash: 'e4f5a6b', message: 'feat', at: '2026-11-22T11:00:00.000Z' },
    ])
  })

  it('parseKanbanBoard читает sessions/commits карточки и отбрасывает битые записи', () => {
    const comment = {
      id: 'm-00000001',
      author: 'agent' as const,
      text: 'Done',
      images: [],
      at: NOW,
      session: { id: 's-1', title: 'Fix ux' },
    }
    let board = applyCardComment(boardWithCards(), { id: 'c-00000001', comment })
    board = {
      ...board,
      cards: board.cards.map((item) =>
        item.id === 'c-00000001'
          ? { ...item, commits: [{ hash: 'a1b2c3d', message: 'fix', at: NOW }, { hash: 'bad', message: 'x', at: 'nope' } as never] }
          : item,
      ),
    }
    const parsed = parseKanbanBoard(JSON.parse(JSON.stringify(board)))!
    const card = parsed.cards.find((item) => item.id === 'c-00000001')!
    expect(card.sessions).toEqual([{ id: 's-1', title: 'Fix ux', at: NOW }])
    expect(card.commits).toEqual([{ hash: 'a1b2c3d', message: 'fix', at: NOW }])
  })

  it('column create/rename/move', () => {
    let board = applyColumnCreate(boardWithCards(), 'Extra')
    expect(board.columns).toHaveLength(6)
    const extraId = board.columns[5].id
    board = applyColumnMove(board, { id: extraId, index: 1 })
    expect(board.columns[1].name).toBe('Extra')
    board = applyColumnRename(board, { id: extraId, name: 'Renamed' })
    expect(board.columns[1].name).toBe('Renamed')
  })

  it('column delete: карточки в Backlog, последнюю колонку удалить нельзя', () => {
    const board = applyColumnDelete(boardWithCards(), 'col-00000003')
    expect(board.columns.map((column) => column.name)).not.toContain('In Progress')
    const backlog = columnName(board, 'Backlog')
    expect(cardsIn(board, backlog)).toEqual(['c-00000001', 'c-00000002', 'c-00000004'])
    expect(() => applyColumnDelete({ ...board, columns: board.columns.slice(0, 1) }, board.columns[0].id)).toThrow('Cannot delete the last column')
  })

  it('column clear: удаляет карточки колонки, остальные не трогает', () => {
    const board = applyColumnClear(boardWithCards(), 'col-00000001')
    expect(cardsIn(board, 'col-00000001')).toEqual([])
    expect(cardsIn(board, 'col-00000002')).toEqual(['c-00000003'])
    expect(board.columns.map((column) => column.name)).toContain('Backlog')
    expect(() => applyColumnClear(boardWithCards(), 'col-nope')).toThrow('Column not found')
  })

  it('column cards move: все карточки в конец целевой, порядок сохранён', () => {
    const board = applyColumnCardsMove(boardWithCards(), { id: 'col-00000001', targetColumnId: 'col-00000004', now: NOW })
    expect(cardsIn(board, 'col-00000001')).toEqual([])
    expect(cardsIn(board, 'col-00000004')).toEqual(['c-00000001', 'c-00000002'])
    const moved = board.cards.find((item) => item.id === 'c-00000001')!
    expect(moved.updatedAt).toBe(NOW)
    expect(() => applyColumnCardsMove(boardWithCards(), { id: 'col-00000001', targetColumnId: 'col-nope' })).toThrow('Column not found')
  })

  it('column cards move: в ту же колонку — доска без изменений', () => {
    const board = boardWithCards()
    expect(applyColumnCardsMove(board, { id: 'col-00000001', targetColumnId: 'col-00000001' })).toBe(board)
  })

  it('workflow set и board rename', () => {
    let board = applyWorkflowSet(boardWithCards(), 'Custom workflow')
    expect(board.workflow).toBe('Custom workflow')
    board = applyBoardRename(board, 'Sprint')
    expect(board.name).toBe('Sprint')
    expect(() => applyBoardRename(board, '  ')).toThrow('Invalid board name')
  })
})

describe('claimNextCard', () => {
  it('берёт первую карточку Todo', () => {
    const result = claimNextCard(boardWithCards(), NOW)
    expect(result).not.toBeNull()
    expect(result!.card.id).toBe('c-00000003')
    const inProgress = columnName(result!.board, 'In Progress')
    expect(cardsIn(result!.board, inProgress)).toEqual(['c-00000004', 'c-00000003'])
  })

  it('Todo пуст — fallback на Backlog', () => {
    const base = boardWithCards()
    base.cards = base.cards.filter((item) => item.columnId !== 'col-00000002')
    const result = claimNextCard(base, NOW)
    expect(result!.card.id).toBe('c-00000001')
  })

  it('нет кандидатов — null', () => {
    const base = boardWithCards()
    base.cards = []
    expect(claimNextCard(base, NOW)).toBeNull()
  })

  it('нет колонки In Progress — null', () => {
    const base = boardWithCards()
    base.columns = base.columns.filter((column) => column.name !== 'In Progress')
    expect(claimNextCard(base, NOW)).toBeNull()
  })
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

class FakeStore implements KanbanBoardStore {
  disk = new Map<string, KanbanBoard>()
  failWrites = false

  async read(boardId: string): Promise<KanbanBoard | null> {
    await tick()
    const board = this.disk.get(boardId)
    return board ? (JSON.parse(JSON.stringify(board)) as KanbanBoard) : null
  }

  async write(board: KanbanBoard): Promise<void> {
    await tick()
    if (this.failWrites) throw new KanbanConflictError()
    const current = this.disk.get(board.id)
    if (!current || current.rev !== board.rev - 1) throw new KanbanConflictError()
    this.disk.set(board.id, JSON.parse(JSON.stringify(board)) as KanbanBoard)
  }
}

function storeWith(board: KanbanBoard): FakeStore {
  const store = new FakeStore()
  store.disk.set(board.id, board)
  return store
}

describe('CAS', () => {
  it('успешная мутация пишет rev+1', async () => {
    const store = storeWith(boardWithCards())
    const value = await casMutate(store, 'b-11111111', (board) => ({
      board: applyBoardRename(board, 'Renamed'),
      value: board.name,
    }))
    expect(value).toBe('Test')
    expect(store.disk.get('b-11111111')!.rev).toBe(1)
    expect(store.disk.get('b-11111111')!.name).toBe('Renamed')
  })

  it('mutate вернул ту же доску — записи нет', async () => {
    const store = storeWith(boardWithCards())
    const value = await casMutate(store, 'b-11111111', (board) => ({ board, value: 'noop' }))
    expect(value).toBe('noop')
    expect(store.disk.get('b-11111111')!.rev).toBe(0)
  })

  it('доски нет — throw', async () => {
    const store = new FakeStore()
    await expect(casMutate(store, 'b-11111111', () => null)).rejects.toThrow('Board not found')
  })

  it('гонка двух pickTask: разные карточки, rev 2', async () => {
    const store = storeWith(boardWithCards())
    const [first, second] = await Promise.all([pickTask(store, 'b-11111111', NOW), pickTask(store, 'b-11111111', NOW)])
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(first!.id).not.toBe(second!.id)
    expect([first!.id, second!.id]).toEqual(['c-00000003', 'c-00000001'])
    const final = store.disk.get('b-11111111')!
    expect(final.rev).toBe(2)
    const inProgress = columnName(final, 'In Progress')
    expect(cardsIn(final, inProgress)).toEqual(['c-00000004', 'c-00000003', 'c-00000001'])
  })

  it('конфликты исчерпаны — throw после 5 попыток', async () => {
    const store = storeWith(boardWithCards())
    store.failWrites = true
    await expect(
      casMutate(store, 'b-11111111', (board) => ({ board: applyBoardRename(board, 'X'), value: null })),
    ).rejects.toThrow('Kanban CAS failed after 5 attempts')
  })

  it('чужая ошибка не глотается', async () => {
    const store = storeWith(boardWithCards())
    store.write = async () => {
      await tick()
      throw new Error('disk full')
    }
    await expect(
      casMutate(store, 'b-11111111', (board) => ({ board: applyBoardRename(board, 'X'), value: null })),
    ).rejects.toThrow('disk full')
  })
})
