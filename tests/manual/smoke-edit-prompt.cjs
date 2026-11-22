/* Smoke: edit-prompt UI. Attach over CDP, open a session, hover a user message,
 * click the pencil, check the inline editor opens, Cancel restores the bubble. */
const { chromium } = require('playwright-core')

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9222')
  const context = browser.contexts()[0]
  const page = context.pages()[0]
  await page.waitForSelector('.history-item', { timeout: 30000 })
  // Открываем историческую сессию — возобновит pi и реплейнет историю
  await page.locator('.history-item').first().click()
  await page.waitForSelector('.user-message', { timeout: 90000 })
  const before = await page.locator('.user-message').count()
  console.log('user messages:', before)
  // Карандаш появляется по ховеру
  const first = page.locator('.user-message').last()
  await first.hover()
  const pencil = first.locator('.user-edit')
  console.log('pencil visible on hover:', await pencil.isVisible())
  await pencil.click()
  await page.waitForSelector('.user-message.editing .user-edit-area', { timeout: 5000 })
  const value = await page.locator('.user-edit-area').inputValue()
  console.log('editor opened, draft equals original:', value === (await first.textContent()))
  // Escape закрывает редактор
  await page.locator('.user-edit-area').press('Escape')
  const editingCount = await page.locator('.user-message.editing').count()
  console.log('editor closed after Escape:', editingCount === 0)
  // Кнопки Cancel/Send существуют
  await first.hover()
  await pencil.click()
  const buttons = await page.locator('.user-edit-actions button').allTextContents()
  console.log('edit actions:', JSON.stringify(buttons))
  await page.locator('.user-edit-actions button').first().click()
  console.log('cancel closes editor:', (await page.locator('.user-message.editing').count()) === 0)
  await browser.close()
  console.log('SMOKE OK')
}

main().catch((err) => {
  console.error('SMOKE FAIL:', err.message)
  process.exit(1)
})
