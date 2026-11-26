/* Smoke: background session lifecycle (task 2/3). Launches its own smoke instance, runs a
 * turn, quits the app MID-TURN of a second prompt, verifies the daemon and the pi child
 * survive (daemon pid from daemon.log, pipe reachable, session JSONL keeps growing with the
 * assistant reply written after the app died), then relaunches and verifies the tab is
 * restored with the full transcript and a correct status. Kills the smoke daemon by PID. */
const { spawn, execFileSync } = require('node:child_process')
const { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync, mkdirSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { createHash } = require('node:crypto')
const http = require('node:http')
const { chromium } = require('playwright-core')

const REPO = join(__dirname, '..', '..')
const PORT = 9227
const CDP = `http://localhost:${PORT}`
// Дефолтная модель смоук-инстанса может быть недоступна — рабочая по умолчанию, переопределение SMOKE_MODEL.
const MODEL = process.env.SMOKE_MODEL || 'spark41/GLM-5.3-Flash'
const userData = mkdtempSync(join(tmpdir(), 'piwright-lifecycle-smoke-'))

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

async function launchApp(captureLog) {
  const electronPath = require('electron')
  const proc = spawn(
    electronPath,
    [REPO, '--smoke', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`],
    { cwd: REPO, stdio: captureLog ? ['ignore', 'pipe', 'pipe'] : 'ignore' }
  )
  if (captureLog) {
    const fs = require('node:fs')
    proc.stdout.on('data', (d) => fs.appendFileSync(captureLog, `[out] ${d}`))
    proc.stderr.on('data', (d) => fs.appendFileSync(captureLog, `[err] ${d}`))
  }
  const deadline = Date.now() + 60000
  let lastNetstat = ''
  while (!(await cdpAlive())) {
    if (Date.now() > deadline) {
      try { lastNetstat = execSyncPowerShell('(netstat -ano | Select-String ":' + PORT + '") -join "`n"') } catch { lastNetstat = 'netstat failed' }
      throw new Error(`CDP never came up; netstat: ${lastNetstat}`)
    }
    await sleep(500)
  }
  return proc
}

/** Свежий userData пуст — сидируем проект piwright, как в других смоук-инстансах. */
function seedProject() {
  mkdirSync(userData, { recursive: true })
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({ projects: [{ kind: 'native', dir: REPO }] }),
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

function daemonPidFromLog() {
  const logPath = join(userData, 'daemon.log')
  if (!existsSync(logPath)) return null
  const matches = [...readFileSync(logPath, 'utf8').matchAll(/daemon pid (\d+)/g)]
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

function pipeReachable(pipeName) {
  const script =
    "try { $p = New-Object System.IO.Pipes.NamedPipeClientStream('.', '" +
    pipeName +
    "', [System.IO.Pipes.PipeDirection]::InOut); $p.Connect(2000); 'connected' } catch { 'missing' }"
  return execSyncPowerShell(script).includes('connected')
}

function execSyncPowerShell(script) {
  return execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout: 15000 })
}

/** Число assistant-сообщений в JSONL сессии (ход агента дописывает message-записи). */
function assistantCount(sessionFile) {
  try {
    const lines = readFileSync(sessionFile, 'utf8').split('\n').filter((l) => l.trim().length > 0)
    let count = 0
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line)
        if (parsed.type === 'message' && parsed.message?.role === 'assistant') count++
      } catch {
        // последняя строка могла быть недописана
      }
    }
    return count
  } catch {
    return 0
  }
}

