/* Смоук отложенных промптов (очередь сессий): меню ПКМ по Send, панель Scheduled, отмена. */
const { chromium } = require('playwright-core')

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9223')
  const page = await browser.contexts()[0].pages()[0]
  const log = (...a) => console.log(...a)

  await page.waitForSelector('.right-bar', { timeout: 30000 })

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
  log('current session rows:', current)
  if (current === 0) {
    const plus = page.locator('button[title="Новая сессия"], button[title="New session"]').first()
    if ((await plus.count()) === 0) throw new Error('new-session button not found')
    await plus.click()
    await page.waitForSelector('.session-row.current', { timeout: 90000 })
    await page.waitForTimeout(2000)
  }

  const info = await page.evaluate(async () => {
    const snap = await window.piwright.listSessions()
    return { hostId: snap.active[0]?.hostId ?? null, count: snap.active.length }
  })
  if (info.hostId === null) throw new Error('no active session host')
  log('active host:', info.hostId)

  const input = page.locator('.composer textarea:not(.loop-exit)').first()

  // 1. ПКМ по Send с пустым вводом — меню не открывается
  const sendBtn = page.locator('.send-wrap button').first()
  await sendBtn.click({ button: 'right', force: true })
  await page.waitForTimeout(400)
  let menuCount = await page.locator('.sched-menu').count()
  if (menuCount !== 0) throw new Error('sched menu opened with empty input')
  log('empty input: no menu — ok')

  // 2. ПКМ с текстом — меню с секциями и пометкой про отсутствие идущих ходов
  await input.fill('smoke scheduled prompt text')
  await sendBtn.click({ button: 'right', force: true })
  await page.waitForSelector('.sched-menu', { timeout: 5000 })
  const emptyNote = await page.locator('.sched-menu-empty').count()
  if (emptyNote !== 1) throw new Error('expected "no running turns" note, got ' + emptyNote)
  const titles = await page.locator('.sched-menu-title').allTextContents()
  log('menu sections:', JSON.stringify(titles))
  await page.screenshot({ path: 'tests/manual/out-scheduled-menu.png' })

  // 3. «Отправить в…»: дата+время (через час — в пределах таймера Node) → ОК → панель Scheduled
  const atValue = await page.evaluate(() => {
    const d = new Date(Date.now() + 3600000)
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  })
  await page.locator('.sched-time').fill(atValue)
  await page.locator('.sched-apply').click()
  await page.waitForTimeout(1000)
  const diag = await page.evaluate(async () => ({
    menu: !!document.querySelector('.sched-menu'),
    panel: !!document.querySelector('.scheduled-panel'),
    list: (await window.piwright.scheduledList()).items.length
  }))
  log('after apply diag:', JSON.stringify(diag))
  await page.waitForSelector('.scheduled-panel', { timeout: 5000 })
  let rows = await page.locator('.scheduled-panel .queue-row').count()
  if (rows !== 1) throw new Error('expected 1 scheduled row, got ' + rows)
  const rowText = (await page.locator('.scheduled-panel .queue-row').first().textContent()) ?? ''
  if (!rowText.includes('smoke scheduled prompt text')) throw new Error('scheduled row lost the prompt text: ' + rowText)
  const listed = await page.evaluate(async () => {
    const r = await window.piwright.scheduledList()
    return { ok: r.ok, count: r.items.length, kind: r.items[0]?.trigger?.kind ?? null }
  })
  if (!listed.ok || listed.count !== 1 || listed.kind !== 'at') throw new Error('scheduledList wrong: ' + JSON.stringify(listed))
  log('scheduled at-time item ok:', rowText.trim().slice(0, 80))
  await page.screenshot({ path: 'tests/manual/out-scheduled-panel.png' })

  // 4. Отмена крестиком — панель и список пусты
  await page.locator('.scheduled-panel .queue-remove').first().click()
  await page.waitForTimeout(600)
  rows = await page.locator('.scheduled-panel .queue-row').count()
  if (rows !== 0) throw new Error('scheduled row did not disappear after cancel')
  const afterCancel = await page.evaluate(async () => (await window.piwright.scheduledList()).items.length)
  if (afterCancel !== 0) throw new Error('scheduledList not empty after cancel: ' + afterCancel)
  log('cancel ok')

  // 5. Триггер «после сессии» через IPC — бейдж «after …» в панели
  await page.evaluate(async (hostId) => {
    const r = await window.piwright.schedulePrompt({
      targetHostId: hostId,
      text: 'after-trigger smoke item',
      trigger: { kind: 'after', sourceHostId: hostId, sourceTitle: 'Smoke Source' }
    })
    if (!r.ok) throw new Error('schedulePrompt failed: ' + r.error)
  }, info.hostId)
  await page.waitForSelector('.scheduled-panel', { timeout: 5000 })
  const badge = (await page.locator('.scheduled-panel .queue-badge').first().textContent()) ?? ''
  log('after badge:', badge)
  if (!/after|после/i.test(badge)) throw new Error('after badge missing: ' + badge)
  await page.locator('.scheduled-panel .queue-remove').first().click()
  await page.waitForTimeout(600)
  const finalCount = await page.evaluate(async () => (await window.piwright.scheduledList()).items.length)
  if (finalCount !== 0) throw new Error('item not cancelled: ' + finalCount)

  // 6. Текст в поле ввода не съелся планированием (отменённые элементы не трогают композер)
  const leftInput = await input.inputValue()
  log('composer text intact:', leftInput.length > 0)

  await page.screenshot({ path: 'tests/manual/out-scheduled-final.png' })
  log('SMOKE OK')
}

main().catch((err) => {
  console.error('SMOKE FAIL:', err.message)
  process.exit(1)
})
