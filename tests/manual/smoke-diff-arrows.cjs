/* Смоук навигации диффов клавишами ↑/↓ (баг: стрелки не листали файлы коммита). */
const { chromium } = require('playwright-core')

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9223')
  const page = await browser.contexts()[0].pages()[0]
  const log = (...a) => console.log(...a)

  await page.waitForSelector('.right-bar', { timeout: 30000 })

  // Бутстрап: проект piwright + сессия, если пусто
  const boot = await page.evaluate(async () => {
    const s = await window.piwright.getSettings()
    const has = (s.projects ?? []).some((p) => p.dir === 'D:\\Projects\\piwright')
    if (!has) await window.piwright.setSettings({ projects: [...(s.projects ?? []), { kind: 'native', dir: 'D:\\Projects\\piwright' }] })
    return (s.projects ?? []).length
  })
  log('projects in settings:', boot)
  await page.reload()
  await page.waitForSelector('.right-bar', { timeout: 30000 })
  await page.waitForTimeout(1000)

  // Панель сессий может быть свёрнута — развернуть
  const expand = page.locator('button[title="Развернуть панель"], button[title="Expand panel"]')
  if ((await expand.count()) > 0) { await expand.click(); await page.waitForTimeout(800) }

  const current = await page.locator('.session-row.current').count()
  log('current session rows:', current)
  if (current === 0) {
    const plus = page.locator('button[title="Новая сессия"], button[title="New session"]').first()
    if ((await plus.count()) === 0) throw new Error('new-session button not found')
    await plus.click()
    await page.waitForSelector('.session-row.current', { timeout: 90000 })
    await page.waitForTimeout(2000)
  }

  // Открыть док Git Log (клик может потеряться сразу после создания сессии — ретраим)
  const gitLogBtn = page.locator('.right-bar button[title*="Git Log"], .right-bar button[title*="История Git"]').first()
  if ((await gitLogBtn.count()) === 0) throw new Error('gitlog button not found')
  for (let i = 0; i < 3; i++) {
    await gitLogBtn.click()
    try {
      await page.waitForSelector('.gitlog-dock', { timeout: 5000 })
      break
    } catch {
      if (i === 2) throw new Error('gitlog dock did not open')
    }
  }
  await page.waitForTimeout(1500)

  // Найти коммит минимум с 2 файлами: кликаем строки, пока не найдём
  const rows = page.locator('.gitlog-row')
  const rowCount = await rows.count()
  log('commit rows:', rowCount)
  let files = 0
  let picked = -1
  for (let i = 0; i < Math.min(rowCount, 15); i++) {
    await rows.nth(i).click()
    await page.waitForTimeout(600)
    files = await page.locator('.gitlog-file').count()
    if (files >= 2) { picked = i; break }
  }
  if (picked < 0) throw new Error('no commit with >=2 files found in first 15')
  log('commit #' + picked + ' files:', files)

  // Открыть дифф первого файла
  await page.locator('.gitlog-file').first().click()
  await page.waitForSelector('.diff-overlay', { timeout: 10000 })
  await page.waitForTimeout(1500)
  const title0 = (await page.locator('.tab.active').textContent()) ?? ''
  log('diff tab #1:', title0)

  // Стрелка вниз → следующий файл
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(1200)
  const title1 = (await page.locator('.tab.active').textContent()) ?? ''
  log('after ArrowDown:', title1)
  if (title1 === title0) throw new Error('ArrowDown did not switch diff')

  // Стрелка вверх → обратно
  await page.keyboard.press('ArrowUp')
  await page.waitForTimeout(1200)
  const title2 = (await page.locator('.tab.active').textContent()) ?? ''
  log('after ArrowUp:', title2)
  if (title2 !== title0) throw new Error('ArrowUp did not switch back')

  // Фокус внутри Monaco — стрелки двигают курсор, вкладку не меняют
  await page.evaluate(() => {
    const ta = document.querySelector('.diff-overlay .monaco-editor textarea')
    if (ta instanceof HTMLElement) ta.focus()
  })
  await page.waitForTimeout(300)
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(800)
  const title3 = (await page.locator('.tab.active').textContent()) ?? ''
  log('after ArrowDown inside monaco:', title3)
  if (title3 !== title2) throw new Error('monaco focus should not switch diff tab')

  await page.screenshot({ path: 'tests/manual/out-diff-arrows.png' })
  log('SMOKE OK')
  await browser.close()
}

main().catch((err) => {
  console.error('SMOKE FAIL:', err.message)
  process.exit(1)
})
