/* Smoke: daemon core. Attach over CDP, create a session in the piwright project, send a short
 * prompt, then verify the pi child was spawned through the daemon: daemon.log + token in
 * userData, a live daemon process (ELECTRON_RUN_AS_NODE), the named pipe, and a working turn. */
const { chromium } = require('playwright-core')
const { execSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

const USER_DATA = process.env.PIWRIGHT_SMOKE_USERDATA || join(process.env.TEMP, 'piwright-smoke-userdata')

function log(label, value) {
  console.log(`${label}: ${value}`)
}

function daemonProcesses() {
  const out = execSync(
    'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'electron.exe\'\\" | Where-Object { $_.CommandLine -like \'*daemon*index.js*\' } | Select-Object -ExpandProperty ProcessId"',
    { encoding: 'utf8' }
  )
  return out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
}

function pipeReachable(pipeName) {
  const script =
    "try { $p = New-Object System.IO.Pipes.NamedPipeClientStream('.', '" +
    pipeName +
    "', [System.IO.Pipes.PipeDirection]::InOut); $p.Connect(2000); 'connected' } catch { 'missing' }"
  return execSync(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).includes('connected')
}

async function main() {
  const browser = await chromium.connectOverCDP(process.env.SMOKE_CDP || 'http://localhost:9223')
  const context = browser.contexts()[0]
  const page = context.pages()[0]
  await page.waitForSelector('.project-row', { timeout: 60000 })

  // Новая сессия проекта piwright: «+» в строке проекта (кнопка с текстом '+')
  const row = page.locator('.project-row', { hasText: 'piwright' }).first()
  await row.locator('button.icon', { hasText: '+' }).last().click()
  await page.waitForSelector('.session-row.current', { timeout: 90000 })
  log('session created', true)

  const input = page.locator('.composer textarea:not(.loop-exit)').first()
  await input.waitFor({ timeout: 90000 })
  await input.fill('Reply with exactly one word: pong')
  await input.press('Control+Enter')
  log('prompt sent', true)

  // Ответ агента — ход прошёл целиком через демона
  await page.waitForSelector('.assistant-message', { timeout: 180000 })
  log('assistant replied', true)

  // Артефакты демона в userData
  const tokenPath = join(USER_DATA, 'daemon-token')
  const logPath = join(USER_DATA, 'daemon.log')
  log('daemon-token exists', existsSync(tokenPath))
  log('daemon.log exists', existsSync(logPath))
  if (!existsSync(logPath) || !existsSync(tokenPath)) throw new Error('daemon artifacts missing in userData')
  const daemonLog = readFileSync(logPath, 'utf8')
  log('daemon spawned a child', daemonLog.includes('spawned'))
  log('daemon saw child exit', daemonLog.includes('exited'))
  if (!daemonLog.includes('spawned')) throw new Error(`daemon.log has no spawn record:\n${daemonLog}`)

  // Живой процесс демона (electron в режиме Node) и канал
  const daemons = daemonProcesses()
  log('daemon processes', JSON.stringify(daemons))
  if (daemons.length === 0) throw new Error('no daemon process found')
  const pipeName = `piwright-daemon-${createHash('md5').update(USER_DATA).digest('hex')}`
  log(`pipe ${pipeName}`, pipeReachable(pipeName))
  if (!pipeReachable(pipeName)) throw new Error('daemon pipe not reachable')

  await browser.close()
  console.log('SMOKE OK')
}

main().catch((err) => {
  console.error('SMOKE FAIL:', err.message)
  process.exit(1)
})
