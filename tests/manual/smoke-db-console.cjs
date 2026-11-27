/* UI smoke DB console tab (DB 5/5, final end-to-end): real postgres (throwaway docker
 * container on :5545, seeded 250 rows), full flow: connection -> schema -> table -> filter ->
 * console query. Console: Monaco SQL editor (typed via insertText), Ctrl+Enter run, SELECT grid,
 * rowsAffected for INSERT/DELETE, inline error keeps last result, history dropdown restores SQL,
 * console tab persists across reload (one per connection).
 * Run: docker run smoke pg, npm run build, start smoke instance on 9223, then node tests/manual/smoke-db-console.cjs */
const { chromium } = require('playwright-core')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'
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

const CONNECTION = {
  id: 'db-console-smoke',
  name: 'Smoke Console PG',
  kind: 'postgres',
  host: 'localhost',
  port: 5545,
  database: 'smoke',
  user: 'smoke',
  authType: 'password'
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP)
  const contexts = browser.contexts()
  const page = contexts[0]?.pages()[0]
  if (!page) throw new Error('no page over CDP')
  await page.waitForSelector('.sessions-panel', { timeout: 30000 })

  const clickTitle = async (titles) => {
    return await page.evaluate((titles) => {
      const btn = [...document.querySelectorAll('button')].find((b) => titles.some((t) => b.title === t))
      if (!btn) return false
      btn.click()
      return true
    }, titles)
  }
  const waitRowsInfo = async (substring, timeout = 10000) => {
    await page.waitForFunction(
      (sub) => document.querySelector('.db-table-toolbar')?.textContent?.includes(sub) === true,
      substring,
      { timeout }
    )
  }
  const consoleTabCount = async () => {
    return await page.evaluate(() => document.querySelectorAll('.tab.db-console').length)
  }
  const editorText = async () => {
    return await page.evaluate(() => document.querySelector('.db-console-editor .view-lines')?.textContent ?? '')
  }
  const setEditorSql = async (sql) => {
    await page.click('.db-console-editor-canvas')
    await page.keyboard.press('Control+A')
    await page.keyboard.insertText(sql)
    await page.waitForFunction(
      (expected) => document.querySelector('.db-console-editor .view-lines')?.textContent?.replace(/\s+/g, ' ').includes(expected) === true,
      sql.replace(/\s+/g, ' '),
      { timeout: 5000 }
    )
  }
  const pressRun = async () => {
    await page.click('.db-console-editor-canvas')
    await page.keyboard.press('Control+Enter')
  }
  const waitStatus = async (substring, timeout = 10000) => {
    await page.waitForFunction(
      (sub) => document.querySelector('.db-console-status')?.textContent?.includes(sub) === true,
      substring,
      { timeout }
    )
  }

  // 0. Clean slate: only the smoke connection, panels closed.
  const projectKey = await page.evaluate(async (connection) => {
    const s = await window.piwright.getSettings()
    const norm = (d) => d.replace(/\\/g, '/').replace(/\/+$/, '')
    const p = s.projects[0]
    if (p === undefined) return null
    const key = `${p.kind}\u0000${norm(p.dir)}`
    await window.piwright.setSettings({ ...s, projectDbConnections: {}, panels: { ...s.panels, git: { open: false }, files: { open: false }, kanban: { open: false }, db: { open: false } }, lastProjectKey: key })
    await window.piwright.dbConnectionDelete(key, connection.id).catch(() => {})
    return key
  }, CONNECTION)
  const saved = await page.evaluate(async ({ connection, projectKey }) => {
    return await window.piwright.dbConnectionSave(projectKey, connection, { password: 'smoke' })
  }, { connection: CONNECTION, projectKey })
  check('connection saved with secret', saved.ok === true && saved.connections.some((c) => c.id === CONNECTION.id), JSON.stringify(saved))
  await page.reload()
  await page.waitForSelector('.sessions-panel', { timeout: 30000 })
  await page.waitForTimeout(500)

  // 1. Full flow part 1: DB panel -> connection -> schema -> table -> filter.
  check('db toggle button exists', await clickTitle(['Databases', 'Базы данных']))
  await page.waitForSelector('[data-testid="db-panel"]', { timeout: 5000 })
  await page.evaluate(() => document.querySelector('.db-tree-connection')?.click())
  await page.waitForSelector('.db-tree-schema', { timeout: 10000 })
  await page.evaluate(() => document.querySelector('.db-tree-schema .db-tree-name')?.click())
  await page.waitForSelector('.db-tree-table', { timeout: 10000 })
  const clicked = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.db-tree-table')].find((r) => r.textContent?.includes('items'))
    if (!row) return false
    row.click()
    return true
  })
  check('items table clicked', clicked)
  await page.waitForSelector('.db-grid tbody tr', { timeout: 10000 })
  await waitRowsInfo('rows 50 of 250')
  check('table grid renders 50 of 250', true)
  await page.evaluate(() => {
    const input = document.querySelectorAll('.db-grid thead tr.db-grid-filters th input')[1]
    if (input) {
      input.focus()
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, 'item 7')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
  })
  await page.keyboard.press('Enter')
  await waitRowsInfo('rows 1 of 1')
  check('filter narrows to 1 row', true)

  // 2. Console tab opens from the connection node; second click reuses the same tab.
  const consoleOpened = await page.evaluate(() => {
    const node = document.querySelector('.db-tree-connection')
    const btn = node?.querySelector('button[title="Open console"], button[title="Открыть консоль"]')
    if (!btn) return false
    btn.click()
    return true
  })
  check('console button on connection node', consoleOpened)
  await page.waitForSelector('.db-console-tab', { timeout: 5000 })
  check('console tab appears', (await consoleTabCount()) === 1)
  const tabTitle = await page.evaluate(() => document.querySelector('.tab.db-console .tab-name')?.textContent ?? '')
  check('console tab titled with connection name', tabTitle === 'Smoke Console PG', tabTitle)
  await page.evaluate(() => {
    const node = document.querySelector('.db-tree-connection')
    node?.querySelector('button[title="Open console"], button[title="Открыть консоль"]')?.click()
  })
  check('console tab reused (one per connection)', (await consoleTabCount()) === 1)

  // 3. SELECT via Ctrl+Enter: grid with 5 rows, status shows rows + ms.
  await setEditorSql('SELECT id, name, score FROM items WHERE id <= 5 ORDER BY id')
  await pressRun()
  await page.waitForSelector('.db-console-results .db-grid tbody tr', { timeout: 10000 })
  const gridRows = await page.evaluate(() => document.querySelectorAll('.db-console-results .db-grid tbody tr').length)
  check('SELECT grid has 5 rows', gridRows === 5, String(gridRows))
  const firstCell = await page.evaluate(() => document.querySelector('.db-console-results .db-grid tbody tr td')?.textContent ?? '')
  check('SELECT grid first id 1', firstCell === '1', firstCell)
  await waitStatus('5 rows · ')
  check('SELECT status rows + ms', true)

  // 4. INSERT: rowsAffected path (results hint, status).
  await setEditorSql("INSERT INTO items (name, score) VALUES ('console-row', 9)")
  await pressRun()
  await waitStatus('rows affected')
  const insertHint = await page.evaluate(() => document.querySelector('.db-console-results .panel-hint')?.textContent ?? '')
  check('INSERT hint rows affected 1', insertHint.includes('1'), insertHint)
  const insertStatus = await page.evaluate(() => document.querySelector('.db-console-status')?.textContent ?? '')
  check('INSERT status OK · 1 rows affected · ms', /OK · 1 rows affected · \d+ ms/.test(insertStatus), insertStatus)

  // 5. DELETE the inserted row (also cleans the seed for reruns).
  await setEditorSql("DELETE FROM items WHERE name = 'console-row'")
  await pressRun()
  await waitStatus('rows affected')
  const deleteStatus = await page.evaluate(() => document.querySelector('.db-console-status')?.textContent ?? '')
  check('DELETE status rows affected', /OK · 1 rows affected · \d+ ms/.test(deleteStatus), deleteStatus)

  // 6. Error inline: previous result kept, banner dismissable, next success clears it.
  await setEditorSql('SELECT * FROM missing_table')
  await pressRun()
  await page.waitForSelector('.db-console-tab .git-error', { timeout: 10000 })
  const errText = await page.evaluate(() => document.querySelector('.db-console-tab .git-error')?.textContent ?? '')
  check('error banner shows driver error', errText.includes('missing_table'), errText)
  const hintAfterError = await page.evaluate(() => document.querySelector('.db-console-results .panel-hint')?.textContent ?? '')
  check('previous result kept after error', hintAfterError.includes('1'), hintAfterError)
  await setEditorSql('SELECT count(*) FROM items')
  await pressRun()
  await page.waitForSelector('.db-console-results .db-grid tbody tr', { timeout: 10000 })
  const bannerGone = await page.evaluate(() => document.querySelector('.db-console-tab .git-error') === null)
  check('success clears error banner', bannerGone)
  const countCell = await page.evaluate(() => document.querySelector('.db-console-results .db-grid tbody tr td')?.textContent ?? '')
  check('count(*) back to 250 after delete', countCell === '250', countCell)

  // 7. History dropdown: entries accumulated, picking one restores SQL in the editor.
  const historyCount = await page.evaluate(() => {
    const select = document.querySelector('.db-console-history')
    return select ? select.options.length : 0
  })
  check('history has 4 entries + placeholder', historyCount === 5, String(historyCount))
  await page.evaluate(() => {
    const select = document.querySelector('.db-console-history')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
    setter.call(select, select.options[1].value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  const restoredSql = await editorText()
  check('history pick restores SQL', restoredSql.includes('count(*)'), restoredSql.slice(0, 80))

  // 8. Console tab persists across reload; history is in-memory only.
  await page.reload()
  await page.waitForSelector('.sessions-panel', { timeout: 30000 })
  await page.waitForTimeout(500)
  check('console tab restored after reload', (await consoleTabCount()) === 1)
  await page.evaluate(() => document.querySelector('.tab.db-console')?.click())
  await page.waitForSelector('.db-console-tab', { timeout: 5000 })
  const hintAfterReload = await page.evaluate(() => document.querySelector('.db-console-results .panel-hint')?.textContent ?? '')
  check('results reset after reload', hintAfterReload.length > 0 && !hintAfterReload.includes('1'), hintAfterReload)
  const historyAfterReload = await page.evaluate(() => document.querySelector('.db-console-history')?.options.length ?? 0)
  check('history is in-memory (empty after reload)', historyAfterReload === 1, String(historyAfterReload))

  await page.screenshot({ path: 'tests/manual/db-console-smoke.png' })
  console.log(`\nSMOKE ${fail === 0 ? 'OK' : 'FAILED'}: ${pass} pass, ${fail} fail`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('SMOKE ERROR:', err.message)
  process.exit(1)
})
