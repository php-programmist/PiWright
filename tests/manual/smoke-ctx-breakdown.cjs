/* Smoke: context breakdown popover in chat header.
 * Attach over CDP, create a session, send a prompt, wait for the turn,
 * click the ctx-usage percent, verify popover rows with token counts. */
const { chromium } = require('playwright-core')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'

async function main() {
  const browser = await chromium.connectOverCDP(CDP)
  const context = browser.contexts()[0]
  const page = context.pages()[0]
  await page.waitForSelector('.sessions-panel', { timeout: 30000, state: 'attached' })
  const hasProject = await page.locator('.project-name').count()
  if (hasProject === 0) {
    await page.evaluate(() =>
      window.piwright.setSettings({ projects: [{ kind: 'native', dir: 'D:/Projects/piwright' }] })
    )
    await page.evaluate(() => location.reload())
    await page.waitForSelector('.sessions-panel', { timeout: 30000, state: 'attached' })
  }
  await page.waitForSelector('.project-name', { timeout: 30000 })

  // Git/files/kanban panels overlay the chat header — close any open one
  for (const title of ['Git', 'Гит', 'Files', 'Файлы', 'Kanban', 'Канбан']) {
    const btn = await page.$(`.right-bar button.active[title="${title}"]`)
    if (btn !== null) {
      await btn.click()
      await page.waitForTimeout(200)
    }
  }

  const newBtn = await page.$('button[title="New session"], button[title="Новая сессия"]')
  if (newBtn === null) {
    console.log('SMOKE-FAIL: new session button not found')
    process.exit(1)
  }
  await newBtn.click()
  await page.waitForSelector('.composer textarea', { timeout: 90000 })
  console.log('new session created')

  const textarea = await page.$('.composer textarea')
  await textarea.fill('Ответь ровно одним словом: привет')
  const sendBtn = await page.$('.composer button:not([class])')
  await sendBtn.click()
  console.log('prompt sent')

  await page.waitForFunction(() => !document.querySelector('.dot.streaming'), null, { timeout: 180000 })
  await page.waitForSelector('.ctx-usage', { timeout: 30000 })
  const percent = await page.$eval('.ctx-usage', (el) => el.textContent)
  console.log('ctx-usage:', percent)

  await page.click('.ctx-usage')
  await page.waitForSelector('.ctx-popover', { timeout: 10000 })
  const rows = await page.$$eval('.ctx-popover .ctx-row', (els) =>
    els.map((el) => {
      const label = el.querySelector('.ctx-row-label')?.textContent ?? ''
      const value = el.querySelector('.ctx-row-value')?.textContent ?? ''
      const pct = el.querySelector('.ctx-row-pct')?.textContent ?? ''
      return `${label}=${value}${pct}`
    })
  )
  console.log('popover rows:', JSON.stringify(rows, null, 1))

  const total = rows.find((r) => r.startsWith('Всего') || r.startsWith('Total'))
  if (total === undefined) {
    console.log('SMOKE-FAIL: total row missing')
    process.exit(1)
  }
  const hasSystem = rows.some((r) => r.includes('Системный промпт') || r.includes('System prompt'))
  const hasUser = rows.some((r) => r.includes('пользователя') || r.includes('User messages'))
  const hasAgent = rows.some((r) => r.includes('агента') || r.includes('Agent text'))
  if (!hasSystem || !hasUser || !hasAgent) {
    console.log('SMOKE-FAIL: expected buckets missing')
    process.exit(1)
  }

  // Overflow check: popover must not exceed viewport
  const fits = await page.$eval('.ctx-popover', (el) => {
    const r = el.getBoundingClientRect()
    return r.right <= window.innerWidth && r.bottom <= window.innerHeight && r.left >= 0
  })
  if (!fits) {
    console.log('SMOKE-FAIL: popover overflows viewport')
    process.exit(1)
  }

  // Close by Escape, reopen — data refetches
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelector('.ctx-popover') === null, null, { timeout: 5000 })
  await page.click('.ctx-usage')
  await page.waitForSelector('.ctx-popover', { timeout: 10000 })
  console.log('reopen works')

  // Screenshot for layout check
  await page.screenshot({ path: 'tests/manual/out-ctx-breakdown.png' })
  console.log('SMOKE-OK')
}

main().catch((err) => {
  console.log('SMOKE-FAIL:', err.message)
  process.exit(1)
})
