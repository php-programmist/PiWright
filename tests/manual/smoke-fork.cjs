/* Smoke: fork session UI. Attach over CDP, create a session, send a short prompt,
 * wait for the assistant answer, hover it, click the fork button, check a new
 * "(fork)" session appears and becomes active with replayed history. */
const { chromium } = require('playwright-core')

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9222')
  const context = browser.contexts()[0]
  const page = context.pages()[0]
  await page.waitForSelector('.projects-panel, .session-row, .history-item', { timeout: 30000 })

  // create a new session via the project "+" button (title "New session"/"Новая сессия")
  const newBtn = await page.$('button[title="New session"], button[title="Новая сессия"]')
  if (newBtn === null) {
    console.log('SMOKE-FAIL: new session button not found')
    process.exit(1)
  }
  await newBtn.click()
  await page.waitForSelector('.composer textarea', { timeout: 90000 })
  console.log('new session created')

  // send a short prompt
  const textarea = await page.$('.composer textarea')
  await textarea.fill('Ответь ровно одним словом: привет')
  const sendBtn = await page.$('.composer button:not([class])')
  await sendBtn.click()
  console.log('prompt sent')

  // wait for the assistant answer
  await page.waitForFunction(
    () => document.querySelectorAll('.transcript .assistant-message').length > 0,
    null,
    { timeout: 180000 }
  )
  await page.waitForFunction(() => !document.querySelector('.dot.streaming'), null, { timeout: 180000 })
  console.log('assistant answered')

  const count = await page.$$eval('.transcript .assistant-message', (els) => els.length)
  const opacity = await page.$eval('.transcript .assistant-fork', (el) => getComputedStyle(el).opacity)
  console.log('assistant messages:', count, 'fork opacity before hover:', opacity)

  const msg = await page.$('.transcript .assistant-message')
  await msg.hover()
  await page.waitForTimeout(300)
  const opacityHover = await page.$eval('.transcript .assistant-fork', (el) => getComputedStyle(el).opacity)
  console.log('fork opacity on hover:', opacityHover)
  await page.click('.transcript .assistant-message .assistant-fork')

  // wait for the forked session to appear and become active
  await page.waitForFunction(
    () => {
      const rows = Array.from(document.querySelectorAll('.session-row, .history-item'))
      return rows.some((r) => /\(fork\)/.test(r.textContent) && (r.className.includes('current') || r.className.includes('active') || r.className.includes('selected')))
    },
    null,
    { timeout: 90000 }
  )
  const forkTitle = await page.$eval('.session-row.current, .session-row.active, .history-item.active, .history-item.selected', (el) => el.textContent)
  console.log('active forked session:', forkTitle)

  // forked session shows replayed history (user + assistant entries)
  await page.waitForSelector('.transcript .assistant-message', { timeout: 30000 })
  const userCount = await page.$$eval('.transcript .user-message', (els) => els.length)
  console.log('fork transcript user messages:', userCount)
  console.log('SMOKE-OK')
  process.exit(0)
}

main().catch((err) => {
  console.error('SMOKE-FAIL:', err.message)
  process.exit(1)
})
