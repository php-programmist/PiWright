/* Smoke: composer resize UI. Attach over CDP, check auto-grow of the prompt and
 * loop-exit textareas, drag-resize of the composer top border, double-click reset. */
const { chromium } = require('playwright-core')

const CDP = process.env.SMOKE_CDP ?? 'http://localhost:9223'

async function main() {
  const browser = await chromium.connectOverCDP(CDP)
  const page = browser.contexts()[0].pages()[0]
  // Композер виден только в открытой сессии — при пустом старте открываем историю
  if ((await page.locator('.composer').count()) === 0) {
    await page.waitForSelector('.history-item', { timeout: 30000 })
    await page.locator('.history-item').first().click()
  }
  await page.waitForSelector('.composer', { timeout: 90000 })

  // Включаем петли в настройках (перезагрузка, чтобы settings-draft обновился)
  const loopsWas = await page.evaluate(() => window.piwright.getSettings().then((s) => s.loopsEnabled))
  if (!loopsWas) {
    await page.evaluate(() => window.piwright.setSettings({ loopsEnabled: true }))
    await page.reload()
    await page.waitForSelector('.composer', { timeout: 30000 })
  }

  // Открываем сессию, если ни одна не активна (loop-exit требует chat-состояния)
  if ((await page.locator('.session-row').count()) > 0 && (await page.locator('.session-row.current').count()) === 0) {
    await page.locator('.session-row').first().click()
    await page.waitForSelector('.composer textarea', { timeout: 90000 })
  }

  const prompt = page.locator('.composer-fields > textarea').first()
  await prompt.waitFor({ timeout: 30000 })

  // Сброс состояния прошлых прогонов: авто-режим, пустые поля
  await page.evaluate(() => {
    document.querySelector('.composer-resize')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  })
  await prompt.fill('')
  const loopExitEarly = page.locator('.composer textarea.loop-exit')
  if ((await loopExitEarly.count()) > 0) await loopExitEarly.fill('')
  await page.waitForTimeout(150)

  // 1. Авто-рост промпта: 20 строк -> высота упирается в кап (15 строк), внутренний скролл
  const multiLine = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n')
  const before = await prompt.evaluate((el) => el.getBoundingClientRect().height)
  await prompt.fill(multiLine)
  await page.waitForTimeout(150)
  const grown = await prompt.evaluate((el) => ({
    h: el.getBoundingClientRect().height,
    scrollable: el.scrollHeight > el.clientHeight + 1,
  }))
  console.log('prompt height before:', Math.round(before), 'after 20 lines:', Math.round(grown.h), 'scrollable:', grown.scrollable)
  if (grown.h <= before + 20) throw new Error('prompt did not grow')
  if (!grown.scrollable) throw new Error('prompt cap expected to scroll beyond 15 lines')

  // 2. Сжатие обратно при очистке
  await prompt.fill('')
  await page.waitForTimeout(150)
  const reset = await prompt.evaluate((el) => el.getBoundingClientRect().height)
  console.log('prompt height after clear:', Math.round(reset))
  if (reset > before + 10) throw new Error('prompt did not shrink back')

  // 3. loop-exit: включаем петлю (если ещё не включена), авто-рост до 6 строк
  const loopExit = page.locator('.composer textarea.loop-exit')
  if ((await loopExit.count()) === 0 || !(await loopExit.isVisible())) {
    const loopToggle = page.locator('.selector-bar input[type="checkbox"], .loop-bar input[type="checkbox"]').first()
    if ((await loopToggle.count()) === 0) throw new Error('loop toggle not found')
    await loopToggle.evaluate((el) => el.click())
  }
  await loopExit.waitFor({ timeout: 5000 })
  const loopBefore = await loopExit.evaluate((el) => el.getBoundingClientRect().height)
  await loopExit.fill(Array.from({ length: 12 }, (_, i) => `exit ${i + 1}`).join('\n'))
  await page.waitForTimeout(150)
  const loopGrown = await loopExit.evaluate((el) => ({
    h: el.getBoundingClientRect().height,
    scrollable: el.scrollHeight > el.clientHeight + 1,
  }))
  console.log('loop-exit height before:', Math.round(loopBefore), 'after 12 lines:', Math.round(loopGrown.h), 'scrollable:', loopGrown.scrollable)
  if (loopGrown.h <= loopBefore + 10) throw new Error('loop-exit did not grow')
  if (!loopGrown.scrollable) throw new Error('loop-exit cap expected to scroll beyond 6 lines')
  await loopExit.fill('')

  // 4. Драг верхней границы композера вверх -> блок полей растёт, оба поля растут
  const handle = page.locator('.composer-resize')
  const fieldsBox = await page.locator('.composer-fields').boundingBox()
  const handleBox = await handle.boundingBox()
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y - 150, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(150)
  const sized = await page.evaluate(() => {
    const fields = document.querySelector('.composer-fields')
    const ta = document.querySelector('.composer-fields > textarea')
    const loop = document.querySelector('.composer textarea.loop-exit')
    return {
      fields: fields.getBoundingClientRect().height,
      prompt: ta.getBoundingClientRect().height,
      loop: loop !== null ? loop.getBoundingClientRect().height : 0,
      sized: fields.classList.contains('sized'),
    }
  })
  console.log('after drag: fields', Math.round(sized.fields), 'prompt', Math.round(sized.prompt), 'loop', Math.round(sized.loop), 'sized:', sized.sized)
  if (!sized.sized) throw new Error('composer-fields missing .sized class')
  if (sized.fields < fieldsBox.height + 100) throw new Error('fields did not grow after drag')
  if (sized.prompt < before + 20) throw new Error('prompt did not grow with drag')
  if (sized.loop <= loopBefore) throw new Error('loop-exit did not grow with drag')

  // 5. Двойной клик по ручке — сброс к авто
  await handle.dblclick()
  await page.waitForTimeout(150)
  const afterReset = await page.evaluate(() => document.querySelector('.composer-fields').classList.contains('sized'))
  console.log('sized after double-click reset:', afterReset)
  if (afterReset) throw new Error('double-click did not reset')

  // 6. Скриншот композера после сброса — визуальная проверка
  await page.locator('.composer').screenshot({ path: 'tests/manual/out/composer-resize.png' })

  await browser.close()
  console.log('SMOKE OK')
}

main().catch((err) => {
  console.error('SMOKE FAIL:', err.message)
  process.exit(1)
})
