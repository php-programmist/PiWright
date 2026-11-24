const { chromium } = require('playwright-core')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'

async function main() {
  const browser = await chromium.connectOverCDP(CDP)
  const page = browser.contexts()[0].pages()[0]

  await page.evaluate(async () => {
    const s = await window.piwright.getSettings()
    await window.piwright.setSettings({ ...s, language: 'en', kanbanEnabled: true })
  })
  await page.reload()
  await page.waitForTimeout(1500)

  const results = {}

  // 1) Kanban themes hint in EN settings → Appearance
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button, [role="tab"], .settings-nav *')]
      .filter((el) => el.textContent.trim() === 'Appearance')
    btns[0]?.click()
  })
  await page.waitForTimeout(800)
  results.appearanceTabText = await page.evaluate(() => {
    const hints = [...document.querySelectorAll('.panel-hint')].map((el) => el.textContent.trim())
    return hints.find((h) => h.includes('theme sets column accents')) ?? null
  })

  // 2) Thinking level labels in EN: create a session and read the control
  const plusBtn = page.locator('.sessions-panel button[title="New session"]').first()
  await plusBtn.click()
  await page.waitForSelector('.session-row.current', { timeout: 90000 })
  await page.waitForTimeout(5000)

  const thinkingBtn = page.locator('.thinking-button').first()
  try {
    await thinkingBtn.waitFor({ state: 'visible', timeout: 20000 })
    results.thinkingButtonLabel = (await thinkingBtn.textContent()).trim()
    await thinkingBtn.click()
    await page.waitForTimeout(400)
    results.thinkingTicks = await page.evaluate(() =>
      [...document.querySelectorAll('.thinking-ticks span')].map((el) => el.textContent.trim())
    )
  } catch {
    results.thinkingButtonLabel = null
  }

  console.log(JSON.stringify(results, null, 2))
  await browser.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
