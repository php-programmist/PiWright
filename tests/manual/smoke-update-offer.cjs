/* Smoke: явный оффер обновления возле версии в футере панели проектов.
 * 1) Без обновления баннера нет. updateDevEmit('9.9.9') → баннер с текстом и 2 кнопками.
 * 2) Кнопки на месте, layout не ломается (текст помещается, нет выхода за окно).
 * 3) «Не предлагать эту версию» прячет баннер и пишет dismissedUpdateVersion в settings.json.
 * 4) После reload повторный emit той же версии скрыт (suppression), новой версии — виден.
 * Запуск: SMOKE_CDP=http://localhost:9223 SMOKE_USERDATA=<dir> node tests/manual/smoke-update-offer.cjs */
const { chromium } = require('playwright-core')
const fs = require('node:fs')
const path = require('node:path')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'
const USERDATA = process.env.SMOKE_USERDATA || ''

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

  await page.reload()
  await page.waitForSelector('.panel-foot', { timeout: 30000 })
  check('no banner initially', (await page.locator('.update-offer').count()) === 0)

  // 1. Эмуляция найденного обновления (dev-канал, тот же путь, что реальное событие)
  const st1 = await page.evaluate(() => window.piwright.updateDevEmit('9.9.9'))
  check('status pushed', st1.availableVersion === '9.9.9' && st1.phase === 'idle')
  await page.waitForSelector('.update-offer', { timeout: 10000 })
  const text = await page.locator('.update-offer-text').innerText()
  check('banner text has version', /9\.9\.9/.test(text))

  // 2. Кнопки: двухшаговый флоу — «Download», затем (после загрузки) «Restart to update»
  const install = page.locator('.update-offer-install')
  const dismiss = page.locator('.update-offer-dismiss')
  check('download button', (await install.innerText()) === 'Download' && await install.isEnabled())
  check('dismiss button', (await dismiss.innerText()) === "Don't suggest this version" && await dismiss.isEnabled())

  // 2a. Клик Download в dev ничего не скачивает (не packaged) — кнопка остаётся «Download»
  await install.click()
  await page.waitForTimeout(300)
  check('dev download is no-op', (await install.innerText()) === 'Download' && await install.isEnabled())

  // 2b. Эмуляция завершённой загрузки → кнопка «Restart to update»
  const stD = await page.evaluate(() => window.piwright.updateDevEmit('9.9.9', 'downloaded'))
  check('downloaded phase pushed', stD.phase === 'downloaded')
  await page.waitForFunction(() => document.querySelector('.update-offer-install')?.textContent === 'Restart to update', { timeout: 10000 })
  check('restart button shown', true)
  await page.locator('.update-offer-install').click()
  await page.waitForTimeout(300)
  check('dev install is no-op (window alive)', (await page.locator('.update-offer-install').innerText()) === 'Restart to update')
  await page.evaluate(() => window.piwright.updateDevEmit('9.9.9'))
  await page.waitForFunction(() => document.querySelector('.update-offer-install')?.textContent === 'Download', { timeout: 10000 })
  check('back to download phase', true)

  // 3. Layout: баннер в пределах окна, текст не обрезан, не наезжает на версию
  const vp = await page.evaluate(() => ({ w: document.documentElement.clientWidth, h: document.documentElement.clientHeight }))
  const offerBox = await page.locator('.update-offer').boundingBox()
  check('banner inside window', offerBox.x >= 0 && offerBox.y >= 0 && offerBox.x + offerBox.width <= vp.w && offerBox.y + offerBox.height <= vp.h)
  const fit = await page.evaluate(() => {
    const t = document.querySelector('.update-offer-text')
    return t ? t.scrollWidth <= t.clientWidth + 1 : false
  })
  check('banner text fits', fit)
  const verBox = await page.locator('.app-version').boundingBox()
  check('no overlap with version', offerBox.x + offerBox.width <= verBox.x + 1)
  await page.screenshot({ path: 'tests/manual/out-update-offer.png' })

  // 4. «Не предлагать эту версию» → баннер скрыт, версия записана в settings
  await dismiss.click()
  await page.waitForFunction(() => document.querySelector('.update-offer') === null, { timeout: 10000 })
  check('banner hidden after dismiss', true)
  const st2 = await page.evaluate(() => window.piwright.updateStatus())
  check('status cleared', st2.availableVersion === null && st2.phase === 'idle')
  if (USERDATA) {
    const settings = JSON.parse(fs.readFileSync(path.join(USERDATA, 'settings.json'), 'utf8'))
    check('dismissedUpdateVersion persisted', settings.dismissedUpdateVersion === '9.9.9')
  }

  // 5. Персистентность: после reload та же версия подавлена, более новая — видна
  await page.reload()
  await page.waitForSelector('.panel-foot', { timeout: 30000 })
  await page.evaluate(() => window.piwright.updateDevEmit('9.9.9'))
  await page.waitForTimeout(800)
  check('same version still suppressed', (await page.locator('.update-offer').count()) === 0)
  await page.evaluate(() => window.piwright.updateDevEmit('9.9.10'))
  await page.waitForSelector('.update-offer', { timeout: 10000 })
  check('newer version shows banner', /9\.9\.10/.test(await page.locator('.update-offer-text').innerText()))

  // 6. Сброс
  await page.evaluate(() => window.piwright.updateDevEmit(null))
  await page.waitForFunction(() => document.querySelector('.update-offer') === null, { timeout: 10000 })
  check('reset works', true)

  log('SMOKE OK:', results.length, 'checks')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
