/* Smoke: shiki highlighting works in built app (JS-regex engine, no wasm/CSP).
 * Attach over CDP, create a session, ask the agent to reply with a ```bash
 * code block, verify the block renders highlighted (.code-block without
 * .plain, inner pre.shiki), not the plain fallback. */
const { chromium } = require('playwright-core')

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9223')
  const context = browser.contexts()[0]
  const page = context.pages()[0]
  page.on('console', (msg) => {
    if (msg.type() === 'warning' || msg.type() === 'error') {
      console.log(`[console.${msg.type()}]`, msg.text().slice(0, 400))
    }
  })
  await page.waitForSelector('.projects-panel, .session-row, .history-item', { timeout: 30000 })

  const newBtn = await page.$('button[title="New session"], button[title="Новая сессия"]')
  if (newBtn === null) {
    console.log('SMOKE-FAIL: new session button not found')
    process.exit(1)
  }
  await newBtn.click()
  await page.waitForSelector('.composer textarea', { timeout: 90000 })
  console.log('new session created')

  const textarea = await page.$('.composer textarea')
  await textarea.fill('Ответь ровно одним fenced код-блоком ```bash с одной строкой: echo "hello world" — без пояснений, без текста до или после блока.')
  const sendBtn = await page.$('.composer button:not([class])')
  await sendBtn.click()
  console.log('prompt sent')

  await page.waitForFunction(() => !document.querySelector('.dot.streaming'), null, { timeout: 180000 })
  console.log('streaming done')

  await page.waitForFunction(
    () => document.querySelector('.assistant-message .code-block') !== null,
    null,
    { timeout: 30000 }
  )
  await page.waitForTimeout(2000)

  const plainBlocks = await page.$$eval('.assistant-message .code-block.plain', (els) => els.length)
  const shikiBlocks = await page.$$eval('.assistant-message .code-block pre.shiki', (els) => els.length)
  const copyButtons = await page.$$eval('.assistant-message .code-block-wrap .code-copy-btn', (els) => els.length)
  console.log('plain blocks:', plainBlocks, '| pre.shiki blocks:', shikiBlocks, '| copy buttons:', copyButtons)

  if (shikiBlocks === 0) {
    console.log('SMOKE-FAIL: no highlighted block (shiki fell back to plain or failed)')
    process.exit(1)
  }
  if (plainBlocks > 0) {
    console.log('SMOKE-FAIL: some blocks rendered as plain fallback')
    process.exit(1)
  }
  const sample = await page.$eval('.assistant-message .code-block', (el) => el.innerHTML.slice(0, 200))
  console.log('sample html:', sample)
  console.log('SMOKE-OK')
  process.exit(0)
}

main().catch((err) => {
  console.log('SMOKE-FAIL:', err.message)
  process.exit(1)
})
