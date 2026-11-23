/** Смоук модалки карточки внутри вкладки канбана: оверлей только над доской (таб-бар и док
 *  «История Git» кликабельны), модалка переживает смену вкладки (дифф из истории Git →
 *  возврат на канбан — карточка снова открыта). */
const { chromium } = require('playwright-core')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'
const BOARD = 'SMOKE-CARDTAB'
const CARD = 'SMOKE-CARD-1'
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

  // открыть панель канбана
  const kbBtn = p.locator('.right-bar button[title="Канбан"], .right-bar button[title="Kanban"]')
  if (!(await kbBtn.getAttribute('class'))?.includes('active')) await kbBtn.click()
  await p.waitForTimeout(800)

  // удалить доску от прошлого прогона
  const oldRow = p.locator('.kanban-board-row', { hasText: BOARD })
  if (await oldRow.count()) {
    await oldRow.locator('.kanban-board-action').last().evaluate((el) => el.click())
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

  // карточка в Backlog
  const column = (name) => p.locator('.board-column', { has: p.locator('.board-column-name', { hasText: name }) })
  await column('Backlog').locator('.board-card-add').click()
  await column('Backlog').locator('.kanban-name-input').fill(CARD)
  await column('Backlog').locator('.kanban-name-input').press('Enter')
  await p.waitForTimeout(500)

  // открыть модалку двойным кликом
  await column('Backlog').locator('.board-card', { hasText: CARD }).dblclick()
  await p.waitForTimeout(600)
  const overlay = p.locator('.board-card-overlay')
  check('modal open', (await overlay.count()) === 1)
  check('overlay position absolute', (await overlay.evaluate((el) => getComputedStyle(el).position)) === 'absolute')
  check('overlay inside board-view', await overlay.evaluate((el) => el.closest('.board-view') !== null))

  // таб-бар не перекрыт
  const tabHit = await p.evaluate(() => {
    const bar = document.querySelector('.tab-bar')
    if (bar === null) return false
    const r = bar.getBoundingClientRect()
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return bar.contains(el)
  })
  check('tab-bar clickable', tabHit)

  // док «История Git» открывается и не перекрыт оверлеем
  await p.locator('.right-bar .gitlog-toggle').click()
  await p.waitForTimeout(1000)
  const dock = p.locator('.gitlog-dock')
  check('gitlog dock open', (await dock.count()) === 1)
  const dockHit = await p.evaluate(() => {
    const d = document.querySelector('.gitlog-dock')
    if (d === null) return false
    const r = d.getBoundingClientRect()
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return d.contains(el)
  })
  check('gitlog dock clickable', dockHit)

  // коммит → файл → дифф в новой вкладке (центр уходит с канбана, модалка размонтируется)
  await dock.locator('.gitlog-row').first().click()
  await p.waitForTimeout(1200)
  const fileRow = dock.locator('.gitlog-file').first()
  check('commit files listed', (await fileRow.count()) > 0)
  await fileRow.click()
  await p.waitForTimeout(1200)
  check('modal hidden on diff tab', (await overlay.count()) === 0)
  const tabNames = await p.locator('.tab-bar .tab .tab-name').allTextContents()
  check('kanban tab still in tab-bar', tabNames.some((name) => name.includes(BOARD)))

  // возврат на вкладку канбана — модалка восстановлена, док открыт
  await p.locator('.tab-bar .tab', { hasText: BOARD }).click()
  await p.waitForTimeout(1000)
  check('modal restored after tab switch', (await overlay.count()) === 1)
  check('gitlog dock still open', (await dock.count()) === 1)
  const modalText = await p.locator('.board-card-overlay .board-modal-title').inputValue()
  check('restored modal is same card', modalText === CARD)

  // Escape закрывает модалку
  await p.keyboard.press('Escape')
  await p.waitForTimeout(400)
  check('escape closes modal', (await overlay.count()) === 0)

  // уборка: закрыть док, удалить доску
  await p.locator('.right-bar .gitlog-toggle').click()
  await p.waitForTimeout(500)
  const kbRow = p.locator('.kanban-board-row', { hasText: BOARD })
  await kbRow.locator('.kanban-board-action').last().evaluate((el) => el.click())
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
