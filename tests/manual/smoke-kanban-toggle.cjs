const { chromium } = require('playwright-core')

;(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9222')
  const p = b.contexts()[0].pages()[0]
  await p.waitForTimeout(1000)
  // закрыть панель канбана, если открыта
  const kbBtn = p.locator('.right-bar button[title="Канбан"], .right-bar button[title="Kanban"]')
  if (await kbBtn.count()) {
    const cls = await kbBtn.getAttribute('class')
    if (cls?.includes('active')) await kbBtn.click()
  }
  if ((await p.locator('.settings-modal-overlay').count()) === 0) {
    await p.locator('button[title*="Настройки"], button[title*="Settings"]').first().click()
    await p.waitForTimeout(800)
  }
  await p.locator('.settings-nav button', { hasText: /Расширенн|Advanced/ }).click()
  await p.waitForTimeout(500)
  const cb = p.locator('label:has-text("канбан-доски"), label:has-text("kanban boards")').locator('input[type=checkbox]')
  await cb.first().setChecked(false)
  await p.waitForTimeout(2500)
  await p.keyboard.press('Escape')
  await p.waitForTimeout(800)
  console.log('final right-bar:', JSON.stringify(await p.locator('.right-bar button').evaluateAll((els) => els.map((e) => e.title))))
  console.log('final tabs:', JSON.stringify(await p.locator('.tab-bar .tab .tab-name').evaluateAll((els) => els.map((e) => e.textContent))))
  await b.close()
})().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
