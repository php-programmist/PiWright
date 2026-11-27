const { chromium } = require('playwright-core')

const PORT = process.env.SMOKE_CDP ? new URL(process.env.SMOKE_CDP).port : '9223'

const PANELS = [
  { name: 'git', toggleTitle: /Git/i, headSel: '.git-panel .git-head', asideSel: '.git-panel' },
  { name: 'files', toggleTitle: /Файлы|Files/i, headSel: '.files-panel .files-head', asideSel: '.files-panel' },
  { name: 'kanban', toggleTitle: /Канбан|Kanban/i, headSel: '.kanban-panel .git-head', asideSel: '.kanban-panel' },
  { name: 'db', toggleTitle: /Базы данных|Databases/i, headSel: '.db-panel .git-head', asideSel: '.db-panel' }
]

;(async () => {
  const b = await chromium.connectOverCDP(`http://localhost:${PORT}`)
  const p = b.contexts()[0].pages()[0]
  await p.waitForTimeout(1500)

  let failed = false
  for (const panel of PANELS) {
    const toggle = p.locator(`.right-bar button[title]`).filter({ hasText: '' })
    const btn = p.locator(`.right-bar button[title=${JSON.stringify(panel.name)}]`)
    const t = p.locator(`.right-bar button[title]`).evaluateAll(
      (els) => els.map((e) => e.getAttribute('title'))
    )
    void toggle
    void t
    // найти кнопку тулбара по title (ru/en)
    const titles = await p.locator('.right-bar button').evaluateAll((els) =>
      els.map((e) => ({ title: e.getAttribute('title') || '', cls: e.className }))
    )
    const tb = titles.find((x) => panel.toggleTitle.test(x.title))
    if (!tb) {
      console.log(`${panel.name}: SKIP (toolbar button not found)`)
      continue
    }
    const tbSel = `.right-bar button[title=${JSON.stringify(tb.title)}]`
    if (!tb.cls.includes('active')) {
      await p.locator(tbSel).click()
      await p.waitForTimeout(700)
    }
    const head = p.locator(panel.headSel)
    if ((await head.count()) === 0) {
      console.log(`${panel.name}: SKIP (panel open but no head — placeholder state)`)
      continue
    }
    const closeBtn = head.locator('button[title="Свернуть панель"], button[title="Collapse panel"]')
    const cnt = await closeBtn.count()
    if (cnt !== 1) {
      console.log(`${panel.name}: FAIL — close button count=${cnt}`)
      failed = true
      continue
    }
    // кнопка — крайняя правая в заголовке
    const lastBtn = await head.locator('button').last().getAttribute('title')
    await closeBtn.click()
    await p.waitForTimeout(700)
    const gone = (await p.locator(panel.asideSel).count()) === 0
    const toggleInactive = !(await p.locator(tbSel).getAttribute('class'))?.includes('active')
    if (gone && toggleInactive) {
      console.log(`${panel.name}: OK (closed via header "−", last button="${lastBtn}")`)
    } else {
      console.log(`${panel.name}: FAIL — gone=${gone} toggleInactive=${toggleInactive}`)
      failed = true
    }
  }
  await b.close()
  process.exit(failed ? 1 : 0)
})().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
