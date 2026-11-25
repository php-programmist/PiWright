const { chromium } = require('playwright-core')

const PROJECT = { kind: 'native', dir: 'D:/Projects/piwright' }
const CARD_TITLE = 'SMOKE link chip card with a very long title for truncation check'

;(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9223')
  const p = b.contexts()[0].pages()[0]
  await p.waitForTimeout(1500)

  // включить канбан + перезагрузка (setSettings не обновляет zustand-draft)
  await p.evaluate(async () => {
    const s = await window.piwright.getSettings()
    await window.piwright.setSettings({ ...s, kanbanEnabled: true })
  })
  await p.reload()
  await p.waitForTimeout(2500)

  // temp-карточка через IPC
  const card = await p.evaluate(async (project) => {
    const boards = await window.piwright.kanbanBoards(project)
    if (!boards.ok || boards.boards.length === 0) throw new Error('no boards')
    const boardId = boards.boards[0].id
    const col = await window.piwright.kanbanBoardGet(project, boardId)
    if (!col.ok) throw new Error('board get failed')
    const res = await window.piwright.kanbanCardCreate(project, boardId, {
      title: 'SMOKE link chip card with a very long title for truncation check',
      columnId: col.board.columns[0].id
    })
    if (!res.ok || res.board === null) throw new Error('card create failed: ' + (res.error ?? ''))
    const created = res.board.cards.find((c) => c.title.startsWith('SMOKE link chip'))
    return { boardId, cardId: created.id, cardTitle: created.title }
  }, PROJECT)
  console.log('created:', card.cardId)

  // открыть вкладку доски: если уже открыта — пропустить
  const kanbanTabCount = await p.locator('.tab-bar .tab.kanban').count()
  if (kanbanTabCount === 0) {
    await p.locator('.right-bar button[title="Канбан"], .right-bar button[title="Kanban"]').first().click()
    await p.waitForTimeout(800)
    await p.locator('.kanban-board-name').first().click()
  }
  await p.waitForTimeout(1200)

  // правый клик по карточке → контекстное меню → Copy task link
  const cardEl = p.locator('.board-card', { hasText: 'SMOKE link chip' }).first()
  await cardEl.click({ button: 'right' })
  await p.waitForTimeout(400)
  await p.locator('.project-menu-item', { hasText: 'Copy task link' }).click()
  await p.waitForTimeout(400)
  const copied = await p.evaluate(() => navigator.clipboard.readText())
  console.log('clipboard:', copied)
  if (copied !== `kanban:task:${card.cardId}`) throw new Error('clipboard mismatch: ' + copied)

  // комментарий с токеном задачи + токеном сессии из истории
  const hist = await p.evaluate(async ({ project, cardId }) => {
    const boards = await window.piwright.kanbanBoards(project)
    if (!boards.ok || boards.boards.length === 0) throw new Error('no boards: ' + JSON.stringify(boards).slice(0, 200))
    const boardId = boards.boards[0].id
    const history = await window.piwright.sessionHistory(project)
    const sessionId = history.length > 0 ? history[0].id : null
    const sessionTitle = history.length > 0 ? history[0].title : null
    const res = await window.piwright.kanbanCardComment(project, boardId, {
      cardId,
      text: `see kanban:task:${cardId} and kanban:session:${sessionId ?? 'no-session'}`
    })
    return { ok: res.ok, error: res.error ?? null, sessionId, sessionTitle }
  }, { project: PROJECT, cardId: card.cardId }).catch((e) => ({ ok: false, error: e.message }))
  console.log('comment:', JSON.stringify(hist))
  if (!hist.ok) throw new Error('comment failed: ' + hist.error)

  // открыть модалку карточки (двойной клик) и проверить чипы
  await cardEl.dblclick()
  await p.waitForTimeout(2500)
  const chips = await p.locator('.board-modal .board-chip').evaluateAll((els) =>
    els.map((e) => ({ cls: e.className, text: e.textContent, title: e.title }))
  )
  console.log('chips:', JSON.stringify(chips, null, 1))
  const taskChip = chips.find((c) => c.cls.includes('task'))
  if (!taskChip) throw new Error('no task chip in comment')
  if (taskChip.text.length > 21) throw new Error('task chip title not truncated: ' + taskChip.text)
  if (taskChip.title !== card.cardTitle) throw new Error('task chip title attr mismatch')

  // клик по чипу задачи — модалка остаётся/открывается на эту карточку
  await p.locator('.board-modal .board-chip.task').first().click()
  await p.waitForTimeout(600)
  const modalTitle = await p.locator('.board-modal-title').inputValue()
  console.log('modal title after chip click:', modalTitle)
  if (!modalTitle.startsWith('SMOKE link chip')) throw new Error('chip click did not open card modal')

  // чип сессии: если история была — проверить текст
  if (hist.sessionId) {
    const sessChip = chips.find((c) => c.cls.includes('session') && c.title === hist.sessionTitle)
    if (!sessChip) throw new Error('no session chip with title ' + hist.sessionTitle)
    console.log('session chip ok:', sessChip.text)
  }

  // убрать temp-карточку
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)
  await p.evaluate(async ({ project, boardId, cardId }) => {
    await window.piwright.kanbanCardDelete(project, boardId, cardId)
  }, { project: PROJECT, boardId: card.boardId, cardId: card.cardId })
  console.log('SMOKE PASS')
  await b.close()
})().catch((e) => {
  console.error('SMOKE FAIL:', e.message)
  process.exit(1)
})
