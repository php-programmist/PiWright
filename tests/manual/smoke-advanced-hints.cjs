/* Manual smoke: advanced-features descriptions moved into hover tooltips (Settings → Advanced).
   Checks RU/EN texts, absence of old inline panel-hints, and that the popover stays in the viewport.
   SMOKE_CDP=http://localhost:9223 */
const { chromium } = require('playwright-core')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'
const failures = []
const ok = (cond, msg) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + msg)
  if (!cond) failures.push(msg)
}

async function setLanguage(page, lang) {
  await page.evaluate(async (l) => {
    const s = await window.piwright.getSettings()
    await window.piwright.setSettings({ ...s, language: l, notifications: { ...s.notifications } })
  }, lang)
  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('button[title*="Настройки"], button[title*="Settings"]', { timeout: 30000 })
}

async function openAdvanced(page) {
  if ((await page.locator('.settings-modal-overlay').count()) === 0) {
    await page.locator('button[title*="Настройки"], button[title*="Settings"]').first().click()
    await page.waitForTimeout(600)
  }
  await page.locator('.settings-nav button', { hasText: /Расширенн|Advanced/ }).click()
  await page.waitForTimeout(300)
}

async function hintText(page, index) {
  const icon = page.locator('.settings-section .hint-icon').nth(index)
  await icon.hover()
  await page.waitForSelector('.hint-popover', { timeout: 3000 })
  const text = await page.locator('.hint-popover').textContent()
  const box = await page.locator('.hint-popover').boundingBox()
  await page.mouse.move(10, 10)
  await page.waitForTimeout(200)
  return { text: text ?? '', box }
}

const inViewport = (box, vw, vh) =>
  box && box.x >= -1 && box.y >= -1 && box.x + box.width <= vw + 1 && box.y + box.height <= vh + 1

;(async () => {
  const b = await chromium.connectOverCDP(CDP)
  const p = b.contexts()[0].pages()[0]
  try {
    const origLang = await p.evaluate(() => window.piwright.getSettings().then((s) => s.language))

    await setLanguage(p, 'ru')
    await openAdvanced(p)
    // предыдущие прогоны могли оставить петли включёнными — нормализуем
    await p.locator('label:has-text("Включить петли") input[type=checkbox]').setChecked(false)
    await p.waitForTimeout(900)

    ok((await p.locator('.settings-section .panel-hint').count()) === 0, 'RU: в «Расширенных» нет inline panel-hint')

    const loops = await hintText(p, 0)
    ok(loops.text.includes('Петля повторяет тот же промпт'), 'RU: тултип петель открылся, новый текст')
    ok(!loops.text.includes('харнесс'), 'RU: жаргон «харнесс» убран')
    ok(loops.text.includes('инструментов'), 'RU: текст про инструменты сохранён')
    const vw = await p.evaluate(() => window.innerWidth)
    const vh = await p.evaluate(() => window.innerHeight)
    ok(inViewport(loops.box, vw, vh), `RU: тултип петель в вьюпорте ${JSON.stringify(loops.box)}`)

    const kanban = await hintText(p, 1)
    ok(kanban.text.includes('инструменты канбан-доски'), 'RU: тултип канбана открылся, «тулы» заменены')
    ok(!kanban.text.includes('туы'), 'RU: опечатка «туы» исчезла')
    ok(kanban.text.includes('.pi/kanban'), 'RU: путь хранения досок на месте')
    ok(inViewport(kanban.box, vw, vh), 'RU: тултип канбана в вьюпорте')

    await p.locator('label:has-text("Включить петли") input[type=checkbox]').setChecked(true)
    await p.waitForTimeout(900)
    const closeHint = await hintText(p, 1)
    ok(closeHint.text.includes('Родительская вкладка сессии'), 'RU: тултип «закрывать сессию» работает')
    await p.locator('label:has-text("Включить петли") input[type=checkbox]').setChecked(false)
    await p.waitForTimeout(900)

    await p.keyboard.press('Escape')
    await setLanguage(p, 'en')
    await openAdvanced(p)

    ok((await p.locator('.settings-section .panel-hint').count()) === 0, 'EN: нет inline panel-hint')
    const loopsEn = await hintText(p, 0)
    ok(loopsEn.text.startsWith('The loop repeats the same prompt'), 'EN: loops tooltip text')
    ok(!/[А-Яа-яЁё]/.test(loopsEn.text), 'EN: без кириллицы')
    const kanbanEn = await hintText(p, 1)
    ok(kanbanEn.text.startsWith('The extension adds kanban board tools'), 'EN: kanban tooltip text')
    ok(inViewport(kanbanEn.box, vw, vh), 'EN: тултип канбана в вьюпорте')

    await p.keyboard.press('Escape')
    await setLanguage(p, origLang)
    console.log(failures.length === 0 ? 'SMOKE OK' : 'SMOKE FAIL')
    process.exitCode = failures.length === 0 ? 0 : 1
  } catch (e) {
    console.error(e.message)
    process.exitCode = 1
  } finally {
    await b.close()
  }
})()
