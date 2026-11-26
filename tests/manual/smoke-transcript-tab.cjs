/** Смоук вкладки транскрипта дочерней сессии: класс `tab transcript` не должен
 *  подхватывать правило `main.transcript` (flex-direction: column) — вкладка остаётся
 *  строкой той же высоты, что соседние. Проверяет синтетический элемент и, если в
 *  истории есть транскрипт субагента, реальную вкладку. */
const { chromium } = require('playwright-core')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'
let failed = false
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
  if (!ok) failed = true
}

;(async () => {
  const b = await chromium.connectOverCDP(CDP)
  const p = b.contexts()[0].pages()[0]
  await p.waitForTimeout(1500)
  await p.keyboard.press('Escape')
  await p.waitForTimeout(400)

  // Синтетика: стиль .tab.transcript — строка, компактный паддинг, без gap/column.
  const synthetic = await p.evaluate(() => {
    const el = document.createElement('div')
    el.className = 'tab transcript'
    document.querySelector('.tab-bar')?.appendChild(el)
    const cs = getComputedStyle(el)
    const out = { direction: cs.flexDirection, padding: cs.padding, gap: cs.gap, height: el.getBoundingClientRect().height }
    el.remove()
    return out
  })
  check('synthetic .tab.transcript is row', synthetic.direction === 'row', `direction=${synthetic.direction}`)
  check('synthetic padding compact', synthetic.padding === '4px 6px 4px 10px', `padding=${synthetic.padding}`)

  // Реальная вкладка: клик по транскрипту субагента в истории (если есть).
  const subItem = p.locator('.history-item.sub').first()
  if (await subItem.count()) {
    const before = await p.evaluate(() => {
      const tabs = [...document.querySelectorAll('.tab-bar .tab')]
      const normal = tabs.find((t) => !t.classList.contains('transcript'))
      return normal !== undefined ? normal.getBoundingClientRect().height : null
    })
    await subItem.click()
    await p.waitForSelector('.tab-bar .tab.transcript', { timeout: 10000 })
    const real = await p.evaluate(() => {
      const tab = document.querySelector('.tab-bar .tab.transcript')
      const cs = getComputedStyle(tab)
      return { direction: cs.flexDirection, height: tab.getBoundingClientRect().height }
    })
    check('real transcript tab is row', real.direction === 'row', `direction=${real.direction}`)
    if (before !== null) {
      check('real transcript tab height ~= neighbor', Math.abs(real.height - before) <= 2, `tab=${real.height} neighbor=${before}`)
    }
    // закрыть вкладку обратно
    await p.locator('.tab-bar .tab.transcript .tab-close').evaluate((el) => el.click())
  } else {
    console.log('SKIP real transcript tab: no .history-item.sub in history')
  }

  console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS')
  process.exit(failed ? 1 : 0)
})().catch((e) => {
  console.error('ERROR', e)
  process.exit(2)
})
