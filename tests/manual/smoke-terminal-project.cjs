const { chromium } = require('playwright-core')

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9222')
  const ctx = browser.contexts()[0]
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  await page.waitForSelector('.app', { timeout: 30000 })

  // Fresh state: no active session, only project tabs visible
  const hasProject = await page.locator('.project-name').count()
  if (hasProject === 0) {
    await page.evaluate(() =>
      window.piwright.setSettings({ projects: [{ kind: 'native', dir: 'D:\\Projects\\piwright' }] })
    )
    await page.reload()
    await page.waitForSelector('.project-name', { timeout: 30000 })
  }
  // Switch to project tabs (no session tab active)
  await page.locator('.project-name').first().click()
  await page.waitForTimeout(500)

  // Open terminal WITHOUT any active session (toggle only if closed — open state persists)
  if ((await page.locator('.terminal-dock').count()) === 0) {
    await page.click('.term-toggle')
  }
  const head = await page.waitForSelector('.terminal-head', { timeout: 30000 }).then(() => true).catch(() => false)
  console.log('terminal head without session:', head)
  const hint = await page.locator('.terminal-dock .panel-hint').count()
  console.log('hint shown (should be 0):', hint)

  // Spawn default terminal via "+"
  await page.click('.terminal-head .term-new')
  await page.waitForSelector('.term-tab', { timeout: 30000 })
  console.log('tab spawned without session: OK')

  // Profile menu works too
  await page.click('.terminal-head .term-profile-arrow')
  await page.waitForSelector('.terminal-dock .tab-menu', { timeout: 5000 })
  console.log('profile menu: OK')
  await page.keyboard.press('Escape')

  // Collapse and reopen
  await page.click('.terminal-head .term-collapse')
  await page.waitForSelector('.terminal-dock', { state: 'detached', timeout: 5000 })
  await page.click('.term-toggle')
  await page.waitForSelector('.terminal-head', { timeout: 10000 })
  console.log('collapse/reopen: OK')

  await browser.close()
  console.log('SMOKE PASSED')
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e.message)
  process.exit(1)
})
