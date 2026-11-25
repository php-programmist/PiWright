/* Smoke: раскладка кнопок под ответом агента — rewind и fork на одной линии
 * (в одном .msg-actions-row, одинаковый offsetTop), диалог отката открывается.
 * Git-репозиторий не нужен: rewind-кнопка рисуется по ленте (ответ + следующий промпт). */
const { chromium } = require('playwright-core')
const os = require('node:os')
const path = require('node:path')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'
const MODEL = process.env.SMOKE_MODEL || 'p100/p100/qwen3.8-flash-next'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP)
  const page = browser.contexts()[0].pages()[0]

  await page.evaluate(() => {
    window.__smokeStatus = {}
    window.__smokeTurns = {}
    window.piwright.onPiStatus((s) => {
      window.__smokeStatus[s.hostId] = s
    })
    window.piwright.onPiEvent((m) => {
      if (m.event.type !== 'turn_end') return
      const list = window.__smokeTurns[m.hostId] || (window.__smokeTurns[m.hostId] = [])
      list.push(Date.now())
    })
  })

  // Новая сессия первого проекта через «+» в строке проекта.
  const row = page.locator('.project').first()
  await row.waitFor({ timeout: 30000 })
  await row.locator('button[title="New session"]').click()
  await page.waitForSelector('.composer textarea', { timeout: 90000 })

  const hostId = await page.waitForFunction(
    () => {
      const found = Object.entries(window.__smokeStatus).find(([, s]) => ['ready', 'starting', 'idle'].includes(s.state))
      return found ? found[0] : null
    },
    null,
    { timeout: 30000 }
  ).then((h) => h.jsonValue())
  await page.waitForFunction(
    (hostId) => window.__smokeStatus[hostId] && window.__smokeStatus[hostId].state !== 'starting',
    hostId,
    { timeout: 120000 }
  )
  const setModel = await page.evaluate(async ({ hostId, model }) => await window.piwright.setModel(hostId, model), { hostId, model: MODEL })
  console.log('setModel:', JSON.stringify(setModel))

  const send = async (text) => {
    const input = page.locator('.composer textarea').first()
    await input.fill(text)
    await input.press('Control+Enter')
  }
  const waitTurn = async (index) => {
    const deadline = Date.now() + 240000
    while (Date.now() < deadline) {
      const done = await page.evaluate(({ hostId, index }) => ((window.__smokeTurns[hostId] || []).length >= index), { hostId, index })
      if (done) return
      await sleep(500)
    }
    throw new Error(`turn ${index} did not finish in time`)
  }

  await send('Reply with the single word ALPHA. Do not use any tools.')
  await waitTurn(1)
  await send('Reply with the single word BETA. Do not use any tools.')
  await waitTurn(2)

  // Первый ответ: row с двумя кнопками на одной линии.
  const first = page.locator('.assistant-message').first()
  const rowEl = first.locator('.msg-actions-row')
  if ((await rowEl.count()) !== 1) throw new Error('msg-actions-row missing under first answer')
  const layout = await rowEl.evaluate((el) => {
    const buttons = Array.from(el.querySelectorAll('button.msg-action'))
    const cs = getComputedStyle(el)
    return {
      display: cs.display,
      flexWrap: cs.flexWrap,
      count: buttons.length,
      tops: buttons.map((b) => Math.round(b.getBoundingClientRect().top)),
      titles: buttons.map((b) => b.title)
    }
  })
  console.log('layout:', JSON.stringify(layout))
  if (layout.display !== 'flex') throw new Error(`row display is ${layout.display}, expected flex`)
  if (layout.count !== 2) throw new Error(`expected 2 buttons in row, got ${layout.count}`)
  if (layout.tops[0] !== layout.tops[1]) throw new Error(`buttons not on one line: tops ${layout.tops}`)
  if (!layout.titles.some((t) => t.includes('Rewind')) || !layout.titles.some((t) => t.includes('Fork'))) {
    throw new Error(`unexpected buttons: ${layout.titles}`)
  }

  // Последний ответ: кнопки отката быть не должно (fork там был и раньше).
  const lastRewind = await page.locator('.assistant-message').last().locator('button.msg-action[title="Rewind session and code to this point"]').count()
  if (lastRewind !== 0) throw new Error('last answer must not have a rewind button')

  // Диалог отката открывается, Cancel ничего не меняет.
  await first.locator('button.msg-action[title="Rewind session and code to this point"]').click()
  await page.waitForSelector('.confirm-box', { timeout: 5000 })
  await page.locator('.confirm-box button').first().click()
  await page.waitForSelector('.confirm-box', { state: 'detached', timeout: 5000 })
  const userCount = await page.locator('.user-message:not(.editing)').count()
  if (userCount !== 2) throw new Error('cancel changed the feed')
  console.log('dialog cancel: OK')

  await page.screenshot({ path: path.join(os.tmpdir(), 'piwright-rewind-layout.png') })
  await browser.close()
  console.log('SMOKE OK')
}

main().catch((err) => {
  console.error('SMOKE FAIL:', err.message)
  process.exit(1)
})
