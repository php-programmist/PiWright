/* Smoke: клик по миниатюре ещё не отправленного вложения над полем промпта
 * открывает Lightbox. Вставка png через paste-событие на textarea. */
const { chromium } = require('playwright-core')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'
const PROJECT_DIR = process.env.SMOKE_PROJECT_DIR

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function main() {
  const browser = await chromium.connectOverCDP(CDP)
  const page = await browser.contexts()[0].pages()[0]
  const log = (...a) => console.log(...a)

  await page.waitForSelector('.right-bar', { timeout: 30000 })

  const boot = await page.evaluate(async () => {
    const s = await window.piwright.getSettings()
    const project = (s.projects ?? []).find((p) => p.dir === 'D:\\Projects\\piwright')
    if (project === undefined) throw new Error('piwright project missing in settings')
    return await window.piwright.newSession(project)
  })
  log('session created:', boot.hostId)

  for (let i = 0; i < 5; i++) {
    try {
      await page.locator('.project .expand').first().click({ timeout: 2000 })
      await page.waitForSelector('.session-row', { timeout: 3000 })
      break
    } catch {
      if (i === 4) throw new Error('session row did not appear after expand clicks')
    }
  }
  await page.locator('.session-row').first().click()
  await page.waitForSelector('.composer textarea', { timeout: 90000 })
  await page.waitForTimeout(1500)

  const input = page.locator('.composer textarea:not(.loop-exit)').first()
  await input.evaluate((el, base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    const file = new File([bytes], 'pasted.png', { type: 'image/png' })
    const dt = new DataTransfer()
    dt.items.add(file)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, PNG_1PX)

  await page.waitForSelector('.composer .pending-image img', { timeout: 20000 })
  log('pending thumbnail rendered')

  await page.locator('.composer .pending-image img').click()
  await page.waitForSelector('.lightbox-overlay', { timeout: 5000 })
  log('lightbox opened from pending thumbnail')

  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelector('.lightbox-overlay') === null, null, { timeout: 5000 })
  log('lightbox closed')

  log('SMOKE OK')
}

main().catch((err) => {
  console.error('SMOKE FAIL:', err.message)
  process.exit(1)
})
