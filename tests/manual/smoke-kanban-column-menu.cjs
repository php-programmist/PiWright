const { chromium } = require('playwright-core')

const SMOKE_CDP = process.env.SMOKE_CDP || 'http://localhost:9223'
const BOARD = 'SMOKE-COLMENU'
const rx = (ru, en) => new RegExp(`${ru}|${en}`)

;(async () => {
  const b = await chromium.connectOverCDP(SMOKE_CDP)
  const p = b.contexts()[0].pages()[0]
  await p.waitForTimeout(1000)
  await p.keyboard.press('Escape')
  await p.waitForTimeout(400)

  // открыть панель канбана
  const kbBtn = p.locator('.right-bar button[title="Канбан"], .right-bar button[title="Kanban"]')
  if (!(await kbBtn.getAttribute('class'))?.includes('active')) await kbBtn.click()
  await p.waitForTimeout(800)

  // удалить доску от прошлого прогона, если осталась
  const oldRow = p.locator('.kanban-board-row', { hasText: BOARD })
  if (await oldRow.count()) {
    await oldRow.locator('.kanban-board-action').last().evaluate((el) => el.click())
    await p.waitForTimeout(400)
    await p.locator('.files-rename-box button', { hasText: rx('Удалить', 'Delete') }).last().click()
    await p.waitForTimeout(800)
  }

  // создать временную доску
  await p.locator('.kanban-add').click()
  await p.locator('.kanban-name-input').fill(BOARD)
  await p.locator('.kanban-name-input').press('Enter')
  await p.waitForTimeout(800)

  // открыть доску
  await p.locator('.kanban-board-name', { hasText: BOARD }).click()
  await p.waitForTimeout(1000)

  const column = (name) => p.locator('.board-column', { has: p.locator('.board-column-name', { hasText: name }) })
  const cardsIn = async (name) => await column(name).locator('.board-card').count()

  // две карточки в Backlog
  for (const title of ['SMOKE-A', 'SMOKE-B']) {
    await column('Backlog').locator('.board-card-add').click()
    await column('Backlog').locator('.kanban-name-input').fill(title)
    await column('Backlog').locator('.kanban-name-input').press('Enter')
    await p.waitForTimeout(500)
  }
  console.log('backlog cards after add:', await cardsIn('Backlog'))

  // меню колонки: новые пункты на месте
  await column('Backlog').locator('.board-column-btn').click()
  await p.waitForTimeout(300)
  const menu = p.locator('.files-menu')
  console.log('menu has move-tasks:', await menu.locator('button', { hasText: rx('Переместить задачи в', 'Move tasks to') }).count())
  console.log('menu has clear:', await menu.locator('button', { hasText: rx('Очистить колонку', 'Clear column') }).count())

  // переместить задачи в Todo через модалку
  await menu.locator('button', { hasText: rx('Переместить задачи в', 'Move tasks to') }).click()
  await p.waitForTimeout(400)
  const modal = p.locator('.board-move-cards-modal')
  console.log('modal visible:', await modal.count())
  await modal.locator('select.board-column-select').selectOption({ label: 'Todo' })
  await modal.locator('button.board-primary').click()
  await p.waitForTimeout(800)
  console.log('backlog after move:', await cardsIn('Backlog'))
  console.log('todo after move:', await cardsIn('Todo'))

  // очистить Todo через confirm
  await column('Todo').locator('.board-column-btn').click()
  await p.waitForTimeout(300)
  await p.locator('.files-menu button', { hasText: rx('Очистить колонку', 'Clear column') }).click()
  await p.waitForTimeout(400)
  console.log('confirm text:', (await p.locator('.files-rename-box').first().textContent())?.trim())
  await p.locator('button', { hasText: rx('Очистить', 'Clear') }).last().click()
  await p.waitForTimeout(800)
  console.log('todo after clear:', await cardsIn('Todo'))
  console.log('backlog after clear:', await cardsIn('Backlog'))

  // убрать за собой
  const kbRow = p.locator('.kanban-board-row', { hasText: BOARD })
  if (await kbRow.count()) {
    await kbRow.locator('.kanban-board-action').last().evaluate((el) => el.click())
    await p.waitForTimeout(400)
    await p.locator('.files-rename-box button', { hasText: rx('Удалить', 'Delete') }).last().click()
    await p.waitForTimeout(800)
  }
  console.log('cleanup board rows left:', await p.locator('.kanban-board-row', { hasText: BOARD }).count())

  await b.close()
})().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
