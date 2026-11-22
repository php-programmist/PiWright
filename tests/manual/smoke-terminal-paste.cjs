const { chromium } = require('playwright-core')

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9222')
  const ctx = browser.contexts()[0]
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  await page.waitForSelector('.app', { timeout: 30000 })

  const hasProject = await page.locator('.project-name').count()
  if (hasProject === 0) {
    await page.evaluate(() =>
      window.piwright.setSettings({ projects: [{ kind: 'native', dir: 'D:\\Projects\\piwright' }] })
    )
    await page.reload()
    await page.waitForSelector('.project-name', { timeout: 30000 })
  }
  await page.locator('.project-name').first().click()
  await page.waitForTimeout(500)

  if ((await page.locator('.terminal-dock').count()) === 0) {
    await page.click('.term-toggle')
  }
  const tabsBefore = await page.locator('.term-tab').count()
  await page.click('.terminal-head .term-new')
  await page.waitForSelector('.term-host', { timeout: 30000 })
  await page.waitForTimeout(2500)

  await page.evaluate(() => navigator.clipboard.writeText('echo PASTE_SMOKE_OK'))
  await page.waitForTimeout(300)

  // Capture-phase paste listener: if the Ctrl+V keydown reaches the browser default
  // action (custom key handler let it through), a paste event fires on the focused
  // xterm textarea — the same event xterm's own paste handler consumes to feed the pty.
  await page.evaluate(() => {
    window.__pasteEvents = []
    document.addEventListener(
      'paste',
      (e) => {
        window.__pasteEvents.push(e.clipboardData ? e.clipboardData.getData('text') : null)
      },
      true
    )
  })

  await page.locator('.term-host').click()
  await page.waitForTimeout(300)
  await page.keyboard.press('Control+v')
  await page.waitForTimeout(1000)

  const pasteEvents = await page.evaluate(() => window.__pasteEvents)
  console.log('paste events:', JSON.stringify(pasteEvents))
  if (!pasteEvents.includes('echo PASTE_SMOKE_OK')) {
    await browser.close()
    throw new Error('paste event with clipboard text did not fire')
  }

  // Cleanup: close the tab spawned by this smoke
  const closeButtons = page.locator('.term-tab .term-close')
  const extra = (await closeButtons.count()) - tabsBefore
  for (let i = 0; i < extra; i++) {
    await closeButtons.last().click()
    await page.waitForTimeout(400)
  }

  await browser.close()
  console.log('SMOKE PASSED')
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e.message)
  process.exit(1)
})
