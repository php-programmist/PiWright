/* Smoke: превью вложений в отправленных сообщениях пользователя.
 * Фейковый pi (fake-pi-ok.cmd), временный проект. putAttachment кладёт png,
 * промпт с ref → в пузыре пользователя рендерится миниатюра, клик — Lightbox. */
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

  const boot = await page.evaluate(async (dir) => {
    return await window.piwright.newSession({ kind: 'native', dir })
  }, PROJECT_DIR)
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

  const att = await page.evaluate(async ({ dir, base64 }) => {
    return await window.piwright.putAttachment({ kind: 'native', dir }, 'smoke-shot.png', base64)
  }, { dir: PROJECT_DIR, base64: PNG_1PX }).catch((err) => {
    throw new Error('putAttachment failed: ' + err.message)
  })
  log('putAttachment:', JSON.stringify({ ok: att.ok, name: att.name, ref: att.ref, isImage: att.isImage }))
  if (!att.ok || !att.isImage || att.ref !== '@.pi/attachments/smoke-shot.png') {
    throw new Error('unexpected attachment result: ' + JSON.stringify(att))
  }

  const input = page.locator('.composer textarea:not(.loop-exit)').first()
  await input.fill(`check preview ${att.ref}`)
  await page.locator('.send-wrap button').first().click()

  await page.waitForSelector('.transcript .user-message .user-attachment', { timeout: 30000 })
  await page.waitForFunction(
    () => {
      const img = document.querySelector('.transcript .user-message img.user-attachment')
      return img !== null && (img.getAttribute('src') ?? '').startsWith('data:image/') && img.naturalWidth > 0
    },
    null,
    { timeout: 20000 }
  )
  log('thumbnail rendered in user message')

  await page.click('.transcript .user-message img.user-attachment')
  await page.waitForSelector('.lightbox-overlay', { timeout: 10000 })
  log('lightbox opened')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelector('.lightbox-overlay') === null, null, { timeout: 5000 })
  log('lightbox closed')

  await page.screenshot({ path: 'tests/manual/out-attachment-preview.png' })
  log('SMOKE OK')
  process.exit(0)
}

main().catch((err) => {
  console.error('SMOKE FAIL:', err)
  process.exit(1)
})
