const { chromium } = require('playwright-core')

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9222')
  const ctx = browser.contexts()[0]
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  await page.waitForSelector('.app', { timeout: 30000 })

  // Seed project via settings + reload (dir chooser dialog not automatable)
  await page.evaluate(() =>
    window.piwright.setSettings({ projects: [{ kind: 'native', dir: 'D:\\Projects\\piwright' }] })
  )
  await page.reload()
  await page.waitForSelector('.project-name', { timeout: 30000 })
  console.log('project visible: OK')

  // Create session via "+" in project row
  await page.click('button[title="New session"]')
  await page.waitForSelector('.terminal-dock, .history-item', { timeout: 90000 })
  // Wait until a session is active (chat view mounted)
  await page.waitForFunction(() => document.querySelector('.terminal-dock .panel-hint') === null || document.querySelector('.chat-view, .composer, textarea'), null, { timeout: 90000 })
  console.log('session active: OK')

  // Open terminal via right-bar toggle
  const hasDock = await page.locator('.terminal-dock').count()
  if (hasDock === 0) {
    await page.click('.term-toggle')
  }
  await page.waitForSelector('.terminal-head', { timeout: 30000 })
  console.log('terminal head: OK')

  // "+" then profile arrow right after it
  const plus = page.locator('.terminal-head .term-new')
  const arrow = page.locator('.terminal-head .term-profile-arrow')
  console.log('plus count:', await plus.count(), 'arrow count:', await arrow.count())
  const plusBox = await plus.first().boundingBox()
  const arrowBox = await arrow.boundingBox()
  console.log('arrow after plus:', arrowBox.x > plusBox.x, 'gap:', Math.round(arrowBox.x - (plusBox.x + plusBox.width)))
  console.log('old select gone:', (await page.locator('.term-profile-select').count()) === 0)

  // Open profile menu
  await arrow.click()
  await page.waitForSelector('.terminal-dock .tab-menu', { timeout: 5000 })
  const items = page.locator('.terminal-dock .tab-menu .tab-menu-item')
  const n = await items.count()
  const labels = []
  for (let i = 0; i < n; i++) labels.push(await items.nth(i).textContent())
  console.log('menu items:', n, '|', labels.join(' | '))

  // Spawn from menu
  const before = await page.locator('.term-tab').count()
  await items.nth(Math.min(1, n - 1)).click()
  await page.waitForFunction((b) => document.querySelectorAll('.term-tab').length > b, before, { timeout: 30000 })
  console.log('spawn from menu: OK, tabs:', await page.locator('.term-tab').count())

  // Collapse via "−" at right edge
  const collapse = page.locator('.terminal-head .term-collapse')
  console.log('collapse count:', await collapse.count())
  const collBox = await collapse.boundingBox()
  const head = await page.locator('.terminal-head').boundingBox()
  console.log('collapse near right edge:', Math.abs(head.x + head.width - (collBox.x + collBox.width)) < 24)
  await collapse.click()
  await page.waitForSelector('.terminal-dock', { state: 'detached', timeout: 5000 })
  console.log('collapsed: OK')

  // Reopen via right-bar toggle
  await page.click('.term-toggle')
  await page.waitForSelector('.terminal-head', { timeout: 10000 })
  console.log('reopened: OK')

  await browser.close()
  console.log('SMOKE PASSED')
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e.message)
  process.exit(1)
})
