/* Smoke: токен kanban:task: в описании карточки рендерится бейджем с именем задачи прямо в поле
 * ввода (TokenField-бэкдроп), бейдж на первой строке внутри поля и непрозрачный (закрывает сырой
 * токен); Backspace справа от бейджа удаляет токен целиком. Регрессия c-93510c30. */
const { chromium } = require('playwright-core')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'
const MARK = `smoke-desc-${Date.now()}`

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
    await p.locator('button[title="Новая сессия"], button[title="New session"]').first().click()
    await p.waitForSelector('.session-row', { timeout: 90000 })
  }
  console.log('session ready')

  if ((await p.locator('.right-bar button[title="Канбан"], .right-bar button[title="Kanban"]').count()) === 0) {
    await p.locator('button[title*="Настройки"], button[title*="Settings"]').first().click()
    await p.waitForTimeout(800)
    await p.locator('.settings-nav button', { hasText: /Advanced|Расширенные/ }).click()
    await p.waitForTimeout(500)
    const cb = p.locator('label:has-text("kanban boards")').locator('input[type=checkbox]')
    await cb.first().setChecked(true)
    await p.waitForTimeout(2500)
    await p.keyboard.press('Escape')
    await p.waitForTimeout(800)
  }

  if ((await p.locator('.board-card-modal').count()) > 0) {
    await p.keyboard.press('Escape')
    await p.waitForTimeout(400)
  }
  if ((await p.locator('.board-column').count()) === 0) {
    if ((await p.locator('.kanban-board-row').count()) === 0) {
      await p.locator('.right-bar button[title="Канбан"], .right-bar button[title="Kanban"]').first().click()
      await p.waitForTimeout(1200)
    }
    const boardRow = p.locator('.kanban-board-row').first()
    if (await boardRow.count()) {
      await boardRow.click()
      await p.waitForTimeout(1000)
    }
  }
  await p.waitForSelector('.board-column', { timeout: 10000 })

  // Create target card + referenced card via IPC.
  const setup = await p.evaluate(async (mark) => {
    const s = await window.piwright.getSettings()
    const project = s.projects[0]
    const boards = await window.piwright.kanbanBoards(project)
    const board = boards.boards[0]
    const ref = await window.piwright.kanbanCardCreate(project, board.id, { title: `${mark} REF` })
    if (!ref.ok) return { ok: false, error: ref.error ?? 'ref create failed' }
    const full = await window.piwright.kanbanBoardGet(project, board.id)
    const refCard = (full.board?.cards ?? []).find((c) => c.title === `${mark} REF`)
    if (refCard === undefined) return { ok: false, error: 'ref card not found' }
    const description = `Ссылка на задачу (kanban:task:${refCard.id}) внутри скобок — длинный текст перед ссылкой, чтобы строка была занята и перенос бейджа был заметен.`
    const target = await window.piwright.kanbanCardCreate(project, board.id, { title: `${mark} TARGET`, description })
    return { ok: target.ok, error: target.error ?? null, refId: refCard.id }
  }, MARK)
  console.log('setup:', JSON.stringify(setup))
  if (!setup.ok) process.exit(1)

  await p.locator('.board-head-refresh').click()
  await p.waitForTimeout(800)

  // Open target card modal.
  await p.locator('.board-card', { hasText: `${MARK} TARGET` }).first().dblclick()
  await p.waitForSelector('.board-card-modal', { timeout: 10000 })
  await p.setViewportSize({ width: 1600, height: 1000 })
  await p.waitForTimeout(400)

  const refTitle = `${MARK} REF`
  const expectedTitle = refTitle.length > 20 ? `${refTitle.slice(0, 20)}…` : refTitle
  const check = await p.evaluate(() => {
    const ta = document.querySelector('.board-card-modal .board-modal-description')
    if (ta === null) return { found: false }
    const field = ta.closest('.token-field')
    const backdrop = field !== null && field !== undefined ? field.querySelector('.token-backdrop') : null
    const badge = backdrop !== null && backdrop !== undefined ? backdrop.querySelector('.token-badge') : null
    const taRect = ta.getBoundingClientRect()
    const badgeRect = badge !== null && badge !== undefined ? badge.getBoundingClientRect() : null
    return {
      found: true,
      fieldPresent: field !== null && field !== undefined,
      backdropPresent: backdrop !== null && backdrop !== undefined,
      badgePresent: badge !== null && badge !== undefined,
      badgeText: badge?.textContent ?? null,
      badgeOpaque: badge !== null && getComputedStyle(badge).backgroundColor !== 'rgba(0, 0, 0, 0)',
      badgeInsideField: badgeRect !== null && badgeRect.top >= taRect.top && badgeRect.top < taRect.bottom,
      badgeOnFirstLine: badgeRect !== null && Math.abs(badgeRect.top - taRect.top) < 30,
    }
  })
  console.log('check:', JSON.stringify(check, null, 1))
  if (!check.found || !check.fieldPresent || !check.backdropPresent) throw new Error('TokenField not rendered for description')
  if (!check.badgePresent) throw new Error('token badge not rendered in description field')
  if (check.badgeText !== expectedTitle) throw new Error(`badge text mismatch: ${check.badgeText} expected ${expectedTitle}`)
  if (!check.badgeOpaque) throw new Error('badge background is not opaque — raw token would show through')
  if (!check.badgeInsideField || !check.badgeOnFirstLine) throw new Error('badge misaligned: ' + JSON.stringify(check))

  await p.screenshot({ path: process.env.TEMP + '\\desc-chip-inline.png' })

  // Backspace при каретке внутри бейджа удаляет токен целиком, каретка остаётся на месте токена.
  await p.evaluate(() => {
    const ta = document.querySelector('.board-card-modal .board-modal-description')
    const tokStart = ta.value.indexOf('kanban:task:')
    ta.focus()
    ta.setSelectionRange(tokStart + 5, tokStart + 5)
  })
  await p.keyboard.press('Backspace')
  await p.waitForTimeout(300)
  const afterBackspace = await p.evaluate(() => {
    const ta = document.querySelector('.board-card-modal .board-modal-description')
    return {
      value: ta.value,
      caret: ta.selectionStart,
      badges: document.querySelectorAll('.board-card-modal .token-badge').length,
    }
  })
  console.log('afterBackspace:', JSON.stringify(afterBackspace))
  if (afterBackspace.value.includes('kanban:task:') || afterBackspace.value.includes(':task:')) throw new Error('Backspace did not remove the whole token: ' + afterBackspace.value)
  if (afterBackspace.caret !== afterBackspace.value.indexOf('(') + 1) throw new Error('caret is not at the removed token start')
  if (afterBackspace.badges !== 0) throw new Error('badge still rendered after token removal')

  // Cleanup.
  const cleanup = await p.evaluate(async ([mark, refId]) => {
    const s = await window.piwright.getSettings()
    const project = s.projects[0]
    const boards = await window.piwright.kanbanBoards(project)
    const board = boards.boards[0]
    const full = await window.piwright.kanbanBoardGet(project, board.id)
    const ids = (full.board?.cards ?? []).filter((c) => c.title.includes(mark)).map((c) => c.id)
    if (refId !== undefined && !ids.includes(refId)) ids.push(refId)
    for (const id of ids) await window.piwright.kanbanCardDelete(project, board.id, id)
    return ids.length
  }, [MARK, setup.refId])
  console.log('cleanup deleted:', cleanup)

  await b.close()
  const ok = check.found && check.fieldPresent && check.backdropPresent && check.badgePresent && check.badgeInsideField && check.badgeOnFirstLine && afterBackspace.badges === 0
  console.log(ok ? 'SMOKE PASS' : 'SMOKE FAIL')
  if (!ok) process.exit(1)
})().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
