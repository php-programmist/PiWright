const { chromium } = require('playwright-core')
const path = require('node:path')

;(async () => {
  const b = await chromium.connectOverCDP(process.env.SMOKE_CDP || 'http://localhost:9223')
  const p = b.contexts()[0].pages()[0]
  await p.evaluate(async () => {
    const cur = await window.piwright.getSettings()
    await window.piwright.setSettings({ ...cur, kanbanEnabled: true, kanbanTheme: 'ocean', language: 'ru' })
  })
  await p.reload()
  await p.waitForTimeout(3000)
  await p.locator('button[title*="Настройки"], button[title*="Settings"]').first().click()
  await p.waitForTimeout(800)
  await p.locator('.settings-nav button', { hasText: /Внешни|Appearance/ }).click()
  await p.waitForTimeout(800)
  await p.locator('.settings-modal').screenshot({ path: path.join(process.env.TEMP, 'kanban-theme-settings.png') })
  await b.close()
  console.log('shot ok')
})().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
