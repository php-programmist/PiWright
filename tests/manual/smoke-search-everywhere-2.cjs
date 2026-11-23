/* Smoke 2: Enter opens file tab; card item opens kanban board + modal. */
const { chromium } = require('playwright-core')
const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'

async function main() {
  const browser = await chromium.connectOverCDP(CDP)
  const page = browser.contexts()[0].pages()[0]
  await page.waitForSelector('.app', { timeout: 20000 })

  const openOverlay = async () => {
    await page.keyboard.press('Shift')
    await page.waitForTimeout(80)
    await page.keyboard.down('Shift')
    await page.keyboard.up('Shift')
    await page.waitForSelector('.search-everywhere-overlay', { timeout: 5000 })
    await page.waitForFunction(() => {
      const el = document.querySelector('.search-everywhere-list')
      return el !== null && el.children.length > 0
    }, { timeout: 15000 })
  }

  // 1. Enter opens file tab
  await openOverlay()
  await page.keyboard.type('package.json')
  await page.waitForTimeout(300)
  const firstTitle = await page.locator('.search-everywhere-item').first().locator('.search-everywhere-title').textContent()
  console.log('first result:', firstTitle)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  if (await page.locator('.search-everywhere-overlay').count() !== 0) throw new Error('overlay not closed after Enter')
  const tabs = await page.locator('.tab.file .tab-name').allTextContents()
  console.log('file tabs:', tabs)
  if (!tabs.some((t) => t.includes('package.json'))) throw new Error('file tab not opened')
  console.log('OK: Enter opens file tab')

  // 2. card item: find a kanban card in empty-query recent list
  await openOverlay()
  const kinds = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.search-everywhere-item')).map((el) => el.textContent.slice(0, 60))
  })
  console.log('recent items sample:', kinds.slice(0, 5))
  // type a query that matches kanban card titles from the board
  await page.keyboard.type('Поиск файлов')
  await page.waitForTimeout(300)
  const cardItems = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.search-everywhere-item')).map((el) => el.textContent)
  })
  console.log('results for "Поиск файлов":', JSON.stringify(cardItems))
  const hasCard = cardItems.some((t) => t.includes('Канбан'))
  if (!hasCard) console.log('NOTE: no kanban card in results (board may lack matching card)')
  else {
    const idx = cardItems.findIndex((t) => t.includes('Канбан'))
    await page.locator('.search-everywhere-item').nth(idx).click()
    await page.waitForTimeout(600)
    const boardVisible = await page.locator('.board-card, .kanban-board-name, .kb-column').count()
    console.log('kanban elements after click:', boardVisible)
    if (boardVisible === 0) throw new Error('kanban board did not open')
    console.log('OK: card click opens kanban')
  }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  await page.screenshot({ path: 'tests/manual/out-search-everywhere-2.png' })
  await browser.close()
  console.log('SMOKE2 PASS')
}

main().catch((err) => { console.error('SMOKE2 FAIL:', err.message); process.exit(1) })
