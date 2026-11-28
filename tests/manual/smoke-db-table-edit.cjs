/* UI smoke: DB table editing (add/delete rows, inline cell edit, pending buffer,
 * SQL preview, submit in one transaction). Needs real PostgreSQL:
 *   docker run --rm -d --name piwright-smoke-pg-edit -p 127.0.0.1:5498:5432 \
 *     -e POSTGRES_PASSWORD=smokepass -e POSTGRES_DB=smokedb postgres:16-alpine
 *   + table public.users(id serial pk, name, email, age) with rows alice/bob.
 * Run: node tests/manual/smoke-db-table-edit.cjs */
const { spawn } = require('node:child_process')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const http = require('node:http')
const { chromium } = require('playwright-core')

const REPO = join(__dirname, '..', '..')
const PORT = process.env.SMOKE_PORT ? Number(process.env.SMOKE_PORT) : 9228
const CDP = `http://localhost:${PORT}`
const userData = mkdtempSync(join(tmpdir(), 'piwright-table-edit-smoke-'))

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
  const { execSync } = require('node:child_process')
  // Чистое состояние таблицы независимо от предыдущих прогонов.
  execSync('docker exec piwright-smoke-pg-edit psql -U postgres -d smokedb -c "TRUNCATE public.users RESTART IDENTITY; INSERT INTO public.users (name, email, age) VALUES (\'alice\',\'a@x.io\',30),(\'bob\',\'b@x.io\',NULL);"')
  const proc = await launchApp()
  let browser
  try {
    browser = await chromium.connectOverCDP(CDP)
    const page = browser.contexts().flatMap((c) => c.pages()).find((p) => !p.url().startsWith('devtools://'))
    if (!page) throw new Error('no app page')
    await page.waitForSelector('.sessions-panel', { timeout: 60000 })

    // Seed one smoke project.
    await page.evaluate(async () => {
      const s = await window.piwright.getSettings()
      const first = { kind: 'native', dir: 'C:\\smoke-db-table-edit' }
      const key = `${first.kind}\u0000${first.dir}`
      await window.piwright.setSettings({ ...s, projects: [first, ...s.projects], projectDbConnections: {}, lastProjectKey: key })
    })
    await page.reload()
    await page.waitForSelector('.sessions-panel', { timeout: 30000 })
    await page.waitForTimeout(500)

    // Add connection to the smoke postgres.
    await page.click('[data-testid="db-toggle"]')
    await page.waitForSelector('.db-panel', { timeout: 5000 })
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.db-panel .git-head button')].find(
        (b) => b.title === 'Add connection' || b.title === 'Добавить подключение'
      )
      btn?.click()
    })
    await page.waitForSelector('.db-settings-tab .ssh-edit', { timeout: 5000 })
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
    await setInput(['Name', 'Имя'], 'Edit PG')
    await setInput(['Host', 'Хост'], '127.0.0.1')
    await setInput(['Port', 'Порт'], '5498')
    await setInput(['Database', 'База данных'], 'smokedb')
    await setInput(['User', 'Пользователь'], 'postgres')
    await setInput(['Password', 'Пароль'], 'smokepass')
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.ssh-edit-actions button')].find(
        (b) => b.textContent?.trim() === 'Save connection' || b.textContent?.trim() === 'Сохранить подключение'
      )
      btn?.click()
    })
    await page.waitForSelector('.db-settings-tab .ssh-test-result.ok', { timeout: 10000 })
    check('connection saved', true)

    // Expand tree: connection → public → users.
    const treeClick = async (selector, text) => {
      return await page.evaluate(({ selector, text }) => {
        const el = [...document.querySelectorAll(selector)].find((n) => n.textContent?.trim() === text)
        el?.click()
        return el !== undefined
      }, { selector, text })
    }
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.db-panel .git-head button')].find(
        (b) => b.title === 'Refresh' || b.title === 'Обновить'
      )
      btn?.click()
    })
    await page.waitForTimeout(600)
    check('expand connection', await treeClick('.db-tree-connection .db-tree-name', 'Edit PG'))
    await page.waitForSelector('.db-tree-schema', { timeout: 10000 })
    check('expand schema', await treeClick('.db-tree-schema .db-tree-name', 'public'))
    await page.waitForSelector('.db-tree-table', { timeout: 10000 })
    check('open table tab', await treeClick('.db-tree-table span', 'users'))
    await page.waitForSelector('.db-table-tab .db-grid tbody tr', { timeout: 10000 })

    const gridTexts = () => page.evaluate(() => [...document.querySelectorAll('.db-table-tab .db-grid tbody td')].map((n) => n.textContent?.trim() ?? ''))
    let texts = await gridTexts()
    check('grid shows alice and bob', texts.includes('alice') && texts.includes('bob'), texts.join('|'))
    check('NULL cell muted', await page.evaluate(() => document.querySelector('.db-table-tab .db-grid td.null')?.textContent?.trim() === 'NULL'))

    const cell = (row, col) => page.evaluate(({ row, col }) => {
      const tr = document.querySelectorAll('.db-table-tab .db-grid tbody tr')[row]
      return tr?.querySelectorAll('td')[col] ?? null
    }, { row, col })
    // Клик по td вне вьюпорта смоук-окна не работает — дергаем через evaluate.
    const clickCell = async (row, col) => {
      await page.evaluate(({ row, col }) => {
        const tr = document.querySelectorAll('.db-table-tab .db-grid tbody tr')[row]
        tr?.querySelectorAll('td')[col]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      }, { row, col })
      await page.waitForSelector('.db-table-tab .db-cell-input', { timeout: 3000 })
    }
    const typeAndCommit = async (value) => {
      await page.keyboard.type(value)
      await page.keyboard.press('Enter')
      await page.waitForTimeout(200)
    }
    const contextClick = async (row, col) => {
      await page.evaluate(({ row, col }) => {
        const tr = document.querySelectorAll('.db-table-tab .db-grid tbody tr')[row]
        tr?.querySelectorAll('td')[col]?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
      }, { row, col })
      await page.waitForSelector('.db-table-tab .tab-menu', { timeout: 3000 })
    }
    const menuItem = async (texts) => {
      const list = Array.isArray(texts) ? texts : [texts]
      await page.evaluate((texts) => {
        const btn = [...document.querySelectorAll('.db-table-tab .tab-menu .tab-menu-item')].find((b) =>
          texts.some((x) => b.textContent?.trim() === x)
        )
        btn?.click()
      }, list)
      await page.waitForTimeout(200)
    }
    const submitCount = () => page.evaluate(() => document.querySelector('.db-table-tab .db-submit-btn')?.textContent?.trim() ?? '')

    // 1. Inline cell edit → pending buffer, green arrow with count.
    await clickCell(0, 1)
    await typeAndCommit('alice2')
    check('submit button appears with count 1', (await submitCount()).includes('1'), await submitCount())
    check('pending cell highlighted', await page.evaluate(() => document.querySelector('.db-table-tab td.db-cell-pending') !== null))
    texts = await gridTexts()
    check('grid shows pending value', texts.includes('alice2') && !texts.includes('alicealice2'), texts.join('|'))

    // 2. Revert clears the buffer.
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.db-table-tab .db-table-toolbar button')].find((b) => b.title === 'Revert pending changes' || b.title === 'Отменить правки')
      btn?.click()
    })
    await page.waitForTimeout(200)
    check('revert clears buffer', (await submitCount()) === '')
    texts = await gridTexts()
    check('grid back to original', texts.includes('alice') && !texts.includes('alice2'), texts.join('|'))

    // 3. Re-edit alice name + Set NULL via context menu on alice email (col 2, non-null) — same row change.
    await clickCell(0, 1)
    await typeAndCommit('alice2')
    await contextClick(0, 2)
    await menuItem(['Set NULL', 'Установить NULL'])
    check('changes merged per row', (await submitCount()).includes('1'))

    // 4. Delete bob row via context menu.
    await contextClick(1, 1)
    await menuItem(['Delete row', 'Удалить строку'])
    check('delete adds to buffer', (await submitCount()).includes('2'), await submitCount())
    check('row struck through', await page.evaluate(() => document.querySelector('.db-table-tab tr.db-row-deleted') !== null))

    // 5. Add row and fill name.
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.db-table-tab .db-table-toolbar button')].find((b) => b.title === 'Add row' || b.title === 'Добавить строку')
      btn?.click()
    })
    await page.waitForSelector('.db-table-tab tr.db-row-insert', { timeout: 3000 })
    check('insert row rendered', true)
    await clickCell(2, 1)
    await typeAndCommit('carol')
    check('insert adds to buffer', (await submitCount()).includes('3'))

    // 6. Preview shows generated SQL; Execute applies in one transaction.
    await page.evaluate(() => document.querySelector('.db-table-tab .db-submit-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await page.waitForSelector('.db-preview-overlay', { timeout: 5000 })
    const previewSql = await page.evaluate(() => [...document.querySelectorAll('.db-preview-statement')].map((n) => n.textContent?.trim() ?? '').join('\n'))
    check('preview has UPDATE', previewSql.includes('UPDATE "public"."users" SET'), previewSql)
    check('preview sets email NULL', previewSql.includes('"email" = NULL'), previewSql)
    check('preview has DELETE by pk', previewSql.includes('DELETE FROM "public"."users" WHERE "id"'), previewSql)
    check('preview has INSERT', previewSql.includes('INSERT INTO "public"."users"'), previewSql)
    await page.evaluate(() => document.querySelector('.db-preview-run')?.click())
    await page.waitForFunction(() => document.querySelector('.db-preview-overlay') === null, { timeout: 10000 })
    await page.waitForFunction(() => {
      const t = [...document.querySelectorAll('.db-table-tab .db-grid tbody td')].map((n) => n.textContent?.trim() ?? '')
      return t.includes('alice2') && t.includes('carol') && !t.includes('bob')
    }, { timeout: 10000 })
    check('grid reloaded after submit', true)
    check('buffer cleared after submit', (await submitCount()) === '')

    // 7. DB state: alice2 + carol, bob gone.
    const dbRows = execSync('docker exec piwright-smoke-pg-edit psql -U postgres -d smokedb -t -A -c "SELECT name FROM public.users ORDER BY id"').toString().trim()
    check('db has alice2 and carol, bob deleted', dbRows === 'alice2\ncarol', JSON.stringify(dbRows))

    // 8. Preview off (global flag): green arrow applies immediately.
    await page.evaluate(async () => {
      const s = await window.piwright.getSettings()
      await window.piwright.setSettings({ ...s, dbSqlPreview: false })
    })
    await page.reload()
    await page.waitForSelector('.sessions-panel', { timeout: 30000 })
    await page.waitForTimeout(500)
    const flag = await page.evaluate(async () => (await window.piwright.getSettings()).dbSqlPreview)
    check('dbSqlPreview flag persisted false', flag === false, String(flag))
    await page.evaluate(() => {
      if (document.querySelector('.db-panel') === null) {
        document.querySelector('[data-testid="db-toggle"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      }
    })
    await page.waitForSelector('.db-panel', { timeout: 5000 })
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.db-tree-connection')].find((n) => n.querySelector('.db-tree-name')?.textContent?.trim() === 'Edit PG')
      const chevron = row?.querySelector('.db-tree-chevron')?.textContent?.trim()
      if (chevron === '▸') row?.querySelector('.db-tree-name')?.click()
    })
    await page.waitForSelector('.db-tree-schema', { timeout: 10000 })
    await treeClick('.db-tree-schema .db-tree-name', 'public')
    await page.waitForSelector('.db-tree-table', { timeout: 10000 })
    await treeClick('.db-tree-table span', 'users')
    await page.waitForSelector('.db-table-tab .db-grid tbody tr', { timeout: 10000 })
    await clickCell(0, 1)
    await typeAndCommit('alice3')
    await page.evaluate(() => document.querySelector('.db-table-tab .db-submit-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await page.waitForFunction(() => {
      const t = [...document.querySelectorAll('.db-table-tab .db-grid tbody td')].map((n) => n.textContent?.trim() ?? '')
      return t.includes('alice3')
    }, { timeout: 10000 })
    check('no preview overlay when flag off', await page.evaluate(() => document.querySelector('.db-preview-overlay') === null))
    const dbRows2 = execSync('docker exec piwright-smoke-pg-edit psql -U postgres -d smokedb -t -A -c "SELECT name FROM public.users ORDER BY id"').toString().trim()
    check('direct submit applied alice3', dbRows2.includes('alice3'), JSON.stringify(dbRows2))

    await page.screenshot({ path: 'tests/manual/db-table-edit-smoke.png' })
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
