/* Smoke: kanban card modal - B1 layout (rail, feed, header delete, autoscroll after send). */
const { chromium } = require('playwright-core')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'
const MARK = `smoke-modal-${Date.now()}`

;(async () => {
  const b = await chromium.connectOverCDP(CDP)
  const p = b.contexts()[0].pages()[0]

  // Fresh instance: add this repo as project if absent.
  const hasProject = await p.locator('.sessions-panel', { hasText: 'piwright' }).count()
  if (!hasProject) {
    await p.evaluate(async () => {
      await window.piwright.setSettings({ projects: [{ kind: 'native', dir: 'D:\\Projects\\piwright' }] })
    })
    await p.reload()
    await p.waitForTimeout(2000)
  }

  // Create a session if none active.
  if ((await p.locator('.session-row').count()) === 0) {
    await p.locator('button[title*="New session"], button[title*="session"]').first().click()
    await p.waitForSelector('.session-row', { timeout: 90000 })
  }
  console.log('session ready')

  // Enable kanban if off (settings, Advanced checkbox), like smoke-kanban-toggle.
  if ((await p.locator('.right-bar button[title="Kanban"]').count()) === 0) {
    await p.locator('button[title*="Settings"]').first().click()
    await p.waitForTimeout(800)
    await p.locator('.settings-nav button', { hasText: /Advanced/ }).click()
    await p.waitForTimeout(500)
    const cb = p.locator('label:has-text("kanban boards")').locator('input[type=checkbox]')
    await cb.first().setChecked(true)
    await p.waitForTimeout(2500)
    await p.keyboard.press('Escape')
    await p.waitForTimeout(800)
  }

  // Idempotent: open kanban panel + board only if not already visible.
  if ((await p.locator('.board-card-modal').count()) > 0) {
    await p.keyboard.press('Escape')
    await p.waitForTimeout(400)
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

  // Create a temp card through the UI: add-card control in first column.
  await p.locator('.board-card-add').first().click()
  await p.waitForTimeout(300)
  await p.keyboard.type(MARK)
  await p.keyboard.press('Enter')
  await p.waitForTimeout(800)

  // Open modal by double click on the card.
  await p.locator('.board-card', { hasText: MARK }).first().dblclick()
  await p.waitForSelector('.board-card-modal', { timeout: 10000 })
  console.log('modal opened')

  // Big viewport so the 860px modal fits.
  await p.setViewportSize({ width: 1600, height: 1000 })
  await p.waitForTimeout(300)

  // Structure checks.
  const checks = await p.evaluate(() => {
    const q = (sel) => document.querySelector(sel)
    const modal = q('.board-card-modal')
    const rail = q('.board-card-rail')
    const head = modal?.querySelector('.board-modal-head')
    return {
      split: !!q('.board-card-split'),
      rail: !!rail,
      railColumnSelect: !!rail?.querySelector('.board-column-select'),
      railAttachments: !!rail?.querySelector('.board-card-images'),
      headDelete: !!head?.querySelector('.board-head-danger'),
      feed: !!q('.board-feed'),
      sectionLabels: [...(modal?.querySelectorAll('.board-section-label') ?? [])].map((e) => e.textContent?.trim()),
      okButton: !!modal?.querySelector('.board-modal-description-actions'),
      footerSend: !!modal?.querySelector('.board-modal-foot .board-primary'),
      footerColumnSelect: !!modal?.querySelector('.board-modal-foot .board-column-select'),
      modalWidth: modal ? Math.round(modal.getBoundingClientRect().width) : 0,
    }
  })
  console.log('structure:', JSON.stringify(checks, null, 1))

  // Add comments (12) - autoscroll to bottom after each send.
  for (let i = 0; i < 12; i += 1) {
    await p.locator('.board-comment-input').fill(`comment ${i} ${MARK}`)
    await p.locator('.board-modal-foot .board-primary').click()
    await p.waitForTimeout(250)
  }
  await p.waitForTimeout(800)
  const after = await p.evaluate(() => {
    const body = document.querySelector('.board-card-modal .board-modal-body')
    return { scroll: Math.round(body.scrollTop), height: body.scrollHeight, client: body.clientHeight }
  })
  const scrolled = after.height > after.client && after.scroll >= after.height - after.client - 2
  console.log('autoscroll:', JSON.stringify({ after, scrolled }))

  // Agent-style comment with session/commits via IPC -> card-level chips in rail.
  const railChips = await p.evaluate(async (mark) => {
    const s = await window.piwright.getSettings()
    const project = s.projects[0]
    const modal = document.querySelector('.board-card-modal')
    const title = modal.querySelector('.board-modal-title').value
    const boards = await window.piwright.kanbanBoards(project)
    const board = boards.boards[0]
    const res = await window.piwright.kanbanCardComment(project, board.id, {
      cardId: title,
      text: 'agent reply',
      session: { id: 'smoke-sess-1', title: 'smoke session' },
      commits: [{ hash: 'abc1234def', message: 'fix: stuff' }],
    })
    return { ok: res.ok, error: res.error ?? null }
  }, MARK)
  console.log('agent comment:', JSON.stringify(railChips))
  if (!railChips.ok) {
    // cardId is the kanban id, not the title - resolve it from the board and retry.
    const retry = await p.evaluate(async (mark) => {
      const s = await window.piwright.getSettings()
      const project = s.projects[0]
      const boards = await window.piwright.kanbanBoards(project)
      const board = boards.boards[0]
      const full = await window.piwright.kanbanBoardGet(project, board.id)
      const card = (full.board?.cards ?? []).find((c) => c.title.includes(mark))
      if (!card) return { ok: false, error: 'card not found' }
      const res = await window.piwright.kanbanCardComment(project, board.id, {
        cardId: card.id,
        text: 'agent reply',
        session: { id: 'smoke-sess-1', title: 'smoke session' },
        commits: [{ hash: 'abc1234def', message: 'fix: stuff' }],
      })
      return { ok: res.ok, error: res.error ?? null }
    }, MARK)
    console.log('agent comment retry:', JSON.stringify(retry))
  }

  // External mutation does not push to renderer: close modal, refresh board, reopen modal.
  await p.keyboard.press('Escape')
  await p.waitForTimeout(400)
  await p.locator('.board-head-refresh').click()
  await p.waitForTimeout(800)
  await p.locator('.board-card', { hasText: MARK }).first().dblclick()
  await p.waitForSelector('.board-card-modal', { timeout: 10000 })
  await p.waitForTimeout(400)

  const rail = await p.evaluate(() => {
    const railEl = document.querySelector('.board-card-rail')
    const labels = [...railEl.querySelectorAll('.board-section-label')].map((e) => e.textContent?.trim())
    const chips = [...railEl.querySelectorAll('.board-chip')].map((e) => ({ cls: e.className, title: e.title, text: e.textContent }))
    const feedChips = [...document.querySelectorAll('.board-feed .board-chip')].length
    return { labels, chips, feedChips }
  })
  console.log('rail:', JSON.stringify(rail, null, 1))

  // Feed item rendered with avatar + name + date.
  const feed = await p.evaluate(() => {
    const items = [...document.querySelectorAll('.board-feed-item')]
    const last = items[items.length - 1]
    return {
      count: items.length,
      avatar: !!last?.querySelector('.board-feed-avatar'),
      name: last?.querySelector('.board-feed-name')?.textContent,
      date: !!last?.querySelector('.board-feed-date'),
      text: last?.querySelector('.board-comment-text')?.textContent,
    }
  })
  console.log('feed:', JSON.stringify(feed))

  // Overflow check: rail must not overflow modal, no horizontal scroll in main body.
  const fit = await p.evaluate(() => {
    const modal = document.querySelector('.board-card-modal')
    const body = modal.querySelector('.board-modal-body')
    const railEl = modal.querySelector('.board-card-rail')
    const mr = modal.getBoundingClientRect()
    const rr = railEl.getBoundingClientRect()
    return {
      railInsideModal: rr.right <= mr.right + 1 && rr.left >= mr.left - 1,
      bodyHScroll: body.scrollWidth > body.clientWidth + 1,
      railHScroll: railEl.scrollWidth > railEl.clientWidth + 1,
    }
  })
  console.log('fit:', JSON.stringify(fit))

  // Screenshot for review.
  await p.screenshot({ path: process.env.TEMP + '\\card-modal-smoke.png' })

  // Cleanup: delete card via header trash + confirm.
  await p.locator('.board-card-modal .board-head-danger').click()
  await p.waitForTimeout(500)
  const confirmBtn = p.locator('button', { hasText: /^Delete$|^Удалить$/ }).last()
  if (await confirmBtn.count()) {
    await confirmBtn.click()
    await p.waitForTimeout(800)
  }
  const gone = (await p.locator('.board-card', { hasText: MARK }).count()) === 0
  console.log('deleted:', gone)

  await b.close()
  const railChipOk = rail.chips.length >= 2 && rail.chips.some((c) => c.cls.includes('session')) && rail.chips.some((c) => c.cls.includes('commit')) && rail.chips.every((c) => c.title.includes('·'))
  const ok = checks.split && checks.rail && checks.railColumnSelect && checks.railAttachments && checks.headDelete &&
    checks.feed && !checks.okButton && !checks.footerColumnSelect && checks.footerSend && checks.modalWidth >= 850 &&
    scrolled && feed.avatar && railChipOk && rail.feedChips >= 2 &&
    fit.railInsideModal && !fit.bodyHScroll && !fit.railHScroll && gone
  console.log(ok ? 'SMOKE PASS' : 'SMOKE FAIL')
  if (!ok) process.exit(1)
})().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
