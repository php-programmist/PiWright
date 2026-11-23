/* Smoke: UI мутации шлют rev — свежая правка применяется, устаревшая отклоняется с ошибкой. */
const { chromium } = require('playwright-core')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'
const MARK = `smoke-rev-${Date.now()}`

;(async () => {
  const b = await chromium.connectOverCDP(CDP)
  const p = b.contexts()[0].pages()[0]

  const hasProject = await p.locator('.sessions-panel', { hasText: 'piwright' }).count()
  if (!hasProject) {
    await p.evaluate(async () => {
      await window.piwright.setSettings({ projects: [{ kind: 'native', dir: 'D:\\Projects\\piwright' }] })
    })
    await p.reload()
    await p.waitForTimeout(2000)
  }
  if ((await p.locator('.session-row').count()) === 0) {
    await p.locator('button[title*="New session"], button[title*="session"]').first().click()
    await p.waitForSelector('.session-row', { timeout: 90000 })
  }
  if ((await p.locator('.right-bar button[title="Kanban"]').count()) === 0) {
    await p.evaluate(async () => {
      const s = await window.piwright.getSettings()
      await window.piwright.setSettings({ ...s, kanbanEnabled: true })
    })
    await p.reload()
    await p.waitForTimeout(2000)
  }
  if ((await p.locator('.board-column').count()) === 0) {
    if ((await p.locator('.kanban-board-row').count()) === 0) {
      await p.locator('.right-bar button[title="Kanban"]').first().click()
      await p.waitForTimeout(1200)
    }
    const boardRow = p.locator('.kanban-board-row').first()
    if (await boardRow.count()) {
      await boardRow.click()
      await p.waitForTimeout(1000)
    }
  }
  await p.waitForSelector('.board-column', { timeout: 10000 })

  // Temp card through the UI.
  await p.locator('.board-card-add').first().click()
  await p.waitForTimeout(300)
  await p.keyboard.type(MARK)
  await p.keyboard.press('Enter')
  await p.waitForTimeout(800)
  await p.locator('.board-card', { hasText: MARK }).first().dblclick()
  await p.waitForSelector('.board-card-modal', { timeout: 10000 })
  console.log('modal opened')

  // Fresh edit: rename via modal title (saveDetails шлёт rev) — должно примениться.
  await p.locator('.board-modal-title').fill(`${MARK} v2`)
  await p.keyboard.press('Enter')
  await p.waitForTimeout(900)
  const fresh = await p.evaluate(() => ({
    error: document.querySelector('.panel-hint')?.textContent ?? null,
    rev: document.querySelector('.board-rev')?.textContent ?? null,
    title: document.querySelector('.board-modal-title')?.value ?? null,
  }))
  console.log('fresh edit:', JSON.stringify(fresh))

  // Stale edit: внешняя мутация двигает rev, затем правка описания из открытой модалки.
  const ext = await p.evaluate(async (mark) => {
    const s = await window.piwright.getSettings()
    const project = s.projects[0]
    const boards = await window.piwright.kanbanBoards(project)
    const full = await window.piwright.kanbanBoardGet(project, boards.boards[0].id)
    const card = full.board.cards.find((c) => c.title.includes(mark))
    if (!card) return { ok: false, error: 'card not found' }
    const res = await window.piwright.kanbanCardComment(project, boards.boards[0].id, { cardId: card.id, text: 'external bump' })
    return { ok: res.ok, rev: res.board?.rev ?? null }
  }, `${MARK} v2`)
  console.log('external bump:', JSON.stringify(ext))

  await p.locator('.board-modal-description').fill('stale description edit')
  await p.locator('.board-section-label').first().click()
  await p.waitForTimeout(1200)
  const stale = await p.evaluate(() => ({
    error: document.querySelector('.panel-hint')?.textContent ?? null,
  }))
  console.log('stale edit:', JSON.stringify(stale))

  // Cleanup: удалить карточку напрямую через IPC.
  const cleanup = await p.evaluate(async (mark) => {
    const s = await window.piwright.getSettings()
    const project = s.projects[0]
    const boards = await window.piwright.kanbanBoards(project)
    const full = await window.piwright.kanbanBoardGet(project, boards.boards[0].id)
    const card = full.board.cards.find((c) => c.title.includes(mark))
    if (!card) return { deleted: false, reason: 'not found' }
    const res = await window.piwright.kanbanCardDelete(project, boards.boards[0].id, card.id)
    return { deleted: res.ok }
  }, MARK)
  console.log('cleanup:', JSON.stringify(cleanup))

  await b.close()
  const ok =
    fresh.error === null &&
    fresh.title === `${MARK} v2` &&
    fresh.rev !== null &&
    ext.ok === true &&
    stale.error !== null &&
    stale.error.includes('Board has changed') &&
    cleanup.deleted === true
  console.log(ok ? 'SMOKE PASS' : 'SMOKE FAIL')
  if (!ok) process.exit(1)
})().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
