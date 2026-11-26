/* Smoke: аттач сессии посреди хода. Длинный ход → крестик вкладки (keepAlive, агент дозревает
 * в демоне) → переоткрытие из History = аттач к живому процессу. Фикс c-5f6c359d: после аттача
 * кнопка «Подсказать» (.steer) видна (синтетический turn_start external), отправка уходит как
 * followUp без ошибки «агент уже работает». */
const { chromium } = require('playwright-core')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'
const PROJECT_DIR = process.env.SMOKE_PROJECT_DIR
if (!PROJECT_DIR) throw new Error('SMOKE_PROJECT_DIR is required (пустой temp-каталог, первый проект в settings.json смоук-инстанса)')

let failed = false
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
  if (!ok) failed = true
}

async function main() {
  console.log('project:', PROJECT_DIR)

  const browser = await chromium.connectOverCDP(CDP)
  const page = await browser.contexts()[0].pages()[0]
  await page.waitForSelector('.right-bar', { timeout: 30000 })

  const boot = await page.evaluate(async (dir) => await window.piwright.newSession({ kind: 'native', dir }), PROJECT_DIR)
  console.log('session created:', boot.hostId)

  const projectName = PROJECT_DIR.split('\\').pop()
  for (let i = 0; i < 5; i++) {
    try {
      await page.locator('.project', { hasText: projectName }).locator('.expand').first().click({ timeout: 2000 })
      await page.waitForSelector('.session-row', { timeout: 3000 })
      break
    } catch {
      if (i === 4) throw new Error('session row did not appear after expand clicks')
    }
  }
  await page.locator('.session-row').first().click()
  await page.waitForSelector('.composer textarea', { timeout: 90000 })
  await page.waitForTimeout(1500)

  const input = page.locator('.composer textarea:not(.loop-exit)').first()
  const LONG_PROMPT =
    'Напиши очень длинное эссе об истории письменности — не менее 3000 слов, развернуто, по разделам. Не используй инструменты, пиши ответ сразу.'
  await input.fill(LONG_PROMPT)
  await page.locator('.send-wrap button').first().click()

  // Ход пошёл: кнопка «Подсказать» видна (санити до аттача).
  await page.waitForSelector('.composer .steer', { timeout: 120000, state: 'visible' })
  check('steer visible during original turn', true)

  // Крестик вкладки во время хода — сессия уходит в фон (демон), ход дозревает.
  // Клик через evaluate: стриминг постоянно перерисовывает строку — node-клик нестабилен.
  let closed = false
  for (let i = 0; i < 5 && !closed; i++) {
    await page.evaluate(() => {
      const row = document.querySelector('.session-row')
      const btn = row?.querySelector('.icon.remove')
      if (btn instanceof HTMLElement) btn.click()
    })
    try {
      await page.waitForSelector('.session-row', { state: 'detached', timeout: 8000 })
      closed = true
    } catch {
      // перерисовка съела клик — повторяем
    }
  }
  check('tab closed during turn', closed)

  // Переоткрытие из History — аттач к живому ребёнку демона посреди хода.
  await page.waitForSelector('.history-item', { timeout: 30000 })
  await page.locator('.history-item').first().click()
  await page.waitForSelector('.composer textarea', { timeout: 90000 })

  // Фикс: синтетический turn_start external → streaming-UI возвращается.
  await page.waitForSelector('.composer .steer', { timeout: 30000, state: 'visible' })
  check('steer visible after attach (the fix)', true)

  // Второй симптом: отправка во время аттачнутого хода — followUp, без ошибки «уже работает».
  await input.fill('продолжай')
  await page.locator('.send-wrap button').first().click()
  await page.waitForTimeout(4000)
  const errorCount = await page.locator('.transcript .entry-error').count()
  check('no turn-error after followUp send', errorCount === 0, `turn-error count: ${errorCount}`)

  // Ход(ы) завершаются: followUp мог начать второй ход — ждём устойчивое отсутствие .steer.
  const deadline = Date.now() + 600000
  let done = false
  while (Date.now() < deadline) {
    if ((await page.locator('.composer .steer').count()) === 0) {
      await page.waitForTimeout(5000)
      if ((await page.locator('.composer .steer').count()) === 0) {
        done = true
        break
      }
    }
    await page.waitForTimeout(2000)
  }
  check('steer hidden after turn end', done)

  await page.screenshot({ path: 'tests/manual/out-attach-steer.png' })
  if (failed) {
    console.error('SMOKE FAIL')
    process.exit(1)
  }
  console.log('SMOKE OK')
  process.exit(0)
}

main().catch((err) => {
  console.error('SMOKE FAIL:', err)
  process.exit(1)
})
