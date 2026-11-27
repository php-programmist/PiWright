/* UI smoke: files panel for an ssh project with NO active sessions. Regression for
 * "Invalid request" red banner: restored/non-session tabs used to carry a project
 * reconstructed from the tab-set key (kind\0dir, no serverId) — files:list guard rejected it.
 * Fix: projectForKey resolves the full entry from the projects list / active sessions.
 * Seed (written by the launcher): settings.json with an ssh project, a fake ssh server
 * (127.0.0.1:1 — connect refused) and a persisted 'skills' tab; lastProjectKey points at it.
 * Expected: files:list passes the guard, sftp connect fails with ECONNREFUSED — the banner
 * shows the connection error, never 'Invalid request'.
 * Run: node tests/manual/smoke-files-no-session.cjs  (expects smoke instance on 9223) */
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

  // Project panel shows the ssh project (no sessions under it).
  await page.waitForFunction(() => document.querySelector('.project-name') !== null, null, { timeout: 15000 })
  const projectName = await page.evaluate(() => document.querySelector('.project-name')?.textContent?.trim() ?? '')
  check('ssh project visible in panel', projectName === 'smoke-ssh', `got "${projectName}"`)

  // Restored non-session tab (skills) — the hydration path that used to lose serverId.
  await page.waitForFunction(() => document.querySelectorAll('.tab').length > 0, null, { timeout: 15000 })
  const tabTitles = await page.evaluate(() => [...document.querySelectorAll('.tab')].map((t) => t.textContent?.trim() ?? ''))
  check('restored skills tab present', tabTitles.some((t) => t.startsWith('Skills') || t.startsWith('Навыки')), JSON.stringify(tabTitles))

  // Files side panel is closed by default — open it via the right-bar toggle.
  const opened = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.title === 'Files')
    if (!btn) return false
    btn.click()
    return true
  })
  check('files toggle clicked', opened)
  await page.waitForFunction(() => document.querySelector('.files-panel') !== null, null, { timeout: 10000 })

  // Files panel: banner must be the ssh connect error, never 'Invalid request'.
  await page.waitForFunction(
    () => document.querySelector('.files-error') !== null || document.querySelectorAll('.files-tree .file-row, .files-panel li').length > 0,
    null,
    { timeout: 20000 }
  )
  const banner = await page.evaluate(() => document.querySelector('.files-error')?.textContent?.trim() ?? '')
  check('files panel shows ssh error banner', banner.length > 0, `banner="${banner}"`)
  check('banner is not "Invalid request"', banner !== 'Invalid request', `banner="${banner}"`)
  check('banner is ssh connect error', /ECONNREFUSED|etimedout|connect/i.test(banner), `banner="${banner}"`)
  const bodyText = await page.evaluate(() => document.body.textContent ?? '')
  check('no "Invalid request" anywhere', !bodyText.includes('Invalid request'))

  await page.screenshot({ path: 'tests/manual/smoke-files-no-session.png' })
  console.log(`SMOKE ${pass > 0 && fail === 0 ? 'OK' : 'FAILED'} ${pass}/${pass + fail}`)
  await browser.close()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('SMOKE ERROR', err)
  process.exit(1)
})
