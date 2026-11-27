/* UI smoke DB table tab (DB 4/5): grid columns/rows from a real postgres (throwaway docker
 * container on :5545, seeded 250 rows), pagination 50/100/200, sort click asc/desc, per-column
 * filter (parameterized WHERE), NULL styling, clear filters.
 * Run: docker run smoke pg, npm run build, start smoke instance on 9223, then node tests/manual/smoke-db-table.cjs */
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
  id: 'db-table-smoke',
  name: 'Smoke Table PG',
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
  const evalText = async (selector) => {
    return await page.evaluate((s) => document.querySelector(s)?.textContent ?? '', selector)
  }
  const waitRowsInfo = async (substring, timeout = 10000) => {
    await page.waitForFunction(
      (sub) => document.querySelector('.db-table-toolbar')?.textContent?.includes(sub) === true,
      substring,
      { timeout }
    )
  }
  const waitFirstId = async (expected, timeout = 10000) => {
    await page.waitForFunction(
      (exp) => document.querySelector('.db-grid tbody tr td')?.textContent === exp,
      expected,
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

  // 1. Open DB panel, expand connection and public schema, open the items table.
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

  // 2. Grid renders: headers, 50 rows of 250, page 1 prev disabled.
  await page.waitForSelector('.db-grid tbody tr', { timeout: 10000 })
  const headText = await evalText('.db-grid thead tr:first-child')
  check('columns rendered', ['id', 'name', 'score', 'note'].every((c) => headText.includes(c)), headText)
  const rowCount = await page.evaluate(() => document.querySelectorAll('.db-grid tbody tr').length)
  check('page size 50 rows rendered', rowCount === 50, String(rowCount))
  await waitRowsInfo('rows 50 of 250')
  check('total count shown', true)
  const prevDisabled = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.db-table-toolbar button.icon')]
    return btns[0]?.disabled === true
  })
  check('prev disabled on first page', prevDisabled)

  // 3. NULL cells styled.
  const nullCells = await page.evaluate(() => document.querySelectorAll('.db-grid td.null').length)
  check('NULL cells styled', nullCells > 0, String(nullCells))

  // 4. Sort: click id header -> asc (first id 1), click again -> desc (first id 250).
  const firstId = () => page.evaluate(() => document.querySelector('.db-grid tbody tr td')?.textContent ?? '')
  await page.evaluate(() => document.querySelectorAll('.db-grid thead tr:first-child th')[0]?.click())
  await waitFirstId('1')
  check('sort asc first id 1', (await firstId()) === '1', await firstId())
  const ascIndicator = await page.evaluate(() => document.querySelectorAll('.db-grid thead tr:first-child th')[0]?.textContent ?? '')
  check('asc indicator', ascIndicator.includes('▲'), ascIndicator)
  await page.evaluate(() => document.querySelectorAll('.db-grid thead tr:first-child th')[0]?.click())
  await waitFirstId('250')
  check('sort desc first id 250', (await firstId()) === '250', await firstId())
  const descIndicator = await page.evaluate(() => document.querySelectorAll('.db-grid thead tr:first-child th')[0]?.textContent ?? '')
  check('desc indicator', descIndicator.includes('▼'), descIndicator)

  // 5. Filter by name = 'item 7' (Enter applies): one row.
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
  const filteredName = await page.evaluate(() => document.querySelectorAll('.db-grid tbody tr:first-child td')[1]?.textContent ?? '')
  check('filter applied single row', filteredName === 'item 7', filteredName)
  const clearVisible = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.db-table-toolbar button')].find((b) => b.textContent?.includes('Clear filters') || b.textContent?.includes('Сбросить фильтры'))
    return btn !== undefined
  })
  check('clear filters button visible', clearVisible)

  // 6. Clear filters -> back to 250.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.db-table-toolbar button')].find((b) => b.textContent?.includes('Clear filters') || b.textContent?.includes('Сбросить фильтры'))
    btn?.click()
  })
  await waitRowsInfo('rows 50 of 250')
  check('filters cleared back to 250', (await firstId()) === '250', await firstId())

  // 7. Pagination: next page -> offset 50, first id 200 (desc sort kept).
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.db-table-toolbar button.icon')]
    btns[btns.length - 1]?.click()
  })
  await waitRowsInfo('rows 100 of 250')
  check('next page offset shifted', (await firstId()) === '200', await firstId())

  // 8. Page size 200 -> 200 rows, next enabled (250 total), then last page 250 rows.
  await page.evaluate(() => {
    const select = document.querySelector('.db-table-size select')
    if (select) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
      setter.call(select, '200')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }
  })
  await waitRowsInfo('rows 200 of 250')
  const rows200 = await page.evaluate(() => document.querySelectorAll('.db-grid tbody tr').length)
  check('page size 200 rows', rows200 === 200, String(rows200))
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.db-table-toolbar button.icon')]
    btns[btns.length - 1]?.click()
  })
  await waitRowsInfo('rows 250 of 250')
  const nextDisabledLast = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.db-table-toolbar button.icon')]
    return btns[btns.length - 1]?.disabled === true
  })
  check('next disabled on last page', nextDisabledLast)

  // 9. Error banner: point the tab at a missing table via direct API error path is covered by
  // unit tests; here just verify no error banner is shown on the happy path.
  const errorShown = await page.evaluate(() => document.querySelector('.db-table-tab .git-error') !== null)
  check('no error banner on happy path', !errorShown)

  await page.screenshot({ path: 'tests/manual/db-table-smoke.png' })
  console.log(`\nSMOKE ${fail === 0 ? 'OK' : 'FAILED'}: ${pass} pass, ${fail} fail`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('SMOKE ERROR:', err.message)
  process.exit(1)
})
