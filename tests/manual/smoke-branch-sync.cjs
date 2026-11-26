/* Смоук пуш/пулл в селекторе веток: стрелки ahead/behind в списке, пункты Push /
 * Force push (lease) / Pull (rebase) / Pull (merge) / Pull в подменю по состоянию ветки,
 * рабочий Push и Pull (rebase) по клику.
 * Запуск против smoke-инстанса:
 *   npx electron . --smoke --remote-debugging-port=9223 --user-data-dir=%TEMP%\piwright-smoke-userdata
 *   node tests/manual/smoke-branch-sync.cjs
 */
const { execSync } = require('node:child_process')
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { chromium } = require('playwright-core')

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'piwright-smoke-branchsync-'))
  // remote и clone — ВНЕ каталога проекта: вложенные репо git видит как незакоммиченные изменения
  // и rebase/pull отказывается («You have unstaged changes»)
  const aux = mkdtempSync(join(tmpdir(), 'piwright-smoke-branchsync-aux-'))
  const winDir = dir.replace(/\//g, '\\')
  const run = (cmd, cwd = dir) => execSync(cmd, { cwd, stdio: 'pipe' })
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

  // synced: чистая запушенная ветка без расхождения (upstream задан)
  run('git branch synced')
  run('git checkout -q synced')
  run('git push -q -u origin synced')
  run('git checkout -q main')
  // feature: без upstream
  run('git branch feature')
  // main: 2 локальных коммита вперёд
  writeFileSync(join(dir, 'local1.txt'), 'l1')
  run('git add .')
  run('git commit -q -m local1')
  writeFileSync(join(dir, 'local2.txt'), 'l2')
  run('git add .')
  run('git commit -q -m local2')

  // remote-коммит из клона → main позади на 1
  const clone = join(aux, 'clone')
  run(`git clone -q "${remote}" "${clone}"`)
  run('git config user.email smoke@test', clone)
  run('git config user.name smoke', clone)
  writeFileSync(join(clone, 'remote1.txt'), 'r1')
  run('git add .', clone)
  run('git commit -q -m remote1', clone)
  run('git push -q origin main', clone)
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
    // стрелки появляются после авто-fetch + branchSync
    await page.waitForSelector('.app-header .branch-popup .branch-ab.up', { timeout: 20000 }).catch(() => {})
    await page.waitForTimeout(1500)

    const openPopup = async () => {
      await page.locator('.app-header .branch-toggle').click()
      await page.waitForSelector('.app-header .branch-popup .branch-item', { timeout: 5000 })
    }
    const rowInfo = async (branch) =>
      page.evaluate((b) => {
        const row = [...document.querySelectorAll('.app-header .branch-popup .branch-item')].find(
          (e) => e.querySelector('.branch-item-name')?.textContent === b
        )
        if (row === undefined) return null
        return {
          up: row.querySelector('.branch-ab.up')?.textContent ?? null,
          down: row.querySelector('.branch-ab.down')?.textContent ?? null
        }
      }, branch)
    // пункты подменю с точным текстом (has-text ловит подстроку — «Push» матчится и в «Force push»)
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
    const closeAll = async () => {
      const overlay = await page.$('.app-header .popup-overlay')
      if (overlay !== null) await overlay.click().catch(() => {})
    }

    await openPopup()
    // стрелки: main ↑2 ↓1, остальные без стрелок
    let info = await rowInfo('main')
    log('main arrows:', JSON.stringify(info))
    if (info === null || info.up !== '↑2' || info.down !== '↓1') throw new Error(`main arrows wrong: ${JSON.stringify(info)}`)
    info = await rowInfo('feature')
    if (info === null || info.up !== null || info.down !== null) throw new Error(`feature arrows wrong: ${JSON.stringify(info)}`)
    info = await rowInfo('synced')
    if (info === null || info.up !== null || info.down !== null) throw new Error(`synced arrows wrong: ${JSON.stringify(info)}`)

    // подменю main (текущая, расходится): Push, Force push (lease), Pull (rebase), Pull (merge)
    await openSub('main')
    let items = await subItems()
    log('main submenu:', items.join(' | '))
    for (const label of ['Push', 'Force push (lease)', 'Pull (rebase)', 'Pull (merge)']) {
      if (!items.includes(label)) throw new Error(`main submenu missing "${label}": [${items.join(', ')}]`)
    }
    if (items.includes('Pull')) throw new Error('main diverged submenu must not have plain "Pull"')
    await closeAll()

    // подменю feature (не текущая, без upstream): Push + Force push, без Pull
    await openPopup()
    await openSub('feature')
    items = await subItems()
    log('feature submenu:', items.join(' | '))
    if (!items.includes('Push') || !items.includes('Force push (lease)')) throw new Error(`feature submenu missing push: [${items.join(', ')}]`)
    if (items.some((i) => i.startsWith('Pull'))) throw new Error('feature (no upstream) must not have Pull')
    await closeAll()

    // подменю synced: ни Push, ни Pull
    await openPopup()
    await openSub('synced')
    items = await subItems()
    log('synced submenu:', items.join(' | '))
    if (items.includes('Push') || items.some((i) => i.startsWith('Pull'))) {
      throw new Error(`synced submenu must have no push/pull: [${items.join(', ')}]`)
    }
    await closeAll()

    // Pull (rebase) main по клику: ↓ исчезает, ↑2 остаётся (rebase переиграл локальные коммиты)
    await openPopup()
    await openSub('main')
    await clickSub('Pull (rebase)')
    await page.waitForFunction(() => {
      const t = document.querySelector('.app-header .branch-toggle')
      return t !== null && !t.disabled
    }, undefined, { timeout: 30000 })
    await openPopup()
    await page.waitForFunction(
      () => {
        const row = [...document.querySelectorAll('.app-header .branch-popup .branch-item')].find(
          (e) => e.querySelector('.branch-item-name')?.textContent === 'main'
        )
        return row !== undefined && row.querySelector('.branch-ab.down') === null
      },
      undefined,
      { timeout: 20000 }
    )
    info = await rowInfo('main')
    log('main after pull:', JSON.stringify(info))
    if (info.up !== '↑2' || info.down !== null) throw new Error(`main after pull wrong: ${JSON.stringify(info)}`)
    await closeAll()

    // Push main по клику: стрелка ↑ исчезает
    await openPopup()
    await openSub('main')
    await clickSub('Push')
    // ждём завершения операции (busy=false), затем в открытом попапе — отсутствие стрелки ↑
    await page.waitForFunction(() => {
      const t = document.querySelector('.app-header .branch-toggle')
      return t !== null && !t.disabled
    }, undefined, { timeout: 30000 })
    await openPopup()
    await page.waitForFunction(
      () => {
        const row = [...document.querySelectorAll('.app-header .branch-popup .branch-item')].find(
          (e) => e.querySelector('.branch-item-name')?.textContent === 'main'
        )
        return row !== undefined && row.querySelector('.branch-ab.up') === null
      },
      undefined,
      { timeout: 20000 }
    )
    info = await rowInfo('main')
    log('main after push:', JSON.stringify(info))
    if (info.up !== null || info.down !== null) throw new Error(`main after push wrong: ${JSON.stringify(info)}`)
    await closeAll()

    // заголовочные стрелки шапки тоже ушли
    const hdr = await page.$$eval('.app-header .hdr-arrow', (els) => els.map((e) => e.textContent))
    if (hdr.length !== 0) throw new Error(`header arrows must be empty after sync, got ${hdr.join(',')}`)

    await page.screenshot({ path: 'tests/manual/out-branch-sync.png' })
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
