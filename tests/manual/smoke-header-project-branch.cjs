/* Смоук шапки приложения (референс PHPStorm): имя проекта с выпадающим списком,
 * ветка с попапом (перенесена из git-панели), авто-fetch активного проекта,
 * зелёная стрелка ↑ (ahead) и синяя ↓ (behind).
 * Запуск против smoke-инстанса:
 *   npx electron . --smoke --remote-debugging-port=9223 --user-data-dir=%TEMP%\piwright-smoke-userdata
 *   node tests/manual/smoke-header-project-branch.cjs
 */
const { execSync } = require('node:child_process')
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { chromium } = require('playwright-core')

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'piwright-smoke-header-'))
  const clone = mkdtempSync(join(tmpdir(), 'piwright-smoke-header-clone-'))
  const dirB = mkdtempSync(join(tmpdir(), 'piwright-smoke-header-b-'))
  const remote = mkdtempSync(join(tmpdir(), 'piwright-smoke-header-remote-'))
  const winDir = dir.replace(/\//g, '\\')
  const winDirB = dirB.replace(/\//g, '\\')
  const nameA = winDir.split('\\').pop()
  const nameB = winDirB.split('\\').pop()
  const runIn = (cwd) => (cmd) => execSync(cmd, { cwd, stdio: 'pipe' })
  const run = runIn(dir)
  run('git init -q -b main')
  run('git config user.email smoke@test')
  run('git config user.name smoke')
  writeFileSync(join(dir, 'a.txt'), '1')
  run('git add .')
  run('git commit -q -m init')
  execSync('git init -q --bare -b main', { cwd: remote, stdio: 'pipe' })
  run(`git remote add origin "${remote}"`)
  run('git push -q -u origin main')
  const runB = runIn(dirB)
  runB('git init -q -b main')
  runB('git config user.email smoke@test')
  runB('git config user.name smoke')
  writeFileSync(join(dirB, 'b.txt'), '1')
  runB('git add .')
  runB('git commit -q -m init-b')
  const runClone = runIn(clone)
  execSync(`git clone -q "${remote}" "${clone}"`, { stdio: 'pipe' })
  runClone('git config user.email smoke@test')
  runClone('git config user.name smoke')

  const browser = await chromium.connectOverCDP('http://localhost:9223')
  const page = await browser.contexts()[0].pages()[0]
  const log = (...a) => console.log(...a)
  try {
    await page.waitForSelector('.right-bar', { timeout: 30000 })

    const boot = await page.evaluate(async ([a, b]) => {
      const s = await window.piwright.getSettings()
      const projects = (s.projects ?? []).filter((p) => p.dir !== a && p.dir !== b)
      projects.push({ kind: 'native', dir: a }, { kind: 'native', dir: b })
      await window.piwright.setSettings({ projects })
      return projects.length
    }, [winDir, winDirB])
    log('projects in settings:', boot)
    await page.reload()
    await page.waitForSelector('.right-bar', { timeout: 30000 })
    await page.waitForTimeout(1000)

    const expand = page.locator('button[title="Развернуть панель"], button[title="Expand panel"]')
    if ((await expand.count()) > 0) { await expand.click(); await page.waitForTimeout(800) }

    // Выбрать проект A кликом по имени в панели проектов (ждём загрузку списка после reload;
    // CSS-селектор по title с Windows-путём ломается на backslash-экранах — кликаем через evaluate)
    await page.waitForFunction((t) => [...document.querySelectorAll('.project-name')].some((e) => e.title === t), winDir, { timeout: 30000 })
    await page.evaluate((t) => {
      const el = [...document.querySelectorAll('.project-name')].find((e) => e.title === t)
      el.click()
    }, winDir)
    await page.waitForSelector('.app-header', { timeout: 15000 })

    // Имя проекта и ветка в шапке
    const hdrName = await page.locator('.app-header .hdr-project-name').textContent()
    log('header project:', hdrName)
    if (hdrName !== nameA) throw new Error(`expected header project "${nameA}", got "${hdrName}"`)
    const hdrBranch = await page.locator('.app-header .branch-toggle-name').textContent()
    log('header branch:', hdrBranch)
    if (hdrBranch !== 'main') throw new Error(`expected branch "main", got "${hdrBranch}"`)
    const iconCount = await page.locator('.app-header .branch-toggle .branch-icon').count()
    if (iconCount !== 1) throw new Error('branch icon missing in header toggle')

    // Локальный коммит → ahead 1 (пока без remote-изменений)
    writeFileSync(join(dir, 'a.txt'), '2')
    run('git add .')
    run('git commit -q -m local-ahead')

    // Переключение проекта выпадающим списком в шапке: A → B
    await page.locator('.app-header .hdr-project').click()
    await page.waitForSelector('.app-header .project-menu .project-menu-item', { timeout: 5000 })
    const items = await page.locator('.app-header .project-menu .project-menu-item').count()
    log('project menu items:', items)
    if (items < 2) throw new Error('expected at least 2 projects in header dropdown')
    await page.locator(`.app-header .project-menu .project-menu-item:has-text("${nameB}")`).click()
    await page.waitForFunction((n) => document.querySelector('.app-header .hdr-project-name')?.textContent === n, nameB, { timeout: 10000 })
    log('switched to B via header dropdown')

    // Remote уходит вперёд: клон пушит коммит
    writeFileSync(join(clone, 'remote.txt'), 'x')
    runClone('git add .')
    runClone('git commit -q -m from-clone')
    runClone('git push -q origin main')

    // Обратно на A: авто-fetch при переключении → behind 1, плюс локальный ahead 1
    await page.locator('.app-header .hdr-project').click()
    await page.waitForSelector('.app-header .project-menu .project-menu-item', { timeout: 5000 })
    await page.locator(`.app-header .project-menu .project-menu-item:has-text("${nameA}")`).click()
    await page.waitForFunction((n) => document.querySelector('.app-header .hdr-project-name')?.textContent === n, nameA, { timeout: 10000 })

    const up = page.locator('.app-header .hdr-arrow.up')
    await up.waitFor({ state: 'visible', timeout: 20000 })
    const upText = (await up.textContent()).trim()
    log('up arrow:', upText)
    if (!upText.includes('1')) throw new Error('expected ↑1 in header')
    const down = page.locator('.app-header .hdr-arrow.down')
    await down.waitFor({ state: 'visible', timeout: 20000 })
    const downText = (await down.textContent()).trim()
    log('down arrow:', downText)
    if (!downText.includes('1')) throw new Error('expected ↓1 in header')

    // Ветка в шапке управляется тем же попапом: список открывается, подменю — справа от попапа без наложения
    await page.locator('.app-header .branch-toggle').click()
    await page.waitForSelector('.app-header .branch-popup .branch-item', { timeout: 5000 })
    log('branch popup opens from header')
    await page.locator('.app-header .branch-popup .branch-item.current').click()
    await page.waitForSelector('.app-header .branch-sub', { timeout: 5000 })
    const rects = await page.evaluate(() => {
      const popup = document.querySelector('.app-header .branch-popup').getBoundingClientRect()
      const sub = document.querySelector('.app-header .branch-sub').getBoundingClientRect()
      return { popupRight: popup.right, subLeft: sub.left, subTop: sub.top, popupTop: popup.top }
    })
    log('popup right:', rects.popupRight, 'submenu left:', rects.subLeft)
    if (rects.subLeft < rects.popupRight - 1) throw new Error(`submenu overlaps popup: sub.left ${rects.subLeft} < popup.right ${rects.popupRight}`)
    await page.keyboard.press('Escape')
    await page.mouse.click(400, 400)

    await page.screenshot({ path: 'tests/manual/out-header-project-branch.png' })
    log('SMOKE OK')
  } finally {
    await browser.close()
    for (const d of [dir, clone, dirB, remote]) {
      try { rmSync(d, { recursive: true, force: true }) } catch {}
    }
  }
}

main().catch((err) => {
  console.error('SMOKE FAIL:', err.message)
  process.exit(1)
})
