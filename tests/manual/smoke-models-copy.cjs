/* Smoke: Settings → Models — «Копировать в…» (меню бэкендов: WSL + SSH-серверы) и «Правка JSON».
 * 1) На вкладке Windows кнопка Copy to… открывает меню: WSL и SSH: Smoke Box (сид в settings.json).
 * 2) Клик WSL → confirm перезаписи (провайдеры совпадают) → Cancel — записи нет.
 * 3) ⇉ у модели → меню → WSL → CopyPanel с «Copy model … to WSL» → Cancel.
 * 4) Правка JSON: открывается с текущим документом, невалидный JSON даёт ошибку, Cancel закрывает. */
const { chromium } = require('playwright-core')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'

async function main() {
  const browser = await chromium.connectOverCDP(CDP)
  const page = await browser.contexts()[0].pages()[0]
  page.on('pageerror', (e) => console.log('PAGE ERR:', String(e).slice(0, 400)))
  const log = (...a) => console.log(...a)
  const results = []
  const check = (name, cond) => {
    if (!cond) throw new Error('CHECK FAILED: ' + name)
    results.push(name)
    log('PASS:', name)
  }

  await page.waitForSelector('.panel-foot', { timeout: 30000 })

  // Хвост прошлого запуска: закрыть висящий confirm, если есть
  while ((await page.locator('.confirm-box').count()) > 0) {
    await page.locator('.files-rename-actions button', { hasText: 'Cancel' }).click().catch(() => {})
    await page.waitForTimeout(300)
  }

  // Открыть настройки → вкладка Models
  await page.evaluate(() => window.useSessionsStoreHot?.() ?? null).catch(() => {})
  await page.evaluate(() => {
    const store = document.querySelector('.panel-foot') // noop guard
    return store
  }).catch(() => {})
  await page.evaluate(() => {
    // openSettings живёт в zustand-сторе сессий; доступ через глобал не экспортирован — клик по кнопке ⚙
    const btn = [...document.querySelectorAll('.panel-foot button')].find((b) => b.textContent.trim() === '⚙')
    btn.click()
  })
  await page.waitForSelector('.settings-view, .settings-tabs, [class*="settings"]', { timeout: 15000 })
  const modelsTabBtn = page.locator('button', { hasText: /^Models$/ }).first()
  await modelsTabBtn.click()
  await page.waitForSelector('.models-tab', { timeout: 15000 })
  check('models tab opened', true)

  // 1. Кнопка Copy to… и меню бэкендов
  await page.waitForSelector('.provider-card', { timeout: 20000 })
  const copyBtn = page.locator('.provider-card .provider-head button', { hasText: 'Copy to…' }).first()
  check('Copy to… button on provider', (await copyBtn.count()) > 0)
  await copyBtn.click()
  await page.waitForSelector('.models-tab .project-menu', { timeout: 5000 })
  const menuItems = await page.locator('.models-tab .project-menu .project-menu-item').allInnerTexts()
  log('menu items:', JSON.stringify(menuItems))
  check('menu has WSL', menuItems.includes('WSL'))
  check('menu has SSH server', menuItems.includes('SSH: Smoke Box'))
  check('menu has no current backend', !menuItems.includes('Windows'))
  await page.screenshot({ path: 'tests/manual/out-models-copy-menu.png' })

  // 2. Клик WSL → confirm перезаписи → Cancel (холодный wsl.exe может дать «Cannot resolve» — ретрай)
  let confirmed = false
  for (let attempt = 0; attempt < 2 && !confirmed; attempt++) {
    if (attempt > 0) {
      await page.locator('.provider-card .provider-head button', { hasText: 'Copy to…' }).first().click()
      await page.waitForSelector('.models-tab .project-menu', { timeout: 5000 })
    }
    await page.locator('.models-tab .project-menu .project-menu-item', { hasText: 'WSL' }).click()
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(500)
      if ((await page.locator('.confirm-box').count()) > 0) { confirmed = true; break }
      if ((await page.locator('.models-tab .project-menu').count()) > 0) break
    }
  }
  check('overwrite confirm shown', confirmed)
  const confirmText = await page.locator('.confirm-message').innerText()
  log('confirm:', confirmText.replace(/\n/g, ' ').slice(0, 120))
  check('confirm mentions WSL', /WSL/.test(confirmText))
  await page.locator('.files-rename-actions button', { hasText: 'Cancel' }).click()
  await page.waitForTimeout(300)
  check('confirm cancelled', (await page.locator('.confirm-box').count()) === 0)

  // 3. Edit провайдера → ⇉ у модели → меню → WSL → CopyPanel → Cancel
  await page.locator('.provider-card .provider-head button', { hasText: 'Edit' }).first().click()
  await page.waitForSelector('.model-row', { timeout: 5000 })
  const copyModelBtn = page.locator('.model-row-head button.icon[title="Copy to another backend"]').first()
  check('model ⇉ button exists', (await copyModelBtn.count()) > 0)
  await copyModelBtn.click()
  await page.waitForSelector('.models-tab .project-menu', { timeout: 5000 })
  await page.locator('.models-tab .project-menu .project-menu-item', { hasText: 'WSL' }).click()
  await page.waitForSelector('.copy-panel', { timeout: 10000 })
  const copyTitle = await page.locator('.copy-title').innerText()
  log('copy panel title:', copyTitle)
  check('copy panel targets WSL', /WSL/.test(copyTitle))
  await page.locator('.copy-panel button', { hasText: 'Cancel' }).click()
  await page.waitForTimeout(200)
  check('copy panel closed', (await page.locator('.copy-panel').count()) === 0)
  await page.locator('.provider-form .form-actions button', { hasText: 'Cancel' }).click()
  await page.waitForTimeout(200)
  check('provider edit closed', (await page.locator('.provider-form').count()) === 0)

  // 4. Правка JSON
  const editJsonBtn = page.locator('.models-head button', { hasText: 'Edit JSON' })
  check('Edit JSON button exists', (await editJsonBtn.count()) > 0)
  await editJsonBtn.click()
  await page.waitForSelector('.json-editor-text', { timeout: 5000 })
  const initial = await page.locator('.json-editor-text').inputValue()
  check('editor has providers doc', initial.includes('"providers"'))
  await page.screenshot({ path: 'tests/manual/out-models-json-editor.png' })

  // Невалидный JSON → ошибка, файл не пишется
  const textarea = page.locator('.json-editor-text')
  await textarea.fill('{ "providers": { broken')
  await page.locator('.models-json-editor button', { hasText: 'Save' }).click()
  await page.waitForSelector('.models-json-editor .settings-error', { timeout: 5000 })
  const errText = await page.locator('.models-json-editor .settings-error').innerText()
  log('json error:', errText.slice(0, 120))
  check('invalid JSON error shown', errText.length > 0)

  // Cancel закрывает редактор, список провайдеров возвращается
  await page.locator('.models-json-editor button', { hasText: 'Cancel' }).click()
  await page.waitForTimeout(200)
  check('editor closed', (await page.locator('.json-editor-text').count()) === 0)
  check('provider list back', (await page.locator('.provider-card').count()) > 0)

  log(`\nSMOKE OK: ${results.length} checks passed`)
  await browser.close()
}

main().catch((e) => {
  console.error('SMOKE FAIL:', e.message)
  process.exit(1)
})
