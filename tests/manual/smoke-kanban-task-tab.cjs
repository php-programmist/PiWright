/** Смоук вкладки задачи: пункт контекст-меню карточки «Открыть в отдельной вкладке» открывает
 *  TaskView (карточка во всю вкладку, без оверлея), чип kanban:task: в описании другой карточки
 *  открывает ту же вкладку, Escape закрывает вкладку. */
const { chromium } = require('playwright-core')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'
const BOARD = 'SMOKE-TASKTAB'
const CARD1 = 'SMOKE-TASK-1'
const CARD2 = 'SMOKE-TASK-2'
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

;(async () => {
  const b = await chromium.connectOverCDP(CDP)
  const p = b.contexts()[0].pages()[0]
  await p.waitForTimeout(1500)
  await p.keyboard.press('Escape')
  await p.waitForTimeout(400)

  await setKanban(p, true)
  await setProject(p, PROJECT_DIR)

  // закрыть вкладки от прошлых прогонов
  for (const label of [CARD1, CARD2, BOARD]) {
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

  // создать доску и открыть её
  await p.locator('.kanban-add').click()
  await p.locator('.kanban-name-input').fill(BOARD)
  await p.locator('.kanban-name-input').press('Enter')
  await p.waitForTimeout(800)
  await p.locator('.kanban-board-name', { hasText: BOARD }).click()
  await p.waitForTimeout(1000)

  // две карточки в Backlog
  const column = (name) => p.locator('.board-column', { has: p.locator('.board-column-name', { hasText: name }) })
  for (const title of [CARD1, CARD2]) {
    await column('Backlog').locator('.board-card-add').click()
    await column('Backlog').locator('.kanban-name-input').fill(title)
    await column('Backlog').locator('.kanban-name-input').press('Enter')
    await p.waitForTimeout(500)
  }

  // в описание CARD2 — ссылка-токен на CARD1 (через IPC, чтобы не возиться с модалкой)
  const descSet = await p.evaluate(async ([boardName, cardTitle, targetTitle]) => {
    const boards = await window.piwright.kanbanBoards({ kind: 'native', dir: 'D:\\Projects\\piwright' })
    if (!boards.ok) return false
    const summary = boards.boards.find((x) => x.name === boardName)
    if (summary === undefined) return false
    const res = await window.piwright.kanbanBoardGet({ kind: 'native', dir: 'D:\\Projects\\piwright' }, summary.id)
    if (!res.ok || res.board === null) return false
    const card = res.board.cards.find((c) => c.title === cardTitle)
    const target = res.board.cards.find((c) => c.title === targetTitle)
    if (card === undefined || target === undefined) return false
    const upd = await window.piwright.kanbanCardUpdate({ kind: 'native', dir: 'D:\\Projects\\piwright' }, summary.id, {
      id: card.id,
      description: `See kanban:task:${target.id}`,
      rev: res.board.rev,
    })
    return upd.ok
  }, [BOARD, CARD2, CARD1])
  check('card2 description set', descSet)
  await p.locator('.board-head-refresh').click()
  await p.waitForTimeout(600)

  // 1. контекст-меню карточки → «Открыть в отдельной вкладке»
  await column('Backlog').locator('.board-card', { hasText: CARD1 }).click({ button: 'right' })
  await p.waitForTimeout(400)
  await p.locator('.files-menu button', { hasText: rx('Открыть в отдельной вкладке', 'Open in separate tab') }).evaluate((el) => el.click())
  await p.waitForTimeout(800)
  const taskTabs = p.locator('.tab-bar .tab', { hasText: CARD1 })
  check('task tab in tab-bar', (await taskTabs.count()) === 1)
  check('task view rendered', (await p.locator('.task-view').count()) === 1)
  check('no overlay in task tab', (await p.locator('.board-card-overlay').count()) === 0)
  const title1 = await p.locator('.task-view .board-modal-title').inputValue()
  check('task view shows card1', title1 === CARD1)

  // правка описания во вкладке сохраняется
  await p.locator('.task-view .board-modal-description').fill('edited from task tab')
  await p.locator('.task-view .board-modal-title').click()
  await p.waitForTimeout(600)
  const descSaved = await p.evaluate(async ([boardName, targetTitle]) => {
    const boards = await window.piwright.kanbanBoards({ kind: 'native', dir: 'D:\\Projects\\piwright' })
    if (!boards.ok) return false
    const summary = boards.boards.find((x) => x.name === boardName)
    const res = await window.piwright.kanbanBoardGet({ kind: 'native', dir: 'D:\\Projects\\piwright' }, summary.id)
    if (!res.ok || res.board === null) return false
    const card = res.board.cards.find((c) => c.title === targetTitle)
    return card !== undefined && card.description === 'edited from task tab'
  }, [BOARD, CARD1])
  check('description edited from task tab', descSaved)

  // Escape закрывает вкладку задачи
  await p.keyboard.press('Escape')
  await p.waitForTimeout(500)
  check('escape closes task tab', (await taskTabs.count()) === 0 && (await p.locator('.task-view').count()) === 0)

  // 2. чип kanban:task: в описании CARD2 открывает вкладку CARD1
  await column('Backlog').locator('.board-card', { hasText: CARD2 }).dblclick()
  await p.waitForTimeout(600)
  const chip = p.locator('.board-card-overlay .board-description-refs .board-chip.task')
  check('task chip rendered in card2', (await chip.count()) === 1)
  await chip.evaluate((el) => el.click())
  await p.waitForTimeout(800)
  check('chip opens task tab', (await taskTabs.count()) === 1)
  const title2 = await p.locator('.task-view .board-modal-title').inputValue()
  check('chip tab shows card1', title2 === CARD1)
  check('card2 modal closed by tab open', (await p.locator('.board-card-overlay').count()) === 0)

  // вкладка задачи не дублируется при повторном клике по чипу
  await p.locator('.tab-bar .tab', { hasText: BOARD }).last().click()
  await p.waitForTimeout(600)
  // модалка CARD2 переживает смену вкладки — закрыть перед следующим dblclick
  if ((await p.locator('.board-card-overlay').count()) > 0) {
    await p.keyboard.press('Escape')
    await p.waitForTimeout(400)
  }
  await column('Backlog').locator('.board-card', { hasText: CARD2 }).dblclick()
  await p.waitForTimeout(400)
  await chip.evaluate((el) => el.click())
  await p.waitForTimeout(600)
  check('no duplicate task tab', (await taskTabs.count()) === 1)

  // уборка: закрыть вкладку, удалить доску
  await p.keyboard.press('Escape')
  await p.waitForTimeout(400)
  const kbRow = p.locator('.kanban-board-row', { hasText: BOARD })
  await kbRow.locator('.kanban-board-action').evaluate((el) => el.click())
  await p.waitForTimeout(400)
  await p.locator('.project-menu button', { hasText: rx('Удалить доску', 'Delete board') }).click()
  await p.waitForTimeout(400)
  await p.locator('.files-rename-box button', { hasText: rx('Удалить', 'Delete') }).last().click()
  await p.waitForTimeout(800)
  console.log('cleanup: board deleted:', (await p.locator('.kanban-board-row', { hasText: BOARD }).count()) === 0)

  await b.close()
  process.exit(failed ? 1 : 0)
})().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
