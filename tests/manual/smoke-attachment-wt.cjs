/* Smoke: worktree-сессия — вложение в общей папке корня репо + превью в чате.
 * Worktree и settings с обоими проектами готовит launch-скрипт; здесь: новая сессия
 * на каталоге worktree, putAttachment → ref @../../…, промпт → миниатюра из корня,
 * клик → Lightbox. */
const { chromium } = require('playwright-core')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'
const WT_DIR = process.env.WT_DIR
const BIG_PNG = process.env.BIG_PNG

async function main() {
  const browser = await chromium.connectOverCDP(CDP)
  const page = await browser.contexts()[0].pages()[0]
  const log = (...a) => console.log(...a)

  await page.waitForSelector('.right-bar', { timeout: 30000 })

  const boot = await page.evaluate(async (dir) => await window.piwright.newSession({ kind: 'native', dir }), WT_DIR)
  log('wt session created:', boot.hostId)

  for (let i = 0; i < 5; i++) {
    const expand = page.locator('button[title="Развернуть панель"], button[title="Expand panel"]')
    if ((await expand.count()) > 0) {
      await expand.click()
      await page.waitForTimeout(500)
    }
    const groups = await page.evaluate(() => [...document.querySelectorAll('.project')].map((g) => g.querySelector('.project-name')?.textContent ?? ''))
    if (groups.some((n) => n.includes('piwright-att-wtrepo'))) break
  }
  const wtGroup = page.locator('.project', { hasText: 'piwright-att-wtrepo' }).first()
  if ((await wtGroup.locator('.session-row').count()) === 0) {
    await wtGroup.locator('.expand').click()
    await page.waitForTimeout(600)
  }
  await wtGroup.locator('.session-row').first().click()
  await page.waitForSelector('.composer textarea', { timeout: 90000 })
  await page.waitForTimeout(1500)
  log('composer ready in wt session')

  const att = await page.evaluate(async ({ dir, base64, name }) => await window.piwright.putAttachment({ kind: 'native', dir }, name, base64), { dir: WT_DIR, base64: BIG_PNG, name: `wt-shot-${Date.now()}.png` })
  log('putAttachment:', JSON.stringify({ ok: att.ok, name: att.name, ref: att.ref }))
  if (!att.ok || !/^@..\/..\/.pi\/attachments\/wt-shot-\d+\.png$/.test(att.ref)) throw new Error('unexpected ref: ' + att.ref)

  const input = page.locator('.composer textarea:not(.loop-exit)').first()
  await input.fill(`root preview ${att.ref}`)
  await page.locator('.send-wrap button').first().click()

  await page.waitForFunction(
    () => {
      const bubble = [...document.querySelectorAll('.transcript .user-message')].find((el) => el.textContent.includes('root preview'))
      return bubble !== undefined && bubble.querySelector('img.user-attachment') !== null
    },
    null,
    { timeout: 30000 }
  )
  await page.waitForFunction(() => {
    const imgs = [...document.querySelectorAll('.transcript .user-message img.user-attachment')]
    return imgs.some((el) => el.naturalWidth > 1)
  }, null, { timeout: 20000 })
  log('thumbnail rendered from repo root in wt session')

  await page.click('.transcript .user-message img.user-attachment')
  await page.waitForSelector('.lightbox-overlay', { timeout: 10000 })
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelector('.lightbox-overlay') === null, null, { timeout: 5000 })
  log('lightbox ok')

  await page.screenshot({ path: 'tests/manual/out-attachment-wt.png' })
  log('SMOKE OK')
  process.exit(0)
}

main().catch((err) => {
  console.error('SMOKE FAIL:', err)
  process.exit(1)
})
