/* Smoke: вложения с кириллицей и пробелами в имени. Временный проект, putAttachment
 * с 'Расписание занятий.png' → имя сохраняет кириллицу (пробел → '_'), ref парсится,
 * миниатюра рендерится в пузыре пользователя; kanbanAttachmentPut/Get — то же для доски. */
const { chromium } = require('playwright-core')
const fs = require('node:fs')
const path = require('node:path')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'
const PROJECT_DIR = process.env.SMOKE_PROJECT_DIR
if (!PROJECT_DIR) throw new Error('SMOKE_PROJECT_DIR is required (пустой temp-каталог, первый проект в settings.json смоук-инстанса)')

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

let failed = false
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
  if (!ok) failed = true
}

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

  const att = await page.evaluate(async ({ dir, base64, name }) => {
    return await window.piwright.putAttachment({ kind: 'native', dir }, name, base64)
  }, { dir: PROJECT_DIR, base64: PNG_1PX, name: 'Расписание занятий.png' })
  console.log('putAttachment:', JSON.stringify(att))
  check('putAttachment ok', att.ok === true)
  check('cyrillic name preserved', att.name === 'Расписание_занятий.png', att.name)
  check('ref with cyrillic', att.ref === '@.pi/attachments/Расписание_занятий.png', att.ref)
  check('isImage', att.isImage === true)

  const stored = path.join(PROJECT_DIR, '.pi', 'attachments', att.name)
  check('file on disk', fs.existsSync(stored))

  const input = page.locator('.composer textarea:not(.loop-exit)').first()
  await input.fill(`проверка кириллицы ${att.ref}`)
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
  check('thumbnail rendered from cyrillic ref', true)

  const kb = await page.evaluate(async ({ dir, base64, name }) => {
    const put = await window.piwright.kanbanAttachmentPut({ kind: 'native', dir }, name, base64)
    if (!put.ok) return { put }
    const get = await window.piwright.kanbanAttachmentGet({ kind: 'native', dir }, put.path)
    return { put, get }
  }, { dir: PROJECT_DIR, base64: PNG_1PX, name: 'Расписание занятий.png' })
  console.log('kanban:', JSON.stringify(kb))
  check('kanban put cyrillic', kb.put?.ok === true && kb.put.name === 'Расписание_занятий.png', kb.put?.name)
  check('kanban get cyrillic', kb.get?.ok === true && (kb.get.dataUrl ?? '').startsWith('data:image/png'))

  await page.screenshot({ path: 'tests/manual/out-attachment-cyrillic.png' })
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
