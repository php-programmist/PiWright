/* Смоук графа побочных веток в доке Git Log: дефолт «Все ветки», коммиты боковых веток
 * видны без фильтра, сход боковых веток в общий родительский коммит рисуется кривой.
 * Запуск против smoke-инстанса:
 *   npx electron . --smoke --remote-debugging-port=9223 --user-data-dir=%TEMP%\piwright-smoke-userdata
 *   node tests/manual/smoke-gitlog-branches.cjs
 */
const { execSync } = require('node:child_process')
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { chromium } = require('playwright-core')

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'piwright-smoke-branches-'))
  const winDir = dir.replace(/\//g, '\\')
  const run = (cmd) => execSync(cmd, { cwd: dir, stdio: 'pipe' })
  run('git init -q -b main')
  run('git config user.email smoke@test')
  run('git config user.name smoke')
  writeFileSync(join(dir, 'a.txt'), '1')
  run('git add .')
  run('git commit -q -m base-1')
  writeFileSync(join(dir, 'a.txt'), '2')
  run('git add .')
  run('git commit -q -m base-2')
  // Две боковые ветки от одного base-2 (сценарий карточки): сход в общий родитель.
  // side-old старше по дате — встаёт между base-коммитами при --date-order.
  run('git checkout -q -b side-old')
  writeFileSync(join(dir, 'old.txt'), 'x')
  run('git add .')
  run('git -c user.email=smoke@test -c user.name=smoke commit -q -m side-old-commit --date "2026-01-01T10:00:00"')
  run('git checkout -q main')
  run('git checkout -q -b side-new')
  writeFileSync(join(dir, 'new.txt'), 'y')
  run('git add .')
  run('git commit -q -m side-new-commit')
  run('git checkout -q main')
  writeFileSync(join(dir, 'a.txt'), '3')
  run('git add .')
  run('git commit -q -m base-3')

  const browser = await chromium.connectOverCDP('http://localhost:9223')
  const page = await browser.contexts()[0].pages()[0]
  const log = (...a) => console.log(...a)
  try {
    await page.waitForSelector('.right-bar', { timeout: 30000 })

    const boot = await page.evaluate(async (d) => {
      const s = await window.piwright.getSettings()
      const has = (s.projects ?? []).some((p) => p.dir === d)
      if (!has) await window.piwright.setSettings({ projects: [...(s.projects ?? []), { kind: 'native', dir: d }] })
      return (s.projects ?? []).length
    }, winDir)
    log('projects in settings:', boot)
    await page.reload()
    await page.waitForSelector('.right-bar', { timeout: 30000 })
    await page.waitForTimeout(1000)

    const expand = page.locator('button[title="Развернуть панель"], button[title="Expand panel"]')
    if ((await expand.count()) > 0) { await expand.click(); await page.waitForTimeout(800) }

    // Выбрать проект с боковыми ветками: клик по имени проекта (title = полный путь)
    const projectName = page.locator(`.project-name[title="${winDir}"]`).first()
    if ((await projectName.count()) > 0) {
      await projectName.click()
      await page.waitForTimeout(1000)
    }
    const current = await page.locator('.session-row.current').count()
    if (current === 0) {
      const plus = page.locator('button[title="Новая сессия"], button[title="New session"]').first()
      await plus.click()
      await page.waitForSelector('.session-row.current', { timeout: 90000 })
      await page.waitForTimeout(2000)
    }

    const gitLogBtn = page.locator('.right-bar button[title*="Git Log"], .right-bar button[title*="История Git"]').first()
    for (let i = 0; i < 3; i++) {
      await gitLogBtn.click()
      try {
        await page.waitForSelector('.gitlog-dock', { timeout: 5000 })
        break
      } catch {
        if (i === 2) throw new Error('gitlog dock did not open')
      }
    }
    await page.waitForSelector('.gitlog-row', { timeout: 15000 })
    await page.waitForTimeout(1000)

    // Дефолт фильтра — «Все ветки»
    const selValue = await page.locator('.gitlog-branch-select').inputValue()
    log('branch select default:', selValue)
    if (selValue !== '*') throw new Error('expected default branch filter "*" (all branches), got ' + selValue)

    // Коммиты боковых веток видны без ручного фильтра
    const subjects = await page.locator('.gitlog-row .gitlog-subject').allTextContents()
    log('subjects:', subjects.join(' | '))
    for (const expected of ['side-new-commit', 'side-old-commit', 'base-3']) {
      if (!subjects.some((s) => s.includes(expected))) throw new Error('side-branch commit missing from default log: ' + expected)
    }

    // Сход веток: у общего родителя (base-2) есть входящая кривая (path) в графе
    const base2Idx = subjects.findIndex((s) => s.includes('base-2'))
    if (base2Idx < 0) throw new Error('base-2 row not found')
    const paths = await page.locator('.gitlog-row').nth(base2Idx).locator('.gitlog-graph path').count()
    log('base-2 graph paths:', paths)
    if (paths < 1) throw new Error('no converging curve drawn at shared parent')

    // Точка у каждой строки
    const rows = await page.locator('.gitlog-row').count()
    const dots = await page.locator('.gitlog-graph circle').count()
    log('rows:', rows, 'dots:', dots)
    if (dots < rows) throw new Error('graph dots missing')

    await page.screenshot({ path: 'tests/manual/out-gitlog-branches.png' })
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
