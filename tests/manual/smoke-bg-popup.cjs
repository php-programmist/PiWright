/* Smoke: popup of background sessions (click on the footer counter). Launches its own smoke
 * instance, runs a long turn, forgets the restore tab and quits the app mid-turn: the daemon
 * finishes the turn with clients=0, so the footer shows "1 in background". Relaunch, click the
 * counter, check the popup row (project + title + streaming dot), screenshot, close via Escape,
 * then attach the session by clicking the popup row (tab reopens, counter drops to 0). */
const { spawn, execFileSync } = require('node:child_process')
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const http = require('node:http')
const { chromium } = require('playwright-core')

const REPO = join(__dirname, '..', '..')
const PORT = 9229
const CDP = `http://localhost:${PORT}`
const MODEL = process.env.SMOKE_MODEL || 'spark41/GLM-5.3-Flash'
const userData = mkdtempSync(join(tmpdir(), 'piwright-bgpopup-smoke-'))

const results = []
const check = (name, ok, extra) => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra !== undefined ? ' — ' + extra : ''}`)
  if (!ok) throw new Error(`check failed: ${name}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function cdpAlive() {
  return new Promise((resolve) => {
    const req = http.get(`${CDP}/json/version`, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(1500, () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function launchApp() {
  const electronPath = require('electron')
  const proc = spawn(electronPath, [REPO, '--smoke', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`], {
    cwd: REPO,
    stdio: 'ignore'
  })
  const deadline = Date.now() + 60000
  while (!(await cdpAlive())) {
    if (Date.now() > deadline) throw new Error('CDP never came up')
    await sleep(500)
  }
  return proc
}

function seedSettings() {
  mkdirSync(userData, { recursive: true })
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({
      projects: [{ kind: 'native', dir: REPO }],
      notifications: {
        sounds: { completion: '', await: '', error: '' },
        telegram: { chatId: '', events: { turnEnd: false, permission: false, question: false, error: false, loopEnd: false } },
        remote: { enabled: false, port: 7690, staticPin: '' },
        backgroundGraceMinutes: 30
      }
    }),
    'utf8'
  )
}

async function attachPage(browser) {
  const page = browser.contexts().flatMap((c) => c.pages()).find((p) => !p.url().startsWith('devtools://'))
  if (!page) throw new Error('no app page')
  await page.waitForSelector('.project-row', { timeout: 60000 })
  return page
}

async function sendPrompt(page, text) {
  const input = page.locator('.composer textarea:not(.loop-exit)').first()
  await input.waitFor({ timeout: 90000 })
  await input.fill(text)
  await input.press('Control+Enter')
}

function appAlive(pid) {
  try {
    return execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV'], { encoding: 'utf8' }).includes(String(pid))
  } catch {
    return false
  }
}

;(async () => {
  let browser = null
  let proc = null
  try {
    seedSettings()
    proc = await launchApp()
    browser = await chromium.connectOverCDP(CDP)
    let page = await attachPage(browser)

    // Сессия проекта piwright
    const row = page.locator('.project-row', { hasText: 'piwright' }).first()
    await row.locator('button.icon', { hasText: '+' }).last().click()
    await page.waitForSelector('.session-row.current', { timeout: 90000 })
    const hostId = await page.evaluate(async () => (await window.piwright.listSessions()).active[0]?.hostId ?? null)
    if (hostId === null) throw new Error('no active host after session create')
    console.log('setModel:', JSON.stringify(await page.evaluate(async ({ hostId, model }) => await window.piwright.setModel(hostId, model), { hostId, model: MODEL })))

    // Длинный ход; забыть вкладку восстановления и выйти посреди него —
    // демон дозреет ход с clients=0 (счётчик футера покажет «1 в фоне»)
    await sendPrompt(page, 'Count from 1 to 5000, one number per line, no extra text.')
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
    await page.evaluate(async ({ hostId }) => await window.piwright.backgroundSession(hostId), { hostId })
    execFileSync('taskkill', ['/PID', String(proc.pid)], { stdio: 'ignore', timeout: 15000 })
    const exitDeadline = Date.now() + 20000
    while (appAlive(proc.pid) && Date.now() < exitDeadline) await sleep(500)
    check('app exited gracefully', !appAlive(proc.pid))

    // Рестарт: вкладка не восстановлена (забыта), счётчик футера = 1
    await browser.close()
    proc = await launchApp()
    browser = await chromium.connectOverCDP(CDP)
    page = await attachPage(browser)
    const bgDeadline = Date.now() + 15000
    let bg = 0
    while (Date.now() < bgDeadline) {
      bg = await page.evaluate(async () => (await window.piwright.daemonStatus()).background)
      if (bg === 1) break
      await sleep(500)
    }
    check('footer counter shows 1 background', bg === 1, `background=${bg}`)

    // Клик по счётчику — попап со строкой фоновой сессии
    await page.locator('.daemon-bg-count').click()
    await page.waitForSelector('.daemon-bg-popover', { timeout: 5000 })
    await page.waitForSelector('.daemon-bg-row', { timeout: 10000 })
    const rows = await page.locator('.daemon-bg-row').evaluateAll((els) =>
      els.map((e) => ({ text: e.textContent, disabled: e.disabled }))
    )
    check('popup lists the background session', rows.length === 1 && !rows[0].disabled, JSON.stringify(rows))
    check('row shows project name', rows[0].text.includes('piwright'), rows[0].text)
    check('streaming dot shown', (await page.locator('.daemon-bg-dot').count()) === 1)
    await page.screenshot({ path: 'tests/manual/bg-popup.png' })

    // Escape закрывает попап
    await page.keyboard.press('Escape')
    await sleep(300)
    check('escape closes popup', (await page.locator('.daemon-bg-popover').count()) === 0)

    // Клик по строке — аттач: вкладка открылась, счётчик падает в 0
    await page.locator('.daemon-bg-count').click()
    await page.waitForSelector('.daemon-bg-row', { timeout: 5000 })
    await page.locator('.daemon-bg-row').first().click()
    await page.waitForSelector('.session-row.current', { timeout: 90000 })
    check('session tab reopened after attach', true)
    const bgAfter = await page.evaluate(async () => (await window.piwright.daemonStatus()).background)
    check('counter back to 0 after attach', bgAfter === 0, `background=${bgAfter}`)

    console.log('SMOKE OK')
  } catch (err) {
    console.error('SMOKE FAIL:', err.message)
    results.push({ name: 'smoke', ok: false })
  } finally {
    try {
      // Демон переживает app (unref): гасим по pid из daemon.log, иначе висит 10 мин idle.
      const logPath = join(userData, 'daemon.log')
      const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
      for (const m of log.matchAll(/daemon pid (\d+)/g)) {
        try {
          execFileSync('taskkill', ['/F', '/PID', String(m[1])], { stdio: 'ignore', timeout: 15000 })
        } catch { /* best effort */ }
      }
    } catch { /* best effort */ }
    try {
      if (proc !== null && appAlive(proc.pid)) {
        execFileSync('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { stdio: 'ignore', timeout: 15000 })
      }
    } catch { /* best effort */ }
    try {
      await browser?.close()
    } catch { /* best effort */ }
    try {
      rmSync(userData, { recursive: true, force: true })
    } catch { /* best effort */ }
    process.exit(results.every((r) => r.ok) ? 0 : 1)
  }
})().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
