/* Смоук кнопки закрытия во вкладке сессии (таб-бар) при режиме фоновых сессий:
 * 1) настройка выключена: крестик «Закрыть сессию» во вкладке;
 * 2) настройка включена, idle-сессия: крестик остаётся;
 * 3) busy-сессия: вместо крестика eject «Сделать фоновой»;
 * 4) клик по eject: вкладка исчезла (сессия в фоне), строка в панели с play-иконкой.
 * Запуск против smoke-инстанса:
 *   npm run build
 *   npx electron . --smoke --remote-debugging-port=9223 --user-data-dir=%TEMP%\piwright-smoke-userdata
 *   node tests/manual/smoke-tab-eject.cjs
 */
const { execSync } = require('node:child_process')
const { mkdtempSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { chromium } = require('playwright-core')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'piwright-smoke-tabeject-'))
  const winDir = dir.replace(/\//g, '\\')
  const run = (cmd) => execSync(cmd, { cwd: dir, stdio: 'pipe' })
  run('git init -q -b main')
  run('git config user.email smoke@test')
  run('git config user.name smoke')
  writeFileSync(join(dir, 'a.txt'), '1')
  run('git add .')
  run('git commit -q -m base-1')

  const browser = await chromium.connectOverCDP(CDP)
  const page = browser.contexts()[0].pages()[0]
  const results = []
  const check = (name, cond, extra = '') => {
    results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
    if (!cond) process.exitCode = 1
  }

  await page.waitForSelector('.right-bar', { timeout: 30000 })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  await page.evaluate(async (d) => {
    const s = await window.piwright.getSettings()
    const has = (s.projects ?? []).some((p) => p.dir === d)
    const patch = { backgroundSessions: false }
    if (!has) patch.projects = [...(s.projects ?? []), { kind: 'native', dir: d }]
    await window.piwright.setSettings(patch)
  }, winDir)
  await page.reload()
  await page.waitForSelector('.right-bar', { timeout: 30000 })
  await page.waitForTimeout(1500)

  const tabClose = '.tab.session button.tab-close[title="Close session"], .tab.session button.tab-close[title="Закрыть сессию"]'
  const tabEject = '.tab.session button.eject'
  const playBtn = '.session-row button.play'

  // 1. Настройка выключена: во вкладке крестик
  await page.locator('button[title="Новая сессия"], button[title="New session"]').first().click()
  await page.locator('.tab.session').first().waitFor({ timeout: 90000 })
  await page.waitForTimeout(1000)
  check('off: tab close visible', (await page.locator(tabClose).count()) === 1)
  check('off: tab eject hidden', (await page.locator(tabEject).count()) === 0)

  // 2. Включить режим фоновых сессий; idle-сессия — крестик остаётся
  await page.evaluate(() => window.piwright.setSettings({ backgroundSessions: true }))
  await page.reload()
  await page.waitForSelector('.tab.session', { timeout: 90000 })
  await page.waitForTimeout(1500)
  check('on idle: tab close visible', (await page.locator(tabClose).count()) === 1)
  check('on idle: tab eject hidden', (await page.locator(tabEject).count()) === 0)

  // 3. Запустить ход → busy → во вкладке eject вместо крестика
  const input = page.locator('.composer textarea:not(.loop-exit)').first()
  await input.waitFor({ timeout: 90000 })
  await input.fill('Count from 1 to 300, one number per line, no extra text.')
  await input.press('Control+Enter')
  const busyDeadline = Date.now() + 60000
  let busy = false
  while (Date.now() < busyDeadline) {
    const dot = await page.evaluate(async () => (await window.piwright.listSessions()).active[0]?.dot ?? null)
    if (dot === 'busy') {
      busy = true
      break
    }
    await sleep(300)
  }
  check('turn is streaming', busy)
  await page.waitForSelector(tabEject, { timeout: 15000 })
  const ejectTitle = await page.locator(tabEject).getAttribute('title')
  check('on busy: tab eject visible', true, `title=${ejectTitle}`)
  check('on busy: tab close hidden', (await page.locator(tabClose).count()) === 0)

  // 4. Клик по eject во вкладке → вкладка исчезла, строка в панели с play
  await page.locator(tabEject).click()
  await page.waitForSelector(playBtn, { timeout: 15000 })
  check('after eject: play visible in panel', (await page.locator(playBtn).count()) === 1)
  check('after eject: tab gone', (await page.locator('.tab.session').count()) === 0)
  const dot = await page.evaluate(async () => (await window.piwright.listSessions()).active[0]?.dot ?? null)
  check('after eject: session alive', dot !== null, `dot=${dot}`)

  // 5. Откат: остановить фоновую сессию, выключить настройку
  await page.locator('.session-row button.stop').click()
  await page.waitForTimeout(1500)
  await page.evaluate(() => window.piwright.setSettings({ backgroundSessions: false }))

  console.log(results.join('\n'))
  await browser.close()
}

main().catch((err) => {
  console.error('SMOKE ERROR:', err.message)
  process.exit(1)
})
