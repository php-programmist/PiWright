/* Smoke: панель петли восстанавливается после рестарта приложения. Settings смоук-инстанса
 * заранее сеются с активной петлёй (remaining=0 — после подъёма сессии петля останавливается
 * с лимитом, без API-вызовов) и открытой вкладкой той же сессии. Реаттач при старте происходит
 * ДО создания окна — loop_state туда не доходит, поэтому App на маунте дотягивает снимок
 * петель (loops:snapshot, как pending-диалоги). Детерминированная проверка через reload:
 * живой путь событий умирает вместе со стором рендерера, новых loop_state не будет —
 * остановленная петля может попасть в UI ТОЛЬКО через пулл снимка на маунте.
 * modelsRefresh() даёт статус-пуш, чтобы ChatView после reload отрисовался. */
const { chromium } = require('playwright-core')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'
const PROJECT_DIR = process.env.SMOKE_PROJECT_DIR
if (!PROJECT_DIR) throw new Error('SMOKE_PROJECT_DIR is required')

let failed = false
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
  if (!ok) failed = true
}

async function main() {
  console.log('project:', PROJECT_DIR)
  const browser = await chromium.connectOverCDP(CDP)
  const page = await browser.contexts()[0].pages()[0]
  await page.waitForSelector('.right-bar', { timeout: 60000 })

  // Даём сессии подняться: реаттач → onStatus(ready) → remaining=0 → петля остановлена в main.
  await page.waitForSelector('.session-row', { timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(12000)

  // Перезагрузка: стор рендерера пуст, живых loop_state больше не будет —
  // состояние петли может прийти только пуллом снимка на маунте App.
  await page.reload()
  await page.waitForSelector('.right-bar', { timeout: 60000 })

  // ChatView после reload рисуется только со статус-пушем — дёргаем modelsRefresh.
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
  await page.evaluate(() => window.piwright.modelsRefresh())
  await page.waitForSelector('.loop-stopped-text', { timeout: 30000 })
  const stopped = await page.locator('.loop-stopped-text').textContent()
  check('restored loop rendered in the panel', stopped !== null && stopped.toLowerCase().includes('loop stopped'), stopped ?? '')
}

main()
  .then(() => {
    console.log(failed ? 'SMOKE FAIL' : 'SMOKE OK')
    process.exit(failed ? 1 : 0)
  })
  .catch((err) => {
    console.error('SMOKE FAIL:', err.message)
    process.exit(1)
  })
