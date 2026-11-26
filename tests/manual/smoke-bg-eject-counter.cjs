/* Смоук счётчика фоновых сессий после eject (без рестарта приложения):
 * 1) eject во время хода → счётчик «1 in background» появляется сразу;
 * 2) поповер: строка с пульсирующей точкой (ход ещё идёт);
 * 3) после конца хода строка остаётся (idle-фоновая сессия считается), точка гаснет;
 * 4) клик по строке — реаттач: вкладка открылась, счётчик исчез;
 * 5) повторный eject + «Остановить все фоновые» — сессия остановлена, счётчик исчез.
 * Запуск против smoke-инстанса:
 *   npm run build
 *   npx electron . --smoke --remote-debugging-port=9223 --user-data-dir=%TEMP%\piwright-smoke-userdata
 *   node tests/manual/smoke-bg-eject-counter.cjs
 */
const { execSync } = require('node:child_process')
const { mkdtempSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { chromium } = require('playwright-core')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'piwright-smoke-bgcounter-'))
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
    const patch = { backgroundSessions: true }
    if (!has) patch.projects = [...(s.projects ?? []), { kind: 'native', dir: d }]
    await window.piwright.setSettings(patch)
  }, winDir)
  await page.reload()
  await page.waitForSelector('.right-bar', { timeout: 30000 })
  await page.waitForTimeout(1500)

  const tabEject = '.tab.session button.eject'
  const counter = '.daemon-bg-count'
  const popover = '.daemon-bg-popover'
  const bgRow = '.daemon-bg-row'
  const bgDot = '.daemon-bg-dot'

  const waitBusy = async () => {
    const deadline = Date.now() + 60000
    while (Date.now() < deadline) {
      const dot = await page.evaluate(async () => (await window.piwright.listSessions()).active[0]?.dot ?? null)
      if (dot === 'busy') return true
      await sleep(300)
    }
    return false
  }
  const waitIdle = async () => {
    const deadline = Date.now() + 180000
    while (Date.now() < deadline) {
      const dot = await page.evaluate(async () => (await window.piwright.listSessions()).active[0]?.dot ?? null)
      if (dot === 'idle') return true
      await sleep(500)
    }
    return false
  }
  const startTurn = async () => {
    const input = page.locator('.composer textarea:not(.loop-exit)').first()
    await input.waitFor({ timeout: 90000 })
    await input.fill('Count from 1 to 300, one number per line, no extra text.')
    await input.press('Control+Enter')
    check('turn is streaming', await waitBusy())
  }

  // 1. Новая сессия, ход, eject во время хода
  await page.locator('button[title="Новая сессия"], button[title="New session"]').first().click()
  await page.locator('.tab.session').first().waitFor({ timeout: 90000 })
  await page.waitForTimeout(1000)
  await startTurn()
  await page.waitForSelector(tabEject, { timeout: 15000 })
  await page.locator(tabEject).click()
  await page.waitForSelector(counter, { timeout: 10000 })
  const counterText = await page.locator(counter).textContent()
  check('after eject: counter shows 1 without restart', counterText.trim().startsWith('1'), `text=${counterText.trim()}`)
  check('after eject: tab gone', (await page.locator('.tab.session').count()) === 0)

  // 2. Поповер: строка фоновой сессии с пульсирующей точкой
  await page.locator(counter).click()
  await page.waitForSelector(popover, { timeout: 5000 })
  await page.waitForSelector(bgRow, { timeout: 5000 })
  check('popover: one row', (await page.locator(bgRow).count()) === 1)
  check('popover: streaming dot while turn runs', (await page.locator(bgDot).count()) === 1)
  const rowTitle = await page.locator(`${bgRow} .daemon-bg-row-title`).textContent()
  check('popover: row has title', (rowTitle ?? '').trim().length > 0, `title=${rowTitle}`)
  const rowProject = await page.locator(`${bgRow} .daemon-bg-row-project`).textContent()
  check('popover: row has project name', (rowProject ?? '').trim().length > 0, `project=${rowProject}`)

  // 3. Ход дозрел в фоне: строка остаётся, точка гаснет, счётчик на месте
  check('background turn finishes', await waitIdle())
  await page.waitForTimeout(6500)
  check('after turn end: counter still visible', (await page.locator(counter).count()) === 1)
  check('after turn end: row still listed', (await page.locator(bgRow).count()) === 1)
  check('after turn end: dot gone (idle)', (await page.locator(bgDot).count()) === 0)

  // 4. Клик по строке — реаттач живого хоста: вкладка открылась, счётчик исчез
  await page.locator(bgRow).first().click()
  await page.waitForSelector('.tab.session', { timeout: 15000 })
  check('reattach: tab opened', (await page.locator('.tab.session').count()) === 1)
  await page.waitForTimeout(1000)
  check('reattach: counter gone', (await page.locator(counter).count()) === 0)
  check('reattach: play icon gone', (await page.locator('.session-row button.play').count()) === 0)

  // 5. Повторный eject + «Остановить все фоновые сессии»
  await startTurn()
  await page.waitForSelector(tabEject, { timeout: 15000 })
  await page.locator(tabEject).click()
  await page.waitForSelector(counter, { timeout: 10000 })
  await page.locator('.daemon-bg-stop').click()
  await page.waitForSelector('.confirm-box', { timeout: 5000 })
  await page.locator('.confirm-box button.primary').click()
  await page.waitForTimeout(2000)
  check('stop all: counter gone', (await page.locator(counter).count()) === 0)
  check('stop all: session row removed', (await page.locator('.session-row').count()) === 0)
  const hosts = await page.evaluate(async () => (await window.piwright.listSessions()).active.length)
  check('stop all: host stopped', hosts === 0, `hosts=${hosts}`)

  // Откат настройки
  await page.evaluate(() => window.piwright.setSettings({ backgroundSessions: false }))

  console.log(results.join('\n'))
  if (!process.exitCode) console.log('SMOKE OK')
  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
