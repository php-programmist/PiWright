/* Смоук Git Log: поиск по сообщению/хэшу, фильтр веток, контекстное меню коммита.
   Только читающие операции — мутации (cherry-pick/reset/drop/…) покрыты vitest на временных репо. */
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

  const expand = page.locator('button[title="Развернуть панель"], button[title="Expand panel"]')
  if ((await expand.count()) > 0) { await expand.click(); await page.waitForTimeout(800) }

  const current = await page.locator('.session-row.current').count()
  if (current === 0) {
    const plus = page.locator('button[title="Новая сессия"], button[title="New session"]').first()
    await plus.click()
    await page.waitForSelector('.session-row.current', { timeout: 90000 })
    await page.waitForTimeout(2000)
  }

  const gitLogBtn = page.locator('.right-bar button[title*="Git Log"], .right-bar button[title*="История Git"]').first()
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

  // --- Поиск по сообщению ---
  const rows = page.locator('.gitlog-row')
  const before = await rows.count()
  log('rows before search:', before)
  if (before < 3) throw new Error('too few rows')

  // Слово из subject 6-й строки (не HEAD) — уникальное подмножество истории
  const sampleSubject = (await rows.nth(5).getAttribute('title')) ?? ''
  const words = sampleSubject.split(/\s+/).filter((w) => w.length >= 5 && /[a-zA-Zа-яА-Я]/.test(w))
  if (words.length === 0) throw new Error('no usable word in subject: ' + sampleSubject)
  const needle = words[words.length - 1]
  log('search needle:', needle, '| from:', sampleSubject)

  const search = page.locator('.gitlog-search')
  await search.fill(needle)
  await page.waitForTimeout(900) // дебаунс 300мс + IPC
  const afterSearch = await rows.count()
  log('rows after message search:', afterSearch)
  if (afterSearch >= before) throw new Error('message search did not filter rows')
  const subjects = await page.locator('.gitlog-subject').allTextContents()
  const hit = subjects.some((s) => s.toLowerCase().includes(needle.toLowerCase()))
  if (!hit) throw new Error('expected commit with needle not found in filtered list')

  // Очистка кнопкой ×
  await page.locator('.gitlog-search-clear').click()
  await page.waitForTimeout(900)
  const afterClear = await rows.count()
  log('rows after clear:', afterClear)
  if (afterClear < before) throw new Error('clear did not restore the list')

  // --- Поиск по хэшу: берём 7 символов из деталей первого коммита ---
  await rows.first().click()
  await page.waitForSelector('.gitlog-commit-meta', { timeout: 10000 })
  const meta = (await page.locator('.gitlog-commit-meta').textContent()) ?? ''
  const shortHash = meta.trim().split('·').pop()?.trim() ?? ''
  log('short hash:', shortHash)
  if (!/^[0-9a-f]{7}$/.test(shortHash)) throw new Error('bad short hash from meta: ' + meta)
  await search.fill(shortHash)
  await page.waitForTimeout(900)
  const hashRows = await rows.count()
  log('rows after hash search:', hashRows)
  if (hashRows === 0) throw new Error('hash search returned nothing')
  // Коммит мог быть уже выбран до поиска — клик снял бы выделение (тоггл)
  if ((await page.locator('.gitlog-commit-meta').count()) === 0) {
    await rows.first().click()
    await page.waitForTimeout(600)
  }
  const meta2 = (await page.locator('.gitlog-commit-meta').textContent()) ?? ''
  if (!meta2.includes(shortHash)) throw new Error('hash search top row is not the target commit: ' + meta2)
  await page.screenshot({ path: 'tests/manual/out-gitlog-actions-1-search.png' })
  await page.locator('.gitlog-search-clear').click()
  await page.waitForTimeout(900)

  // --- Фильтр веток ---
  const select = page.locator('.gitlog-branch-select')
  const optionCount = await select.locator('option').count()
  log('branch options:', optionCount)
  if (optionCount < 2) throw new Error('branch select has too few options')
  const selectBox = await select.boundingBox()
  const dockBox = await page.locator('.gitlog-dock').boundingBox()
  if (!selectBox || !dockBox || selectBox.x + selectBox.width > dockBox.x + dockBox.width) {
    throw new Error('branch select overflows the dock')
  }
  // Выбрать реальную ветку (не HEAD-опцию): значение = имя ветки из списка опций
  const branchValue = await select.evaluate((el) => {
    const opt = [...el.querySelectorAll('option')].find((o) => o.value !== '' && o.value !== '*')
    return opt ? opt.value : null
  })
  log('picked branch option:', branchValue)
  if (branchValue !== null) {
    await select.selectOption(branchValue)
    await page.waitForTimeout(900)
    const rowsBranch = await rows.count()
    log('rows on branch filter:', rowsBranch)
    if (rowsBranch === 0) throw new Error('branch filter returned no rows')
    await page.screenshot({ path: 'tests/manual/out-gitlog-actions-2-branch.png' })
    await select.selectOption('')
    await page.waitForTimeout(900)
  }

  // --- Контекстное меню: состав и закрытие по Escape ---
  await rows.first().click({ button: 'right' })
  await page.waitForSelector('.gitlog-menu', { timeout: 5000 })
  const items = await page.locator('.gitlog-menu .project-menu-item').allTextContents()
  log('menu items:', items.length)
  // [en, ru] — язык инстанса может быть любым
  const expected = [
    ['Copy Revision Number', 'Копировать номер ревизии'],
    ['Cherry-Pick', 'Cherry-Pick'],
    ['Checkout Revision', 'Переключиться на ревизию'],
    ['Reset Current Branch to Here...', 'Переместить текущую ветку сюда...'],
    ['Revert Commit', 'Отменить коммит (revert)'],
    ['Edit Commit Message...', 'Изменить сообщение коммита...'],
    ['Squash Into...', 'Уплотнить в родительский...'],
    ['Drop Commit', 'Удалить коммит'],
    ['Interactively Rebase from Here...', 'Интерактивный rebase отсюда...'],
    ['New Branch...', 'Новая ветка...'],
    ['New Tag...', 'Новый тег...'],
    ['Go to Child Commit', 'К дочернему коммиту'],
    ['Go to Parent Commit', 'К родительскому коммиту']
  ]
  const missing = expected.filter(([en, ru]) => !items.some((i) => i.trim() === en || i.trim() === ru))
  if (missing.length > 0) throw new Error('missing menu items: ' + missing.map(([en]) => en).join('; '))
  const excluded = ['Create Patch', 'Show Repository at Revision', 'Compare with Local', 'Push All up to Here', 'Undo Commit', 'Fixup']
  const present = excluded.filter((e) => items.some((i) => i.includes(e)))
  if (present.length > 0) throw new Error('excluded items present: ' + present.join('; '))
  await page.screenshot({ path: 'tests/manual/out-gitlog-actions-3-menu.png' })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  if ((await page.locator('.gitlog-menu').count()) !== 0) throw new Error('Escape did not close the menu')

  // --- Reset: подменю из трёх режимов, без выполнения ---
  await rows.first().click({ button: 'right' })
  await page.waitForSelector('.gitlog-menu', { timeout: 5000 })
  await page.locator('.gitlog-menu .project-menu-item', { hasText: 'Переместить текущую ветку' }).click()
  await page.waitForTimeout(300)
  const menus = await page.locator('.gitlog-menu').count()
  if (menus < 2) throw new Error('reset submenu did not open')
  const subItems = await page.locator('.gitlog-menu').nth(1).locator('.project-menu-item').allTextContents()
  log('reset submenu:', subItems.map((s) => s.trim()))
  if (subItems.length !== 3) throw new Error('reset submenu must have exactly 3 modes')
  await page.screenshot({ path: 'tests/manual/out-gitlog-actions-4-reset.png' })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // --- Copy Revision Number: меню закрывается, буфер содержит 40-символьный хэш ---
  await rows.first().click({ button: 'right' })
  await page.waitForSelector('.gitlog-menu', { timeout: 5000 })
  await page.locator('.gitlog-menu .project-menu-item', { hasText: 'Копировать номер ревизии' }).click()
  await page.waitForTimeout(400)
  if ((await page.locator('.gitlog-menu').count()) !== 0) throw new Error('menu did not close after copy')
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''))
  log('clipboard:', clip.slice(0, 12) + '…', 'len:', clip.length)
  if (!/^[0-9a-f]{40}$/.test(clip)) throw new Error('clipboard does not contain a full hash: ' + clip)

  // --- Go to Parent Commit: выбор переходит на родителя ---
  if ((await page.locator('.gitlog-commit-meta').count()) === 0) {
    await rows.first().click()
    await page.waitForSelector('.gitlog-commit-meta', { timeout: 10000 })
  }
  await page.waitForTimeout(400)
  const headSubject = (await page.locator('.gitlog-commit-subject').textContent()) ?? ''
  await rows.first().click({ button: 'right' })
  await page.waitForSelector('.gitlog-menu', { timeout: 5000 })
  await page.locator('.gitlog-menu .project-menu-item', { hasText: 'К родительскому коммиту' }).click()
  await page.waitForTimeout(600)
  const parentSubject = (await page.locator('.gitlog-commit-subject').textContent()) ?? ''
  log('head:', headSubject, '→ parent:', parentSubject)
  if (parentSubject === headSubject) throw new Error('Go to Parent did not change selection')

  // --- Меню в пределах экрана ---
  await rows.first().click({ button: 'right' })
  await page.waitForSelector('.gitlog-menu', { timeout: 5000 })
  const menuBox = await page.locator('.gitlog-menu').first().boundingBox()
  const vw = await page.evaluate(() => window.innerWidth)
  const vh = await page.evaluate(() => window.innerHeight)
  if (!menuBox || menuBox.x < 0 || menuBox.y < 0 || menuBox.x + menuBox.width > vw || menuBox.y + menuBox.height > vh) {
    throw new Error('context menu overflows the viewport: ' + JSON.stringify(menuBox))
  }
  await page.keyboard.press('Escape')

  log('SMOKE OK')
  await browser.close()
}

main().catch((err) => {
  console.error('SMOKE FAIL:', err.message)
  process.exit(1)
})
