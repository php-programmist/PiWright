/* UI smoke DB connection management: gear icon (hover) opens the per-connection edit tab titled
 * with the connection name and showing only the form (no connection list), context menu on the
 * panel row (Edit / Test / Open console / Delete), "+" add form without the list, framed centered
 * form card. Run: node tests/manual/smoke-db-connections-ui.cjs  (expects smoke instance on 9223) */
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

function computeKey(project) {
  const dir = project.dir.replace(/\\/g, '/').replace(/\/+$/, '')
  return `${project.kind}\u0000${dir}`
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP)
  const contexts = browser.contexts()
  const page = contexts[0]?.pages()[0]
  if (!page) throw new Error('no page over CDP')

  const evalJs = (fn, arg) => page.evaluate(fn, arg)
  const clickTitle = async (titles) => {
    return await page.evaluate((titles) => {
      const btn = [...document.querySelectorAll('button')].find((b) => titles.includes(b.title))
      if (!btn) return false
      btn.click()
      return true
    }, titles)
  }
  const menuItem = async (texts) => {
    return await page.evaluate((texts) => {
      const btn = [...document.querySelectorAll('.tab-menu .tab-menu-item')].find((b) =>
        texts.some((x) => b.textContent?.trim() === x)
      )
      if (!btn) return false
      btn.click()
      return true
    }, texts)
  }
  const tabTexts = async () => {
    return await page.evaluate(() => [...document.querySelectorAll('.tab-bar .tab')].map((t) => t.textContent?.trim() ?? ''))
  }
  const openDbPanel = async () => {
    const panelOpen = await page.evaluate(() => document.querySelector('.db-panel') !== null)
    if (!panelOpen) {
      await page.click('[data-testid="db-toggle"]')
      await page.waitForSelector('.db-panel', { timeout: 5000 })
    }
  }

  // 0. Seed: one project, one connection, project active.
  const key = await page.evaluate(async () => {
    const s = await window.piwright.getSettings()
    const norm = (d) => d.replace(/\\/g, '/').replace(/\/+$/, '')
    const first = { kind: 'native', dir: 'C:\\smoke-db-proj' }
    const rest = s.projects.filter((p) => norm(p.dir) !== norm(first.dir))
    const key = `${first.kind}\u0000${norm(first.dir)}`
    const conn = {
      id: 'db-smoke1',
      name: 'Smoke Conn',
      kind: 'postgres',
      host: '127.0.0.1',
      port: 5432,
      database: 'appdb',
      user: 'app_user',
      authType: 'password'
    }
    await window.piwright.setSettings({
      ...s,
      projects: [first, ...rest],
      projectDbConnections: { [key]: [conn] },
      lastProjectKey: key
    })
    return key
  })
  check('project + connection seeded', typeof key === 'string' && key.length > 0, key)
  await page.reload()
  await page.waitForSelector('.sessions-panel', { timeout: 30000 })
  await page.waitForTimeout(500)
  await openDbPanel()
  await page.waitForSelector('.db-tree-connection', { timeout: 5000 })

  // 1. Row icons (gear + console) hidden by default, visible on hover.
  const row = page.locator('.db-tree-connection').first()
  const iconCount = await evalJs(() => document.querySelectorAll('.db-tree-connection .icon').length)
  check('row has gear + console icons', iconCount === 2, String(iconCount))
  const idleOpacity = await evalJs(() => getComputedStyle(document.querySelectorAll('.db-tree-connection .icon')[0]).opacity)
  check('icons hidden when not hovered', idleOpacity === '0', idleOpacity)
  await row.hover()
  await page.waitForTimeout(250)
  const hoverOpacity = await evalJs(
    () => getComputedStyle(document.querySelectorAll('.db-tree-connection .icon')[0]).opacity
  )
  check('icons visible on hover', hoverOpacity === '1', hoverOpacity)

  // 2. Context menu on the row: Edit / Test / Open console / Delete.
  await row.click({ button: 'right' })
  await page.waitForSelector('.tab-menu', { timeout: 3000 })
  const menuItems = await evalJs(() =>
    [...document.querySelectorAll('.tab-menu .tab-menu-item')].map((b) => b.textContent?.trim() ?? '')
  )
  check(
    'context menu has 4 items',
    menuItems.length === 4 && menuItems.includes('Edit') && menuItems.includes('Test') && menuItems.includes('Open console') && menuItems.includes('Delete'),
    menuItems.join('|')
  )
  await page.screenshot({ path: 'tests/manual/db-connections-menu-smoke.png' })

  // 3. Test from menu: result hint under the row (connect fails fast — closed port).
  await menuItem(['Test', 'Проверить'])
  await page.waitForSelector('.db-panel .ssh-test-result', { timeout: 15000 })
  const testText = await evalJs(() => document.querySelector('.db-panel .ssh-test-result')?.textContent ?? '')
  check('panel test shows result', testText.length > 0, testText)

  // 4. Gear icon opens edit tab titled with the connection name; form only, no list.
  await clickTitle(['Edit connection', 'Изменить подключение'])
  await page.waitForSelector('.db-settings-tab .db-conn-form', { timeout: 5000 })
  const tabsAfterGear = await tabTexts()
  check('edit tab titled with connection name', tabsAfterGear.some((t) => t.startsWith('Smoke Conn')), tabsAfterGear.join('|'))
  const editHasList = await evalJs(() => ({
    rows: document.querySelectorAll('.db-settings-tab .ssh-server-row').length,
    listHead: [...document.querySelectorAll('.db-settings-tab h3')].some((h) => h.textContent === 'Database connections'),
    formHead: document.querySelector('.db-settings-tab .db-conn-form h3')?.textContent ?? ''
  }))
  check(
    'edit tab: form only, no list',
    editHasList.rows === 0 && !editHasList.listHead && editHasList.formHead === 'Edit connection',
    JSON.stringify(editHasList)
  )

  // 5. Form card styling: framed, rounded, centered.
  const cardStyle = await evalJs(() => {
    const el = document.querySelector('.db-settings-tab .db-conn-form')
    if (!el) return null
    const cs = getComputedStyle(el)
    const parent = el.parentElement.getBoundingClientRect()
    const box = el.getBoundingClientRect()
    return {
      radius: cs.borderRadius,
      border: cs.borderStyle,
      maxWidth: cs.maxWidth,
      centerX: Math.abs(box.left + box.width / 2 - (parent.left + parent.width / 2)) < 8
    }
  })
  check(
    'form card framed, rounded, centered',
    cardStyle !== null && cardStyle.border === 'solid' && cardStyle.radius !== '0px' && cardStyle.centerX,
    JSON.stringify(cardStyle)
  )
  await page.screenshot({ path: 'tests/manual/db-connections-edit-smoke.png' })

  // 6. Edit tab selects styled like inputs (not alien).
  const selectStyle = await evalJs(() => {
    const el = document.querySelector('.db-conn-form select')
    if (!el) return null
    const cs = getComputedStyle(el)
    return { bg: cs.backgroundColor, radius: cs.borderRadius }
  })
  check('select styled with bg + radius', selectStyle !== null && selectStyle.radius !== '0px' && selectStyle.bg !== 'rgba(0, 0, 0, 0)', JSON.stringify(selectStyle))

  // 7. Panel "+" opens the add form without the connection list.
  await evalJs(() => {
    const btn = [...document.querySelectorAll('.db-panel .git-head button')].find(
      (b) => b.title === 'Add connection' || b.title === 'Добавить подключение'
    )
    btn?.click()
  })
  await page.waitForSelector('.db-settings-tab .db-conn-form', { timeout: 5000 })
  const addState = await evalJs(() => ({
    rows: document.querySelectorAll('.db-settings-tab .ssh-server-row').length,
    formHead: document.querySelector('.db-settings-tab .db-conn-form h3')?.textContent ?? '',
    tabs: [...document.querySelectorAll('.tab-bar .tab')].map((t) => t.textContent?.trim() ?? '')
  }))
  check(
    'add form without list, separate tab',
    addState.rows === 0 && addState.formHead === 'New connection' && addState.tabs.some((t) => t.startsWith('Databases')),
    JSON.stringify(addState)
  )

  // 8. Cancel returns to the list view.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.db-conn-form .ssh-edit-actions button')].find((b) => b.textContent?.trim() === 'Cancel' || b.textContent?.trim() === 'Отмена')
    btn?.click()
  })
  await page.waitForTimeout(300)
  const listBack = await evalJs(() => ({
    rows: document.querySelectorAll('.db-settings-tab .ssh-server-row').length,
    form: document.querySelector('.db-settings-tab .db-conn-form') !== null
  }))
  check('cancel back to list view', listBack.rows === 1 && !listBack.form, JSON.stringify(listBack))

  // 9. Delete from context menu: row gone, settings empty.
  await row.click({ button: 'right' })
  await page.waitForSelector('.tab-menu', { timeout: 3000 })
  await menuItem(['Delete', 'Удалить'])
  await page.waitForTimeout(1000)
  const rowsAfterDelete = await evalJs(() => document.querySelectorAll('.db-panel .db-tree-connection').length)
  check('panel row removed after delete', rowsAfterDelete === 0, String(rowsAfterDelete))
  const settingsAfter = await page.evaluate(async () => {
    const s = await window.piwright.getSettings()
    return Object.values(s.projectDbConnections).flat().filter((c) => c.id === 'db-smoke1').length
  })
  check('settings list empty after delete', settingsAfter === 0, String(settingsAfter))

  // 10. Stale edit tab shows "not found" hint.
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll('.tab-bar .tab')].find((t) => t.textContent?.includes('Smoke Conn'))
    tab?.click()
  })
  await page.waitForTimeout(400)
  const staleHint = await evalJs(() => document.querySelector('.db-settings-tab .panel-hint')?.textContent ?? '')
  check('stale edit tab shows not found', staleHint.length > 0, staleHint)

  console.log(`\nSMOKE ${fail === 0 ? 'OK' : 'FAILED'}: ${pass} pass, ${fail} fail`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('SMOKE ERROR:', err.message)
  process.exit(1)
})
