/** Разовая проверка: вкладка задачи переживает reload (персист в settings), нет горизонтального
 *  переполнения в .task-view. */
const { chromium } = require('playwright-core')
const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'
let failed = false
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
  if (!ok) failed = true
}

;(async () => {
  const b = await chromium.connectOverCDP(CDP)
  const p = b.contexts()[0].pages()[0]
  await p.waitForTimeout(1500)

  // открыть доску SMOKE-TASKTAB, создать карточку, открыть вкладку задачи
  await p.evaluate(async () => {
    const cur = await window.piwright.getSettings()
    await window.piwright.setSettings({ ...cur, kanbanEnabled: true, projects: [{ kind: 'native', dir: 'D:\\Projects\\piwright' }] })
  })
  await p.reload()
  await p.waitForTimeout(3000)
  const kbBtn = p.locator('.right-bar button[title="Канбан"], .right-bar button[title="Kanban"]')
  if (!(await kbBtn.getAttribute('class'))?.includes('active')) await kbBtn.click()
  await p.waitForTimeout(800)
  await p.locator('.kanban-add').click()
  await p.locator('.kanban-name-input').fill('SMOKE-TASKTAB')
  await p.locator('.kanban-name-input').press('Enter')
  await p.waitForTimeout(800)
  await p.locator('.kanban-board-name', { hasText: 'SMOKE-TASKTAB' }).click()
  await p.waitForTimeout(1000)
  const column = () => p.locator('.board-column', { has: p.locator('.board-column-name', { hasText: 'Backlog' }) })
  await column().locator('.board-card-add').click()
  await column().locator('.kanban-name-input').fill('SMOKE-PERSIST')
  await column().locator('.kanban-name-input').press('Enter')
  await p.waitForTimeout(500)
  await column().locator('.board-card', { hasText: 'SMOKE-PERSIST' }).click({ button: 'right' })
  await p.waitForTimeout(400)
  await p.locator('.files-menu button', { hasText: /Открыть в отдельной вкладке|Open in separate tab/ }).evaluate((el) => el.click())
  await p.waitForTimeout(800)
  check('task tab open', (await p.locator('.task-view').count()) === 1)

  // переполнений нет
  const overflow = await p.evaluate(() => {
    const el = document.querySelector('.task-view')
    if (el === null) return true
    return el.scrollWidth <= el.clientWidth + 1
  })
  check('no horizontal overflow in task-view', overflow)

  // reload — вкладка восстановилась из settings
  await p.reload()
  await p.waitForTimeout(3000)
  check('task tab survives reload', (await p.locator('.tab-bar .tab', { hasText: 'SMOKE-PERSIST' }).count()) === 1)
  check('task view after reload', (await p.locator('.task-view').count()) === 1)
  const title = await p.locator('.task-view .board-modal-title').inputValue()
  check('same card after reload', title === 'SMOKE-PERSIST')

  // уборка
  await p.keyboard.press('Escape')
  await p.waitForTimeout(400)
  await p.locator('.kanban-board-row', { hasText: 'SMOKE-TASKTAB' }).locator('.kanban-board-action').evaluate((el) => el.click())
  await p.waitForTimeout(400)
  await p.locator('.project-menu button', { hasText: /Удалить доску|Delete board/ }).click()
  await p.waitForTimeout(400)
  await p.locator('.files-rename-box button', { hasText: /Удалить|Delete/ }).last().click()
  await p.waitForTimeout(800)
  console.log('cleanup: board deleted:', (await p.locator('.kanban-board-row', { hasText: 'SMOKE-TASKTAB' }).count()) === 0)

  await b.close()
  process.exit(failed ? 1 : 0)
})().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
