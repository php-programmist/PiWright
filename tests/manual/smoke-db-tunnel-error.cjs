/* UI smoke: DB connection over SSH tunnel — failure path. Tunnel to a refused port must
 * render a non-empty error plate and re-enable Test/Save buttons (busy released), and the
 * pg tunnel adapter (preparePgTunnelStream) must not hang the request.
 * Run: node tests/manual/smoke-db-tunnel-error.cjs  (expects smoke instance on 9223) */
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

  // 0. Seed project + connection with an SSH tunnel to a refused port (127.0.0.1:1).
  const seeded = await page.evaluate(async () => {
    const s = await window.piwright.getSettings()
    const norm = (d) => d.replace(/\\/g, '/').replace(/\/+$/, '')
    const project = { kind: 'native', dir: 'C:\\smoke-db-tunnel' }
    const rest = s.projects.filter((p) => norm(p.dir) !== norm(project.dir))
    const key = `${project.kind}\u0000${norm(project.dir)}`
    const entry = {
      id: 'db-tunneltest',
      name: 'tunnel-err',
      kind: 'postgres',
      host: '10.255.255.1',
      port: 5432,
      database: 'smoke',
      user: 'smoke',
      authType: 'password',
      ssh: { host: '127.0.0.1', port: 1, user: 'smoke', auth: 'password' }
    }
    await window.piwright.setSettings({ ...s, projects: [project, ...rest], projectDbConnections: { [key]: [entry] }, lastProjectKey: key })
    return key
  })
  check('seeded', typeof seeded === 'string' && seeded.length > 0, seeded)
  await page.reload()
  await page.waitForSelector('.sessions-panel', { timeout: 30000 })
  await page.waitForTimeout(500)

  // 1. API-level: test over dead tunnel returns an error (never hangs).
  const apiResult = await page.evaluate(async (key) => {
    const list = (await window.piwright.dbConnectionsList(key)).connections
    if (list.length === 0) return null
    return await window.piwright.dbConnectionTest(list[0], { password: 'x' })
  }, seeded)
  check(
    'dead tunnel test returns non-empty error',
    apiResult !== null && apiResult.ok === false && typeof apiResult.error === 'string' && apiResult.error.length > 0,
    JSON.stringify(apiResult)
  )

  // 2. UI: open Databases tab, click row Test, error plate appears, buttons re-enabled.
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
  await page.waitForSelector('.db-settings-tab .ssh-server-row', { timeout: 5000 })

  const testClicked = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.db-settings-tab .ssh-server-row')].find((r) => r.textContent?.includes('tunnel-err'))
    const btn = row ? [...row.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Test' || b.textContent?.trim() === 'Тест') : undefined
    if (!btn) return false
    btn.click()
    return true
  })
  check('row Test clicked', testClicked)
  await page.waitForSelector('.db-settings-tab .ssh-server-row .ssh-test-result', { timeout: 30000 })
  const state = await page.evaluate(() => {
    const el = document.querySelector('.db-settings-tab .ssh-server-row .ssh-test-result')
    const row = [...document.querySelectorAll('.db-settings-tab .ssh-server-row')].find((r) => r.textContent?.includes('tunnel-err'))
    const testBtn = row ? [...row.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Test' || b.textContent?.trim() === 'Тест') : undefined
    return { text: el?.textContent ?? null, cls: el?.className ?? '', testDisabled: testBtn?.disabled ?? null }
  })
  check(
    'error plate non-empty + err class',
    state.text !== null && state.text.trim().length > 0 && state.cls.includes('err'),
    JSON.stringify(state)
  )
  check('Test button re-enabled after failure (busy released)', state.testDisabled === false, JSON.stringify(state))

  console.log(`SMOKE ${pass > 0 && fail === 0 ? 'OK' : 'FAILED'} ${pass}/${pass + fail}`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('SMOKE ERROR', err)
  process.exit(1)
})
