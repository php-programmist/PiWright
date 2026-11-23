/* Smoke: slash-command substring search. Attach over CDP, create a session,
 * type "/rele" in the composer, check "/skill:release" appears in the menu;
 * prefix matches still rank first for "/auto". */
const { chromium } = require('playwright-core')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'

async function main() {
  const browser = await chromium.connectOverCDP(CDP)
  const context = browser.contexts()[0]
  const page = context.pages()[0]
  // Новая сессия: «+» в строке проекта
  const newBtn = page.locator('[title="Новая сессия"]').first()
  await newBtn.waitFor({ timeout: 30000 })
  await page.evaluate((el) => el.click(), await newBtn.elementHandle())
  const input = page.locator('.composer textarea').first()
  await input.waitFor({ timeout: 90000 })

  // Ждём загрузки списка команд: пустой токен "/" должен открыть меню
  await input.click()
  await input.fill('/')
  let loaded = false
  for (let i = 0; i < 30; i++) {
    if ((await page.locator('.slash-menu .slash-item').count()) > 0) { loaded = true; break }
    await page.waitForTimeout(1000)
    await input.fill('')
    await input.fill('/')
  }
  if (!loaded) throw new Error('slash menu never appeared for "/"')
  const all = await page.locator('.slash-menu .slash-name').allTextContents()
  console.log('menu for "/":', all.length, 'items')

  // Подстрока: /rele → skill:release
  await input.fill('/rele')
  await page.waitForTimeout(300)
  const rele = await page.locator('.slash-menu .slash-name').allTextContents()
  console.log('menu for "/rele":', JSON.stringify(rele))
  if (!rele.includes('/skill:release')) throw new Error('/rele did not match /skill:release')

  // Префиксные идут первыми: /s → 8 skill:* (префикс), потом agents/lsp/todos (подстрока)
  await input.fill('/s')
  await page.waitForTimeout(300)
  const s = await page.locator('.slash-menu .slash-name').allTextContents()
  console.log('menu for "/s":', JSON.stringify(s))
  const firstNonPrefix = s.findIndex((n) => !/^\/skill/.test(n))
  if (firstNonPrefix === -1) throw new Error('no substring matches for /s')
  if (s.slice(firstNonPrefix).some((n) => /^\/skill/.test(n))) throw new Error('prefix match after substring match for /s')

  // Пробел закрывает меню
  await input.fill('/s ')
  await page.waitForTimeout(300)
  const closed = (await page.locator('.slash-menu').count()) === 0
  console.log('menu closed after space:', closed)

  await browser.close()
  console.log('SMOKE OK')
}

main().catch((err) => {
  console.error('SMOKE FAIL:', err.message)
  process.exit(1)
})
