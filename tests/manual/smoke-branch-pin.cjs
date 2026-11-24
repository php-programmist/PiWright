/* Смоук переключателя веток: main/master первым, пин веток (подменю Pin/Unpin,
 * глиф 📌, порядок закреплённых вверху, персист в settings.pinnedBranches).
 * Запуск против smoke-инстанса:
 *   npx electron . --smoke --remote-debugging-port=9223 --user-data-dir=%TEMP%\piwright-smoke-userdata
 *   node tests/manual/smoke-branch-pin.cjs
 */
const { execSync } = require('node:child_process')
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { chromium } = require('playwright-core')

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'piwright-smoke-branchpin-'))
  const winDir = dir.replace(/\//g, '\\')
  const nameA = winDir.split('\\').pop()
  const run = (cmd) => execSync(cmd, { cwd: dir, stdio: 'pipe' })
  run('git init -q -b main')
  run('git config user.email smoke@test')
  run('git config user.name smoke')
  writeFileSync(join(dir, 'a.txt'), '1')
  run('git add .')
  run('git commit -q -m init')
  for (const b of ['zeta', 'alpha', 'dev']) run(`git branch ${b}`)

  const browser = await chromium.connectOverCDP('http://localhost:9223')
  const page = await browser.contexts()[0].pages()[0]
  const log = (...a) => console.log(...a)
  try {
    await page.waitForSelector('.right-bar', { timeout: 30000 })

    await page.evaluate(async (a) => {
      const s = await window.piwright.getSettings()
      const projects = (s.projects ?? []).filter((p) => p.dir !== a)
      projects.push({ kind: 'native', dir: a })
      await window.piwright.setSettings({ projects })
    }, winDir)
    await page.reload()
    await page.waitForSelector('.right-bar', { timeout: 30000 })
    await page.waitForTimeout(1000)

    await page.waitForFunction((t) => [...document.querySelectorAll('.project-name')].some((e) => e.title === t), winDir, { timeout: 30000 })
    await page.evaluate((t) => {
      const el = [...document.querySelectorAll('.project-name')].find((e) => e.title === t)
      el.click()
    }, winDir)
    await page.waitForSelector('.app-header .branch-toggle', { timeout: 15000 })
    await page.waitForTimeout(1500)

    const openPopup = async () => {
      await page.locator('.app-header .branch-toggle').click()
      await page.waitForSelector('.app-header .branch-popup .branch-item', { timeout: 5000 })
    }
    const itemNames = () => page.$$eval('.app-header .branch-popup .branch-item .branch-item-name', (els) => els.map((e) => e.textContent))

    // Без закрепления: main первый, дальше по алфавиту
    await openPopup()
    let names = await itemNames()
    log('initial order:', names.join(', '))
    if (JSON.stringify(names) !== JSON.stringify(['main', 'alpha', 'dev', 'zeta'])) {
      throw new Error(`expected [main, alpha, dev, zeta], got [${names.join(', ')}]`)
    }

    // Пин dev: клик по ветке → подменю → Pin
    await page.locator('.app-header .branch-popup .branch-item:has-text("dev")').first().click()
    await page.waitForSelector('.app-header .branch-sub', { timeout: 5000 })
    await page.locator('.app-header .branch-sub .branch-item:has-text("Pin")').first().click()
    await page.waitForTimeout(600)

    // Персист в settings
    const persisted = await page.evaluate(async (d) => {
      const s = await window.piwright.getSettings()
      const key = 'native\u0000' + d.replace(/\\/g, '/')
      return s.pinnedBranches[key] ?? null
    }, winDir)
    log('pinnedBranches in settings:', JSON.stringify(persisted))
    if (JSON.stringify(persisted) !== JSON.stringify(['dev'])) throw new Error('pinnedBranches not persisted')

    // Порядок: dev закреплён наверху, глиф pin
    await openPopup()
    names = await itemNames()
    log('after pin:', names.join(', '))
    if (JSON.stringify(names) !== JSON.stringify(['dev', 'main', 'alpha', 'zeta'])) {
      throw new Error(`expected [dev, main, alpha, zeta], got [${names.join(', ')}]`)
    }
    const pinGlyph = await page.locator('.app-header .branch-popup .branch-item .branch-glyph.pin').count()
    if (pinGlyph !== 1) throw new Error(`expected 1 pin glyph, got ${pinGlyph}`)

    // Подменю закреплённой ветки показывает Unpin
    await page.locator('.app-header .branch-popup .branch-item:has-text("dev")').first().click()
    await page.waitForSelector('.app-header .branch-sub', { timeout: 5000 })
    const unpinVisible = await page.locator('.app-header .branch-sub .branch-item:has-text("Unpin")').count()
    if (unpinVisible !== 1) throw new Error('Unpin item missing for pinned branch')
    await page.locator('.app-header .branch-sub .branch-item:has-text("Unpin")').first().click()
    await page.waitForTimeout(600)

    // После анпина исходный порядок
    await openPopup()
    names = await itemNames()
    log('after unpin:', names.join(', '))
    if (JSON.stringify(names) !== JSON.stringify(['main', 'alpha', 'dev', 'zeta'])) {
      throw new Error(`expected [main, alpha, dev, zeta], got [${names.join(', ')}]`)
    }
    const cleared = await page.evaluate(async (d) => {
      const s = await window.piwright.getSettings()
      const key = 'native\u0000' + d.replace(/\\/g, '/')
      return s.pinnedBranches[key] ?? null
    }, winDir)
    if (cleared !== null) throw new Error(`expected pinnedBranches cleared, got ${JSON.stringify(cleared)}`)

    await page.screenshot({ path: 'tests/manual/out-branch-pin.png' })
    log('SMOKE OK')
  } finally {
    await browser.close()
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
}

main().catch((err) => {
  console.error('SMOKE FAIL:', err.message)
  process.exit(1)
})
