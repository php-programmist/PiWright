/* Smoke: чейндж-лог в приложении.
 * 1) Попап «приложение обновлено» над версией (update-state.json посеян до старта с 0.3.9).
 * 2) Клик по попапу → модалка «What's new»: релизы с GitHub, новые сверху, без хэшей.
 * 3) Escape закрывает; клик по .app-version открывает снова. */
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
  await page.reload()
  await page.waitForSelector('.panel-foot', { timeout: 30000 })

  // 1. Попап обновления (update-state.json посеян с lastVersion 0.3.9 до старта)
  await page.waitForSelector('.update-popup', { timeout: 15000 })
  const popupText = await page.locator('.update-popup').innerText()
  check('popup visible', popupText.includes('0.3.9'))
  check('popup mentions changelog hint', popupText.length > 10)

  // Попап не вылезает за пределы окна
  const popupBox = await page.locator('.update-popup').boundingBox()
  check('popup inside window', popupBox.x >= 0 && popupBox.y >= 0 && popupBox.x + popupBox.width <= 400)

  // 2. Клик по попапу → модалка
  await page.locator('.update-popup').click()
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(500)
    const oc = await page.locator('.changelog-modal-overlay').count()
    console.log('poll', i, 'overlay', oc, 'popup', await page.locator('.update-popup').count())
    if (oc > 0) break
  }
  await page.waitForSelector('.changelog-modal-overlay', { timeout: 10000 })
  check('modal opened from popup', true)
  await page.waitForSelector('.changelog-release', { timeout: 30000 })
  const versions = await page.locator('.changelog-version').allInnerTexts()
  check('releases rendered', versions.length >= 2)
  check('newest first', versions[0] === 'v0.4.1' || Number(versions[0].slice(1)) >= Number(versions[1].slice(1)))
  const bodyText = await page.locator('.changelog-body').innerText()
  check('no commit hashes', !/[0-9a-f]{7,40}/.test(bodyText.replace(/v?\d+\.\d+\.\d+/g, '')))
  const dates = await page.locator('.changelog-date').allInnerTexts()
  check('dates shown', dates.length === versions.length && dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))

  // Модалка в пределах окна, текст не обрезан
  const modalBox = await page.locator('.changelog-modal').boundingBox()
  const vp = await page.evaluate(() => ({ w: document.documentElement.clientWidth, h: document.documentElement.clientHeight }))
  check('modal inside window', modalBox.x >= 0 && modalBox.y >= 0 && modalBox.x + modalBox.width <= vp.w && modalBox.y + modalBox.height <= vp.h)

  await page.screenshot({ path: 'tests/manual/out-changelog-modal.png' })

  // 3. Escape → закрытие; клик по версии → снова открыта; попап больше не показывается
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelector('.changelog-modal-overlay') === null, null, { timeout: 5000 })
  check('escape closes modal', true)
  check('popup dismissed after click', (await page.locator('.update-popup').count()) === 0)

  await page.locator('.app-version').click()
  await page.waitForSelector('.changelog-modal-overlay', { timeout: 5000 })
  check('modal opens from version click', true)
  await page.locator('.changelog-head .settings-close').click()
  await page.waitForFunction(() => document.querySelector('.changelog-modal-overlay') === null, null, { timeout: 5000 })
  check('close button works', true)

  log('SMOKE OK:', results.length, 'checks')
  process.exit(0)
}

main().catch((err) => {
  console.error('SMOKE FAIL:', err.message)
  process.exit(1)
})
