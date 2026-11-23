/* Smoke: double-Shift opens SearchEverywhere, files/sessions/kanban in one list, icons, ≤20 items. */
const { chromium } = require('playwright-core')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'

async function main() {
  const browser = await chromium.connectOverCDP(CDP)
  const contexts = browser.contexts()
  if (contexts.length === 0) throw new Error('no contexts')
  let page = null
  for (const ctx of contexts) {
    for (const p of ctx.pages()) {
      if ((await p.title()) !== '' || (await p.url()).startsWith('file')) { page = p; break }
    }
    if (page) break
  }
  if (!page) throw new Error('main page not found')
  await page.waitForSelector('.app', { timeout: 20000 })
  console.log('page ok:', await page.url())

  const overlay = () => page.locator('.search-everywhere-overlay')
  const box = () => page.locator('.search-everywhere-box')

  // 1. double-Shift opens
  await page.keyboard.press('Shift')
  await page.waitForTimeout(80)
  await page.keyboard.down('Shift')
  await page.keyboard.up('Shift')
  await page.waitForSelector('.search-everywhere-overlay', { timeout: 5000 })
  console.log('OK: double-Shift opens overlay')

  // 2. Escape closes
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  if (await overlay().count() !== 0) throw new Error('Escape did not close overlay')
  console.log('OK: Escape closes')

  // 3. reopen, wait for data, list renders with items
  await page.keyboard.press('Shift')
  await page.waitForTimeout(80)
  await page.keyboard.down('Shift')
  await page.keyboard.up('Shift')
  await page.waitForSelector('.search-everywhere-overlay', { timeout: 5000 })
  await page.waitForFunction(() => {
    const el = document.querySelector('.search-everywhere-list')
    return el !== null && el.children.length > 0
  }, { timeout: 15000 })
  const count = await page.locator('.search-everywhere-item').count()
  console.log('OK: list renders, items =', count)
  if (count > 20) throw new Error('more than 20 items: ' + count)

  // icons present
  const icons = await page.locator('.search-everywhere-item .search-everywhere-icon svg').count()
  if (icons !== count) throw new Error(`icons ${icons} != items ${count}`)
  console.log('OK: every item has an icon')

  // 4. fuzzy filter: type query, results shrink, highlight present
  await page.keyboard.type('file-service')
  await page.waitForTimeout(300)
  const filtered = await page.locator('.search-everywhere-item').count()
  console.log('filtered items for "file-service":', filtered)
  const hl = await page.locator('.search-everywhere-title b').count()
  console.log('highlight chars:', hl)
  if (hl === 0) throw new Error('no highlight')

  // 5. screenshot for layout check
  await page.screenshot({ path: 'tests/manual/out-search-everywhere.png' })
  console.log('screenshot saved')

  // 6. keyboard nav: ArrowDown/Up/Enter does not throw; Escape closes
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  if (await overlay().count() !== 0) throw new Error('Escape did not close after nav')
  console.log('OK: keyboard nav + close')

  await browser.close()
  console.log('SMOKE PASS')
}

main().catch((err) => { console.error('SMOKE FAIL:', err.message); process.exit(1) })
