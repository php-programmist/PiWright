/* Смоук настройки «Фоновые сессии» (вкладка Расширенные возможности):
 * 1) чекбокс выключен по умолчанию, грейс-поле скрыто;
 * 2) daemon:status возвращает alive=false при выключенной настройке;
 * 3) включение чекбокса сохраняет настройку и показывает грейс-поле;
 * 4) кнопки остановки сессий: видны при включённой настройке, скрыты после выключения.
 * Запуск против smoke-инстанса:
 *   npm run build
 *   npx electron . --smoke --remote-debugging-port=9223 --user-data-dir=%TEMP%\piwright-smoke-userdata
 *   node tests/manual/smoke-background-sessions.cjs
 */
const { execSync } = require('node:child_process')
const { mkdtempSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { chromium } = require('playwright-core')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'piwright-smoke-bg-'))
  const winDir = dir.replace(/\//g, '\\')
  const run = (cmd) => execSync(cmd, { cwd: dir, stdio: 'pipe' })
  run('git init -q -b main')
  run('git config user.email smoke@test')
  run('git config user.name smoke')
  writeFileSync(join(dir, 'a.txt'), '1')
  run('git add .')
  run('git commit -q -m base-1')

  const browser = await chromium.connectOverCDP(CDP)
  const page = browser.contexts()[0].pages()[0]
  const results = []
  const check = (name, cond, extra = '') => {
    results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
    if (!cond) process.exitCode = 1
  }

  // Сброс: настройка выключена, проект засеян
  await page.waitForSelector('.right-bar', { timeout: 30000 })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  await page.evaluate(async (d) => {
    const s = await window.piwright.getSettings()
    const has = (s.projects ?? []).some((p) => p.dir === d)
    const patch = { backgroundSessions: false }
    if (!has) patch.projects = [...(s.projects ?? []), { kind: 'native', dir: d }]
    await window.piwright.setSettings(patch)
  }, winDir)
  await page.reload()
  await page.waitForSelector('.right-bar', { timeout: 30000 })
  await page.waitForTimeout(1500)

  // 1. По умолчанию выключена
  const initial = await page.evaluate(() => window.piwright.getSettings().then((s) => s.backgroundSessions))
  check('default backgroundSessions=false', initial === false, String(initial))

  // 2. daemon:status при выключенной настройке — alive=false
  const statusOff = await page.evaluate(() => window.piwright.daemonStatus())
  check('daemon status alive=false when off', statusOff.alive === false && statusOff.background === 0)

  // 3. Настройки → Расширенные возможности: чекбокс снят, грейс-поле скрыто
  await page.locator('button[title="Настройки"], button[title="Settings"]').first().click()
  await page.waitForTimeout(800)
  await page.locator('.settings-nav button', { hasText: /Advanced features|Расширенные возможности/ }).click()
  await page.waitForTimeout(500)
  const section = page.locator('.settings-section', { has: page.locator('h3', { hasText: /Фоновые сессии|Background sessions/ }) })
  check('advanced section visible', (await section.count()) === 1)
  const checkbox = section.locator('input[type=checkbox]').first()
  check('checkbox unchecked', (await checkbox.isChecked()) === false)
  const graceOff = await section.locator('input[type=number]').count()
  check('grace field hidden when off', graceOff === 0, `count=${graceOff}`)

  // 4. Включить чекбокс → сохранилось, грейс-поле появилось, подсказка есть
  await checkbox.click()
  await page.waitForTimeout(1200)
  const saved = await page.evaluate(() => window.piwright.getSettings().then((s) => s.backgroundSessions))
  check('backgroundSessions saved=true', saved === true, String(saved))
  const graceOn = await section.locator('input[type=number]').count()
  check('grace field visible when on', graceOn === 1, `count=${graceOn}`)
  const hint = await section.locator('.hint-icon').count()
  check('hint icon present', hint >= 1, `count=${hint}`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)

  // 5. Создать сессию → кнопка остановки видна при включённой настройке
  await page.locator('button[title="Новая сессия"], button[title="New session"]').first().click()
  const row = page.locator('.session-row').first()
  await row.waitFor({ timeout: 90000 })
  await page.waitForTimeout(1000)
  const stopOn = await page.locator('.session-row button.stop').count()
  check('stop button visible when on', stopOn >= 1, `count=${stopOn}`)

  // 6. Выключить настройку → после reload кнопки остановки скрыты
  await page.evaluate(() => window.piwright.setSettings({ backgroundSessions: false }))
  await page.reload()
  await page.waitForSelector('.session-row', { timeout: 90000 })
  await page.waitForTimeout(1500)
  const stopOff = await page.locator('.session-row button.stop').count()
  check('stop button hidden when off', stopOff === 0, `count=${stopOff}`)

  console.log(results.join('\n'))
  await browser.close()
}

main().catch((err) => {
  console.error('SMOKE ERROR:', err.message)
  process.exit(1)
})
