/* Shot: files panel context menu with "Show in folder" item — screenshot for the kanban card. */
const { chromium } = require('playwright-core')

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9223')
  const page = browser.contexts()[0].pages()[0]
  await page.waitForSelector('.files-body .tree-row', { timeout: 20000 })
  const row = await page.$('.files-body .tree-row.file')
  await row.click({ button: 'right' })
  await page.waitForSelector('.files-menu', { timeout: 5000 })
  await page.screenshot({ path: 'tests/manual/out-files-reveal-menu.png' })
  console.log('SHOT-OK')
  process.exit(0)
}

main().catch((err) => { console.log('SHOT-FAIL:', err.message); process.exit(1) })