async function waitForAssistantGrowth(sessionFile, baseline, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (assistantCount(sessionFile) > baseline) return true
    await sleep(1000)
  }
  return false
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
  let sessionFile = null
  try {
    seedProject()
    proc = await launchApp()
    ;({ browser, page } = await attach())
    console.log('app launched, userData=' + userData)

    // Сессия проекта piwright + первый ход
    const row = page.locator('.project-row', { hasText: 'piwright' }).first()
    await row.locator('button.icon', { hasText: '+' }).last().click()
    await page.waitForSelector('.session-row.current', { timeout: 90000 })
    const hostId = await page.evaluate(async () => (await window.piwright.listSessions()).active[0]?.hostId ?? null)
    if (hostId === null) throw new Error('no active host after session create')
    console.log('setModel:', JSON.stringify(await page.evaluate(async ({ hostId, model }) => await window.piwright.setModel(hostId, model), { hostId, model: MODEL })))
    await sendPrompt(page, 'Reply with exactly one word: pong')
    await page.waitForSelector('.assistant-message', { timeout: 180000 })
    check('first turn completed', true)

    // Вкладка сессии сохранена в настройки (main пишет openSessionTabs)
    const tabs = settingsJson().openSessionTabs
    check('openSessionTabs persisted', tabs.length === 1 && typeof tabs[0].sessionFile === 'string', JSON.stringify(tabs.map((t) => t.sessionFile)))
    sessionFile = tabs[0].sessionFile
    const baseline = assistantCount(sessionFile)
    check('session jsonl has assistant message', baseline > 0, `baseline=${baseline}`)

    // Второй ход и graceful quit посреди него
    await sendPrompt(page, 'Count from 1 to 25, one number per line, no extra text.')
    await sleep(4000)
    const daemonPid = daemonPidFromLog()
    check('daemon pid in daemon.log', daemonPid !== null && processAlive(daemonPid), `pid=${daemonPid}`)
    execFileSync('taskkill', ['/PID', String(proc.pid)], { stdio: 'ignore', timeout: 15000 })
    const exitDeadline = Date.now() + 20000
    while (processAlive(proc.pid) && Date.now() < exitDeadline) await sleep(500)
    check('app exited gracefully', !processAlive(proc.pid))

    // Демон и ребёнок пережили закрытие приложения
    check('daemon survived app quit', daemonPid !== null && processAlive(daemonPid), `pid=${daemonPid}`)
    const pipeName = `piwright-daemon-${createHash('md5').update(userData).digest('hex')}`
    check('daemon pipe reachable after quit', pipeReachable(pipeName))

    // Агент дописывает ход в JSONL при закрытом приложении
    const grew = await waitForAssistantGrowth(sessionFile, baseline, 240000)
    check('session jsonl grew while app was closed', grew, `baseline=${baseline} now=${assistantCount(sessionFile)}`)

    // Перезапуск: вкладка восстановлена, транскрипт полный, статус корректный
    await browser.close()
    proc = await launchApp(join(tmpdir(), 'piwright-lifecycle-app2.log'))
    ;({ browser, page } = await attach())
    await page.waitForSelector('.session-row', { timeout: 90000 })
    check('session tab restored', true)
    const rowTexts = await page.locator('.session-row .session-title').allTextContents()
    check('restored row visible in panel', rowTexts.length > 0, JSON.stringify(rowTexts))

    // Транскрипт догнан реплеем: оба промпта и ответ pong
    await page.waitForSelector('.user-message', { timeout: 60000 })
    await page.waitForFunction(() => document.querySelectorAll('.user-message').length >= 2, { timeout: 60000 })
    const userCount = await page.locator('.user-message').count()
    check('both prompts in transcript', userCount >= 2, `user messages=${userCount}`)
    await page.waitForFunction(() => {
      const texts = [...document.querySelectorAll('.assistant-message')].map((e) => e.textContent ?? '')
      return texts.some((t) => t.includes('pong'))
    }, { timeout: 60000 })
    check('assistant reply pong in transcript', true)

    // Статус восстановленной сессии: не застряла в starting/streaming
    await page.waitForFunction(() => {
      const state = document.querySelector('.header .state')?.textContent ?? ''
      return state === 'ready' || state === 'idle'
    }, { timeout: 120000 })
    const stateText = await page.locator('.header .state').first().textContent()
    check('restored session status correct', stateText === 'ready' || stateText === 'idle', stateText ?? '')

    check('openSessionTabs still persisted after restart', settingsJson().openSessionTabs.length === 1)

    console.log('SMOKE OK')
  } catch (err) {
    console.error('SMOKE FAIL:', err.message)
    results.push({ name: 'smoke', ok: false })
  } finally {
    // Уборка: демон смоука — по PID из его userData, приложение — по PID процесса.
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
      rmSync(userData, { recursive: true, force: true })
    } catch { /* best effort */ }
    process.exit(results.every((r) => r.ok) ? 0 : 1)
  }
})()
