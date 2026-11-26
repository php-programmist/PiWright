/** Смоук реальной вкладки транскрипта: проект piwright (в истории есть .history-item.sub),
 *  клик по транскрипту субагента, вкладка .tab.transcript остаётся строкой высотой с соседнюю. */
const { chromium } = require('playwright-core')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'
const PROJECT_DIR = 'D:\\Projects\\piwright'
let failed = false
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
  if (!ok) failed = true
}

;(async () => {
  const b = await chromium.connectOverCDP(CDP)
  const p = b.contexts()[0].pages()[0]
  await p.keyboard.press('Escape')
  await p.waitForTimeout(400)

  await p.evaluate(async (path) => {
    const current = await window.piwright.getSettings()
    await window.piwright.setSettings({ ...current, projects: [{ kind: 'native', dir: path }] })
  }, PROJECT_DIR)
  await p.reload()
  await p.waitForTimeout(3500)

  // Развернуть проект и подождать подгрузку истории
  const expanded = await p.evaluate(() => document.querySelectorAll('.session-row, .history-item').length > 0)
  if (!expanded) {
    await p.locator('.project-row .expand').first().evaluate((el) => el.click())
    await p.waitForTimeout(1500)
  }
  await p.locator('.history-item').first().waitFor({ timeout: 30000 })

  // Развернуть суб-транскрипты родителя, если есть тоггл, затем считать
  const toggle = p.locator('.history-item button.sub-toggle').first()
  if (await toggle.count()) await toggle.evaluate((el) => el.click())
  await p.waitForTimeout(500)
  const subCount = await p.locator('.history-item.sub').count()
  if (!subCount) {
    console.log('SKIP: no .history-item.sub even in piwright project')
    process.exit(0)
  }

  const before = await p.evaluate(() => {
    const tabs = [...document.querySelectorAll('.tab-bar .tab')]
    const normal = tabs.find((t) => !t.classList.contains('transcript'))
    return normal !== undefined ? normal.getBoundingClientRect().height : null
  })
  await p.locator('.history-item.sub').first().click()
  await p.waitForSelector('.tab-bar .tab.transcript', { timeout: 10000 })
  const real = await p.evaluate(() => {
    const tab = document.querySelector('.tab-bar .tab.transcript')
    const cs = getComputedStyle(tab)
    return { direction: cs.flexDirection, height: tab.getBoundingClientRect().height, padding: cs.padding }
  })
  check('real transcript tab is row', real.direction === 'row', `direction=${real.direction}`)
  check('real transcript tab padding compact', real.padding === '4px 6px 4px 10px', `padding=${real.padding}`)
  if (before !== null) {
    check('real transcript tab height ~= neighbor', Math.abs(real.height - before) <= 2, `tab=${real.height} neighbor=${before}`)
  }
  await p.locator('.tab-bar .tab.transcript .tab-close').evaluate((el) => el.click())

  console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS')
  process.exit(failed ? 1 : 0)
})().catch((e) => {
  console.error('ERROR', e)
  process.exit(2)
})
