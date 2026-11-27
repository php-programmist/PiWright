/* UI smoke: DB connection error text is never empty. Node multi-address connect to a closed
 * port on 'localhost' rejects with AggregateError whose message is '' — the UI used to show
 * an empty result row / empty red banner. After the fix the real inner errors must be shown.
 * Run: node tests/manual/smoke-db-error-text.cjs  (expects smoke instance on 9223) */
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

async function main() {
  const browser = await chromium.connectOverCDP(CDP)
  const contexts = browser.contexts()
  const page = contexts[0]?.pages()[0]
  if (!page) throw new Error('no page over CDP')

  // 0. Seed one project with a connection to a closed port on 'localhost' (AggregateError case).
  const seeded = await page.evaluate(async () => {
    const s = await window.piwright.getSettings()
    const norm = (d) => d.replace(/\\/g, '/').replace(/\/+$/, '')
    const project = { kind: 'native', dir: 'C:\\smoke-db-err' }
    const rest = s.projects.filter((p) => norm(p.dir) !== norm(project.dir))
    const key = `${project.kind}\u0000${norm(project.dir)}`
    const entry = {
      id: 'db-errtest',
      name: 'err-test',
      kind: 'postgres',
      host: 'localhost',
      port: 5435,
      database: 'smoke',
      user: 'smoke',
      authType: 'password'
    }
    await window.piwright.setSettings({
      ...s,
      projects: [project, ...rest],
      projectDbConnections: { [key]: [entry] },
      lastProjectKey: key
    })
    return key
  })
  check('project + closed-port connection seeded', typeof seeded === 'string' && seeded.length > 0, seeded)
  await page.reload()
  await page.waitForSelector('.sessions-panel', { timeout: 30000 })
  await page.waitForTimeout(500)

  // 1. Main-process result over real IPC: error text non-empty, mentions the refused addresses.
  const apiResult = await page.evaluate(async (key) => {
    const list = (await window.piwright.dbConnectionsList(key)).connections
    if (list.length === 0) return null
    return await window.piwright.dbConnectionTest(list[0], null)
  }, seeded)
  check(
    'dbConnectionTest error non-empty with ECONNREFUSED',
    apiResult !== null && apiResult.ok === false && typeof apiResult.error === 'string' && apiResult.error.includes('ECONNREFUSED'),
    JSON.stringify(apiResult)
  )

  // 2. UI: open the Databases tab via the panel "+", the saved connection row shows a Test button.
  const panelOpen = await page.evaluate(() => document.querySelector('.db-panel') !== null)
  if (!panelOpen) {
    await page.click('[data-testid="db-toggle"]')
    await page.waitForSelector('.db-panel', { timeout: 5000 })
  }
  const plusClicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.db-panel .git-head button')].find(
      (b) => b.title === 'Add connection' || b.title === 'Добавить подключение'
    )
    if (!btn) return false
    btn.click()
    return true
  })
  check('db panel + opens settings tab', plusClicked)
  await page.waitForSelector('.db-settings-tab', { timeout: 5000 })
  await page.waitForSelector('.db-settings-tab .ssh-server-row', { timeout: 5000 })

  // 3. Click Test on the saved connection row; the result row must render visible non-empty text.
  const testClicked = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.db-settings-tab .ssh-server-row')].find((r) => r.textContent?.includes('err-test'))
    const btn = row ? [...row.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Test' || b.textContent?.trim() === 'Тест') : undefined
    if (!btn) return false
    btn.click()
    return true
  })
  check('row Test button clicked', testClicked)
  await page.waitForSelector('.db-settings-tab .ssh-server-row .ssh-test-result', { timeout: 20000 })
  const rowText = await page.evaluate(() => {
    const el = document.querySelector('.db-settings-tab .ssh-server-row .ssh-test-result')
    return el === null ? null : { text: el.textContent ?? '', cls: el.className }
  })
  check(
    'row test result text non-empty and mentions ECONNREFUSED',
    rowText !== null && rowText.text.trim().length > 0 && rowText.text.includes('ECONNREFUSED') && rowText.cls.includes('err'),
    JSON.stringify(rowText)
  )

  console.log(`SMOKE ${pass > 0 && fail === 0 ? 'OK' : 'FAILED'} ${pass}/${pass + fail}`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('SMOKE ERROR', err)
  process.exit(1)
})
