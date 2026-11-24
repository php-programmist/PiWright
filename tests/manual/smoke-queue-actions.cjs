/* Смоук очереди сообщений: без дубля в ленте, конверсия followUp↔steer, снятие в композер. */
const { chromium } = require('playwright-core')

const FOLLOW_TEXT = 'smoke follow-up item alpha'
const STEER_TEXT = 'smoke steer item beta'

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9223')
  const page = await browser.contexts()[0].pages()[0]
  const log = (...a) => console.log(...a)

  await page.waitForSelector('.right-bar', { timeout: 30000 })

  const boot = await page.evaluate(async () => {
    const s = await window.piwright.getSettings()
    const kept = (s.projects ?? []).filter((p) => p.dir === 'D:\\Projects\\piwright')
    const projects = kept.length > 0 ? kept : [{ kind: 'native', dir: 'D:\\Projects\\piwright' }]
    await window.piwright.setSettings({ ...s, projects })
    const s2 = await window.piwright.getSettings()
    const project = s2.projects.find((p) => p.dir === 'D:\\Projects\\piwright')
    if (project === undefined) throw new Error('piwright project missing in settings')
    return await window.piwright.newSession(project)
  })
  log('session created:', boot.hostId)
  await page.reload()
  await page.waitForSelector('.right-bar', { timeout: 30000 })
  await page.waitForTimeout(1000)

  const expand = page.locator('button[title="Развернуть панель"], button[title="Expand panel"]')
  if ((await expand.count()) > 0) { await expand.click(); await page.waitForTimeout(800) }
  await page.locator('.project .expand').first().click()
  await page.waitForSelector('.session-row', { timeout: 90000 })
  await page.locator('.session-row').first().click()
  await page.waitForSelector('.composer textarea', { timeout: 30000 })
  await page.waitForTimeout(1500)

  const info = { hostId: boot.hostId }
  log('active host:', info.hostId)

  const input = page.locator('.composer textarea:not(.loop-exit)').first()
  const userBubbles = () => page.locator('.transcript .user-entry').count()

  // 1. Длинный промпт — ход должен жить, пока работаем с очередью
  await input.fill('Write a poem with 30 quatrains about robots. Take your time, do not stop early.')
  await page.locator('.send-wrap button').first().click()
  await page.waitForSelector('.composer button.steer', { timeout: 60000 })
  const baseBubbles = await userBubbles()
  log('user bubbles after prompt:', baseBubbles)
  if (baseBubbles !== 1) throw new Error('expected 1 user bubble after prompt, got ' + baseBubbles)

  // 2. Follow up через Send при ходе: строка в очереди, дубля в ленте НЕТ
  await input.fill(FOLLOW_TEXT)
  await page.locator('.send-wrap button').first().click()
  await page.waitForSelector('.queue-panel', { timeout: 5000 })
  let followRow = page.locator(`.queue-panel .queue-row:has-text("${FOLLOW_TEXT}")`)
  if ((await followRow.count()) !== 1) throw new Error('follow-up row missing in queue panel')
  const followBadge = (await followRow.locator('.queue-badge').textContent()) ?? ''
  if (!/follow-up|после хода/i.test(followBadge)) throw new Error('follow-up badge wrong: ' + followBadge)
  await page.waitForTimeout(1500)
  const bubblesAfterFollow = await userBubbles()
  log('user bubbles after follow-up send:', bubblesAfterFollow)
  if (bubblesAfterFollow !== baseBubbles) throw new Error('follow-up duplicated in feed: ' + bubblesAfterFollow)

  // 3. Steer через кнопку Steer: строка с бейджем steer, лента не растёт
  await input.fill(STEER_TEXT)
  await page.locator('.composer button.steer').click()
  await page.waitForSelector(`.queue-panel .queue-row:has-text("${STEER_TEXT}")`, { timeout: 5000 })
  const steerRow = page.locator(`.queue-panel .queue-row:has-text("${STEER_TEXT}")`)
  const steerBadge = (await steerRow.locator('.queue-badge').textContent()) ?? ''
  if (!/^steer|подсказка/i.test(steerBadge.trim())) throw new Error('steer badge wrong: ' + steerBadge)
  if ((await userBubbles()) !== baseBubbles) throw new Error('steer duplicated in feed')
  log('queue rows: steer + follow-up, no feed duplicates — ok')

  // 4. Конверсия followUp → steer: бейдж меняется на steer
  await followRow.locator('.queue-convert').click()
  await page.waitForFunction(
    (text) => {
      const row = [...document.querySelectorAll('.queue-panel .queue-row')].find((r) => r.textContent.includes(text))
      return row !== undefined && /steer|подсказка/i.test(row.querySelector('.queue-badge')?.textContent ?? '')
    },
    FOLLOW_TEXT,
    { timeout: 5000 }
  )
  log('converted follow-up → steer — ok')

  // 5. Обратно steer → followUp
  await page.locator(`.queue-panel .queue-row:has-text("${FOLLOW_TEXT}") .queue-convert`).click()
  await page.waitForFunction(
    (text) => {
      const row = [...document.querySelectorAll('.queue-panel .queue-row')].find((r) => r.textContent.includes(text))
      return row !== undefined && /follow-up|после хода/i.test(row.querySelector('.queue-badge')?.textContent ?? '')
    },
    FOLLOW_TEXT,
    { timeout: 5000 }
  )
  log('converted steer → follow-up — ok')

  // 6. Редактирование: карандаш снимает steer-элемент в поле ввода, строка исчезает
  await page.locator(`.queue-panel .queue-row:has-text("${STEER_TEXT}") .queue-act:not(.queue-convert)`).click()
  await page.waitForFunction(
    (text) => !([...document.querySelectorAll('.queue-panel .queue-row')].some((r) => r.textContent.includes(text))),
    STEER_TEXT,
    { timeout: 5000 }
  )
  const composerValue = await input.inputValue()
  if (!composerValue.includes(STEER_TEXT)) throw new Error('steer text not returned to composer: "' + composerValue + '"')
  log('edit: text returned to composer — ok')
  await page.screenshot({ path: 'tests/manual/out-queue-actions.png' })

  // 7. Конец хода: follow-up доставлен ровно один раз (один пузырь в ленте)
  await input.fill('')
  await page.waitForFunction(
    (text) => [...document.querySelectorAll('.transcript .user-entry')].filter((r) => r.textContent.includes(text)).length === 1,
    FOLLOW_TEXT,
    { timeout: 240000 }
  )
  const delivered = await userBubbles()
  log('user bubbles after delivery:', delivered)
  if (delivered !== baseBubbles + 1) throw new Error('expected exactly one delivered bubble, got ' + delivered)

  // 8. Стоп — погасить ход следующего промпта
  await page.locator('button.abort').click()
  await page.waitForFunction(() => !document.querySelector('.dot.streaming'), null, { timeout: 60000 })
  await page.waitForTimeout(1000)
  if ((await page.locator('.queue-panel').count()) !== 0) throw new Error('queue panel still visible after abort')
  const finalBubbles = await userBubbles()
  if (finalBubbles !== delivered) throw new Error('unexpected extra bubbles after abort: ' + finalBubbles)
  log('abort ok, no duplicates')

  await page.screenshot({ path: 'tests/manual/out-queue-final.png' })
  log('SMOKE OK')
  process.exit(0)
}

main().catch(async (err) => {
  console.error('SMOKE FAIL:', err.message)
  process.exit(1)
})
