/* Смоук «форк открывается в чате после закрытия вкладки» (хотфикс v0.6.2).
 * Реальный ход агента: сессия → ответ → форк → закрыть вкладку форка и родителя →
 * форк остаётся в истории дочерней строкой: транскрипт → «Open in chat» в шапке →
 * форк снова активен в чате (раньше был только read-only транскрипт).
 * Запуск: SMOKE_CDP=http://localhost:9223 SMOKE_PROJECT_DIR=<temp> node tests/manual/smoke-fork-chat.cjs */
const { chromium } = require('playwright-core')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'
const PROJECT_DIR = process.env.SMOKE_PROJECT_DIR
if (!PROJECT_DIR) throw new Error('SMOKE_PROJECT_DIR is required (пустой temp-каталог)')

let failed = false
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
  if (!ok) failed = true
}

async function main() {
  console.log('project:', PROJECT_DIR)
  const browser = await chromium.connectOverCDP(CDP)
  const page = await browser.contexts()[0].pages()[0]
  await page.waitForSelector('.right-bar', { timeout: 30000 })

  const boot = await page.evaluate(async (dir) => await window.piwright.newSession({ kind: 'native', dir }), PROJECT_DIR)
  console.log('session created:', boot.hostId)

  const projectName = PROJECT_DIR.split('\\').pop()
  for (let i = 0; i < 5; i++) {
    try {
      await page.locator('.project', { hasText: projectName }).locator('.expand').first().click({ timeout: 2000 })
      await page.waitForSelector('.session-row', { timeout: 3000 })
      break
    } catch {
      if (i === 4) throw new Error('session row did not appear after expand clicks')
    }
  }
  await page.locator('.session-row').first().click()
  await page.waitForSelector('.composer textarea', { timeout: 90000 })
  await page.waitForTimeout(1500)

  const input = page.locator('.composer textarea:not(.loop-exit)').first()
  await input.fill('Ответь ровно одним словом: привет')
  await page.locator('.send-wrap button').first().click()
  await page.waitForFunction(() => document.querySelectorAll('.transcript .assistant-message').length > 0, null, { timeout: 180000 })
  await page.waitForFunction(() => !document.querySelector('.dot.streaming'), null, { timeout: 180000 })
  check('assistant answered', true)

  // Форк по ответу
  await page.click('.transcript .assistant-message .msg-action')
  await page.waitForFunction(
    () => {
      const rows = Array.from(document.querySelectorAll('.session-row'))
      return rows.some((r) => /\(fork\)/.test(r.textContent) && r.className.includes('current'))
    },
    null,
    { timeout: 90000 }
  )
  check('fork created and active', true)
  await page.waitForSelector('.composer textarea', { timeout: 90000 })
  check('fork composer ready', true)

  // Закрыть вкладку форка, затем остальные вкладки сессий: idle-сессии закрываются, строки исчезают.
  // Активной вкладки после закрытия может не быть (entry.activeId !== null) — кликаем по первой .tab.session
  const closeAllSessionTabs = async () => {
    for (let i = 0; i < 10; i++) {
      const more = await page.evaluate(() => {
        const btn = document.querySelector('.tab-bar .tab.session .tab-close')
        if (btn instanceof HTMLElement) {
          btn.click()
          return true
        }
        return false
      })
      if (!more) return
      await page.waitForTimeout(700)
    }
  }
  await closeAllSessionTabs()
  await page.waitForFunction(
    () => document.querySelectorAll('.session-row').length === 0 && document.querySelectorAll('.tab-bar .tab.session').length === 0,
    null,
    { timeout: 30000 }
  )
  check('all session rows gone after tab close', true)

  // История: родитель с дочерней строкой форка
  await page.waitForSelector('.history-item', { timeout: 30000 })
  const toggle = page.locator('.history-item .sub-toggle')
  check('parent has sub-toggle', (await toggle.count()) > 0)
  await toggle.first().click()
  await page.waitForSelector('.history-item.sub', { timeout: 30000 })
  const subTitle = await page.locator('.history-item.sub .history-title').first().innerText()
  check('fork in history as child', /\(fork\)/.test(subTitle), subTitle)

  // Транскрипт → в шапке «Open in chat» → чат форка
  await page.locator('.history-item.sub').first().click()
  await page.waitForSelector('.header button[title="Open in chat"]', { timeout: 30000 })
  check('transcript has Open-in-chat button', true)
  await page.locator('.header button[title="Open in chat"]').click()
  await page.waitForSelector('.composer textarea', { timeout: 90000 })
  await page.waitForFunction(() => /\(fork\)/.test(document.querySelector('.session-row.current')?.textContent ?? ''), null, { timeout: 30000 })
  const chatTitle = await page.evaluate(() => document.querySelector('.session-row.current')?.textContent ?? '')
  check('transcript Open-in-chat reopens fork', /\(fork\)/.test(chatTitle), chatTitle.trim())

  // Прибрать за собой: остановить переоткрытого хоста форка
  const reopenId = await page.evaluate(async () => {
    const snap = await window.piwright.listSessions()
    const host = snap.active.find((h) => h.title.includes('(fork)'))
    return host ? host.hostId : null
  })
  if (reopenId !== null) await page.evaluate(async (id) => await window.piwright.closeSession(id, false), reopenId)

  console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS')
  process.exit(failed ? 1 : 0)
}

main().catch((err) => {
  console.error('SMOKE-FAIL:', err.message)
  process.exit(1)
})
