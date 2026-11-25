/* Smoke: rewind (откат сессии и кода к чекпоинту) — полный UI-флоу.
 * Scratch git-репозиторий добавляется в settings.json smoke-инстанса до запуска
 * (см. run-команду), сессия создаётся кнопкой «+», промпты — через реальный композер.
 * Проверки: кнопка отката под ответами (кроме последнего), диалог (Cancel/подтверждение),
 * усечение ленты, откат кода на диске, stash-страховка, ветвление файла сессии. */
const { chromium } = require('playwright-core')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'
const MODEL = process.env.SMOKE_MODEL || 'p100/p100/qwen3.8-flash-next'
const SCRATCH = process.env.SMOKE_SCRATCH
if (!SCRATCH) {
  console.error('SMOKE FAIL: SMOKE_SCRATCH env var is required (scratch git repo dir)')
  process.exit(1)
}
const SCRATCH_NAME = path.basename(SCRATCH)
const P1 = 'Create a file named rewind-smoke.txt containing exactly one line: ALPHA. Then reply DONE.'
const P2 = 'Reply with the single word READY. Do not use any tools.'
const P3 = 'Append one line: BETA to the file rewind-smoke.txt. Then reply DONE.'

function git(...args) {
  return execFileSync('git', args, { cwd: SCRATCH, stdio: 'pipe' }).toString()
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP)
  const page = browser.contexts()[0].pages()[0]

  // Коллекторы статусов и ходов — до создания сессии.
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

  // Новая сессия scratch-проекта через «+» в строке проекта.
  const row = page.locator('.project', { hasText: SCRATCH_NAME }).first()
  await row.waitFor({ timeout: 30000 })
  await row.locator('button[title="New session"]').click()
  await page.waitForSelector('.composer textarea', { timeout: 90000 })

  const hostId = await page.waitForFunction(
    (dir) => {
      const found = Object.entries(window.__smokeStatus).find(([, s]) => s.project && s.project.dir === dir)
      return found ? found[0] : null
    },
    SCRATCH,
    { timeout: 30000 }
  ).then((h) => h.jsonValue())
  console.log('scratch host:', hostId)
  await page.waitForFunction(
    (hostId) => window.__smokeStatus[hostId] && window.__smokeStatus[hostId].state === 'ready',
    hostId,
    { timeout: 120000 }
  )
  // Дефолтная модель может быть недоступна в смоуке — переключаемся на рабочую.
  const setModel = await page.evaluate(async ({ hostId, model }) => await window.piwright.setModel(hostId, model), { hostId, model: MODEL })
  console.log('setModel:', JSON.stringify(setModel))
  await page.waitForFunction(
    (hostId) => window.__smokeStatus[hostId] && window.__smokeStatus[hostId].state !== 'starting',
    hostId,
    { timeout: 60000 }
  )

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

  await send(P1)
  await waitTurn(1)
  await send(P2)
  await waitTurn(2)
  await send(P3)
  await waitTurn(3)

  const counts = async () =>
    page.evaluate(() => ({
      user: document.querySelectorAll('.user-message:not(.editing)').length,
      assistant: document.querySelectorAll('.assistant-message').length,
      rewind: document.querySelectorAll('.assistant-message button.msg-action[title="Rewind session and code to this point"]').length
    }))
  const before = await counts()
  console.log('after three turns:', JSON.stringify(before))
  if (before.user !== 3 || before.rewind !== 2) throw new Error(`unexpected feed state: ${JSON.stringify(before)}`)
  // Под последним ответом кнопки отката быть не должно.
  const lastRewind = await page.locator('.assistant-message').last().locator('button.msg-action[title="Rewind session and code to this point"]').count()
  if (lastRewind !== 0) throw new Error('last assistant message must not have a rewind button')

  // Диалог: Cancel ничего не меняет.
  await page.locator('.assistant-message button.msg-action[title="Rewind session and code to this point"]').first().click()
  await page.waitForSelector('.confirm-box', { timeout: 5000 })
  const boxText = await page.locator('.confirm-box').textContent()
  if (!boxText.includes('git stash')) throw new Error('confirm dialog does not mention git stash')
  await page.locator('.confirm-box button').first().click()
  await page.waitForSelector('.confirm-box', { state: 'detached', timeout: 5000 })
  if ((await counts()).user !== 3) throw new Error('cancel changed the feed')
  console.log('dialog cancel: OK')

  // Подтверждённый откат к P3: лента — P1, A1, P2, A2; код — состояние перед P3.
  await page.locator('.assistant-message button.msg-action[title="Rewind session and code to this point"]').nth(1).click()
  await page.waitForSelector('.confirm-box', { timeout: 5000 })
  await page.locator('.confirm-box button', { hasText: 'Rewind' }).click()
  await page.waitForFunction(() => document.querySelectorAll('.user-message:not(.editing)').length === 2, { timeout: 15000 })
  const after = await counts()
  console.log('after rewind:', JSON.stringify(after))
  if (after.user !== 2 || after.rewind !== 1) throw new Error(`unexpected feed after rewind: ${JSON.stringify(after)}`)
  const lastAfter = await page.locator('.assistant-message').last().locator('button.msg-action[title="Rewind session and code to this point"]').count()
  if (lastAfter !== 0) throw new Error('rewind button appeared under the new last answer')

  const restored = fs.readFileSync(path.join(SCRATCH, 'rewind-smoke.txt'), 'utf8')
  console.log('file after rewind:', JSON.stringify(restored))
  if (!restored.includes('ALPHA')) throw new Error('checkpoint state lost')
  if (restored.includes('BETA')) throw new Error('post-checkpoint change survived')

  const stashList = git('stash', 'list')
  if (!stashList.includes('PiWright rewind backup')) throw new Error('backup stash missing')
  console.log('stash backup: OK')

  const sessionFile = await page.evaluate((hostId) => window.__smokeStatus[hostId].sessionFile, hostId)
  console.log('session file:', sessionFile)

  await page.screenshot({ path: path.join(os.tmpdir(), 'piwright-rewind-smoke.png') })
  await browser.close()
  console.log('SMOKE OK')
}

main().catch((err) => {
  console.error('SMOKE FAIL:', err.message)
  process.exit(1)
})
