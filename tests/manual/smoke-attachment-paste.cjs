/* Smoke: вставка вложений через Ctrl+V в чат. Синтетический ClipboardEvent('paste')
 * с DataTransfer: не-картинка (text/plain файл) → ref в инпуте; картинка → чип
 * превью; обычный текст без файлов → вставляется как текст. */
const { chromium } = require('playwright-core')
const path = require('node:path')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'
const PROJECT_DIR = process.env.SMOKE_PROJECT_DIR
if (!PROJECT_DIR) throw new Error('SMOKE_PROJECT_DIR is required (пустой temp-каталог, первый проект в settings.json смоук-инстанса)')

let failed = false
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
  if (!ok) failed = true
}

const TXT_1PX = 'hello attachment'

async function main() {
  console.log('project:', PROJECT_DIR)

  const browser = await chromium.connectOverCDP(CDP)
  const page = await browser.contexts()[0].pages()[0]
  await page.waitForSelector('.right-bar', { timeout: 30000 })

  const boot = await page.evaluate(async (dir) => await window.piwright.newSession({ kind: 'native', dir }), PROJECT_DIR)
  console.log('session created:', boot.hostId)

  const projectName = path.basename(PROJECT_DIR)
  for (let i = 0; i < 5; i++) {
    try {
      await page.locator('.project', { hasText: projectName }).locator('.expand').first().click({ timeout: 2000 })
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
  await input.fill('')

  // 1. Не-картинка через paste → ref в инпуте
  await page.evaluate(() => {
    const ta = document.querySelector('.composer textarea')
    const dt = new DataTransfer()
    dt.items.add(new File(['hello attachment'], 'notes.txt', { type: 'text/plain' }))
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })
  await page.waitForFunction(
    () => document.querySelector('.composer textarea')?.value.includes('@.pi/attachments/notes.txt'),
    null,
    { timeout: 15000 }
  )
  check('non-image paste inserts ref', true)

  // 2. Картинка через paste → чип превью
  await page.evaluate(() => {
    const ta = document.querySelector('.composer textarea')
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' }))
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })
  await page.waitForSelector('.composer .pending-image', { timeout: 15000 })
  const chipOk = await page.evaluate(() => {
    const chip = document.querySelector('.composer .pending-image')
    if (chip === null) return false
    const img = chip.querySelector('img')
    const name = chip.querySelector('.pending-image-name')?.textContent
    return (img !== null && (img.getAttribute('src') ?? '').startsWith('data:image/')) || name === 'shot.png'
  })
  check('image paste shows preview chip', chipOk)

  // 3. Обычный текст без файлов → вставляется как текст (untrusted paste не делает
  // default-вставку, поэтому реальный Ctrl+V через trusted keyboard-события)
  await input.click()
  await page.evaluate(async () => {
    await navigator.clipboard.writeText('plain text here')
  })
  await page.keyboard.press('Control+v')
  await page.waitForFunction(
    () => document.querySelector('.composer textarea')?.value.includes('plain text here'),
    null,
    { timeout: 10000 }
  )
  check('plain text paste still works', true)

  await page.screenshot({ path: 'tests/manual/out-attachment-paste.png' })
  if (failed) {
    console.error('SMOKE FAIL')
    process.exit(1)
  }
  console.log('SMOKE OK')
  process.exit(0)
}

main().catch((err) => {
  console.error('SMOKE FAIL:', err)
  process.exit(1)
})
