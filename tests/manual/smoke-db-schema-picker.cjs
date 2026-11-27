/* UI smoke DB schema picker + tables timeout fix. Needs real PostgreSQL:
 *   docker run --rm -d --name piwright-smoke-pg -p 127.0.0.1:5499:5432 -e POSTGRES_PASSWORD=smokepass -e POSTGRES_DB=smokedb postgres:16-alpine
 *   (schemas analytics/shop, tables public.users, shop.items)
 * and a disposable sshd container for the tunnel leg (password smoke/smokepass on 127.0.0.1:5500,
 * db target host piwright-smoke-pg:5432 — docker bridge DNS).
 * Verifies: "Select schemas" button after save, checkbox picker with all checked, unchecking hides
 * schemas in the panel tree, unchecking all shows a warning and persists "none", single selected
 * schema expands straight to tables, and a tunnel connection still lists tables after >10s idle
 * (regression: pool idle timeout used to close the shared ssh channel → "timeout exceeded when
 * trying to connect").
 * Run: node tests/manual/smoke-db-schema-picker.cjs */
const { spawn } = require('node:child_process')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const http = require('node:http')
const { chromium } = require('playwright-core')

const REPO = join(__dirname, '..', '..')
const PORT = process.env.SMOKE_PORT ? Number(process.env.SMOKE_PORT) : 9227
const CDP = `http://localhost:${PORT}`
const userData = mkdtempSync(join(tmpdir(), 'piwright-picker-smoke-'))

