/** Смоук тем канбана: секция во «Внешнем виде», 4 дефолтные темы, CSS-переменные выбранной темы,
 *  скрытие секции при выключенном канбане, отсутствие обрезков текста. */
const { chromium } = require('playwright-core')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'

async function setKanban(page, enabled, theme) {
  await page.evaluate(
    async ([on, id]) => {
      const current = await window.piwright.getSettings()
      await window.piwright.setSettings({ ...current, kanbanEnabled: on, kanbanTheme: id })
    },
    [enabled, theme]
  )
  await page.reload()
  await page.waitForTimeout(2500)
}

async function page_setProject(page, dir) {
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

  await setKanban(p, true, 'slate')

  await p.locator('button[title*="Настройки"], button[title*="Settings"]').first().click()
  await p.waitForTimeout(800)
  await p.locator('.settings-nav button', { hasText: /Внешни|Appearance/ }).click()
  await p.waitForTimeout(600)

  const rows = p.locator('.kanban-theme')
  const count = await rows.count()
  console.log('theme rows:', count)
  if (count !== 4) throw new Error(`expected 4 default themes, got ${count}`)
  console.log('theme names:', JSON.stringify(await rows.locator('.kanban-theme-name').evaluateAll((e) => e.map((x) => x.textContent))))

  const overflow = await rows.evaluateAll((els) =>
    els.filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1).map((el) => el.textContent)
  )
  console.log('clipped rows:', JSON.stringify(overflow))

  const tint = () => p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--kb-column-tint').trim())
  console.log('slate tint:', await tint())

  await rows.nth(1).locator('input[type=radio]').click({ force: true })
  await p.waitForTimeout(2000)
  const ocean = await tint()
  console.log('ocean tint:', ocean)
  if (!ocean.includes('59, 157, 214')) throw new Error(`ocean tint not applied: ${ocean}`)

  const current = await p.locator('.kanban-theme.current .kanban-theme-name').textContent()
  console.log('current row:', current)
  if (current?.trim() !== 'Ocean') throw new Error(`current row is ${current}`)

  await p.keyboard.press('Escape')
  await p.waitForTimeout(600)

  const accent = await p.evaluate(() => {
    const col = document.querySelector('.board-column')
    return col === null ? null : getComputedStyle(col).getPropertyValue('--kb-accent').trim()
  })
  console.log('board column accent (no board):', accent)

  // Доска в временном репозитории: акцент колонки из палитры темы.
  const repo = process.env.SMOKE_REPO
  if (repo) {
    await page_setProject(p, repo)
    await p.evaluate(async (pr) => {
      const boards = await window.piwright.kanbanBoards(pr)
      if (boards.boards.length === 0) await window.piwright.kanbanBoardCreate(pr, 'Smoke theme')
    }, { kind: 'native', dir: repo })
    if ((await p.locator('.kanban-panel').count()) === 0) {
      await p.locator('.right-bar button[title="Kanban"], .right-bar button[title="Канбан"]').first().click()
      await p.waitForTimeout(1500)
    }
    await p.locator('.kanban-board-row .kanban-board-name').first().evaluate((el) => el.click())
    await p.waitForTimeout(2500)
    const accents = await p.locator('.board-column').evaluateAll((els) =>
      els.map((el) => getComputedStyle(el).getPropertyValue('--kb-accent').trim())
    )
    console.log('column accents:', JSON.stringify(accents))
    if (accents.length < 2 || accents[0] !== '#3b9dd6' || accents[1] !== '#2fb3c9') {
      throw new Error(`unexpected column accents: ${JSON.stringify(accents)}`)
    }
    const cardBg = await p.evaluate(async (pr) => {
      const boards = await window.piwright.kanbanBoards(pr)
      const board = await window.piwright.kanbanBoardGet(pr, boards.boards[0].id)
      if (board.board !== null && board.board.cards.length === 0) {
        const columnId = board.board.columns[0].id
        await window.piwright.kanbanCardCreate(pr, board.board.id, { title: 'Theme card', columnId })
      }
      return ''
    }, { kind: 'native', dir: repo })
    void cardBg
    await p.locator('.board-head-refresh').first().evaluate((el) => el.click())
    await p.waitForTimeout(1500)
    const card = p.locator('.board-card').first()
    if ((await card.count()) === 0) throw new Error('no card created')
    const cardStyle = await card.evaluate((el) => {
      const cs = getComputedStyle(el)
      return `${cs.backgroundColor} / ${cs.borderTopColor}`
    })
    console.log('card background/border:', cardStyle)
    if (!cardStyle.includes('59, 157, 214')) throw new Error(`card not themed: ${cardStyle}`)
  }

  await setKanban(p, false, 'ocean')
  await p.locator('button[title*="Настройки"], button[title*="Settings"]').first().click()
  await p.waitForTimeout(800)
  await p.locator('.settings-nav button', { hasText: /Внешни|Appearance/ }).click()
  await p.waitForTimeout(600)
  console.log('rows when kanban off:', await p.locator('.kanban-theme').count())
  const offTint = await tint()
  console.log('tint when kanban off:', JSON.stringify(offTint))
  if (offTint.length > 0) throw new Error(`theme vars left applied: ${offTint}`)

  await p.keyboard.press('Escape')
  await b.close()
  console.log('OK')
})().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
