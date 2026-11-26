/* Смоук Resolve Conflicts + rebase-пунктов подменю веток:
 * 1) подменю не-текущей ветки содержит «Rebase 'main' on 'side'» и «Checkout 'side' and Rebase onto 'main'»;
 * 2) Pull (rebase) с конфликтом → диалог Resolve Conflicts открывается сам (UU a.txt),
 *    Yours → Continue завершает rebase, диалог и ⚠-кнопка исчезают;
 * 3) merge-конфликт из CLI → ⚠-кнопка в Git-панели переоткрывает диалог, Abort через confirm откатывает.
 * Запуск против smoke-инстанса:
 *   npm run build
 *   npx electron . --smoke --remote-debugging-port=9223 --user-data-dir=%TEMP%\piwright-smoke-userdata
 *   node tests/manual/smoke-resolve-conflicts.cjs
 */
const { execSync } = require('node:child_process')
const { mkdtempSync, rmSync, writeFileSync, readFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { chromium } = require('playwright-core')

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'piwright-smoke-conflicts-'))
  const aux = mkdtempSync(join(tmpdir(), 'piwright-smoke-conflicts-aux-'))
  const winDir = dir.replace(/\//g, '\\')
  const run = (cmd, cwd = dir) => execSync(cmd, { cwd, stdio: 'pipe' })
  const runAllowFail = (cmd, cwd = dir) => {
    try { execSync(cmd, { cwd, stdio: 'pipe' }) } catch { /* ожидаемый конфликт */ }
  }
  const remote = join(aux, 'remote.git')
  run('git init -q -b main')
  run('git config user.email smoke@test')
  run('git config user.name smoke')
  writeFileSync(join(dir, 'a.txt'), '1')
  run('git add .')
  run('git commit -q -m init')
  run(`git init -q --bare -b main "${remote}"`)
  run(`git remote add origin "${remote}"`)
  run('git push -q -u origin main')

  // side: не-текущая ветка для проверки rebase-пунктов подменю
  run('git branch side')

  // remote-коммит из клона меняет a.txt; локальный main тоже меняет a.txt → pull --rebase = конфликт
  const clone = join(aux, 'clone')
  run(`git clone -q "${remote}" "${clone}"`)
  run('git config user.email smoke@test', clone)
  run('git config user.name smoke', clone)
  writeFileSync(join(clone, 'a.txt'), 'remote')
  run('git add .', clone)
  run('git commit -q -m remote-change', clone)
  run('git push -q origin main', clone)
  writeFileSync(join(dir, 'a.txt'), 'local')
  run('git add .')
  run('git commit -q -m local-change')
  run('git fetch -q')

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
    const openSub = async (branch) => {
      await page.evaluate((b) => {
        const row = [...document.querySelectorAll('.app-header .branch-popup .branch-item')].find(
          (e) => e.querySelector('.branch-item-name')?.textContent === b
        )
        if (row === undefined) throw new Error(`branch row not found: ${b}`)
        row.click()
      }, branch)
      await page.waitForSelector('.app-header .branch-sub', { timeout: 5000 })
    }
    const subItems = async () =>
      page.$$eval('.app-header .branch-sub .branch-item span:last-child', (els) => els.map((e) => e.textContent))
    const clickSub = async (label) => {
      const ok = await page.evaluate((l) => {
        const el = [...document.querySelectorAll('.app-header .branch-sub .branch-item')].find(
          (e) => e.querySelector('span:last-child')?.textContent === l
        )
        if (el === undefined) return false
        el.click()
        return true
      }, label)
      if (!ok) throw new Error(`submenu item not found: ${label}`)
    }
    const closeAll = async () => {
      const overlay = await page.$('.app-header .popup-overlay')
      if (overlay !== null) await overlay.click().catch(() => {})
    }
    // во время rebase HEAD detached — branch-toggle заменён на span.git-branch 'detached'
    const waitIdle = () =>
      page.waitForFunction(() => {
        const t = document.querySelector('.app-header .branch-toggle')
        if (t !== null) return !t.disabled
        return document.querySelector('.app-header .git-branch') !== null
      }, undefined, { timeout: 30000 })

    // 1) rebase-пункты в подменю не-текущей ветки (side, текущая main)
    await openPopup()
    await openSub('side')
    const items = await subItems()
    log('side submenu:', items.join(' | '))
    for (const label of ["Rebase 'main' on 'side'", "Checkout 'side' and Rebase onto 'main'"]) {
      if (!items.includes(label)) throw new Error(`side submenu missing "${label}": [${items.join(', ')}]`)
    }
    await closeAll()

    // 2) Pull (rebase) с конфликтом → диалог открывается сам
    await openPopup()
    await openSub('main')
    await clickSub('Pull (rebase)')
    await page.waitForSelector('.conflict-box', { timeout: 30000 })
    const title = await page.$eval('.conflict-title span', (e) => e.textContent)
    const op = await page.$eval('.conflict-op', (e) => e.textContent)
    log('dialog:', title, '/', op)
    if (title !== 'Resolve Conflicts') throw new Error(`dialog title wrong: ${title}`)
    if (op !== 'Rebase in progress') throw new Error(`dialog op label wrong: ${op}`)
    const row = await page.$eval('.conflict-row', (e) => ({
      badge: e.querySelector('.git-badge')?.textContent,
      path: e.querySelector('.conflict-path')?.textContent,
      buttons: [...e.querySelectorAll('.conflict-row-actions button')].map((b) => b.textContent)
    }))
    log('conflict row:', JSON.stringify(row))
    if (row.badge !== 'UU' || row.path !== 'a.txt') throw new Error(`conflict row wrong: ${JSON.stringify(row)}`)
    for (const b of ['Yours', 'Theirs', 'Edit', 'AI', '✓']) {
      if (!row.buttons.includes(b)) throw new Error(`row missing button "${b}": [${row.buttons.join(', ')}]`)
    }
    const actions = await page.$$eval('.conflict-actions button', (els) => els.map((e) => e.textContent))
    for (const b of ['Resolve with AI', 'Abort', 'Continue']) {
      if (!actions.includes(b)) throw new Error(`dialog missing action "${b}": [${actions.join(', ')}]`)
    }

    // Yours: ours при pull --rebase — upstream ('remote'); затем Continue завершает rebase
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.conflict-row-actions button')].find((b) => b.textContent === 'Yours')
      el.click()
    })
    log('yours clicked')
    await waitIdle()
    log('idle after yours')
    await page.waitForFunction(
      () => {
        const el = [...document.querySelectorAll('.conflict-actions button')].find((b) => b.textContent === 'Continue')
        return el !== undefined && !el.disabled
      },
      undefined,
      { timeout: 30000 }
    )
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.conflict-actions button')].find((b) => b.textContent === 'Continue')
      el.click()
    })
    log('continue clicked')
    await page.waitForSelector('.conflict-box', { state: 'detached', timeout: 30000 })
    log('dialog closed')
    await waitIdle()
    await page.waitForFunction(() => document.querySelector('.git-conflict-btn') === null, undefined, { timeout: 30000 })
    const errBanner = await page.$('.git-error')
    if (errBanner !== null) throw new Error('git error banner after continue')
    const content = readFileSync(join(dir, 'a.txt'), 'utf8').trim()
    log('a.txt after continue:', content)
    if (content !== 'remote') throw new Error(`a.txt after continue wrong: ${content}`)

    // 3) merge-конфликт из CLI → ⚠ переоткрывает диалог, Abort через confirm откатывает
    run('git checkout -q -b m2 main~1')
    writeFileSync(join(dir, 'a.txt'), 'm2')
    run('git add .')
    run('git commit -q -m m2-change')
    run('git checkout -q main')
    runAllowFail('git merge --no-edit m2')
    run('git branch -D m2')
    // рефреш git-панели подхватит sequencer-состояние
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.git-head .icon')].find((b) => b.title === 'Refresh')
      el.click()
    })
    await page.waitForSelector('.git-conflict-btn', { timeout: 30000 })
    await page.evaluate(() => document.querySelector('.git-conflict-btn').click())
    await page.waitForSelector('.conflict-box', { timeout: 5000 })
    const op2 = await page.$eval('.conflict-op', (e) => e.textContent)
    log('reopened dialog op:', op2)
    if (op2 !== 'Merge in progress') throw new Error(`reopened dialog op wrong: ${op2}`)
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.conflict-actions button')].find((b) => b.textContent === 'Abort')
      el.click()
    })
    await page.waitForSelector('.confirm-box', { timeout: 5000 })
    await page.evaluate(() => document.querySelector('.confirm-box .files-rename-actions button.primary').click())
    await page.waitForSelector('.conflict-box', { state: 'detached', timeout: 30000 })
    await waitIdle()
    await page.waitForFunction(() => document.querySelector('.git-conflict-btn') === null, undefined, { timeout: 30000 })
    const contentAfterAbort = readFileSync(join(dir, 'a.txt'), 'utf8').trim()
    log('a.txt after abort:', contentAfterAbort)
    if (contentAfterAbort !== 'remote') throw new Error(`a.txt after abort wrong: ${contentAfterAbort}`)

    await page.screenshot({ path: 'tests/manual/out-resolve-conflicts.png' })
    log('SMOKE OK')
  } finally {
    await browser.close()
    try {
      rmSync(dir, { recursive: true, force: true })
      rmSync(aux, { recursive: true, force: true })
    } catch {}
  }
}

main().catch((err) => {
  console.error('SMOKE FAIL:', err.message)
  process.exit(1)
})
