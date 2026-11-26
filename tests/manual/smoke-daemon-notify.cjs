/* Smoke: background notifications from the daemon (task 3/3). Launches its own smoke instance
 * with PIWRIGHT_TELEGRAM_API pointed at a local capture server, runs a turn, quits the app
 * MID-TURN with the session telegram flag on: the daemon finishes the turn in the background,
 * sends the telegram notification (captured locally), and with backgroundGraceMinutes=0 kills
 * the child right away. Relaunch restores the session from the transcript and NO duplicate
 * notification arrives. Then a second turn is detached mid-turn (tab cross): the daemon
 * notifies again while the app is open (main stays silent for detached sessions), the footer
 * shows "1 in background" and drops back to 0 after the grace kill. */
const { spawn, execFileSync } = require('node:child_process')
const { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync, mkdirSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const http = require('node:http')
const { chromium } = require('playwright-core')

const REPO = join(__dirname, '..', '..')
const PORT = 9228
const TG_PORT = 18777
const CDP = `http://localhost:${PORT}`
const MODEL = process.env.SMOKE_MODEL || 'spark41/GLM-5.3-Flash'
const userData = mkdtempSync(join(tmpdir(), 'piwright-notify-smoke-'))

const results = []
const check = (name, ok, extra) => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra !== undefined ? ' — ' + extra : ''}`)
  if (!ok) throw new Error(`check failed: ${name}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const telegramPosts = []

function startTelegramCapture() {
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body)
        telegramPosts.push({ url: req.url, chatId: parsed.chat_id, text: parsed.text })
      } catch {
        telegramPosts.push({ url: req.url, chatId: null, text: body })
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
    })
  })
  return new Promise((resolve) => server.listen(TG_PORT, '127.0.0.1', () => resolve(server)))
}

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

async function launchApp(captureLog) {
  const electronPath = require('electron')
  const proc = spawn(
    electronPath,
    [REPO, '--smoke', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`],
    {
      cwd: REPO,
      stdio: captureLog ? ['ignore', 'pipe', 'pipe'] : 'ignore',
      env: { ...process.env, PIWRIGHT_TELEGRAM_API: `http://127.0.0.1:${TG_PORT}` }
    }
  )
  if (captureLog) {
    proc.stdout.on('data', (d) => appendLog(captureLog, `[out] ${d}`))
    proc.stderr.on('data', (d) => appendLog(captureLog, `[err] ${d}`))
  }
  const deadline = Date.now() + 60000
  while (!(await cdpAlive())) {
    if (Date.now() > deadline) throw new Error('CDP never came up')
    await sleep(500)
  }
  return proc
}

function appendLog(path, text) {
  try {
    require('node:fs').appendFileSync(path, text)
  } catch { /* best effort */ }
}

/** Свежий userData пуст — сидируем проект piwright и уведомления: chatId, все события,
 *  звуки выключены (демон не дёргает powershell), grace 0 — kill сразу после уведомления. */
function seedSettings() {
  mkdirSync(userData, { recursive: true })
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({
      projects: [{ kind: 'native', dir: REPO }],
      backgroundSessions: true,
      notifications: {
        sounds: { completion: '', await: '', error: '' },
        telegram: { chatId: '777', events: { turnEnd: true, permission: true, question: true, error: true, loopEnd: false } },
        remote: { enabled: false, port: 7690, staticPin: '' },
        backgroundGraceMinutes: 0
      }
    }),
    'utf8'
  )
}

async function attach() {
  const browser = await chromium.connectOverCDP(CDP)
  const page = browser.contexts().flatMap((c) => c.pages()).find((p) => !p.url().startsWith('devtools://'))
  if (!page) throw new Error('no app page')
  await page.waitForSelector('.project-row', { timeout: 60000 })
  return { browser, page }
}

function settingsJson() {
  return JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))
}

function daemonLog() {
  const logPath = join(userData, 'daemon.log')
  return existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
}

function daemonPidFromLog() {
  const matches = [...daemonLog().matchAll(/daemon pid (\d+)/g)]
  return matches.length > 0 ? Number(matches[matches.length - 1][1]) : null
}

function processAlive(pid) {
  try {
    const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV'], { encoding: 'utf8' })
    return out.includes(String(pid))
  } catch {
    return false
  }
}

async function sendPrompt(page, text) {
  const input = page.locator('.composer textarea:not(.loop-exit)').first()
  await input.waitFor({ timeout: 90000 })
  await input.fill(text)
  await input.press('Control+Enter')
}

/** Файл сессии появляется после хендшейка; waitForFunction с async-предикатом не работает
 *  (Promise truthy) — поллим из Node. */
async function waitSessionFile(page, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const sf = await page.evaluate(async () => (await window.piwright.listSessions()).active[0]?.sessionFile ?? null)
    if (sf !== null && sf !== undefined) return sf
    await sleep(1000)
  }
  return null
}

async function waitForPosts(count, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (telegramPosts.length >= count) return true
    await sleep(1000)
  }
  return false
}

