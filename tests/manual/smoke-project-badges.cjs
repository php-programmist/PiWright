/* Smoke: kanban c-98e8df24 — clicking the colored-badge counter row expands the project.
   Needs a seeded project in the smoke user-data-dir settings.json and a live busy session:
   create session, send a prompt, wait for the busy badge on the collapsed project row,
   click the badges row, expect .project-children to appear.
   SMOKE_CDP=http://localhost:9223 */
const { chromium } = require('playwright-core')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'
const PROMPT = 'Reply with a 30-word story about a cat. Nothing else.'

async function waitUntil(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    last = await fn()
    if (last) return last
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('timeout: ' + label + ' — last: ' + JSON.stringify(last))
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP)
  const page = browser.contexts()[0].pages()[0]
  let hostId = null
  try {
    await page.waitForSelector('.project', { timeout: 30000 })
    const projectCount = await page.locator('.project').count()
    if (projectCount !== 1) throw new Error('expected exactly 1 seeded project, got ' + projectCount)

    // Свёрнутый проект: children скрыты, бейджей пока нет.
    if (await page.locator('.project-children').first().isVisible().catch(() => false)) {
      throw new Error('project should start collapsed')
    }

    // Живая сессия: создаём, активируем кликом по строке, шлём промпт.
    hostId = await page.evaluate(async () => {
      const s = await window.piwright.getSettings()
      const created = await window.piwright.newSession(s.projects[0])
      return created.hostId
    })
    await page.locator('.project .expand').first().click()
    await page.waitForSelector('.session-row', { timeout: 90000 })
    await page.locator('.session-row').first().click()
    await page.waitForSelector('.composer textarea', { timeout: 30000 })
    await page.locator('.composer textarea').fill(PROMPT)
    await page.locator('.composer textarea').press('Enter')

    // Агент начал ход → точка busy → сворачиваем проект, появляется бейдж «Working».
    await waitUntil(
      async () => (await page.locator('.session-row .dot.busy').count()) > 0,
      60000,
      'session dot busy'
    )
    await page.locator('.project .expand').first().click()
    await page.waitForSelector('.project-badges', { timeout: 30000 })
    const badgeText = await page.locator('.project-badges .proj-badge').first().textContent()
    console.log('badges visible, first counter:', badgeText)

    // Сам кейс: клик по строке счётчиков раскрывает проект.
    await page.locator('.project-badges').click()
    await page.waitForSelector('.project-children', { timeout: 5000 })
    const badgesGone = (await page.locator('.project-badges').count()) === 0
    console.log('expanded after badge click:', badgesGone)
    if (!badgesGone) throw new Error('badges row still visible after expansion')

    // Обратный путь не регрессировал: стрелка сворачивает, бейджи возвращаются.
    await page.locator('.project .expand').first().click()
    await page.waitForSelector('.project-badges', { timeout: 5000 })
    console.log('collapse restores badges')

    console.log('SMOKE OK')
  } finally {
    try {
      if (hostId !== null) await page.evaluate((id) => window.piwright.closeSession(id), hostId)
    } catch {}
    await browser.close()
  }
}

main().catch((err) => {
  console.error('SMOKE FAIL:', err.message)
  process.exit(1)
})
