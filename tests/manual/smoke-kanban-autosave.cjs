/** Смоук автосохранения карточки: описание сохраняется по debounce 2 с и при размонтировании
 *  панели без blur (Escape/Ctrl+Tab), черновик комментария переживает закрытие и восстанавливается. */
const { chromium } = require('playwright-core')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'
const BOARD = 'SMOKE-AUTOSAVE'
const CARD = 'SMOKE-AUTO-1'
const PROJECT_DIR = process.env.SMOKE_PROJECT || 'D:\\Projects\\piwright'
const rx = (ru, en) => new RegExp(`${ru}|${en}`)
let failed = false
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
  if (!ok) failed = true
}

async function setKanban(page, enabled) {
  await page.evaluate(async (on) => {
    const current = await window.piwright.getSettings()
    await window.piwright.setSettings({ ...current, kanbanEnabled: on })
  }, enabled)
  await page.reload()
  await page.waitForTimeout(2500)
}

async function setProject(page, dir) {
  await page.evaluate(async (path) => {
    const current = await window.piwright.getSettings()
    await window.piwright.setSettings({ ...current, projects: [{ kind: 'native', dir: path }] })
  }, dir)
  await page.reload()
  await page.waitForTimeout(3000)
}

async function boardByTitle(page, name) {
  return page.evaluate(async (boardName) => {
    const boards = await window.piwright.kanbanBoards({ kind: 'native', dir: 'D:\\Projects\\piwright' })
    if (!boards.ok) return null
    const summary = boards.boards.find((x) => x.name === boardName)
    if (summary === undefined) return null
    const res = await window.piwright.kanbanBoardGet({ kind: 'native', dir: 'D:\\Projects\\piwright' }, summary.id)
    return res.ok && res.board !== null ? res.board : null
  }, name)
}

;(async () => {
  const b = await chromium.connectOverCDP(CDP)
  const p = b.contexts()[0].pages()[0]
  await p.waitForTimeout(1500)
  await p.keyboard.press('Escape')
  await p.waitForTimeout(400)

  await setKanban(p, true)
  await setProject(p, PROJECT_DIR)

  for (const label of [CARD, BOARD]) {
    for (let i = 0; i < 5; i += 1) {
      const stale = p.locator('.tab-bar .tab', { hasText: label })
      if ((await stale.count()) === 0) break
      await stale.first().locator('.tab-close').evaluate((el) => el.click())
      await p.waitForTimeout(300)
    }
  }

  const kbBtn = p.locator('.right-bar button[title="Канбан"], .right-bar button[title="Kanban"]')
  if (!(await kbBtn.getAttribute('class'))?.includes('active')) await kbBtn.click()
  await p.waitForTimeout(800)

  // удалить доску от прошлого прогона
  const oldRow = p.locator('.kanban-board-row', { hasText: BOARD })
  if (await oldRow.count()) {
    await oldRow.locator('.kanban-board-action').evaluate((el) => el.click())
    await p.waitForTimeout(400)
    await p.locator('.project-menu button', { hasText: rx('Удалить доску', 'Delete board') }).click()
    await p.waitForTimeout(400)
    await p.locator('.files-rename-box button', { hasText: rx('Удалить', 'Delete') }).last().click()
    await p.waitForTimeout(800)
  }

  // свежая доска и карточка
  await p.locator('.kanban-add').click()
  await p.locator('.kanban-name-input').fill(BOARD)
  await p.locator('.kanban-name-input').press('Enter')
  await p.waitForTimeout(800)
  await p.locator('.kanban-board-name', { hasText: BOARD }).click()
  await p.waitForTimeout(1000)
  const column = p.locator('.board-column', { has: p.locator('.board-column-name', { hasText: 'Backlog' }) })
  await column.locator('.board-card-add').click()
  await column.locator('.kanban-name-input').fill(CARD)
  await column.locator('.kanban-name-input').press('Enter')
  await p.waitForTimeout(500)

  const openCard = async () => {
    await column.locator('.board-card', { hasText: CARD }).first().dblclick()
    await p.waitForSelector('.board-card-modal', { timeout: 10000 })
    await p.waitForTimeout(400)
  }

  // 1. debounce: ввели описание, не уводя фокус, ждём 2.5 с — должно сохраниться
  await openCard()
  const desc = p.locator('.board-card-overlay .board-modal-description')
  await desc.fill('debounced text')
  await p.waitForTimeout(2600)
  let board = await boardByTitle(p, BOARD)
  let card = board?.cards.find((c) => c.title === CARD)
  check('debounce saves description without blur', card?.description === 'debounced text')

  // 2. unmount без blur (путь Ctrl+Tab): правим и сразу Escape
  await desc.fill('flushed on unmount')
  await p.keyboard.press('Escape')
  await p.waitForTimeout(1000)
  board = await boardByTitle(p, BOARD)
  card = board?.cards.find((c) => c.title === CARD)
  check('unmount flush saves description', card?.description === 'flushed on unmount')

  // 3. черновик комментария переживает закрытие модалки
  await openCard()
  const commentInput = p.locator('.board-card-overlay .board-comment-input')
  await commentInput.fill('draft survives close')
  await p.keyboard.press('Escape')
  await p.waitForTimeout(600)
  await openCard()
  const restored = await p.locator('.board-card-overlay .board-comment-input').inputValue()
  check('comment draft restored after reopen', restored === 'draft survives close')

  // 4. отправка комментария очищает черновик
  await p.locator('.board-card-overlay .board-primary', { hasText: rx('Отправить', 'Send') }).evaluate((el) => el.click())
  await p.waitForTimeout(800)
  const feed = p.locator('.board-card-overlay .board-comment-text', { hasText: 'draft survives close' })
  check('comment posted', (await feed.count()) === 1)
  await p.keyboard.press('Escape')
  await p.waitForTimeout(600)
  await openCard()
  const cleared = await p.locator('.board-card-overlay .board-comment-input').inputValue()
  check('comment draft cleared after send', cleared === '')
  await p.keyboard.press('Escape')
  await p.waitForTimeout(400)

  // уборка: удалить доску
  const row = p.locator('.kanban-board-row', { hasText: BOARD })
  await row.locator('.kanban-board-action').evaluate((el) => el.click())
  await p.waitForTimeout(400)
  await p.locator('.project-menu button', { hasText: rx('Удалить доску', 'Delete board') }).click()
  await p.waitForTimeout(400)
  await p.locator('.files-rename-box button', { hasText: rx('Удалить', 'Delete') }).last().click()
  await p.waitForTimeout(800)

  console.log(failed ? 'SMOKE FAILED' : 'SMOKE PASSED')
  process.exit(failed ? 1 : 0)
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
