/* Smoke: watchdog of finished background sessions. Launches its own smoke instance with
 * backgroundGraceMinutes=0, runs a long turn, closes the tab mid-turn (row stays with the
 * play icon), waits for the turn to finish — the watchdog must close the session right away:
 * the row leaves the projects panel, the host disappears from listSessions and the session
 * shows up in History (and the agent process is stopped). */
const { spawn, execFileSync } = require('node:child_process')
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const http = require('node:http')
const { chromium } = require('playwright-core')

const REPO = join(__dirname, '..', '..')
const PORT = 9231
const CDP = `http://localhost:${PORT}`
const MODEL = process.env.SMOKE_MODEL || 'spark41/GLM-5.3-Flash'
const userData = mkdtempSync(join(tmpdir(), 'piwright-bgwatch-smoke-'))
const projectDir = join(userData, 'proj')
mkdirSync(projectDir, { recursive: true })

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
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({
      projects: [{ kind: 'native', dir: projectDir }],
      backgroundSessions: true,
      notifications: {
        sounds: { completion: '', await: '', error: '' },
        telegram: { chatId: '', events: { turnEnd: false, permission: false, question: false, error: false, loopEnd: false } },
        remote: { enabled: false, port: 7690, staticPin: '' },
        backgroundGraceMinutes: 0
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
    const page = await attachPage(browser)

    // Сессия проекта
    const row = page.locator('.project-row', { hasText: 'proj' }).first()
    await row.locator('button.icon', { hasText: '+' }).last().click()
    await page.waitForSelector('.session-row.current', { timeout: 90000 })
    const hostId = await page.evaluate(async () => (await window.piwright.listSessions()).active[0]?.hostId ?? null)
    if (hostId === null) throw new Error('no active host after session create')
    await page.evaluate(async ({ hostId, model }) => window.piwright.setModel(hostId, model), { hostId, model: MODEL })

    // Длинный ход; крестик вкладки посреди него — строка уходит в фон с play-иконкой
    const input = page.locator('.composer textarea:not(.loop-exit)').first()
    await input.waitFor({ timeout: 90000 })
    await input.fill('Run the shell command "ping -n 20 127.0.0.1" and when it finishes, reply with exactly: PING DONE')
    await input.press('Control+Enter')
    const busyDeadline = Date.now() + 90000
    let busy = false
    while (Date.now() < busyDeadline) {
      const dot = await page.evaluate(async (id) => (await window.piwright.listSessions()).active.find((s) => s.hostId === id)?.dot ?? null, hostId)
      if (dot === 'busy') {
        busy = true
        break
      }
      await sleep(300)
    }
    check('turn is streaming', busy)
    await page.locator('.tab.session .tab-close').click()
    await page.waitForSelector('.tab.session', { state: 'detached', timeout: 5000 }).catch(() => {})
    check('tab closed, row stays with play icon', (await page.locator('.session-row .icon.play').count()) === 1)

    // Конец хода: вотчдог с грейсом 0 закрывает сессию сразу после idle — окно «dot=idle»
    // в listSessions длится миллисекунды, ждём сразу конечное состояние: хост исчез.
    const lastState = { dot: null, error: null }
    const goneDeadline = Date.now() + 240000
    let gone = false
    while (Date.now() < goneDeadline) {
      const state = await page.evaluate(async (id) => {
        const snap = await window.piwright.listSessions()
        const row = snap.active.find((s) => s.hostId === id)
        return {
          dot: row?.dot ?? null,
          error: row?.error ?? null,
          rows: document.querySelectorAll('.session-row').length,
          hostGone: !snap.active.some((s) => s.hostId === id),
          history: document.querySelectorAll('.history-item').length
        }
      }, hostId)
      lastState.dot = state.dot
      lastState.error = state.error
      if (state.hostGone) {
        check('watchdog closed session: row gone, host gone, in History', state.rows === 0 && state.history > 0, JSON.stringify(state))
        gone = true
        break
      }
      await sleep(500)
    }
    if (!gone) check('watchdog closed session', false, `timeout, last state: ${JSON.stringify(lastState)}`)

    // Процесс агента остановлен: у демона не осталось фоновых детей
    const bg = await page.evaluate(async () => (await window.piwright.daemonStatus()).background)
    check('agent process stopped (daemon background = 0)', bg === 0, `background=${bg}`)

    console.log('SMOKE OK')
  } catch (err) {
    console.error('SMOKE FAIL:', err.message)
    results.push({ name: 'smoke', ok: false })
  } finally {
    try {
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
