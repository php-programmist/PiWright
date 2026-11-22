/* Смоук дока Git Log: иконка над терминалом, док с графом, детали коммита, дифф во вкладке. */
const { chromium } = require('playwright-core')

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9222')
  const page = await browser.contexts()[0].pages()[0]
  const log = (...a) => console.log(...a)

  await page.waitForSelector('.right-bar', { timeout: 30000 })
  await page.screenshot({ path: 'tests/manual/out-gitlog-0-initial.png' })

  // Иконка истории Git — кнопка перед .term-toggle
  const buttons = page.locator('.right-bar button')
  const n = await buttons.count()
  const gitLogBtn = page.locator('.right-bar button[title*="Git Log"], .right-bar button[title*="История Git"]').first()
  const termBtn = page.locator('.right-bar .term-toggle')
  const glBox = await gitLogBtn.boundingBox()
  const termBox = await termBtn.boundingBox()
  log('gitlog button:', glBox, 'terminal button:', termBox)
  if (!glBox || !termBox) throw new Error('buttons not found')
  if (Math.abs(glBox.y + glBox.height - termBox.y) > 4) throw new Error('gitlog button is not right above terminal')

  // Открытие дока: терминал закрыт, док появляется
  await gitLogBtn.click()
  await page.waitForSelector('.gitlog-dock', { timeout: 10000 })
  await page.waitForTimeout(1500)
  const dockH = (await page.locator('.gitlog-dock').boundingBox())?.height
  log('gitlog dock height:', dockH)
  const rows = await page.locator('.gitlog-row').count()
  log('commit rows:', rows)
  if (rows < 3) throw new Error('too few commit rows')
  const dots = await page.locator('.gitlog-graph circle').count()
  log('graph dots:', dots)
  if (dots < rows) throw new Error('graph dots missing')
  const refs = await page.locator('.gitlog-ref').count()
  log('ref chips:', refs)
  await page.screenshot({ path: 'tests/manual/out-gitlog-1-dock.png' })

  // Клик по коммиту: детали + файлы сбоку
  await page.locator('.gitlog-row').first().click()
  await page.waitForSelector('.gitlog-details', { timeout: 10000 })
  await page.waitForTimeout(800)
  const subject = await page.locator('.gitlog-commit-subject').textContent()
  const meta = await page.locator('.gitlog-commit-meta').textContent()
  const files = await page.locator('.gitlog-file').count()
  log('selected commit:', subject, '|', meta, '| files:', files)
  if (files < 1) throw new Error('no files in details')
  await page.screenshot({ path: 'tests/manual/out-gitlog-2-details.png' })

  // Клик по файлу: дифф во вкладке
  await page.locator('.gitlog-file').first().click()
  await page.waitForSelector('.diff-overlay', { timeout: 10000 })
  await page.waitForTimeout(1500)
  const tabTitle = await page.locator('.tab.active').textContent()
  log('active diff tab:', tabTitle)
  const monaco = await page.locator('.diff-overlay .monaco-editor').count()
  log('monaco editors:', monaco)
  if (monaco < 1) throw new Error('diff editor missing')
  await page.screenshot({ path: 'tests/manual/out-gitlog-3-diff.png' })

  // Повторный клик по коммиту — снятие выделения, детали исчезают
  await page.locator('.gitlog-row').first().click()
  await page.waitForTimeout(400)
  const detailsGone = (await page.locator('.gitlog-details').count()) === 0
  log('details collapsed on second click:', detailsGone)

  // Эксклюзивность: открытие терминала сворачивает gitlog и наоборот
  await termBtn.click()
  await page.waitForSelector('.terminal-dock:not(.gitlog-dock)', { timeout: 10000 })
  const gitlogGone = (await page.locator('.gitlog-dock').count()) === 0
  log('terminal opens, gitlog closed:', gitlogGone)
  await gitLogBtn.click()
  await page.waitForSelector('.gitlog-dock', { timeout: 10000 })
  const termGone = (await page.locator('.terminal-dock:not(.gitlog-dock)').count()) === 0
  log('gitlog opens, terminal closed:', termGone)
  await page.screenshot({ path: 'tests/manual/out-gitlog-4-exclusive.png' })

  // Пагинация: скролл до конца списка догружает следующую страницу (по 50)
  const before = await page.locator('.gitlog-row').count()
  log('rows before scroll:', before)
  if (before !== 50) throw new Error('expected first page of 50, got ' + before)
  await page.locator('.gitlog-list').evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await page.waitForFunction((n) => document.querySelectorAll('.gitlog-row').length > n, before, { timeout: 15000 })
  const after = await page.locator('.gitlog-row').count()
  log('rows after scroll:', after)
  if (after <= before) throw new Error('pagination did not load more')

  // Сворачивание дока кнопкой −
  await page.locator('.gitlog-dock .term-collapse').click()
  await page.waitForTimeout(400)
  const closed = (await page.locator('.gitlog-dock').count()) === 0
  log('collapse button closes dock:', closed)
  if (!closed) throw new Error('collapse failed')

  log('SMOKE OK')
  await browser.close()
}

main().catch((err) => {
  console.error('SMOKE FAIL:', err.message)
  process.exit(1)
})
