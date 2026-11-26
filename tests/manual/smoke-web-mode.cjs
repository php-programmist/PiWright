/* Smoke: веб-режим 3/4 — замены нативных сервисов в браузере против headless-сервера (2/4).
 * 1) Приложение грузится в браузере по WS-RPC (без preload): __piwrightWeb, окно проектов.
 * 2) Выбор папки проекта обзором по RPC (fs:list-dir + LocalDirDialog) → проект добавлен.
 * 3) Канбан-тема: экспорт строкой (kanban:theme-export-data) → браузерный download.
 * 4) Звук: sounds:upload → файл в userData/sounds; вложение: attachments:put → ok.
 * 5) Ссылки: shellOpenExternal в вебе = window.open (ok без нативного shell).
 * 6) Reveal-кнопки: видны на localhost, скрыты с LAN-имени хоста.
 * 7) Обновления: баннер/попап обновлений в веб-режиме отсутствуют.
 * Запуск: npm run build && node tests/manual/smoke-web-mode.cjs */
const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { chromium } = require('playwright-core')

const PORT = Number(process.env.SMOKE_PORT || 7793)
const PIN = '345345'

const log = (...a) => console.log(...a)
const results = []
const check = (name, cond) => {
  if (!cond) throw new Error('CHECK FAILED: ' + name)
  results.push(name)
  log('PASS:', name)
}

function lanAddress() {
  const ifaces = os.networkInterfaces()
  for (const list of Object.values(ifaces)) {
    for (const addr of list ?? []) {
      if (addr.family === 'IPv4' && addr.internal === false) return addr.address
    }
  }
  return null
}

