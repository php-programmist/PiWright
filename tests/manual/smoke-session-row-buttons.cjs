/* Смоук кнопок строки сессии в панели проектов при режиме фоновых сессий:
 * 1) настройка выключена: крестик «Закрыть сессию» виден, стоп-квадрата нет;
 * 2) настройка включена: крестик скрыт, стоп-квадрат есть, последний в ряду, серый (краснеет при наведении);
 * 3) не-idle сессия: eject-иконка «сделать фоновой», клик — сессия уходит в фон (play-иконка, eject исчезает).
 * Запуск против smoke-инстанса:
 *   npm run build
 *   npx electron . --smoke --remote-debugging-port=9223 --user-data-dir=%TEMP%\piwright-smoke-userdata
 *   node tests/manual/smoke-session-row-buttons.cjs
 */
const { execSync } = require('node:child_process')
const { mkdtempSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { chromium } = require('playwright-core')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'piwright-smoke-rowbtn-'))
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

  // Сброс: настройка выключена, проект засеян
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

  const closeBtn = '.session-row button[title="Close session"], .session-row button[title="Закрыть сессию"]'
  const stopBtn = '.session-row button.stop'
  const ejectBtn = '.session-row button.eject'
  const playBtn = '.session-row button.play'

  // 1. Настройка выключена: крестик есть, стопа нет
  await page.locator('button[title="Новая сессия"], button[title="New session"]').first().click()
  await page.locator('.session-row').first().waitFor({ timeout: 90000 })
  await page.waitForTimeout(1000)
  check('off: close button visible', (await page.locator(closeBtn).count()) >= 1)
  check('off: stop button hidden', (await page.locator(stopBtn).count()) === 0)
  check('off: eject hidden', (await page.locator(ejectBtn).count()) === 0)

  // 2. Включить режим фоновых сессий
  await page.evaluate(() => window.piwright.setSettings({ backgroundSessions: true }))
  await page.reload()
  await page.waitForSelector('.session-row', { timeout: 90000 })
  await page.waitForTimeout(1500)
  check('on: close button hidden', (await page.locator(closeBtn).count()) === 0)
  check('on: stop button visible', (await page.locator(stopBtn).count()) === 1)
  const lastBtnClass = await page.locator('.session-row button').last().getAttribute('class')
  check('on: stop is last button in row', (lastBtnClass ?? '').includes('stop'), lastBtnClass ?? '')

  const red = await page.evaluate(() => {
    const el = document.createElement('span')
    el.style.color = 'var(--red)'
    document.body.appendChild(el)
    const c = getComputedStyle(el).color
    el.remove()
    return c
  })
  const stopColor = await page.locator(stopBtn).evaluate((el) => getComputedStyle(el).color)
  check('on: stop is gray (not red)', stopColor !== red, `stop=${stopColor} red=${red}`)
  await page.locator(stopBtn).hover()
  await page.waitForTimeout(300)
  const stopHover = await page.locator(stopBtn).evaluate((el) => getComputedStyle(el).color)
  check('on: stop turns red on hover', stopHover === red, `hover=${stopHover} red=${red}`)

  // 3. Idle-сессия: eject скрыт
  check('on idle: eject hidden', (await page.locator(ejectBtn).count()) === 0)

  // 4. Запустить ход → busy → eject появился
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
  await page.waitForSelector(ejectBtn, { timeout: 15000 })
  const ejectTitle = await page.locator(ejectBtn).getAttribute('title')
  check('busy: eject visible', true, `title=${ejectTitle}`)

  // 5. Клик по eject → сессия в фоне: play-иконка, eject исчез
  await page.locator(ejectBtn).click()
  await page.waitForSelector(playBtn, { timeout: 15000 })
  check('after eject: play visible', (await page.locator(playBtn).count()) === 1)
  check('after eject: eject hidden', (await page.locator(ejectBtn).count()) === 0)
  check('after eject: row stays', (await page.locator('.session-row').count()) === 1)
  const bg = await page.evaluate(async () => (await window.piwright.listSessions()).active[0]?.dot ?? null)
  check('after eject: session alive', bg !== null, `dot=${bg}`)

  // 6. Откат: остановить фоновую сессию, выключить настройку
  await page.locator(stopBtn).click()
  await page.waitForTimeout(1500)
  await page.evaluate(() => window.piwright.setSettings({ backgroundSessions: false }))

  console.log(results.join('\n'))
  await browser.close()
}

main().catch((err) => {
  console.error('SMOKE ERROR:', err.message)
  process.exit(1)
})
