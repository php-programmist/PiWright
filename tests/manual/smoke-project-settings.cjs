/* Смоук per-project настроек (.piwright/settings.json): пин ветки через UI уходит в файл
 * проекта, глобальный settings.json остаётся чистым, .git/info/exclude получает строку,
 * после рестарта пин читается из файла проекта (фаза restart).
 * Запуск против smoke-инстанса (порт 9227):
 *   node tests/manual/smoke-project-settings.cjs [restart]
 */
const { execSync } = require('node:child_process')
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { chromium } = require('playwright-core')

const RESTART = process.argv[2] === 'restart'
const PROJECT_DIR = join(tmpdir(), 'piwright-smoke-projsettings')
const USER_DATA = process.env.PIWRIGHT_SMOKE_USERDATA || join(tmpdir(), 'piwright-smoke-projsettings-userdata')
const CDP = process.env.SMOKE_CDP || 'http://localhost:9227'

const log = (...a) => console.log(...a)
const check = (cond, label) => {
  log(cond ? 'OK ' : 'FAIL', label)
  if (!cond) throw new Error(`check failed: ${label}`)
}

function projectKey(dir) {
  return 'native\u0000' + dir.replace(/\\/g, '/')
}

async function withPage(fn) {
  const browser = await chromium.connectOverCDP(CDP)
  try {
    const page = await browser.contexts()[0].pages()[0]
    await page.waitForSelector('.right-bar', { timeout: 60000 })
    await fn(page)
  } finally {
    await browser.close()
  }
}

async function phase1() {
  rmSync(PROJECT_DIR, { recursive: true, force: true })
  mkdirSync(PROJECT_DIR, { recursive: true })
  const run = (cmd) => execSync(cmd, { cwd: PROJECT_DIR, stdio: 'pipe' })
  writeFileSync(join(PROJECT_DIR, 'a.txt'), '1')
  run('git init -q -b main')
  run('git config user.email smoke@test')
  run('git config user.name smoke')
  run('git add .')
  run('git commit -q -m init')
  run('git branch dev')
  run('git branch zeta')

  await withPage(async (page) => {
    await page.evaluate(async (dir) => {
      const s = await window.piwright.getSettings()
      const projects = (s.projects ?? []).filter((p) => p.dir !== dir)
      projects.push({ kind: 'native', dir })
      await window.piwright.setSettings({ projects })
    }, PROJECT_DIR)
    await page.reload()
    await page.waitForSelector('.right-bar', { timeout: 30000 })
    await page.waitForFunction(
      (t) => [...document.querySelectorAll('.project-name')].some((e) => e.title === t),
      PROJECT_DIR,
      { timeout: 30000 }
    )
    await page.evaluate((t) => {
      [...document.querySelectorAll('.project-name')].find((e) => e.title === t).click()
    }, PROJECT_DIR)
    await page.waitForSelector('.app-header .branch-toggle', { timeout: 15000 })
    await page.waitForTimeout(1500)

    await page.locator('.app-header .branch-toggle').click()
    await page.waitForSelector('.app-header .branch-popup .branch-item', { timeout: 5000 })
    await page.locator('.app-header .branch-popup .branch-item:has-text("dev")').first().click()
    await page.waitForSelector('.app-header .branch-sub', { timeout: 5000 })
    await page.locator('.app-header .branch-sub .branch-item:has-text("Pin")').first().click()
    await page.waitForTimeout(800)

    const merged = await page.evaluate(async (key) => {
      const s = await window.piwright.getSettings()
      return s.pinnedBranches[key] ?? null
    }, projectKey(PROJECT_DIR))
    check(JSON.stringify(merged) === JSON.stringify(['dev']), 'pin виден в merged settings')

    const flatPath = join(PROJECT_DIR, '.piwright', 'settings.json')
    check(existsSync(flatPath), '.piwright/settings.json создан в проекте')
    const flat = JSON.parse(readFileSync(flatPath, 'utf8'))
    check(flat.version === 1, 'version: 1 в файле проекта')
    check(JSON.stringify(flat.pinnedBranches) === JSON.stringify(['dev']), 'pinnedBranches в файле проекта')

    const exclude = readFileSync(join(PROJECT_DIR, '.git', 'info', 'exclude'), 'utf8')
    check(exclude.split(/\r?\n/).includes('.piwright/'), '.piwright/ в .git/info/exclude')

    const global = JSON.parse(readFileSync(join(USER_DATA, 'settings.json'), 'utf8'))
    check(Object.keys(global.pinnedBranches ?? { x: 1 }).length === 0, 'глобальный settings.json чист от pinnedBranches')
  })
}

async function phaseRestart() {
  await withPage(async (page) => {
    await page.waitForFunction(
      (t) => [...document.querySelectorAll('.project-name')].some((e) => e.title === t),
      PROJECT_DIR,
      { timeout: 30000 }
    )
    await page.evaluate((t) => {
      [...document.querySelectorAll('.project-name')].find((e) => e.title === t).click()
    }, PROJECT_DIR)
    await page.waitForSelector('.app-header .branch-toggle', { timeout: 15000 })
    await page.waitForTimeout(1500)

    await page.locator('.app-header .branch-toggle').click()
    await page.waitForSelector('.app-header .branch-popup .branch-item', { timeout: 5000 })
    const names = await page.$$eval('.app-header .branch-popup .branch-item .branch-item-name', (els) => els.map((e) => e.textContent))
    log('branch order after restart:', names.join(', '))
    check(names[0] === 'dev', 'пин пережил рестарт (dev первый)')

    const merged = await page.evaluate(async (key) => {
      const s = await window.piwright.getSettings()
      return s.pinnedBranches[key] ?? null
    }, projectKey(PROJECT_DIR))
    check(JSON.stringify(merged) === JSON.stringify(['dev']), 'pinnedBranches в merged settings после рестарта')
  })
}

async function main() {
  if (RESTART) await phaseRestart()
  else await phase1()
  console.log('SMOKE OK')
}

main().then(
  () => {},
  (err) => {
    console.error('SMOKE FAIL:', err.message)
    process.exit(1)
  }
)
