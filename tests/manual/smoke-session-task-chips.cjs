/* Smoke: чипы задач канбана в шапке чата (слева от тогглеров). Фейковый pi
 * (fake-pi-ok.cmd, handshake sessionId 's-fake-1'), временный проект с доской,
 * в которой карточка SMOKE-CHIPS-LINKED несёт sessions:[{id:'s-fake-1'}].
 * Ожидания: чип только у связанной карточки, клик открывает вкладку задачи,
 * после удаления связи чип исчезает (поллинг 3 с).
 * Запуск: поднятый smoke-инстанс (SMOKE_CDP), SMOKE_PROJECT_DIR с сид-доской. */
const { chromium } = require('playwright-core')
const fs = require('node:fs')
const path = require('node:path')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9225'
const PROJECT_DIR = process.env.SMOKE_PROJECT_DIR
const LINKED = 'SMOKE-CHIPS-LINKED'
const PLAIN = 'SMOKE-CHIPS-PLAIN'
const BOARD_FILE = path.join(PROJECT_DIR, '.pi', 'kanban', 'b-1234abcd.json')
const rx = (ru, en) => new RegExp(`${ru}|${en}`)
let failed = false
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
  if (!ok) failed = true
}

const board = (sessionLinked) => ({
  version: 1,
  id: 'b-1234abcd',
  name: 'SmokeChips',
  rev: 1,
  workflow: '',
  columns: [
    { id: 'col-1111abcd', name: 'Todo' },
    { id: 'col-2222abcd', name: 'Review' }
  ],
  cards: [
    {
      id: 'c-1111abcd',
      title: LINKED,
      columnId: 'col-1111abcd',
      order: 0,
      createdAt: '2026-11-25T10:00:00.000Z',
      updatedAt: '2026-11-25T10:00:00.000Z',
      description: '',
      images: [],
      comments: [],
      ...(sessionLinked ? { sessions: [{ id: 's-fake-1', title: 'Fake OK Session', at: '2026-11-25T10:00:00.000Z' }] } : {})
    },
    {
      id: 'c-2222abcd',
      title: PLAIN,
      columnId: 'col-1111abcd',
      order: 1,
      createdAt: '2026-11-25T10:00:00.000Z',
      updatedAt: '2026-11-25T10:00:00.000Z',
      description: '',
      images: [],
      comments: []
    }
  ]
})

async function main() {
  const browser = await chromium.connectOverCDP(CDP)
  const page = browser.contexts()[0].pages()[0]
  await page.waitForSelector('.right-bar', { timeout: 30000 })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  const boot = await page.evaluate(async (dir) => {
    return await window.piwright.newSession({ kind: 'native', dir })
  }, PROJECT_DIR)
  console.log('session created:', boot.hostId)

  for (let i = 0; i < 5; i++) {
    try {
      await page.locator('.project .expand').first().click({ timeout: 2000 })
      await page.waitForSelector('.session-row', { timeout: 3000 })
      break
    } catch {
      if (i === 4) throw new Error('session row did not appear after expand clicks')
    }
  }
  await page.locator('.session-row').first().click()
  await page.waitForSelector('.composer textarea', { timeout: 90000 })
  await page.waitForTimeout(1500)

  const chip = page.locator('.header .session-task-chips .board-chip.task', { hasText: LINKED })
  try {
    await chip.waitFor({ timeout: 10000 })
    check('chip for linked card in header', true)
  } catch {
    check('chip for linked card in header', false)
  }
  check('no chip for plain card', (await page.locator('.header .session-task-chips .board-chip', { hasText: PLAIN }).count()) === 0)
  check('single chip total', (await page.locator('.header .session-task-chips .board-chip').count()) === 1)

  // чип слева от тогглеров: до кнопки share в DOM
  const order = await page.evaluate(() => {
    const chips = document.querySelector('.header .session-task-chips')
    const share = Array.from(document.querySelectorAll('.header button.icon')).find((b) => b.querySelector('circle'))
    return chips !== null && share !== null && !!(chips.compareDocumentPosition(share) & Node.DOCUMENT_POSITION_FOLLOWING)
  })
  check('chips left of toggler icons', order)

  // клик — вкладка задачи
  await chip.evaluate((el) => el.click())
  await page.waitForTimeout(800)
  const tab = page.locator('.tab-bar .tab', { hasText: LINKED })
  check('task tab opened', (await tab.count()) === 1)
  check('task view rendered', (await page.locator('.task-view').count()) === 1)
  const title = await page.locator('.task-view .board-modal-title').inputValue()
  check('task view shows linked card', title === LINKED)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  // связь убрана из файла доски — чип исчезает после поллинга
  fs.writeFileSync(BOARD_FILE, JSON.stringify(board(false), null, 2))
  console.log('unlink written:', BOARD_FILE, 'sessions in file:', JSON.parse(fs.readFileSync(BOARD_FILE, 'utf8')).cards[0].sessions ?? null)
  await page.waitForFunction(
    () => document.querySelectorAll('.header .session-task-chips .board-chip').length === 0,
    null,
    { timeout: 10000 }
  )
  check('chip disappears after unlink', true)

  // связь вернули — чип появляется снова
  fs.writeFileSync(BOARD_FILE, JSON.stringify(board(true), null, 2))
  try {
    await chip.waitFor({ timeout: 10000 })
    check('chip reappears after relink', true)
  } catch {
    check('chip reappears after relink', false)
  }

  await browser.close()
  process.exit(failed ? 1 : 0)
}

main().catch((err) => {
  console.error('SMOKE FAIL:', err)
  process.exit(1)
})
