// Smoke: виртуализированная лента. Генерирует синтетическую сессию (~450 записей),
// открывает её, проверяет: DOM ограничен пулом, скролл вверх/вниз работает,
// контент верха/низа доступен. Файл сессии удаляет.
const { chromium } = require('playwright-core')
const { join } = require('node:path')
const { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } = require('node:fs')
const { homedir, tmpdir } = require('node:os')

const PROJECT_DIR = 'D:\\Projects\\piwright'
const PAIRS = 150
const POOL_LIMIT = 110 // пул 100 + запас на cursor/bottomRef

// Уникальный id на прогон: пересозданный файл с тем же id попал бы в уже ошибившийся хост.
const RUN_ID = `sm0kevf0-1111-4222-8333-${Date.now().toString(16).padStart(12, '0')}`

function cleanupOldSessions() {
  const dir = join(homedir(), '.pi', 'agent', 'sessions', '--D--Projects-piwright--')
  try {
    for (const f of readdirSync(dir)) {
      if (f.includes('sm0kevf0')) rmSync(join(dir, f), { force: true })
    }
  } catch {}
}

function buildSessionFile() {
  const id = RUN_ID
  const dir = join(homedir(), '.pi', 'agent', 'sessions', '--D--Projects-piwright--')
  const file = join(dir, `2026-11-23T10-00-00-000Z_${id}.jsonl`)
  const lines = []
  const ts = (i) => new Date(Date.UTC(2026, 10, 23, 10, 0, 0) + i * 1000).toISOString()
  lines.push(JSON.stringify({ type: 'session', version: 3, id, timestamp: ts(0), cwd: PROJECT_DIR }))
  lines.push(
    JSON.stringify({ type: 'session_info', id: 'a0000001', parentId: null, timestamp: ts(0), name: 'SMOKE-VF virtual feed' })
  )
  let n = 1
  const hex = (v) => v.toString(16).padStart(8, '0')
  for (let i = 0; i < PAIRS; i++) {
    lines.push(
      JSON.stringify({
        type: 'message',
        id: hex(n++),
        parentId: i === 0 ? null : hex(n - 2),
        timestamp: ts(i * 2 + 1),
        message: { role: 'user', content: [{ type: 'text', text: `SMOKE-VF user question number ${i + 1}` }] }
      })
    )
    const paragraphs = [
      `SMOKE-VF answer ${i + 1}.`,
      'Paragraph one with some words to give the message a realistic height for the virtualized feed.',
      'Paragraph two: markdown-ish list\n\n- item a\n- item b\n- item c',
      'Paragraph three closes the answer.'
    ]
    lines.push(
      JSON.stringify({
        type: 'message',
        id: hex(n++),
        parentId: hex(n - 2),
        timestamp: ts(i * 2 + 2),
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: paragraphs.join('\n\n') }],
          stopReason: 'stop',
          usage: { input: 120, output: 60, totalTokens: 180 }
        }
      })
    )
  }
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, lines.join('\n') + '\n', 'utf8')
  return file
}

