/* Smoke: kanban c-804772a6 — vertical drag-and-drop reordering of projects.
   Needs 3 seeded projects (P1,P2,P3) in the smoke user-data-dir settings.json.
   Drags P1 below P3 via synthetic DragEvent, checks drop line, new DOM order,
   settings persistence (getSettings + reload).
   SMOKE_CDP=http://localhost:9223 */
const { chromium } = require('playwright-core')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'

async function waitUntil(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    last = await fn()
    if (last) return last
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('timeout: ' + label + ' — last: ' + JSON.stringify(last))
}

async function names(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('.project .project-name')).map((el) => el.textContent.trim()))
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP)
  const page = browser.contexts()[0].pages()[0]
  try {
    await page.waitForSelector('.project', { timeout: 30000 })
    let order = await names(page)
    console.log('initial order:', order.join(', '))
    if (JSON.stringify(order) !== JSON.stringify(['P1', 'P2', 'P3'])) {
      throw new Error('expected seeded order P1,P2,P3, got ' + order.join(','))
    }

    const draggable = await page.locator('.project-row').first().getAttribute('draggable')
    if (draggable !== 'true') throw new Error('project row is not draggable')

    // Drag P1 below P3: dragstart on row 0, dragover near the bottom of the body, drop.
    await page.evaluate(() => {
      const body = document.querySelector('.panel-body')
      const row = body.querySelector('.project-row')
      const rows = Array.from(body.querySelectorAll('[data-project-index]'))
      const last = rows[rows.length - 1].getBoundingClientRect()
      const dt = new DataTransfer()
      row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
      body.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          clientX: last.left + 10,
          clientY: last.bottom - 2,
          dataTransfer: dt
        })
      )
    })
    await page.waitForSelector('.project-drop-line', { timeout: 5000 })
    console.log('drop line visible during drag')
    await page.evaluate(() => {
      const body = document.querySelector('.panel-body')
      body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))
    })
    await waitUntil(async () => {
      order = await names(page)
      return JSON.stringify(order) === JSON.stringify(['P2', 'P3', 'P1'])
    }, 5000, 'order after drop')
    console.log('order after drop:', order.join(', '))

    // Persisted into settings (main memory).
    const saved = await page.evaluate(async () => (await window.piwright.getSettings()).projects.map((p) => p.name))
    if (JSON.stringify(saved) !== JSON.stringify(['P2', 'P3', 'P1'])) {
      throw new Error('settings order wrong: ' + saved.join(','))
    }
    console.log('settings persisted:', saved.join(', '))

    // Survives reload.
    await page.reload()
    await page.waitForSelector('.project', { timeout: 30000 })
    order = await names(page)
    if (JSON.stringify(order) !== JSON.stringify(['P2', 'P3', 'P1'])) {
      throw new Error('order lost after reload: ' + order.join(','))
    }
    console.log('order survives reload:', order.join(', '))

    console.log('SMOKE OK')
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error('SMOKE FAIL:', err.message)
  process.exit(1)
})