;(async () => {
  let browser = null
  let proc = null
  let tgServer = null
  try {
    tgServer = await startTelegramCapture()
    seedSettings()
    proc = await launchApp(join(tmpdir(), 'piwright-notify-app1.log'))
    ;({ browser, page } = await attach())
    console.log('app launched, userData=' + userData)

    // Токен бота — через IPC (safeStorage зашифрует в token-store демона через hello)
    const tokenSaved = await page.evaluate(async () => await window.piwright.setTelegramToken('123:TESTTOKEN'))
    check('telegram token saved', tokenSaved.ok === true)

    // Сессия проекта piwright
    const row = page.locator('.project-row', { hasText: 'piwright' }).first()
    await row.locator('button.icon', { hasText: '+' }).last().click()
    await page.waitForSelector('.session-row.current', { timeout: 90000 })
    const hostId = await page.evaluate(async () => (await window.piwright.listSessions()).active[0]?.hostId ?? null)
    if (hostId === null) throw new Error('no active host after session create')
    console.log('setModel:', JSON.stringify(await page.evaluate(async ({ hostId, model }) => await window.piwright.setModel(hostId, model), { hostId, model: MODEL })))

    // Telegram-флаг сессии ON (persistSessionToggles → settings.sessionToggles по файлу).
    // Файл сессии появляется после хендшейка — ждём его, иначе персист некуда писать.
    const sessionFile = await waitSessionFile(page)
    check('session file known after handshake', typeof sessionFile === 'string', String(sessionFile))
    const toggled = await page.evaluate(async ({ hostId }) => await window.piwright.setSessionTelegram(hostId, true), { hostId })
    check('session telegram toggled on', toggled.ok === true)
    const toggles = settingsJson().sessionToggles
    const toggleEntry = Object.values(toggles).find((t) => t.telegram === true)
    check('session toggle persisted to settings', toggleEntry !== undefined, JSON.stringify(toggles))

    // Ход и graceful quit посреди него
    await sendPrompt(page, 'Count from 1 to 25, one number per line, no extra text.')
    await sleep(4000)
    execFileSync('taskkill', ['/PID', String(proc.pid)], { stdio: 'ignore', timeout: 15000 })
    const exitDeadline = Date.now() + 20000
    while (processAlive(proc.pid) && Date.now() < exitDeadline) await sleep(500)
    check('app exited gracefully', !processAlive(proc.pid))

    // Демон дописал ход в фоне и уведомил: telegram POST захвачен локальным сервером
    const notified = await waitForPosts(1, 240000)
    check('telegram notification captured while app closed', notified, JSON.stringify(telegramPosts))
    check('notification text format', telegramPosts[0].chatId === '777' && telegramPosts[0].text.includes('piwright ·') && telegramPosts[0].text.includes('ход завершён'), telegramPosts[0].text)
    check('daemon log has background notify', daemonLog().includes('background notify turnEnd'))
    check('daemon log has grace kill', daemonLog().includes('background grace'))

    // Ребёнок убит по grace (0 мин)
    const killDeadline = Date.now() + 15000
    let killedLogged = false
    while (Date.now() < killDeadline) {
      if (daemonLog().includes('background grace expired')) {
        killedLogged = true
        break
      }
      await sleep(500)
    }
    check('grace kill logged', killedLogged)

    // Перезапуск: вкладка восстановлена из транскрипта, БЕЗ повторного уведомления
    await browser.close()
    proc = await launchApp(join(tmpdir(), 'piwright-notify-app2.log'))
    ;({ browser, page } = await attach())
    await page.waitForSelector('.session-row', { timeout: 90000 })
    check('session tab restored after restart', true)
    await page.waitForSelector('.user-message', { timeout: 60000 })
    await sleep(8000)
    check('no duplicate notification after relaunch', telegramPosts.length === 1, `posts=${telegramPosts.length}`)

    // Детач во время хода: closeSession(keepAlive=true) отвязывает ребёнка демона — ход дозреет
    // без клиента (уведомление + grace). Крестик вкладки после 1479bbb фонит сессию без детача,
    // поэтому детач дергаем напрямую IPC — смоук проверяет поведение демона, не кнопку.
    await sendPrompt(page, 'Count from 1 to 300, one number per line, no extra text.')
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
    check('second turn is streaming', busy)
    await page.evaluate(async () => {
      const hostId = (await window.piwright.listSessions()).active[0]?.hostId ?? null
      if (hostId === null) throw new Error('no active host to detach')
      await window.piwright.closeSession(hostId, true)
    })
    const bgDeadline = Date.now() + 10000
    let bgCount = 0
    while (Date.now() < bgDeadline) {
      bgCount = await page.evaluate(async () => (await window.piwright.daemonStatus()).background)
      if (bgCount === 1) break
      await sleep(500)
    }
    check('footer status shows 1 background session', bgCount === 1, `background=${bgCount}`)
    const notified2 = await waitForPosts(2, 240000)
    check('daemon notified for detached session turn end', notified2, JSON.stringify(telegramPosts.map((p) => p.text)))
    check('no doubling: exactly one notification per turn', telegramPosts.length === 2, `posts=${telegramPosts.length}`)
    await sleep(6000)
    const bgAfter = await page.evaluate(async () => (await window.piwright.daemonStatus()).background)
    check('background counter back to 0 after grace kill', bgAfter === 0, `background=${bgAfter}`)

    console.log('SMOKE OK')
  } catch (err) {
    console.error('SMOKE FAIL:', err.message)
    results.push({ name: 'smoke', ok: false })
  } finally {
    try {
      const pid = daemonPidFromLog()
      if (pid !== null && processAlive(pid)) execFileSync('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore' })
    } catch { /* best effort */ }
    try {
      if (proc !== null && processAlive(proc.pid)) execFileSync('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { stdio: 'ignore' })
    } catch { /* best effort */ }
    try {
      await browser?.close()
    } catch { /* best effort */ }
    try {
      tgServer?.close()
    } catch { /* best effort */ }
    try {
      rmSync(userData, { recursive: true, force: true })
    } catch { /* best effort */ }
    process.exit(results.every((r) => r.ok) ? 0 : 1)
  }
})()
