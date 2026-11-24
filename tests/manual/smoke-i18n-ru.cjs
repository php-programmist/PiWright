const { chromium } = require('playwright-core')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'

async function main() {
  const browser = await chromium.connectOverCDP(CDP)
  const page = browser.contexts()[0].pages()[0]

  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)

  const plusBtn = page.locator('.sessions-panel button[title="Новая сессия"]').first()
  await plusBtn.click()
  await page.waitForSelector('.session-row.current', { timeout: 90000 })
  await page.waitForTimeout(5000)

  const thinkingBtn = page.locator('.thinking-button').first()
  await thinkingBtn.waitFor({ state: 'visible', timeout: 20000 })
  const label = (await thinkingBtn.textContent()).trim()
  await thinkingBtn.click()
  await page.waitForTimeout(400)
  const ticks = await page.evaluate(() =>
    [...document.querySelectorAll('.thinking-ticks span')].map((el) => el.textContent.trim())
  )
  console.log(JSON.stringify({ label, ticks }, null, 2))
  await browser.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
