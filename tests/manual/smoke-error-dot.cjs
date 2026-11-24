/* Смоук красного круга при ошибке: ход с ошибкой модели → статус error (красный кружок
 * в шапке и панели), звук ошибки ровно один, completion-звука нет. Фейковый pi:
 * tests/manual/fake-pi-error.cmd (piPathNative в settings.json смоук-инстанса).
 * Без page.reload(): пуш статуса после хендшейка терялся бы — handshake фейкового pi
 * завершается раньше перезагрузки renderer'а. */
const { chromium } = require('playwright-core')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'

async function main() {
  const browser = await chromium.connectOverCDP(CDP)
  const page = await browser.contexts()[0].pages()[0]
  const log = (...a) => console.log(...a)

  await page.waitForSelector('.right-bar', { timeout: 30000 })

  const boot = await page.evaluate(async () => {
    const s = await window.piwright.getSettings()
    const project = (s.projects ?? []).find((p) => p.dir === 'D:\\Projects\\piwright')
    if (project === undefined) throw new Error('piwright project missing in settings')
    return await window.piwright.newSession(project)
  })
  log('session created:', boot.hostId)

  const expand = page.locator('button[title="Развернуть панель"], button[title="Expand panel"]')
  if ((await expand.count()) > 0) { await expand.click(); await page.waitForTimeout(800) }
  // Клик по expand может пролететь мимо из-за ре-рендера панели — ретраим.
  for (let i = 0; i < 5; i++) {
    await page.locator('.project .expand').first().click()
    try {
      await page.waitForSelector('.session-row', { timeout: 3000 })
      break
    } catch {
      if (i === 4) throw new Error('session row did not appear after expand clicks')
    }
  }
  await page.locator('.session-row').first().click()
  await page.waitForSelector('.composer textarea', { timeout: 30000 })
  await page.waitForTimeout(1500)

  // Патчим Audio ДО промпта: считаем проигрывания, чтобы отличить error от completion.
  await page.evaluate(() => {
    window.__plays = []
    window.Audio = class {
      constructor(url) {
        window.__plays.push(String(url).slice(0, 60))
      }

      play() {
        return Promise.resolve()
      }
    }
  })

  const input = page.locator('.composer textarea:not(.loop-exit)').first()
  await input.fill('trigger an errored turn')
  await page.locator('.send-wrap button').first().click()

  // Красный кружок и label error в шапке чата.
  await page.waitForSelector('.header .dot.error', { timeout: 60000 })
  const label = (await page.locator('.header .state').first().textContent()) ?? ''
  log('header state label:', label)
  if (!/error|ошибка/i.test(label)) throw new Error('header label is not error: ' + label)

  // Красный кружок в строке панели сессий.
  await page.waitForSelector('.session-row .dot.error', { timeout: 15000 })
  log('panel row dot error — ok')

  // Ошибка видна в ленте.
  await page.waitForSelector('.transcript .error', { timeout: 15000 })
  const errText = (await page.locator('.transcript .error').first().textContent()) ?? ''
  if (!errText.includes('UND_ERR_CONNECT_TIMEOUT')) throw new Error('error entry missing timeout text: ' + errText)
  log('transcript error entry — ok')

  // Звук: ровно один (error), completion после errored-хода не играет.
  await page.waitForTimeout(2000)
  const plays = await page.evaluate(() => window.__plays)
  log('sounds played:', plays.length)
  if (plays.length !== 1) throw new Error('expected exactly 1 sound (error), got ' + plays.length + ': ' + JSON.stringify(plays))

  await page.screenshot({ path: 'tests/manual/out-error-dot.png' })
  log('SMOKE OK')
  process.exit(0)
}

main().catch((err) => {
  console.error('SMOKE FAIL:', err)
  process.exit(1)
})
