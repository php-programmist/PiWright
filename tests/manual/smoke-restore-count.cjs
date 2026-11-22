const { chromium } = require('playwright-core')
async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9222')
  const page = browser.contexts()[0].pages()[0]
  const r = await page.evaluate(async () => {
    const el = document.querySelector('.transcript')
    if (!el) return { error: 'no transcript' }
    let guard = 0
    while (el.scrollTop > 0 && guard < 200) {
      el.scrollTop = 0
      await new Promise((res) => setTimeout(res, 120))
      guard++
    }
    return { kids: el.children.length, guard, height: el.scrollHeight }
  })
  console.log(JSON.stringify(r))
  await browser.close()
}
main().catch((e) => { console.log('ERR', e.message); process.exit(1) })
