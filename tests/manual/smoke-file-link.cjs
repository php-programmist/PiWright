/* Smoke: markdown file link in chat opens a file tab with content.
 * Attach over CDP, create a session, ask the agent to reply with a markdown
 * link to package.json, click the link, verify a file tab opens non-empty. */
const { chromium } = require('playwright-core')

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9222')
  const context = browser.contexts()[0]
  const page = context.pages()[0]
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
  await textarea.fill('Ответь ровно одной строкой markdown, без пояснений и без код-блока: [ссылка](package.json)')
  const sendBtn = await page.$('.composer button:not([class])')
  await sendBtn.click()
  console.log('prompt sent')

  await page.waitForFunction(() => !document.querySelector('.dot.streaming'), null, { timeout: 180000 })
  await page.waitForFunction(
    () => document.querySelectorAll('.markdown a').length > 0,
    null,
    { timeout: 30000 }
  )
  const linkText = await page.$eval('.markdown a', (el) => el.textContent)
  const href = await page.$eval('.markdown a', (el) => el.getAttribute('href'))
  console.log('link found:', JSON.stringify(linkText), 'href:', href)
  if (href === null || !href.includes('package.json')) {
    console.log('SMOKE-FAIL: link is not package.json')
    process.exit(1)
  }

  const tabsBefore = await page.$$eval('.tab', (els) => els.length)
  await page.click('.markdown a')
  await page.waitForFunction(
    (n) => document.querySelectorAll('.tab').length > n,
    tabsBefore,
    { timeout: 10000 }
  )
  console.log('file tab opened')

  await page.waitForFunction(
    () => {
      const body = document.querySelector('.file-body')
      return body !== null && (body.textContent ?? '').trim().length > 50
    },
    null,
    { timeout: 20000 }
  )
  const contentLen = await page.$eval('.file-body', (el) => (el.textContent ?? '').trim().length)
  console.log('file content length:', contentLen)
  console.log('SMOKE-OK')
  process.exit(0)
}

main().catch((err) => {
  console.log('SMOKE-FAIL:', err.message)
  process.exit(1)
})
