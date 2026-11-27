/* UI smoke DB settings per project: "+" on the Databases side panel opens a per-project Databases tab
 * with the add-connection form, connections stored in settings.projectDbConnections[projectKey],
 * isolation between projects, secrets kept out of settings.json, Settings modal has no Databases screen.
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

// Same normalization as renderer projectKey (shared/worktree normalizeDir, non-WSL case).
function computeKey(project) {
  const dir = project.dir.replace(/\\/g, '/').replace(/\/+$/, '')
  return `${project.kind}\u0000${dir}`
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP)
  const contexts = browser.contexts()
  const page = contexts[0]?.pages()[0]
  if (!page) throw new Error('no page over CDP')

  const clickTitle = async (titles) => {
    return await page.evaluate((titles) => {
      const btn = [...document.querySelectorAll('button')].find((b) => titles.some((t) => b.title === t))
      if (!btn) return false
      btn.click()
      return true
    }, titles)
  }
  const clickButton = async (selector, texts) => {
    const list = Array.isArray(texts) ? texts : [texts]
    return await page.evaluate(({ selector, texts }) => {
      const btn = [...document.querySelectorAll(selector)].find(
        (b) => texts.some((x) => b.textContent?.trim() === x || b.textContent?.trim().startsWith(x))
      )
      btn?.click()
      return btn !== undefined
    }, { selector, texts: list })
  }
  const setInput = async (labels, value, scope = '.ssh-edit') => {
    const list = Array.isArray(labels) ? labels : [labels]
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
    }, { labels: list, value, scope })
    if (!ok) throw new Error(`input not found: ${list.join('/')}`)
    await page.waitForTimeout(150)
  }
  const openDbTabViaPanel = async () => {
    const panelOpen = await page.evaluate(() => document.querySelector('.db-panel') !== null)
    if (!panelOpen) {
      await page.click('[data-testid="db-toggle"]')
      await page.waitForSelector('.db-panel', { timeout: 5000 })
    }
    const ok = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.db-panel .git-head button')].find(
        (b) => b.title === 'Add connection' || b.title === 'Добавить подключение'
      )
      if (!btn) return false
      btn.click()
      return true
    })
    if (!ok) throw new Error('db panel + button not found')
    await page.waitForSelector('.db-settings-tab', { timeout: 5000 })
  }
  const clickProject = async (dirPart) => {
    const ok = await page.evaluate((dirPart) => {
      const el = [...document.querySelectorAll('.project-name')].find((n) => n.getAttribute('title')?.includes(dirPart))
      if (!el) return false
      el.click()
      return true
    }, dirPart)
    if (!ok) throw new Error(`project row not found: ${dirPart}`)
    await page.waitForTimeout(500)
  }

  // 0. Clean slate: two smoke projects first, no DB connections anywhere, first project active.
  const key = await page.evaluate(async () => {
    const s = await window.piwright.getSettings()
    const norm = (d) => d.replace(/\\/g, '/').replace(/\/+$/, '')
    const first = { kind: 'native', dir: 'C:\\smoke-db-proj' }
    const second = { kind: 'native', dir: 'C:\\smoke-db-other' }
    const rest = s.projects.filter((p) => norm(p.dir) !== norm(first.dir) && norm(p.dir) !== norm(second.dir))
    const key = `${first.kind}\u0000${norm(first.dir)}`
    await window.piwright.setSettings({ ...s, projects: [first, second, ...rest], projectDbConnections: {}, lastProjectKey: key })
    return key
  })
  const otherKey = await page.evaluate(async () => {
    const s = await window.piwright.getSettings()
    const norm = (d) => d.replace(/\\/g, '/').replace(/\/+$/, '')
    const other = s.projects.find((p) => norm(p.dir).includes('smoke-db-other'))
    return other === undefined ? null : `${other.kind}\u0000${norm(other.dir)}`
  })
  check('two projects seeded, key computed', typeof key === 'string' && key.length > 0 && otherKey !== null, JSON.stringify({ key, otherKey }))
  await page.reload()
  await page.waitForSelector('.sessions-panel', { timeout: 30000 })
  await page.waitForTimeout(500)

  // 1. Databases panel header has the "+" button; click opens the per-project tab with the add form.
  let dbTabOpened = true
  try {
    await openDbTabViaPanel()
  } catch {
    dbTabOpened = false
  }
  check('db panel + opens Databases tab', dbTabOpened)
  const addFormOpen = await page.evaluate(() => document.querySelector('.db-settings-tab .ssh-edit') !== null)
  check('+ opens add-connection form', addFormOpen)
  const tabLabel = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.tab-bar .tab, .tabs .tab')]
    return tabs.map((t) => t.textContent?.trim() ?? '').join('|')
  })
  check('tab labeled Databases', tabLabel.includes('Databases') || tabLabel.includes('Базы данных'), tabLabel)
  const hint = await page.evaluate(() => document.querySelector('.db-settings-tab .panel-hint')?.textContent ?? '')
  check('empty hint shown', hint.length > 0, hint)

  // 2. Add connection form: Save disabled while required fields are empty.
  check('add connection button', await clickButton('.db-settings-tab button.ghost', '+'))
  await page.waitForSelector('.ssh-edit', { timeout: 5000 })
  const saveDisabledEmpty = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.ssh-edit-actions button')].find((b) => b.className.includes('primary'))
    return btn !== undefined && btn.disabled
  })
  check('save disabled with empty form', saveDisabledEmpty)

  // 3. Fill fields -> Save enabled.
  await setInput(['Host', 'Хост'], 'localhost')
  await setInput(['Database', 'База данных'], 'appdb')
  await setInput(['User', 'Пользователь'], 'app_user')
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
  await setInput(['Host', 'Хост'], '127.0.0.1', sshScope)
  await setInput(['User', 'Пользователь'], 'jump', sshScope)
  const sshPort = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('.ssh-edit .ssh-form-grid label')]
    const portLabel = labels.filter((l) => ['Port', 'Порт'].some((x) => l.textContent?.trim().startsWith(x)))
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

  // 6. Save with a password -> row in list, per-project settings, secrets not in settings.
  await setInput(['Password', 'Пароль'], 's3cret-pw')
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.ssh-edit-actions button')].find((b) => b.className.includes('primary'))
    btn?.click()
  })
  await page.waitForTimeout(800)
  const rowText = await page.evaluate(() => document.querySelector('.ssh-server-row')?.textContent ?? '')
  check('connection row shows meta', rowText.includes('appdb') && rowText.includes('app_user@localhost:5432') && rowText.includes('SSH'), rowText)
  const settingsState = await page.evaluate(async (key) => {
    const s = await window.piwright.getSettings()
    return { list: s.projectDbConnections[key] ?? null, legacy: s.dbConnections }
  }, key)
  check('entry persisted under project key with ssh', settingsState.list !== null && settingsState.list.length === 1 && settingsState.list[0].ssh?.host === '127.0.0.1' && settingsState.list[0].kind === 'postgres', JSON.stringify(settingsState))
  check('legacy dbConnections field is gone', settingsState.legacy === undefined, JSON.stringify(settingsState.legacy))
  check('no password in settings', settingsState.list !== null && !JSON.stringify(settingsState.list).includes('s3cret-pw'))
  const secretsFile = path.join(os.tmpdir(), 'piwright-smoke-userdata', 'db-secrets.json')
  let secretsRaw = ''
  try {
    secretsRaw = fs.readFileSync(secretsFile, 'utf8')
  } catch {}
  check('db-secrets.json exists without plaintext password', secretsRaw.length > 0 && !secretsRaw.includes('s3cret-pw'))

  // 7. Edit: rename via form.
  await clickButton('.ssh-server-row button.ghost', ['Edit', 'Изменить'])
  await page.waitForSelector('.ssh-edit', { timeout: 5000 })
  await setInput(['Name', 'Имя'], 'Smoke DB')
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.ssh-edit-actions button')].find((b) => b.className.includes('primary'))
    btn?.click()
  })
  await page.waitForTimeout(800)
  const renamed = await page.evaluate(() => document.querySelector('.ssh-server-row .ssh-server-name')?.textContent ?? '')
  check('rename persisted', renamed === 'Smoke DB', renamed)

  // 8. Per-project isolation: switch to the other project -> its Databases tab is empty.
  await clickProject('smoke-db-other')
  await openDbTabViaPanel()
  const otherRows = await page.evaluate(() => document.querySelectorAll('.db-settings-tab .ssh-server-row').length)
  check('other project has no connections', otherRows === 0, String(otherRows))
  const otherState = await page.evaluate(async (otherKey) => {
    const s = await window.piwright.getSettings()
    return (s.projectDbConnections[otherKey] ?? []).length
  }, otherKey)
  check('other project list empty in settings', otherState === 0, String(otherState))

  // 9. Switch back: connection is still there (per-project storage, not global).
  await clickProject('smoke-db-proj')
  await openDbTabViaPanel()
  await page.waitForSelector('.db-settings-tab .ssh-server-row', { timeout: 5000 })
  const backRows = await page.evaluate(() => document.querySelectorAll('.db-settings-tab .ssh-server-row').length)
  check('first project still has its connection', backRows === 1, String(backRows))

  // 10. Settings modal no longer has a Databases screen.
  await clickTitle(['Settings', 'Настройки'])
  await page.waitForSelector('.settings-modal', { timeout: 5000 })
  const navTexts = await page.evaluate(() => [...document.querySelectorAll('.settings-nav button')].map((b) => b.textContent?.trim() ?? ''))
  check('settings nav has no Databases', !navTexts.includes('Databases') && !navTexts.includes('Базы данных'), navTexts.join('|'))
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.className.includes('settings-close'))
    btn?.click()
  })
  await page.waitForTimeout(300)

  // 11. Tab persists across reload (projectTabs snapshot).
  await page.reload()
  await page.waitForSelector('.sessions-panel', { timeout: 30000 })
  await page.waitForTimeout(700)
  const persisted = await page.evaluate(() => document.querySelector('.db-settings-tab') !== null)
  check('db settings tab restored after reload', persisted)

  // 12. Delete: row gone, project list empty in settings.
  await clickButton('.ssh-server-row button.ghost.danger', ['Delete', 'Удалить'])
  await page.waitForTimeout(800)
  const rowsAfter = await page.evaluate(() => document.querySelectorAll('.db-settings-tab .ssh-server-row').length)
  check('row removed after delete', rowsAfter === 0, String(rowsAfter))
  const emptyAfter = await page.evaluate(async (key) => (await window.piwright.getSettings()).projectDbConnections[key]?.length ?? 0, key)
  check('project dbConnections empty after delete', emptyAfter === 0, String(emptyAfter))

  await page.screenshot({ path: 'tests/manual/db-settings-ui-smoke.png' })

  console.log(`\nSMOKE ${fail === 0 ? 'OK' : 'FAILED'}: ${pass} pass, ${fail} fail`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('SMOKE ERROR:', err.message)
  process.exit(1)
})
