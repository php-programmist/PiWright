/* UI smoke DB panel (DB 3/5): right-bar toggle, panel open/close + persist, exclusive with
 * git/files/kanban, lazy tree connection -> schemas -> tables against a real local postgres
 * (docker php-coding-benchmark-postgres-1 on :5436), table click opens stub data tab.
 * Run: npm run build, start smoke instance on 9223, then node tests/manual/smoke-db-panel.cjs */
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
  id: 'db-smoke',
  name: 'Smoke PG',
  kind: 'postgres',
  host: 'localhost',
  port: 5436,
  database: 'benchmark',
  user: 'benchmark',
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

  // 0. Clean slate: one smoke connection with real secrets, panels closed.
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
    return await window.piwright.dbConnectionSave(projectKey, connection, { password: 'benchmark' })
  }, { connection: CONNECTION, projectKey })
  check('connection saved with secret', saved.ok === true && saved.connections.some((c) => c.id === CONNECTION.id), JSON.stringify(saved))
  await page.reload()
  await page.waitForSelector('.sessions-panel', { timeout: 30000 })
  await page.waitForTimeout(500)

  // 1. Toggle button opens the panel.
  check('db toggle button exists', await clickTitle(['Databases', 'Базы данных']))
  await page.waitForSelector('[data-testid="db-panel"]', { timeout: 5000 })
  check('panel opens', true)

  // 2. Connection node renders; expand -> schemas load lazily.
  await page.waitForSelector('.db-tree-connection', { timeout: 5000 })
  const connText = await page.evaluate(() => document.querySelector('.db-tree-connection')?.textContent ?? '')
  check('connection node shows name and kind', connText.includes('Smoke PG') && connText.includes('PostgreSQL'), connText)
  await page.evaluate(() => document.querySelector('.db-tree-connection')?.click())
  await page.waitForSelector('.db-tree-schema', { timeout: 10000 })
  const schemaText = await page.evaluate(() => document.querySelector('.db-tree-schema .db-tree-name')?.textContent ?? '')
  check('schema public loaded lazily', schemaText === 'public', schemaText)

  // 3. Schema checkbox is checked (no explicit selection = all).
  const boxChecked = await page.evaluate(() => document.querySelector('.db-schema-check')?.checked ?? false)
  check('schema checkbox checked by default', boxChecked)

  // 4. Expand schema -> tables load lazily.
  await page.evaluate(() => document.querySelector('.db-tree-schema .db-tree-name')?.click())
  await page.waitForSelector('.db-tree-table', { timeout: 10000 })
  const tableCount = await page.evaluate(() => document.querySelectorAll('.db-tree-table').length)
  check('tables loaded lazily', tableCount > 0, String(tableCount))

  // 5. Table click opens central stub tab with schema.table title.
  await page.evaluate(() => document.querySelectorAll('.db-tree-table')[0]?.click())
  await page.waitForSelector('.db-table-tab', { timeout: 5000 })
  const tabTitle = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.tab-bar .tab, .tabs .tab')]
    return tabs.map((t) => t.textContent ?? '').join('|')
  })
  const stubHead = await page.evaluate(() => document.querySelector('.db-table-tab-head')?.textContent ?? '')
  check('stub tab opened with schema.table', stubHead.startsWith('public.'), `${stubHead} | ${tabTitle}`)
  const stubHint = await page.evaluate(() => document.querySelector('.db-table-tab .panel-hint')?.textContent ?? '')
  check('stub hint shown', stubHint.length > 0, stubHint)

  // 6. Panel open state persisted to settings.panels.db.
  const panelsState = await page.evaluate(async () => (await window.piwright.getSettings()).panels ?? {})
  check('panels.db.open persisted', panelsState.db?.open === true, JSON.stringify(panelsState))

  // 7. Reload -> panel restored from settings (hydrate).
  await page.reload()
  await page.waitForSelector('.sessions-panel', { timeout: 30000 })
  await page.waitForTimeout(600)
  check('panel restored after reload', (await page.$('[data-testid="db-panel"]')) !== null)

  // 8. Exclusivity: opening Git closes DB.
  check('git toggle clickable', await clickTitle(['Git']))
  await page.waitForTimeout(400)
  const gitOpenDbClosed = await page.evaluate(() => ({
    git: document.querySelector('.git-panel') !== null,
    db: document.querySelector('[data-testid="db-panel"]') !== null
  }))
  check('git open closes db', gitOpenDbClosed.git && !gitOpenDbClosed.db, JSON.stringify(gitOpenDbClosed))
  const panelsAfterGit = await page.evaluate(async () => (await window.piwright.getSettings()).panels ?? {})
  check('db closed persisted after git opened', panelsAfterGit.db?.open === false && panelsAfterGit.git?.open === true, JSON.stringify(panelsAfterGit))

  // 9. Cleanup: close git, delete smoke connection.
  await clickTitle(['Git'])
  await page.waitForTimeout(300)
  await page.evaluate(async ({ connection, projectKey }) => {
    await window.piwright.dbConnectionDelete(projectKey, connection.id)
    const s = await window.piwright.getSettings()
    await window.piwright.setSettings({ ...s, panels: { ...s.panels, git: { open: false }, db: { open: false } } })
  }, { connection: CONNECTION, projectKey })

  await page.screenshot({ path: 'tests/manual/db-panel-smoke.png' })
  console.log(`\nSMOKE ${fail === 0 ? 'OK' : 'FAILED'}: ${pass} pass, ${fail} fail`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('SMOKE ERROR:', err.message)
  process.exit(1)
})