let pass = 0
let fail = 0
function check(name, cond, detail = '') {
  if (cond) {
    pass += 1
    console.log(`PASS ${name}`)
  } else {
    fail += 1
    console.log(`FAIL ${name} ${detail}`)
  }
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

async function main() {
  const proc = await launchApp()
  let browser
  try {
    browser = await chromium.connectOverCDP(CDP)
    const page = browser.contexts().flatMap((c) => c.pages()).find((p) => !p.url().startsWith('devtools://'))
    if (!page) throw new Error('no app page')
    await page.waitForSelector('.sessions-panel', { timeout: 60000 })

    // 0. Seed one smoke project, no DB connections.
    const key = await page.evaluate(async () => {
      const s = await window.piwright.getSettings()
      const norm = (d) => d.replace(/\\/g, '/').replace(/\/+$/, '')
      const first = { kind: 'native', dir: 'C:\\smoke-db-picker' }
      const rest = s.projects.filter((p) => norm(p.dir) !== norm(first.dir))
      const key = `${first.kind}\u0000${norm(first.dir)}`
      await window.piwright.setSettings({ ...s, projects: [first, ...rest], projectDbConnections: {}, lastProjectKey: key })
      return key
    })
    await page.reload()
    await page.waitForSelector('.sessions-panel', { timeout: 30000 })
    await page.waitForTimeout(500)

    const openPanelAndAdd = async () => {
      const panelOpen = await page.evaluate(() => document.querySelector('.db-panel') !== null)
      if (!panelOpen) {
        await page.click('[data-testid="db-toggle"]')
        await page.waitForSelector('.db-panel', { timeout: 5000 })
      }
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.db-panel .git-head button')].find(
          (b) => b.title === 'Add connection' || b.title === 'Добавить подключение'
        )
        btn?.click()
      })
      await page.waitForSelector('.db-settings-tab .ssh-edit', { timeout: 5000 })
    }
    const setInput = async (labels, value, scope = '.ssh-edit') => {
      const ok = await page.evaluate(({ labels, value, scope }) => {
        const section = document.querySelector(scope)
        if (!section) return false
        const labelEl = [...section.querySelectorAll('label')].find((l) => labels.some((x) => l.textContent?.trim().startsWith(x)))
        const input = labelEl?.querySelector('input')
        if (!input) return false
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      }, { labels, value, scope })
      if (!ok) throw new Error(`input not found: ${labels.join('/')}`)
      await page.waitForTimeout(150)
    }
    const clickAction = async (texts) => {
      const list = Array.isArray(texts) ? texts : [texts]
      return await page.evaluate((texts) => {
        const btn = [...document.querySelectorAll('.ssh-edit-actions button')].find((b) =>
          texts.some((x) => b.textContent?.trim() === x)
        )
        btn?.click()
        return btn !== undefined
      }, list)
    }
    const refreshPanel = async () => {
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.db-panel .git-head button')].find(
          (b) => b.title === 'Refresh' || b.title === 'Обновить'
        )
        btn?.click()
      })
      await page.waitForTimeout(600)
    }
    const treeClick = async (selector, text) => {
      return await page.evaluate(({ selector, text }) => {
        const el = [...document.querySelectorAll(selector)].find((n) => n.textContent?.trim() === text)
        el?.click()
        return el !== undefined
      }, { selector, text })
    }
    /** Раскрыть узел дерева по тексту с учётом текущего состояния chevron (▸ закрыт, ▾ открыт). */
    const ensureExpanded = async (rowSelector, nameSelector, text) => {
      await page.evaluate(({ rowSelector, nameSelector, text }) => {
        const row = [...document.querySelectorAll(rowSelector)].find((n) => n.querySelector(nameSelector)?.textContent?.trim() === text)
        if (row === undefined) throw new Error(`tree row not found: ${text}`)
        const chevron = row.querySelector('.db-tree-chevron')?.textContent?.trim()
        if (chevron === '▸') row.querySelector(nameSelector)?.click()
      }, { rowSelector, nameSelector, text })
      await page.waitForTimeout(400)
    }
    const panelTexts = (selector) =>
      page.evaluate((selector) => [...document.querySelectorAll(selector)].map((n) => n.textContent?.trim() ?? ''), selector)

    await openPanelAndAdd()

    // 1. New connection form: no "Select schemas" button before the first save.
    const pickerBeforeSave = await clickAction(['Select schemas', 'Выбрать схемы'])
    check('no Select schemas button before save', pickerBeforeSave === false)

    // 2. Fill and save the direct connection.
    await setInput(['Name', 'Имя'], 'Direct PG')
    await setInput(['Host', 'Хост'], '127.0.0.1')
    await setInput(['Port', 'Порт'], '5499')
    await setInput(['Database', 'База данных'], 'smokedb')
    await setInput(['User', 'Пользователь'], 'postgres')
    await setInput(['Password', 'Пароль'], 'smokepass')
    await clickAction(['Save connection', 'Сохранить подключение'])
    await page.waitForSelector('.db-settings-tab .ssh-test-result.ok', { timeout: 5000 })
    check('connection saved', true)

    // 3. "Select schemas" button appears after save; click loads schemas, all checked.
    check('Select schemas button after save', await clickAction(['Select schemas', 'Выбрать схемы']))
    await page.waitForSelector('.db-schema-picker label.settings-check', { timeout: 10000 })
    const pickerRows = await page.evaluate(() =>
      [...document.querySelectorAll('.db-schema-picker label.settings-check')].map((l) => ({
        name: l.textContent?.trim() ?? '',
        checked: l.querySelector('input')?.checked ?? false
      }))
    )
    const names = pickerRows.map((r) => r.name)
    check('picker lists all schemas checked', names.includes('analytics') && names.includes('public') && names.includes('shop') && pickerRows.every((r) => r.checked), JSON.stringify(pickerRows))

    const uncheck = async (schema) => {
      await page.evaluate((schema) => {
        const label = [...document.querySelectorAll('.db-schema-picker label.settings-check')].find((l) => l.textContent?.trim() === schema)
        label?.querySelector('input')?.click()
      }, schema)
      await page.waitForTimeout(400)
    }

    // 4. Uncheck analytics → persisted selection without it; panel tree hides it.
    await uncheck('analytics')
    const stored1 = await page.evaluate(async (key) => (await window.piwright.getSettings()).projectDbConnections[key]?.[0]?.selectedSchemas, key)
    check('uncheck one persists selection', Array.isArray(stored1) && stored1.includes('public') && stored1.includes('shop') && !stored1.includes('analytics'), JSON.stringify(stored1))
    await refreshPanel()
    await treeClick('.db-tree-connection .db-tree-name', 'Direct PG')
    await page.waitForSelector('.db-tree-schema', { timeout: 5000 })
    const visibleSchemas1 = await panelTexts('.db-tree-schema .db-tree-name')
    check('panel hides unchecked schema', visibleSchemas1.includes('public') && visibleSchemas1.includes('shop') && !visibleSchemas1.includes('analytics'), visibleSchemas1.join(','))
    // Свернуть для чистоты следующих шагов (ensureExpanded сам раскроет при необходимости).
    await treeClick('.db-tree-connection .db-tree-name', 'Direct PG')
    await page.waitForTimeout(300)

    // 5. Uncheck all → warning in the picker, empty selection persisted, panel shows the no-schemas hint.
    await uncheck('public')
    await uncheck('shop')
    const warning = await page.evaluate(() => document.querySelector('.db-schema-picker .ssh-test-result.err')?.textContent ?? '')
    check('warning when all unchecked', warning.includes('No schemas will be available') || warning.includes('Ни одна схема не будет доступна'), warning)
    const stored2 = await page.evaluate(async (key) => (await window.piwright.getSettings()).projectDbConnections[key]?.[0]?.selectedSchemas, key)
    check('empty selection persisted as []', Array.isArray(stored2) && stored2.length === 0, JSON.stringify(stored2))
    await refreshPanel()
    await ensureExpanded('.db-tree-connection', '.db-tree-name', 'Direct PG')
    await page.waitForSelector('.db-panel .db-tree-hint', { timeout: 5000 })
    const hintAll = await page.evaluate(() => [...document.querySelectorAll('.db-panel .db-tree-hint')].map((h) => h.textContent?.trim() ?? '').join('|'))
    check('panel shows no-schemas hint', hintAll.includes('no schemas') || hintAll.includes('нет схем'), hintAll)

    // 6. Re-check shop only → single selected schema: expanding the connection shows tables directly.
    await page.evaluate(() => {
      const label = [...document.querySelectorAll('.db-schema-picker label.settings-check')].find((l) => l.textContent?.trim() === 'shop')
      label?.querySelector('input')?.click()
    })
    await page.waitForTimeout(400)
    const stored3 = await page.evaluate(async (key) => (await window.piwright.getSettings()).projectDbConnections[key]?.[0]?.selectedSchemas, key)
    check('single schema persisted', Array.isArray(stored3) && stored3.length === 1 && stored3[0] === 'shop', JSON.stringify(stored3))
    await refreshPanel()
    await ensureExpanded('.db-tree-connection', '.db-tree-name', 'Direct PG')
    await page.waitForSelector('.db-tree-table', { timeout: 5000 })
    const tablesDirect = await panelTexts('.db-tree-table span')
    const schemaRowsDirect = await panelTexts('.db-tree-schema .db-tree-name')
    check('single schema expands to tables directly', tablesDirect.includes('items') && schemaRowsDirect.length === 0, JSON.stringify({ tablesDirect, schemaRowsDirect }))

    // 7. Tunnel connection: save, expand, wait >10s (old idle window), then list tables.
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.db-panel .git-head button')].find(
        (b) => b.title === 'Add connection' || b.title === 'Добавить подключение'
      )
      btn?.click()
    })
    await page.waitForSelector('.db-settings-tab .ssh-edit', { timeout: 5000 })
    await page.waitForTimeout(300)
    await setInput(['Name', 'Имя'], 'Tunneled PG')
    await setInput(['Host', 'Хост'], 'piwright-smoke-pg', '.ssh-edit .ssh-form-grid')
    await setInput(['Port', 'Порт'], '5432')
    await setInput(['Database', 'База данных'], 'smokedb')
    await setInput(['User', 'Пользователь'], 'postgres')
    await setInput(['Password', 'Пароль'], 'smokepass')
    await page.evaluate(() => {
      const label = [...document.querySelectorAll('.ssh-edit label.settings-check')].find((l) => l.textContent?.includes('SSH'))
      label?.querySelector('input[type=checkbox]')?.click()
    })
    await page.waitForTimeout(200)
    const sshScope = '.ssh-edit div.ssh-form-grid:nth-of-type(2)'
    await setInput(['Host', 'Хост'], '127.0.0.1', sshScope)
    await setInput(['Port', 'Порт'], '5500', sshScope)
    await setInput(['User', 'Пользователь'], 'smoke', sshScope)
    await setInput(['Password', 'Пароль'], 'smokepass', sshScope)
    await clickAction(['Save connection', 'Сохранить подключение'])
    await page.waitForSelector('.db-settings-tab .ssh-test-result.ok', { timeout: 15000 })
    check('tunnel connection saved', true)
    await refreshPanel()

    await treeClick('.db-tree-connection .db-tree-name', 'Tunneled PG')
    await page.waitForSelector('.db-tree-schema', { timeout: 15000 })
    const tunnelSchemas = await panelTexts('.db-tree-schema .db-tree-name')
    check('tunnel schemas loaded', tunnelSchemas.includes('public') && tunnelSchemas.includes('shop'), tunnelSchemas.join(','))
    await treeClick('.db-tree-connection .db-tree-name', 'Tunneled PG')
    await page.waitForTimeout(300)

    // Old bug: after 10s idle the pool closed the shared ssh channel; listing tables then
    // hung and failed with "timeout exceeded when trying to connect".
    await sleep(11000)
    await ensureExpanded('.db-tree-connection', '.db-tree-name', 'Tunneled PG')
    await page.waitForSelector('.db-tree-schema', { timeout: 15000 })
    await ensureExpanded('.db-tree-schema', '.db-tree-name', 'public')
    // 'users' живёт только в public туннельного подключения (Direct показывает только shop.items)
    await page.waitForFunction(() => [...document.querySelectorAll('.db-tree-table span')].some((s) => s.textContent === 'users'), { timeout: 15000 })
    const tunnelTables = await panelTexts('.db-tree-table span')
    const banner = await page.evaluate(() => document.querySelector('.db-panel .git-error span')?.textContent ?? '')
    check('tunnel tables after >10s idle (timeout regression)', tunnelTables.includes('users') && banner.length === 0, JSON.stringify({ tunnelTables, banner }))

    await page.screenshot({ path: 'tests/manual/db-schema-picker-smoke.png' })
    console.log(`\nSMOKE ${fail === 0 ? 'OK' : 'FAILED'}: ${pass} pass, ${fail} fail`)
    process.exitCode = fail === 0 ? 0 : 1
  } finally {
    await browser?.close().catch(() => {})
    proc.kill()
  }
}

main().catch((err) => {
  console.error('SMOKE ERROR:', err.message)
  process.exit(1)
})
