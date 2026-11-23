/* Smoke: ctx breakdown popover must stay inside viewport when the sessions
 * panel is collapsed (header shifts to the left screen edge).
 * Run AFTER smoke-ctx-breakdown.cjs against the same instance. */
const { chromium } = require('playwright-core')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'

async function main() {
  const browser = await chromium.connectOverCDP(CDP)
  const page = browser.contexts()[0].pages()[0]
  await page.waitForSelector('.ctx-usage', { timeout: 30000 })

  const collapseBtn = await page.$('button[title="Collapse panel"], button[title="Свернуть панель"]')
  if (collapseBtn === null) {
    console.log('SMOKE-FAIL: collapse button not found')
    process.exit(1)
  }
  await collapseBtn.click()
  await page.waitForSelector('.sessions-panel.collapsed', { timeout: 5000 })
  console.log('panel collapsed')

  await page.click('.ctx-usage')
  await page.waitForSelector('.ctx-popover', { timeout: 10000 })
  const r = await page.$eval('.ctx-popover', (el) => {
    const b = el.getBoundingClientRect()
    return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, vw: window.innerWidth, vh: window.innerHeight }
  })
  console.log('popover rect:', JSON.stringify(r))
  const fits = r.left >= 0 && r.right <= r.vw && r.bottom <= r.vh
  if (!fits) {
    console.log('SMOKE-FAIL: popover overflows viewport with collapsed panel')
    process.exit(1)
  }

  await page.screenshot({ path: 'tests/manual/out-ctx-breakdown-collapsed.png' })
  console.log('SMOKE-OK')
}

main().catch((err) => {
  console.log('SMOKE-FAIL:', err.message)
  process.exit(1)
})
