const { chromium } = require('playwright-core')

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9222')
  const ctx = browser.contexts()[0]
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  await page.waitForSelector('.app', { timeout: 30000 })

  const names = page.locator('.project-name')

  async function goTo(part) {
    const idx = await page.evaluate((p) => {
      const els = [...document.querySelectorAll('.project-name')]
      return els.findIndex((e) => (e.getAttribute('title') ?? '').includes(p))
    }, part)
    await names.nth(idx).click()
    await page.waitForTimeout(1200)
  }

  async function closeTabByLabel(label) {
    const tabs = page.locator('.term-tab', { hasText: label })
    const n = await tabs.count()
    if (n === 0) return false
    await tabs.last().locator('.term-close').click()
    await page.waitForTimeout(800)
    return true
  }

  // spark: close spawned "Ubuntu 3" and "PowerShell" (keep restored Ubuntu, Ubuntu 2)
  await goTo('spark')
  console.log('spark close Ubuntu 3:', await closeTabByLabel('Ubuntu 3'))
  console.log('spark close PowerShell:', await closeTabByLabel('PowerShell'))

  // jb-pi: close spawned "Ubuntu 2"
  await goTo('jb-pi')
  console.log('jb-pi close Ubuntu 2:', await closeTabByLabel('Ubuntu 2'))

  // piwright: close "PowerShell 3" if present
  await goTo('piwright')
  console.log('piwright close PowerShell 3:', await closeTabByLabel('PowerShell 3'))

  const info = await page.evaluate(() => ({
    tabs: [...document.querySelectorAll('.term-tab .term-tab-name')].map((e) => e.textContent)
  }))
  console.log('piwright final tabs:', JSON.stringify(info.tabs))

  await browser.close()
  console.log('CLEANUP DONE')
}

main().catch((e) => {
  console.error('CLEANUP FAILED:', e.message)
  process.exit(1)
})