async function main() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'piwright-webmode-smoke-'))
  fs.writeFileSync(
    path.join(userData, 'settings.json'),
    JSON.stringify({ language: 'en', notifications: { remote: { staticPin: PIN } } }),
    'utf8'
  )
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'piwright-webmode-proj-'))
  fs.mkdirSync(path.join(projectRoot, 'a-sub'))

  const server = spawn(process.execPath, [path.join(__dirname, '..', '..', 'out', 'headless', 'index.js'),
    '--port', String(PORT), '--user-data', userData, '--host', '0.0.0.0'], { stdio: ['ignore', 'pipe', 'pipe'] })
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 30000)
    server.stdout.on('data', (chunk) => {
      const line = String(chunk)
      log('SRV:', line.trim())
      const match = line.match(/http:\/\/[^:]+:(\d+)\//)
      if (match) {
        clearTimeout(timer)
        resolve(`http://localhost:${match[1]}/`)
      }
    })
    server.stderr.on('data', (chunk) => log('SRV-ERR:', String(chunk).trim()))
  })
  log('PIN:', PIN)

  let browser
  try {
    browser = await chromium.launch({ headless: true })
  } catch {
    // Бинарники playwright не установлены — системный Edge
    browser = await chromium.launch({ headless: true, channel: 'msedge' })
  }
  try {
    const page = await browser.newPage()
    page.on('pageerror', (e) => log('PAGE ERR:', String(e).slice(0, 300)))

    // 1. Логин по PIN → приложение в браузере
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('input[name="pin"]', { timeout: 15000 })
    await page.fill('input[name="pin"]', PIN)
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.press('input[name="pin"]', 'Enter')])
    await page.waitForSelector('button[title="Add project"]', { timeout: 30000 })
    const webFlag = await page.evaluate(() => window.__piwrightWeb === true && typeof window.piwright === 'object')
    check('app loads in browser over WS (no preload)', webFlag)

    // 7. Обновления: попап обновления не показывается (updater off в веб-режиме)
    await page.waitForTimeout(1500)
    check('no update popup in web mode', (await page.locator('.update-popup').count()) === 0)

    // 2. Выбор папки проекта обзором по RPC
    await page.click('button[title="Add project"]')
    await page.waitForSelector('.add-project', { timeout: 5000 })
    await page.click('.add-project button:has-text("Win")')
    await page.waitForSelector('.ssh-dialog', { timeout: 5000 })
    const dialogTitle = await page.locator('.ssh-dialog-head span').first().innerText()
    check('dir browser dialog opened', dialogTitle.includes('Choose project folder'))
    // Ждём устоявшегося рендера (начальный список home): fill во время перерисовки
    // контролируемого input'а даёт конкатенацию вместо замены.
    await page.waitForFunction(() => {
      const dialog = document.querySelector('.ssh-dialog')
      return dialog !== null && dialog.querySelectorAll('.ssh-dialog-entry').length > 0 &&
        dialog.querySelector('.panel-hint') === null
    }, undefined, { timeout: 15000 })
    await page.waitForTimeout(400)
    await page.fill('.ssh-dialog-path input', projectRoot)
    await page.waitForFunction(() => document.body.innerText.includes('a-sub'), undefined, { timeout: 10000 })
    const entries = await page.locator('.ssh-dialog-entry').allInnerTexts()
    check('server dirs listed', entries.some((t) => t.includes('a-sub')))
    await page.click('.ssh-dialog-actions button.primary')
    await page.waitForSelector('.project-row', { timeout: 15000 })
    const rowText = await page.locator('.project-row').first().innerText()
    check('project added via dir browser', rowText.includes(path.basename(projectRoot)))

    // 6a. Reveal на localhost: кнопка «Show in folder» в меню проекта видна
    await page.click('button[title="Project menu"]')
    await page.waitForSelector('.project-menu-item', { timeout: 5000 })
    const menuTexts = await page.locator('.project-menu-item').allInnerTexts()
    check('reveal visible on localhost', menuTexts.some((t) => t.includes('Show in folder')))
    await page.keyboard.press('Escape')

    // 3. Экспорт темы строкой → браузерный download
    const downloadPromise = page.waitForEvent('download', { timeout: 15000 })
    const exportResult = await page.evaluate(() => window.piwright.kanbanThemeExport('slate'))
    check('theme export via data channel', exportResult.ok === true && exportResult.path.endsWith('.json'))
    const download = await downloadPromise
    check('browser download fired', download.suggestedFilename() === 'slate.json')

    // 4. Звук и вложение — upload-каналы (base64 готовится в node, в браузере Buffer нет)
    const wavBase64 = Buffer.from('RIFF0000WAVEfmt ', 'utf8').toString('base64')
    const soundResult = await page.evaluate(async (b64) => window.piwright.soundsUpload('мой тон.wav', b64), wavBase64)
    check('sound uploaded to userData/sounds', soundResult.ok === true && soundResult.path.includes('sounds'))
    const attachResult = await page.evaluate(async ([dir, b64]) => {
      const settings = await window.piwright.getSettings()
      const project = settings.projects.find((p) => p.dir === dir)
      if (project === undefined) return { ok: false, error: 'project not found' }
      return window.piwright.putAttachment(project, 'note.txt', b64)
    }, [projectRoot, Buffer.from('hello', 'utf8').toString('base64')])
    check('attachment put over WS', attachResult.ok === true)

    // 5. Ссылки: веб-оверрайд открывает window.open, не нативный shell
    const externalResult = await page.evaluate(() => window.piwright.shellOpenExternal('https://example.com/'))
    check('open external via window.open', externalResult.ok === true)
    const badResult = await page.evaluate(() => window.piwright.shellOpenExternal('file:///etc/passwd'))
    check('open external rejects non-http', badResult.ok === false)

    // 6b. Reveal с LAN-имени хоста скрыт
    const lan = lanAddress()
    if (lan !== null) {
      const page2 = await browser.newPage()
      await page2.goto(`http://${lan}:${new URL(url).port}/`, { waitUntil: 'domcontentloaded' })
      await page2.waitForSelector('input[name="pin"]', { timeout: 15000 })
      await page2.fill('input[name="pin"]', PIN)
      await Promise.all([page2.waitForNavigation({ waitUntil: 'domcontentloaded' }), page2.press('input[name="pin"]', 'Enter')])
      await page2.waitForSelector('button[title="Add project"]', { timeout: 30000 })
      await page2.click('button[title="Settings"]')
      await page2.waitForSelector('.settings-head', { timeout: 10000 })
      await page2.waitForTimeout(500)
      check('reveal hidden from LAN host', (await page2.locator('.settings-head button:has-text("Open configuration file")').count()) === 0)
      // На localhost та же кнопка видна
      await page.click('button[title="Settings"]')
      await page.waitForSelector('.settings-head', { timeout: 10000 })
      check('reveal visible on localhost (settings)', (await page.locator('.settings-head button:has-text("Open configuration file")').count()) === 1)
      await page2.close()
    } else {
      log('SKIP: no LAN address, reveal-hidden check skipped')
    }

    log(`SMOKE OK: ${results.length} checks passed`)
  } finally {
    await browser.close()
    server.kill('SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 1500))
    if (!server.killed) server.kill('SIGKILL')
    fs.rmSync(userData, { recursive: true, force: true })
    fs.rmSync(projectRoot, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error('SMOKE FAILED:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
