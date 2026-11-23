const { chromium } = require('playwright-core')
const CDP = process.env.SMOKE_CDP || 'http://localhost:9225'
;(async () => {
  const b = await chromium.connectOverCDP(CDP)
  const pages = b.contexts()[0].pages()
  const p = pages.find((c) => c.url().includes('index.html')) ?? pages[0]
  const s = await p.evaluate(async () => {
    const st = await window.piwright.getSettings()
    const list = await window.piwright.kanbanThemeList()
    return {
      kanbanEnabled: st.kanbanEnabled,
      kanbanTheme: st.kanbanTheme,
      modal: !!document.querySelector('.settings-modal'),
      nav: [...document.querySelectorAll('.settings-nav button')].map((el) => el.textContent),
      themeRows: [...document.querySelectorAll('.kanban-theme')].map((el) => el.textContent),
      listOk: list.ok,
      listThemes: list.themes.map((t) => t.id)
    }
  })
  console.log(JSON.stringify(s, null, 2))
  await b.close()
})().catch((e) => { console.error(e.message); process.exit(1) })
