/* Smoke: images in markdown live preview render as data URLs.
 * Attach over CDP, create a session for the piwright project, open README.md
 * from the files tree, verify md images load (data:image src, none dead/pending),
 * then click one and verify the lightbox opens. */
const { chromium } = require('playwright-core')

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9223')
  const context = browser.contexts()[0]
  const page = context.pages()[0]
  await page.waitForSelector('.projects-panel, .session-row, .history-item', { timeout: 30000 })

  const newBtn = await page.$('button[title="New session"], button[title="Новая сессия"]')
  if (newBtn === null) {
    console.log('SMOKE-FAIL: new session button not found')
    process.exit(1)
  }
  await newBtn.click()
  await page.waitForSelector('.composer textarea', { timeout: 90000 })
  console.log('new session created')

  const filesBtn = await page.$('button[title="Files"], button[title="Файлы"]')
  if (filesBtn === null) {
    console.log('SMOKE-FAIL: files panel toggle not found')
    process.exit(1)
  }
  await filesBtn.click()
  console.log('files panel toggled')

  const readmeRow = await page.waitForSelector('.tree-row.file:has-text("README.md")', { timeout: 30000 })
  await readmeRow.click()
  console.log('README.md clicked')

  await page.waitForSelector('.md-live', { timeout: 20000 })
  await page.waitForFunction(
    () => document.querySelectorAll('.md-live .md-image').length > 0,
    null,
    { timeout: 30000 }
  )
  await page.waitForFunction(
    () => document.querySelectorAll('.md-live .md-image.pending, .md-live .md-image.dead').length === 0,
    null,
    { timeout: 30000 }
  )
  const stats = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('.md-live img.md-image')]
    return {
      total: imgs.length,
      dataUrls: imgs.filter((el) => (el.getAttribute('src') ?? '').startsWith('data:image/')).length,
      natural: imgs.filter((el) => el.naturalWidth > 0).length
    }
  })
  console.log('md images:', JSON.stringify(stats))
  if (stats.total === 0 || stats.dataUrls !== stats.total || stats.natural !== stats.total) {
    console.log('SMOKE-FAIL: md images not fully rendered')
    await page.screenshot({ path: '.tmp-md-images-fail.png' })
    process.exit(1)
  }

  await page.click('.md-live img.md-image')
  await page.waitForSelector('.lightbox-overlay', { timeout: 10000 })
  const lightboxSrc = await page.$eval('.lightbox-image', (el) => (el.getAttribute('src') ?? '').slice(0, 30))
  console.log('lightbox opened, src:', lightboxSrc + '…')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelector('.lightbox-overlay') === null, null, { timeout: 5000 })

  await page.screenshot({ path: '.tmp-md-images-ok.png' })
  console.log('SMOKE-OK')
  process.exit(0)
}

main().catch((err) => {
  console.log('SMOKE-FAIL:', err.message)
  process.exit(1)
})
