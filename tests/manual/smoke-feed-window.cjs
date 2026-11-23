// Smoke: restored long feed uses the grow-upward window — real-content scrollHeight,
// tail-only render, lazy prepend on scroll-up, no blank viewport while scrolling.
// All measurements scope to the VISIBLE .transcript (hidden tabs keep their DOM).
const { chromium } = require('playwright-core')

const fail = (msg) => { console.log('FAIL: ' + msg) }

const findVisible = `(() => [...document.querySelectorAll('.transcript')].find((el) => el.offsetParent !== null) ?? null)()`

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9223')
  const ctx = browser.contexts()[0]
  const page = ctx.pages()[0]
  await page.bringToFront()

  // Pick the project with the most history items.
  const rows = await page.locator('.project-row').all()
  let best = null
  for (const row of rows) {
    await row.click()
    await page.waitForTimeout(2500)
    const n = await page.locator('.history-item').count()
    if (best === null || n > best.n) best = { row, n }
    if (best.n >= 5) break
  }
  if (best === null || best.n === 0) { fail('no project with history'); await browser.close(); return }
  await best.row.click()
  await page.waitForTimeout(2500)
  await page.locator('.history-item').first().click()
  console.log('opened session, history items:', best.n)

  await page.waitForSelector('.transcript:visible .user-message, .transcript:visible .assistant-message, .transcript:visible .tool-block, .transcript:visible .info-message', { timeout: 90000 })
  await page.waitForTimeout(2000)

  // 1. Tail-only render: few DOM entries, no spacers, scrollHeight == real content.
  const base = await page.evaluate(`(() => {
    const el = ${findVisible}
    if (el === null) return { error: 'no visible transcript' }
    const kids = el.children
    const last = kids[kids.length - 1]
    return {
      kids: kids.length,
      spacers: el.querySelectorAll('.feed-spacer').length,
      scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
      top: el.scrollTop,
      tailGap: el.scrollHeight - (last.offsetTop + last.offsetHeight),
      distBottom: el.scrollHeight - el.scrollTop - el.clientHeight
    }
  })()`)
  if (base.error) { fail(base.error); await browser.close(); return }
  console.log('after restore:', JSON.stringify(base))
  if (base.spacers !== 0) { fail('feed-spacer found'); await browser.close(); return }
  if (base.kids > 3 && base.tailGap > 150) { fail('phantom space below content: ' + base.tailGap + 'px'); await browser.close(); return }
  if (base.kids > 3 && base.distBottom > 60) { fail('not pinned to bottom: dist ' + base.distBottom); await browser.close(); return }
  if (base.kids > 120) { fail('too many DOM kids for tail window: ' + base.kids); await browser.close(); return }

  // 2. Scroll to top: prepend grows the DOM, visual position preserved (scrollTop += added height).
  const before = await page.evaluate(`(() => {
    const el = ${findVisible}
    if (el === null) return null
    el.scrollTop = 0
    return { kids: el.children.length, h: el.scrollHeight, top: el.scrollTop }
  })()`)
  if (before === null) { fail('no visible transcript'); await browser.close(); return }
  await page.waitForTimeout(1200)
  const afterTop = await page.evaluate(`(() => {
    const el = ${findVisible}
    return { kids: el.children.length, h: el.scrollHeight, top: el.scrollTop }
  })()`)
  console.log('scroll-up prepend: kids', before.kids, '->', afterTop.kids, 'height', before.h, '->', afterTop.h, 'scrollTop', Math.round(afterTop.top))
  if (afterTop.kids <= before.kids) { fail('no prepend on scroll-up'); await browser.close(); return }
  if (afterTop.h <= before.h) { fail('scrollHeight did not grow on prepend'); await browser.close(); return }
  const expectedTop = before.top + (afterTop.h - before.h)
  if (Math.abs(afterTop.top - expectedTop) > 50) { fail(`position lost on prepend: scrollTop ${Math.round(afterTop.top)}, expected ~${Math.round(expectedTop)}`); await browser.close(); return }

  // 3. Scroll sweep: no contiguous blank region taller than a few inter-entry gaps.
  const steps = await page.evaluate(`(async () => {
    const el = ${findVisible}
    const max = el.scrollHeight - el.clientHeight
    const blanks = []
    for (let i = 0; i <= 20; i++) {
      const top = Math.round((max * i) / 20)
      el.scrollTop = top
      await new Promise((r) => setTimeout(r, 120))
      const rect = el.getBoundingClientRect()
      const xs = [rect.left + rect.width * 0.25, rect.left + rect.width * 0.5, rect.left + rect.width * 0.75]
      let run = 0
      let worst = 0
      for (let y = rect.top + 4; y < rect.bottom - 4; y += 6) {
        const covered = xs.some((x) => {
          const hit = document.elementFromPoint(x, y)
          return hit !== null && hit !== el
        })
        if (!covered) { run += 6; if (run > worst) worst = run } else run = 0
      }
      if (worst > 80) blanks.push({ top, worst })
    }
    return { blanks, scrollHeight: el.scrollHeight, kids: el.children.length }
  })()`)
  console.log('scroll sweep: kids', steps.kids, 'scrollHeight', steps.scrollHeight, 'blank runs:', JSON.stringify(steps.blanks))
  if (steps.blanks.length > 0) { fail('blank viewport regions: ' + JSON.stringify(steps.blanks)); await browser.close(); return }

  // 4. Back to bottom: pinned again, content intact.
  const end = await page.evaluate(`(async () => {
    const el = ${findVisible}
    el.scrollTop = el.scrollHeight
    await new Promise((r) => setTimeout(r, 600))
    return { distBottom: el.scrollHeight - el.scrollTop - el.clientHeight, kids: el.children.length }
  })()`)
  console.log('back to bottom:', JSON.stringify(end))
  if (end.distBottom > 60) { fail('cannot reach bottom: dist ' + end.distBottom); await browser.close(); return }

  console.log('OK')
  await browser.close()
}
main().catch((e) => { console.log('ERR', e.message); process.exit(1) })