async function main() {
  cleanupOldSessions()
  const sessionFile = buildSessionFile()
  console.log('session file:', sessionFile)
  let browser
  try {
    browser = await chromium.connectOverCDP('http://localhost:9223')
    const ctx = browser.contexts()[0]
    const page = ctx.pages()[0]
    if (!page.url().includes('worktrees')) {
      throw new Error(`wrong app instance (old bundle?): ${page.url()}`)
    }
    await page.bringToFront()

    // Проект в панель (свежий user-data-dir): дедуп + добавление через setSettings, затем reload —
    // load() после него рефрешит историю всех проектов (см. ui-smoke skill).
    await page.evaluate(async (dir) => {
      const settings = await window.piwright.getSettings()
      const seen = new Set()
      const projects = []
      for (const p of settings.projects) {
        const key = `${p.kind}|${p.dir.toLowerCase()}`
        if (seen.has(key)) continue
        seen.add(key)
        projects.push(p)
      }
      if (!projects.some((p) => p.dir.toLowerCase() === dir.toLowerCase())) projects.push({ kind: 'native', dir })
      await window.piwright.setSettings({ projects })
    }, PROJECT_DIR)
    await page.reload()
    await page.waitForSelector('.project-row', { timeout: 30000 })
    await page.waitForTimeout(2500)

    // Открыть проект и синтетическую сессию: активная вкладка (.session-row) или история (.history-item).
    const rows = page.locator('.project-row')
    const total = await rows.count()
    let opened = false
    for (let i = 0; i < total; i++) {
      const name = (await rows.nth(i).textContent()) ?? ''
      if (!/piwright/i.test(name)) continue
      await rows.nth(i).click()
      await page.waitForTimeout(1500)
      const smokeItem = page
        .locator('.session-row, .history-item', { hasText: 'SMOKE-VF' })
        .first()
      if ((await smokeItem.count()) === 0) await page.waitForTimeout(2000)
      if ((await smokeItem.count()) === 0) break
      await smokeItem.click()
      opened = true
      break
    }
    if (!opened) {
      console.log('FAIL: SMOKE-VF session not found in history')
      await browser.close()
      return
    }

    // Ждём реплей истории (pi резюмится, лента восстанавливается).
    await page.waitForSelector('.transcript .entry-slot', { timeout: 120000 })
    await page.waitForTimeout(2500)

    // 1) Низ ленты: DOM ограничен пулом, последний контент доступен.
    const bottom = await page.evaluate((lastPair) => {
      const el = document.querySelector('.transcript')
      const slots = el.querySelectorAll('.entry-slot')
      return {
        slots: slots.length,
        scrollHeight: el.scrollHeight,
        hasLastQuestion: el.textContent.includes(`SMOKE-VF user question number ${lastPair}`)
      }
    }, PAIRS)
    console.log('bottom:', JSON.stringify(bottom))
    if (bottom.slots > POOL_LIMIT) throw new Error(`pool exceeded at bottom: ${bottom.slots}`)
    if (bottom.scrollHeight < 30000) throw new Error(`scrollHeight too small: ${bottom.scrollHeight}`)
    if (!bottom.hasLastQuestion) throw new Error('last question not rendered at bottom')

    // 2) Скролл к верху: пул переиспользуется, первый вопрос отрисовывается, позиция не улетает.
    await page.evaluate(() => {
      document.querySelector('.transcript').scrollTop = 0
    })
    await page.waitForTimeout(2000)
    const top = await page.evaluate(() => {
      const el = document.querySelector('.transcript')
      return {
        slots: el.querySelectorAll('.entry-slot').length,
        scrollTop: el.scrollTop,
        hasFirstQuestion: el.textContent.includes('SMOKE-VF user question number 1')
      }
    })
    console.log('top:', JSON.stringify(top))
    if (top.slots > POOL_LIMIT) throw new Error(`pool exceeded at top: ${top.slots}`)
    if (!top.hasFirstQuestion) throw new Error('first question not rendered at top')
    if (top.scrollTop > 400) throw new Error(`scrollTop not near top: ${top.scrollTop}`)

    // 3) Середина: скролл в середину, DOM всё ещё ограничен.
    await page.evaluate(() => {
      const el = document.querySelector('.transcript')
      el.scrollTop = el.scrollHeight / 2
    })
    await page.waitForTimeout(1500)
    const mid = await page.evaluate(() => ({
      slots: document.querySelectorAll('.transcript .entry-slot').length
    }))
    console.log('mid slots:', mid.slots)
    if (mid.slots > POOL_LIMIT) throw new Error(`pool exceeded at middle: ${mid.slots}`)

    // 4) Возврат на дно — авто-прилип и последние записи на месте.
    await page.evaluate(() => {
      const el = document.querySelector('.transcript')
      el.scrollTop = el.scrollHeight
    })
    await page.waitForTimeout(1500)
    const back = await page.evaluate((lastPair) => {
      const el = document.querySelector('.transcript')
      return {
        slots: el.querySelectorAll('.entry-slot').length,
        distBottom: el.scrollHeight - el.scrollTop - el.clientHeight,
        hasLastQuestion: el.textContent.includes(`SMOKE-VF user question number ${lastPair}`)
      }
    }, PAIRS)
    console.log('back to bottom:', JSON.stringify(back))
    if (back.slots > POOL_LIMIT) throw new Error(`pool exceeded on return: ${back.slots}`)
    if (!back.hasLastQuestion) throw new Error('last question lost after return')
    if (back.distBottom > 60) throw new Error(`not pinned to bottom: ${back.distBottom}`)

    // Скриншот для проверки вёрстки (текст помещается, нет наложений).
    await page.screenshot({ path: join(tmpdir(), 'smoke-virtual-feed.png'), fullPage: false })
    console.log('screenshot:', join(tmpdir(), 'smoke-virtual-feed.png'))
    await browser.close()
    console.log('SMOKE OK')
  } catch (err) {
    console.log('SMOKE FAIL:', err.message)
    if (browser) await browser.close().catch(() => {})
    process.exitCode = 1
  } finally {
    if (existsSync(sessionFile)) rmSync(sessionFile)
    console.log('session file removed')
  }
}
main().catch((e) => {
  console.log('ERR', e.message)
  process.exit(1)
})
