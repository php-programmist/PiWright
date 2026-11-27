/* Smoke: background sessions disabled — a busy session must close with its process stopped,
 * not leak into the background ("1 в фоне"). Seeds settings with backgroundSessions=false,
 * starts a long turn, closes the tab via the cross button, then checks: the session row is
 * gone from the panel and listSessions, daemonStatus().background stays 0, no footer counter. */
const { spawn, execFileSync } = require('node:child_process')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const http = require('node:http')
const { chromium } = require('playwright-core')

const REPO = join(__dirname, '..', '..')
const PORT = 9231
const CDP = `http://localhost:${PORT}`
const MODEL = process.env.SMOKE_MODEL || 'spark41/GLM-5.3-Flash'
const userData = mkdtempSync(join(tmpdir(), 'piwright-bgdisabled-smoke-'))

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
      backgroundSessions: false,
      notifications: {
        sounds: { completion: '', await: '', error: '' },
        telegram: { chatId: '', events: { turnEnd: false, permission: false, question: false, error: false, loopEnd: false } },
        remote: { enabled: false, port: 7692, staticPin: '' }
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

;(async () => {
  let browser = null
  let proc = null
  try {
    seedSettings()
    proc = await launchApp()
    browser = await chromium.connectOverCDP(CDP)
    const page = await attachPage(browser)

    const saved = await page.evaluate(async () => (await window.piwright.getSettings()).backgroundSessions)
    check('backgroundSessions=false seeded', saved === false, String(saved))

    // Сессия проекта piwright
    const row = page.locator('.project-row', { hasText: 'piwright' }).first()
    await row.locator('button.icon', { hasText: '+' }).last().click()
    await page.waitForSelector('.session-row.current', { timeout: 90000 })
    const hostId = await page.evaluate(async () => (await window.piwright.listSessions()).active[0]?.hostId ?? null)
    if (hostId === null) throw new Error('no active host after session create')
    console.log('setModel:', JSON.stringify(await page.evaluate(async ({ hostId, model }) => await window.piwright.setModel(hostId, model), { hostId, model: MODEL })))

    // Длинный ход — сессия становится busy
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

    // Крестик вкладки при выключенных фоновых сессиях: обычное закрытие (кнопка без .eject)
    const closeBtn = page.locator('.tab.session .tab-close:not(.eject)').first()
    check('close button is plain cross (no eject)', (await closeBtn.count()) === 1)
    await closeBtn.click()

    // Сессия закрылась полностью: строки нет, активных хостов нет, фона нет
    await page.waitForSelector('.session-row', { state: 'detached', timeout: 15000 })
    check('session row removed from panel', true)
    const active = await page.evaluate(async () => (await window.piwright.listSessions()).active)
    check('no active hosts left', active.length === 0, JSON.stringify(active))
    const bg = await page.evaluate(async () => (await window.piwright.daemonStatus()).background)
    check('daemon background counter is 0', bg === 0, `background=${bg}`)
    check('no footer background counter', (await page.locator('.daemon-bg-count').count()) === 0)
    await page.screenshot({ path: 'tests/manual/bg-disabled-close.png' })

    console.log('SMOKE OK')
  } catch (err) {
    console.error('SMOKE FAIL:', err.message)
    results.push({ name: 'smoke', ok: false })
  } finally {
    try {
      if (proc !== null) {
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
