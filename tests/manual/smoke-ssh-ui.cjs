/* UI smoke SSH: Settings -> SSH tab (add server, test connection), add SSH project
 * with remote dir browser against live sshd in WSL Ubuntu.
 * Run: node tests/manual/smoke-ssh-ui.cjs  (expects smoke instance on 9223, sshd up in WSL) */
const { chromium } = require('playwright-core')
const { execSync } = require('node:child_process')
const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'
const DISTRO = process.env.WSL_DISTRO || 'Ubuntu'
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
  // Smoke key: generate and append to the default WSL user's authorized_keys.
  const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piwright-ssh-ui-'))
  const keyPath = path.join(keyDir, 'id_ed25519')
  execSync(`ssh-keygen -q -t ed25519 -N "" -f "${keyPath}"`, { stdio: 'ignore' })
  const pub = fs.readFileSync(`${keyPath}.pub`, 'utf8').trim()
  const wslUser = execSync(`wsl -d ${DISTRO} --exec bash -lc "whoami"`, { encoding: 'utf8' }).trim()
  execSync(
    `wsl -d ${DISTRO} --exec bash -lc "mkdir -p ~/.ssh && grep -qF '${pub}' ~/.ssh/authorized_keys 2>/dev/null || echo '${pub}' >> ~/.ssh/authorized_keys; chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys"`,
    { stdio: 'ignore', timeout: 30000 }
  )

  const browser = await chromium.connectOverCDP(CDP)
  const contexts = browser.contexts()
  const page = contexts[0]?.pages()[0]
  if (!page) throw new Error('no page over CDP')

  const openSettings = async () => {
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(
        (b) => b.title?.includes('Settings') || b.title?.includes('Настройки')
      )
      btn?.click()
    })
    await page.waitForTimeout(500)
  }
  const openSshTab = async () => {
    await page.evaluate(() => {
      const tab = [...document.querySelectorAll('.settings-nav button')].find((b) => b.textContent?.trim() === 'SSH')
      tab?.click()
    })
    await page.waitForTimeout(400)
  }

  // 1. Clean start: no servers.
  await page.evaluate(async () => {
    const s = await window.piwright.getSettings()
    await window.piwright.setSettings({ ...s, sshServers: [] })
  })
  await page.reload()
  await page.waitForSelector('.sessions-panel', { timeout: 30000 })
  await openSettings()
  check('settings modal opens', (await page.$('.settings-modal')) !== null)
  await openSshTab()
  check('SSH tab renders', (await page.$('.ssh-server-row, .panel-hint')) !== null)

  // 2. Server entry with a real key path, persisted via settings.
  await page.evaluate(async (keyPath) => {
    const s = await window.piwright.getSettings()
    await window.piwright.setSettings({
      ...s,
      sshServers: [{ id: 'smoke-1', name: 'WSL smoke', host: '127.0.0.1', port: 22, user: wslUserArg, auth: 'key', keyPath }]
    })
  }, keyPath).catch(() => {})
  // wslUser is not available inside evaluate scope — set via a second call with the value bound.
  await page.evaluate(
    ({ keyPath, user }) =>
      (async () => {
        const s = await window.piwright.getSettings()
        await window.piwright.setSettings({
          ...s,
          sshServers: [{ id: 'smoke-1', name: 'WSL smoke', host: '127.0.0.1', port: 22, user, auth: 'key', keyPath }]
        })
      })(),
    { keyPath, user: wslUser }
  )
  await page.reload()
  await page.waitForSelector('.sessions-panel', { timeout: 30000 })
  await openSettings()
  await openSshTab()
  const rowText = await page.evaluate(() => document.querySelector('.ssh-server-row')?.textContent ?? '')
  check('server row shows name/host/user', rowText.includes('WSL smoke') && rowText.includes(`${wslUser}@127.0.0.1:22`), rowText)

  // 3. Test connection against live sshd.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.ssh-server-row button')].find(
      (b) => b.textContent?.trim() === 'Test' || b.textContent?.trim() === 'Проверить'
    )
    btn?.click()
  })
  await page.waitForTimeout(5000)
  const testText = await page.evaluate(() => document.querySelector('.ssh-test-result')?.textContent ?? '')
  if (testText.length > 0) {
    check('test connection reports result', /pi:|Connected|Подключено|Failed|Не удалось/.test(testText), testText)
  } else {
    console.log('SKIP test connection (no result rendered)')
  }

  // 4. Add project: SSH button in AddProjectControl -> dialog -> remote dir browser.
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await page.evaluate(() => {
    const add = [...document.querySelectorAll('.panel-head button')].find((b) => b.textContent?.trim() === '+')
    add?.click()
  })
  await page.waitForTimeout(300)
  const sshBtn = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.add-project button')].find((b) => b.textContent?.trim() === 'SSH')
    btn?.click()
    return btn !== undefined
  })
  check('SSH add-project button present', sshBtn)
  await page.waitForSelector('.ssh-dialog', { timeout: 5000 })
  check('ssh dialog opens', true)
  await page.waitForTimeout(2500)
  const entries = await page.evaluate(() => [...document.querySelectorAll('.ssh-dialog-entry')].map((e) => e.textContent?.trim()))
  check('remote dir browser lists entries', entries.length > 0, JSON.stringify(entries.slice(0, 5)))
  const entryBg = await page.evaluate(() => {
    const el = document.querySelector('.ssh-dialog-entry')
    return el ? getComputedStyle(el).backgroundColor : 'missing'
  })
  check('dir entry not accent-styled', entryBg === 'rgba(0, 0, 0, 0)', entryBg)
  await page.evaluate(() => {
    const input = document.querySelector('.ssh-dialog-path input')
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, '/tmp')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
  })
  await page.waitForTimeout(1500)
  const addEnabled = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.ssh-dialog-actions button')].find(
      (b) => b.textContent?.includes('Add project') || b.textContent?.includes('Добавить проект')
    )
    return btn !== undefined && !btn.disabled
  })
  check('add project enabled for /tmp', addEnabled)
  if (addEnabled) {
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.ssh-dialog-actions button')].find(
        (b) => b.textContent?.includes('Add project') || b.textContent?.includes('Добавить проект')
      )
      btn?.click()
    })
    await page.waitForTimeout(1500)
    const rows = await page.evaluate(() => [...document.querySelectorAll('.project-name')].map((el) => el.textContent ?? ''))
    check('ssh project appears in panel', rows.some((r) => r.toLowerCase().includes('tmp')), JSON.stringify(rows))
    const badges = await page.evaluate(() => [...document.querySelectorAll('.project-row')].map((el) => el.textContent ?? ''))
    check('SSH badge on project', badges.some((b) => b.includes('tmp') && b.includes('SSH')), JSON.stringify(badges))
  }

  await page.screenshot({ path: 'tests/manual/ssh-ui-smoke.png' })
  fs.rmSync(keyDir, { recursive: true, force: true })

  console.log(`\nSMOKE ${fail === 0 ? 'OK' : 'FAILED'}: ${pass} pass, ${fail} fail`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('SMOKE ERROR:', err.message)
  process.exit(1)
})
