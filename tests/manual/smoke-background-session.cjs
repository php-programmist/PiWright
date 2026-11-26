/* Smoke: фоновые сессии. Крестик вкладки при идущем ходе закрывает только вкладку:
 * строка остаётся в панели с play-иконкой и живым индикатором; play возвращает вкладку,
 * повторный крестик у idle-сессии закрывает её полностью (строка уходит в History). */
const { chromium } = require('playwright-core')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const CDP = process.env.SMOKE_CDP ?? 'http://localhost:9223'
const projectDir = path.join(os.tmpdir(), 'piwright-bgproj')
fs.mkdirSync(projectDir, { recursive: true })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForDot(page, hostId, dot, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const current = await page.evaluate(async (id) => {
      const snap = await window.piwright.listSessions()
      return snap.active.find((s) => s.hostId === id)?.dot ?? null
    }, hostId)
    if (current === dot) return
    if (Date.now() > deadline) throw new Error(`dot never became "${dot}" (last: ${current})`)
    await sleep(1000)
  }
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP)
  const page = browser.contexts()[0].pages()[0]

  // 1. Проект во временной папке — через setSettings (нативный диалог недоступен), затем reload.
  const hasProject = await page.evaluate((dir) => window.piwright.getSettings().then((s) => s.projects.some((p) => p.dir === dir)), projectDir)
  if (!hasProject) {
    await page.evaluate(async (dir) => {
      const s = await window.piwright.getSettings()
      await window.piwright.setSettings({ ...s, projects: [...s.projects, { kind: 'native', dir }] })
    }, projectDir)
    await page.reload()
  }
  await page.waitForSelector('.project-row', { timeout: 30000 })

  // 2. Сессия: переиспользуем живую из прошлого запуска, иначе новая через IPC.
  let hostId = await page.evaluate(async (dir) => {
    const snap = await window.piwright.listSessions()
    return snap.active.find((s) => s.project.dir === dir)?.hostId ?? null
  }, projectDir)
  if (hostId === null) {
    hostId = await page.evaluate(async (dir) => (await window.piwright.newSession({ kind: 'native', dir })).hostId, projectDir)
  }
  // Проект добавлен настройками — раскрыт не будет (IPC-создание не тогглит expand): раскрываем кликом.
  // Целимся в строку своего проекта по имени (могут быть другие проекты с сессиями).
  const projectName = path.basename(projectDir)
  const projectRow = page.locator('.project-row', { has: page.locator('.project-name', { hasText: projectName }) })
  if ((await page.locator('.session-row').count()) === 0) {
    await projectRow.locator('.expand').click()
  }
  await page.waitForSelector('.session-row', { timeout: 90000 })
  await page.locator('.session-row').first().click()
  await page.waitForSelector('.tab.session', { timeout: 15000 })
  console.log('session tab opened')

  // 3. Запускаем долгий ход и ждём busy.
  await page.evaluate((id) => {
    void window.piwright.prompt(id, 'Run the shell command "ping -n 25 127.0.0.1" and when it finishes, reply with exactly: PING DONE')
  }, hostId)
  await waitForDot(page, hostId, 'busy', 90000)
  console.log('turn is busy')

  // 4. Крестик вкладки во время хода: вкладка закрывается, строка остаётся с play.
  await page.locator('.tab.session .tab-close').click()
  await page.waitForSelector('.tab.session', { state: 'detached', timeout: 5000 }).catch(() => {})
  const tabGone = (await page.locator('.tab.session').count()) === 0
  const rowStays = (await page.locator('.session-row').count()) === 1
  const playVisible = (await page.locator('.session-row .icon.play').count()) === 1
  const stopColor = await page.evaluate(() => {
    const el = document.querySelector('.session-row .icon.stop')
    return el === null ? null : getComputedStyle(el).color
  })
  const dotClass = await page.evaluate(() => document.querySelector('.session-row .dot')?.className ?? null)
  console.log(JSON.stringify({ tabGone, rowStays, playVisible, stopColor, dotClass }))
  if (!tabGone || !rowStays || !playVisible) throw new Error('background close failed')

  // 5. Шапка чата: квадрат красный и крупный (rect 5,5 14x14 в viewBox 24).
  await page.locator('.session-row').first().click()
  await page.waitForSelector('.header .icon.stop svg rect', { timeout: 10000 })
  const headerStop = await page.evaluate(() => {
    const rect = document.querySelector('.header .icon.stop svg rect')
    const btn = document.querySelector('.header .icon.stop')
    return rect === null ? null : { x: rect.getAttribute('x'), width: rect.getAttribute('width'), color: getComputedStyle(btn).color }
  })
  console.log('header stop:', JSON.stringify(headerStop))
  if (headerStop === null || headerStop.x !== '5' || headerStop.width !== '14') throw new Error('header stop square wrong size')
  // Возвращаем вкладку в фон для проверки play после конца хода.
  await page.locator('.tab.session .tab-close').click()
  await page.waitForSelector('.tab.session', { state: 'detached', timeout: 5000 }).catch(() => {})

  // 6. Ждём конца хода: индикатор в панели должен погаснуть (idle), строка и play остаются.
  await waitForDot(page, hostId, 'idle', 180000)
  const afterTurn = await page.evaluate(() => ({
    row: document.querySelectorAll('.session-row').length,
    play: document.querySelectorAll('.session-row .icon.play').length,
    dot: document.querySelector('.session-row .dot')?.className ?? null,
    historyTitles: [...document.querySelectorAll('.history-item .history-title')].map((el) => el.textContent)
  }))
  console.log('after turn:', JSON.stringify(afterTurn))
  if (afterTurn.row !== 1 || afterTurn.play !== 1) throw new Error('background row lost after turn end')
  const sessionTitle = await page.evaluate(async (id) => (await window.piwright.listSessions()).active.find((s) => s.hostId === id)?.title, hostId)
  if (afterTurn.historyTitles.some((title) => title === sessionTitle)) throw new Error('background session leaked into History')

  // 7. Play возвращает вкладку (аттач), play-иконка исчезает.
  await page.evaluate((el) => el.click(), await page.locator('.session-row .icon.play').elementHandle())
  await page.waitForSelector('.tab.session', { timeout: 10000 })
  const playGone = (await page.locator('.session-row .icon.play').count()) === 0
  console.log('play reopens tab:', playGone)
  if (!playGone) throw new Error('play icon did not disappear after attach')

  // 8. Повторный крестик у idle-сессии закрывает её полностью — строка уходит, история появляется.
  await page.locator('.tab.session .tab-close').click()
  await page.waitForSelector('.session-row', { state: 'detached', timeout: 15000 }).catch(() => {})
  const closed = (await page.locator('.session-row').count()) === 0
  const inHistory = await page.evaluate((title) => [...document.querySelectorAll('.history-item .history-title')].some((el) => el.textContent === title), sessionTitle)
  console.log(JSON.stringify({ closed, inHistory }))
  if (!closed || !inHistory) throw new Error('full close failed')

  await browser.close()
  console.log('SMOKE OK')
}

main().catch((err) => {
  console.error('SMOKE FAIL:', err.message)
  process.exit(1)
})
