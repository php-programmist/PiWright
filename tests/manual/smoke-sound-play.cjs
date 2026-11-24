/* Smoke: кнопка проигрывания выбранного звука в настройках (Notifications → Sounds).
   Открываем настройки Ctrl+, (фокус через menu-focus.ps1), вкладка Notifications,
   проверяем вторую ghost-кнопку с svg в каждой .sound-row: disabled при пустом пути,
   включается после ввода пути к wav, клик не роняет страницу и не пишет [sounds] warn.
   Запуск: node tests/manual/smoke-sound-play.cjs <smokeMainPid>. */
const { chromium } = require('playwright-core')
const { execSync } = require('node:child_process')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'
const WAV = 'C:\\Windows\\Media\\Windows Notify.wav'

async function main() {
  const pid = process.argv[2]
  if (!pid) throw new Error('usage: node smoke-sound-play.cjs <smokeMainPid>')
  const b = await chromium.connectOverCDP(CDP)
  const p = b.contexts()[0].pages()[0]
  await p.waitForSelector('.app', { timeout: 30000 })

  const warns = []
  p.on('console', (m) => { if (m.text().includes('[sounds]')) warns.push(m.text()) })

  const out = execSync(
    `powershell -NoProfile -ExecutionPolicy Bypass -File tests/manual/menu-focus.ps1 ${pid}`,
    { encoding: 'utf8' }
  )
  console.log(out.trim())
  await p.waitForSelector('.settings-modal-overlay', { timeout: 5000 })

  await p.locator('.settings-nav button', { hasText: 'Notifications' }).click()
  await p.waitForSelector('section:has(h3:text-is("Sounds")) .sound-row', { timeout: 5000 })

  const rows = p.locator('section:has(h3:text-is("Sounds")) .sound-row')
  const n = await rows.count()
  if (n !== 3) throw new Error(`expected 3 sound rows, got ${n}`)

  for (let i = 0; i < n; i++) {
    const row = rows.nth(i)
    const btns = row.locator('button')
    if ((await btns.count()) !== 2) throw new Error(`row ${i}: expected 2 buttons`)
    const play = btns.nth(1)
    if ((await play.locator('svg').count()) !== 1) throw new Error(`row ${i}: play button has no svg`)
    const title = await play.getAttribute('title')
    if (!['Проиграть звук', 'Play sound'].includes(title)) throw new Error(`row ${i}: unexpected title ${title}`)
    const input = row.locator('input')
    const val = (await input.inputValue()).trim()
    if ((await play.isDisabled()) !== (val.length === 0)) {
      throw new Error(`row ${i}: disabled=${await play.isDisabled()} but path empty=${val.length === 0}`)
    }

    await input.fill(WAV)
    await p.waitForTimeout(200)
    if (await play.isEnabled()) {
      await play.click()
      await p.waitForTimeout(600)
    } else {
      throw new Error(`row ${i}: play button still disabled after path set`)
    }
    await input.fill('')
    await p.waitForTimeout(200)
    if (!(await play.isDisabled())) throw new Error(`row ${i}: play button not disabled after clearing`)
  }

  if (warns.length > 0) throw new Error(`[sounds] console warnings: ${warns.join(' | ')}`)

  const row = rows.first()
  const rowBox = await row.boundingBox()
  const playBox = await row.locator('button').nth(1).boundingBox()
  if (playBox.x + playBox.width > rowBox.x + rowBox.width + 1) throw new Error('play button overflows sound-row')

  await p.keyboard.press('Escape')
  console.log('SMOKE OK')
  await b.close()
}

main().catch((e) => { console.error('SMOKE FAIL:', e.message); process.exit(1) })
