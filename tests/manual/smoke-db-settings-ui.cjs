/* UI smoke DB: Settings -> Databases tab (add connection form, per-connection SSH fields,
 * validation, save, secrets kept out of settings.json, edit, delete).
 * Run: node tests/manual/smoke-db-settings-ui.cjs  (expects smoke instance on 9223) */
const { chromium } = require('playwright-core')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

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

  const openSettings = async () => {
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(
        (b) => b.title?.includes('Settings') || b.title?.includes('Настройки')
      )
      btn?.click()
    })
    await page.waitForTimeout(500)
  }
  const openDbTab = async () => {
    await page.evaluate(() => {
      const tab = [...document.querySelectorAll('.settings-nav button')].find(
        (b) => b.textContent?.trim() === 'Databases' || b.textContent?.trim() === 'Базы данных'
      )
      tab?.click()
    })
    await page.waitForTimeout(400)
  }
  const clickButton = async (selector, text) => {
    return await page.evaluate(({ selector, text }) => {
      const btn = [...document.querySelectorAll(selector)].find(
        (b) => b.textContent?.trim() === text || b.textContent?.trim().startsWith(text)
      )
      btn?.click()
      return btn !== undefined
    }, { selector, text })
  }
  const setInput = async (label, value, scope = '.ssh-edit') => {
    const ok = await page.evaluate(({ label, value, scope }) => {
      const section = document.querySelector(scope)
      if (!section) return false
      const labelEl = [...section.querySelectorAll('label')].find((l) => l.textContent?.trim().startsWith(label))
      const input = labelEl?.querySelector('input')
      if (!input) return false
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    }, { label, value, scope })
    if (!ok) throw new Error(`input not found: ${label}`)
    await page.waitForTimeout(150)
  }

  // 1. Clean start: no connections.
  await page.evaluate(async () => {
    const s = await window.piwright.getSettings()
    await window.piwright.setSettings({ ...s, dbConnections: [] })
  })
  await page.reload()
  await page.waitForSelector('.sessions-panel', { timeout: 30000 })
  await openSettings()
  check('settings modal opens', (await page.$('.settings-modal')) !== null)
  await openDbTab()
  const hint = await page.evaluate(() => document.querySelector('.settings-content .panel-hint')?.textContent ?? '')
  check('empty hint shown', hint.length > 0, hint)

  // 2. Add connection form: Save disabled while required fields are empty.
  check('add connection button', await clickButton('.settings-content button.ghost', '+'))
  await page.waitForSelector('.ssh-edit', { timeout: 5000 })
  const saveDisabledEmpty = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.ssh-edit-actions button')].find((b) => b.className.includes('primary'))
    return btn !== undefined && btn.disabled
  })
  check('save disabled with empty form', saveDisabledEmpty)

  // 3. Fill fields -> Save enabled.
  await setInput('Host', 'localhost')
  await setInput('Database', 'appdb')
  await setInput('User', 'app_user')
  const saveEnabledFilled = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.ssh-edit-actions button')].find((b) => b.className.includes('primary'))
    return btn !== undefined && !btn.disabled
  })
  check('save enabled after required fields', saveEnabledFilled)

  // 4. SSH checkbox reveals per-connection tunnel fields; empty ssh host disables save again.
  const sshToggle = await page.evaluate(() => {
    const label = [...document.querySelectorAll('.ssh-edit label.settings-check')].find((l) =>
      l.textContent?.includes('SSH')
    )
    const box = label?.querySelector('input[type=checkbox]')
    if (!box) return false
    box.click()
    return box.checked
  })
  check('ssh checkbox toggles on', sshToggle)
  await page.waitForTimeout(200)
  const saveDisabledSshEmpty = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.ssh-edit-actions button')].find((b) => b.className.includes('primary'))
    return btn !== undefined && btn.disabled
  })
  check('save disabled with empty ssh host', saveDisabledSshEmpty)
  const sshScope = '.ssh-edit div.ssh-form-grid:nth-of-type(2)'
  await setInput('Host', '127.0.0.1', sshScope)
  await setInput('User', 'jump', sshScope)
  const sshPort = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('.ssh-edit .ssh-form-grid label')]
    const portLabel = labels.filter((l) => l.textContent?.trim().startsWith('Port'))
    return portLabel.length >= 2 ? portLabel[1].querySelector('input')?.value : undefined
  })
  check('ssh port field defaults to 22', sshPort === '22', String(sshPort))

  // 5. Test connection: real attempt (ssh auth fails fast on 127.0.0.1) -> readable error, no crash.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.ssh-edit-actions button')].find((b) => b.textContent?.trim() === 'Test connection' || b.textContent?.trim() === 'Проверить соединение')
    btn?.click()
  })
  await page.waitForTimeout(8000)
  const testText = await page.evaluate(() => document.querySelector('.ssh-edit .ssh-test-result')?.textContent ?? '')
  check('test reports readable error', testText.length > 0, testText)

  // 6. Save with a password -> row in list, secrets not in settings.
  await setInput('Password', 's3cret-pw')
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.ssh-edit-actions button')].find((b) => b.className.includes('primary'))
    btn?.click()
  })
  await page.waitForTimeout(800)
  const rowText = await page.evaluate(() => document.querySelector('.ssh-server-row')?.textContent ?? '')
  check('connection row shows meta', rowText.includes('appdb') && rowText.includes('app_user@localhost:5432') && rowText.includes('SSH'), rowText)
  const settingsState = await page.evaluate(async () => {
    const s = await window.piwright.getSettings()
    return s.dbConnections[0] ?? null
  })
  check('entry persisted with ssh', settingsState !== null && settingsState.ssh?.host === '127.0.0.1' && settingsState.kind === 'postgres', JSON.stringify(settingsState))
  check('no password in settings', settingsState !== null && !JSON.stringify(settingsState).includes('s3cret-pw'))
  const secretsFile = path.join(os.tmpdir(), 'piwright-smoke-userdata', 'db-secrets.json')
  let secretsRaw = ''
  try {
    secretsRaw = fs.readFileSync(secretsFile, 'utf8')
  } catch {}
  check('db-secrets.json exists without plaintext password', secretsRaw.length > 0 && !secretsRaw.includes('s3cret-pw'))

  // 7. Edit: rename via form.
  await clickButton('.ssh-server-row button.ghost', 'Edit')
  await page.waitForSelector('.ssh-edit', { timeout: 5000 })
  await setInput('Name', 'Smoke DB')
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.ssh-edit-actions button')].find((b) => b.className.includes('primary'))
    btn?.click()
  })
  await page.waitForTimeout(800)
  const renamed = await page.evaluate(() => document.querySelector('.ssh-server-row .ssh-server-name')?.textContent ?? '')
  check('rename persisted', renamed === 'Smoke DB', renamed)

  // 8. Delete: row gone, settings empty.
  await clickButton('.ssh-server-row button.ghost.danger', 'Delete')
  await page.waitForTimeout(800)
  const rowsAfter = await page.evaluate(() => document.querySelectorAll('.ssh-server-row').length)
  check('row removed after delete', rowsAfter === 0, String(rowsAfter))
  const emptyAfter = await page.evaluate(async () => (await window.piwright.getSettings()).dbConnections.length)
  check('settings dbConnections empty after delete', emptyAfter === 0, String(emptyAfter))

  await page.screenshot({ path: 'tests/manual/db-settings-ui-smoke.png' })

  console.log(`\nSMOKE ${fail === 0 ? 'OK' : 'FAILED'}: ${pass} pass, ${fail} fail`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('SMOKE ERROR:', err.message)
  process.exit(1)
})
