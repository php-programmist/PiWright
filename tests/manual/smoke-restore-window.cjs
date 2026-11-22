// Smoke: restore long session -> no scroll jitter, windowed render, lazy prepend on scroll-up.
const { chromium } = require('playwright-core')

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9222')
  const ctx = browser.contexts()[0]
  const page = ctx.pages()[0]
  await page.bringToFront()

  // Open the spark project (wsl) history and pick the biggest session.
  const projectRows = await page.locator('.project-row').all()
  let opened = false
  for (const row of projectRows) {
    const name = await row.textContent()
    if (!/spark/i.test(name ?? '')) continue
    await row.click()
    await page.waitForTimeout(3000)
    const items = page.locator('.history-item')
    const n = await items.count()
    if (n === 0) { console.log('spark: no history items'); continue }
    await items.first().click()
    opened = true
    console.log('opened session from spark project, history items:', n)
    break
  }
  if (!opened) { console.log('FAIL: spark project not found/expanded'); await browser.close(); return }

  // Wait for transcript to appear.
  await page.waitForSelector('.transcript', { timeout: 90000 })
  await page.waitForTimeout(1000)

  // Instrument: sample scrollTop + DOM entry count over 6s.
  const samples = await page.evaluate(async () => {
    const el = document.querySelector('.transcript')
    if (!el) return { error: 'no .transcript' }
    const out = []
    let mutations = 0
    const mo = new MutationObserver((recs) => { mutations += recs.length })
    mo.observe(el, { childList: true, subtree: true })
    for (let i = 0; i < 120; i++) {
      out.push({ t: performance.now(), top: el.scrollTop, h: el.scrollHeight, ch: el.clientHeight, kids: el.children.length })
      await new Promise((r) => setTimeout(r, 50))
    }
    mo.disconnect()
    return { samples: out, mutations }
  })
  if (samples.error) { console.log('FAIL', samples.error); await browser.close(); return }

  const tops = samples.samples.map((s) => s.top)
  const kids = samples.samples.map((s) => s.kids)
  const min = Math.min(...tops), max = Math.max(...tops)
  const deltas = []
  for (let i = 1; i < tops.length; i++) deltas.push(Math.abs(tops[i] - tops[i - 1]))
  const bigFlips = deltas.filter((d) => d > 50).length
  console.log('entries rendered (kids):', kids[kids.length - 1], 'min/max:', Math.min(...kids), Math.max(...kids))
  console.log('scrollTop min/max:', Math.round(min), Math.round(max), 'range:', Math.round(max - min))
  console.log('big flips >50px:', bigFlips, 'mutations:', samples.mutations)
  const last = samples.samples[samples.samples.length - 1]
  const distBottom = last.h - last.top - last.ch
  console.log('dist to bottom:', Math.round(distBottom))

  // Scroll to top -> expect prepend (kids grow), position preserved (no jump to bottom).
  const before = await page.evaluate(() => {
    const el = document.querySelector('.transcript')
    el.scrollTop = 0
    return { kids: el.children.length, h: el.scrollHeight }
  })
  await page.waitForTimeout(1500)
  const after = await page.evaluate(() => {
    const el = document.querySelector('.transcript')
    return { kids: el.children.length, h: el.scrollHeight, top: el.scrollTop }
  })
  console.log('scroll-up prepend: kids', before.kids, '->', after.kids, 'height', before.h, '->', after.h, 'scrollTop', Math.round(after.top))

  await browser.close()
}
main().catch((e) => { console.log('ERR', e.message); process.exit(1) })
