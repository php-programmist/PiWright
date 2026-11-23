/** Смоук экспорта тем: кнопка «Экспорт» на дефолтной теме не даёт «Theme not found».
 *  IPC экспорта висит, пока открыт нативный диалог «Сохранить» — он закрывается
 *  PostMessage(BM_CLICK) по кнопке Cancel, без нажатий клавиш на окно. */
const { chromium } = require('playwright-core')
const { execFileSync } = require('node:child_process')
const { writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'
const DATA = process.env.SMOKE_USERDATA
const CLOSE_DIALOG = join(__dirname, 'close-smoke-dialog.ps1')

const NEON = {
  id: 'neon',
  name: 'Neon',
  accents: ['#ff00aa', '#00ffcc'],
  columnTint: 'rgba(255, 0, 170, 0.12)',
  columnBorder: 'rgba(255, 0, 170, 0.32)',
  cardTint: 'rgba(255, 0, 170, 0.08)',
  cardBorder: 'rgba(255, 0, 170, 0.26)',
  badge: '#ff66cc'
}

function dismissSaveDialog() {
  const out = execFileSync(
    'powershell',
    ['-ExecutionPolicy', 'Bypass', '-File', CLOSE_DIALOG, '-Match', 'piwright-smoke'],
    { encoding: 'utf8' }
  )
  console.log('  dialog closer:', out.split('\n').filter((l) => l.trim() && l.trim() !== 'done').join(' | '))
}

;(async () => {
  mkdirSync(DATA, { recursive: true })
  writeFileSync(join(DATA, 'kanban-themes.json'), JSON.stringify({ version: 1, themes: [NEON] }, null, 2), 'utf8')

  const b = await chromium.connectOverCDP(CDP)
  const pages = b.contexts()[0].pages()
  const p = pages.find((c) => c.url().includes('index.html')) ?? pages[0]

  await p.evaluate(async () => {
    const cur = await window.piwright.getSettings()
    await window.piwright.setSettings({ ...cur, kanbanEnabled: true, language: 'ru', kanbanTheme: 'slate' })
  })
  await p.reload()
  await p.waitForTimeout(3000)

  async function openSettings() {
    if (await p.locator('.settings-modal').count()) {
      await p.locator('.settings-close').evaluate((el) => el.click())
      await p.waitForTimeout(400)
    }
    await p.locator('button[title*="Настройки"], button[title*="Settings"]').first().evaluate((el) => el.click())
    await p.waitForTimeout(800)
    await p.locator('.settings-nav button', { hasText: /Внешни|Appearance/ }).evaluate((el) => el.click())
    await p.waitForTimeout(800)
  }

  await openSettings()
  const rows = p.locator('.kanban-theme')
  console.log('rows:', await rows.count())

  async function clickExport(name) {
    await rows
      .filter({ hasText: name })
      .locator('button', { hasText: /Экспорт|Export/ })
      .evaluate((el) => el.click())
    await p.waitForTimeout(500)
    const text = (await p.locator('.settings-modal').count()) ? await p.locator('.settings-modal').innerText() : ''
    const failed = text.includes('Theme not found')
    console.log(`export ${name}: theme-not-found=${failed}`)
    if (failed) throw new Error(`export of ${name} reports Theme not found`)
    dismissSaveDialog()
    await p.waitForTimeout(800)
    dismissSaveDialog()
    await p.waitForTimeout(500)
  }

  await clickExport('Ocean')
  await clickExport('Neon')

  const unknown = await p.evaluate(async () => (await window.piwright.kanbanThemeExport('nope')).error)
  console.log('unknown id error:', unknown)
  if (unknown !== 'Theme not found') throw new Error(`unknown id must fail, got ${unknown}`)

  await openSettings()
  await p.locator('.settings-modal').screenshot({ path: join(DATA, 'kanban-theme-export.png') })
  await b.close()
  console.log('OK')
})().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
