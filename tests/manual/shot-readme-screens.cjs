/* Съёмка README-скриншотов против smoke-инстанса (SMOKE_CDP, по умолчанию 9223):
 *  1) kanban-board.png — доска TaskLite + дерево в панели, бейджи задач (busy/question),
 *     свёрнутая колонка с бейджами;
 *  2) kanban-card.png — модалка карточки с вложениями, комментариями, чипом сессии,
 *     чипами коммитов и картинками в комментариях;
 *  3) remote-question.png — телефон (390x844@3), ask-карточка в remote web UI.
 * Инстанс должен быть запущен с --user-data-dir=<tmp>\piwright-shot-userdata, в settings.json
 * которого заранее сидированы проект tasklite-demo, kanbanEnabled и piPathNative=fake-pi-shot.cmd.
 * Картинки-моки кладутся в <tmp>\piwright-shot\img заранее (см. шаг запуска в journal).
 */
const { execSync } = require('node:child_process')
const { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { chromium } = require('playwright-core')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'
const ROOT = join(tmpdir(), 'piwright-shot')
const DIR = join(ROOT, 'tasklite-demo')
const WIN_DIR = DIR.replace(/\//g, '\\')
const IMG = join(ROOT, 'img')
const OUT = 'D:\\Projects\\piwright\\docs\\screenshots'
const BOARD_ID = 'b-3fa9c2d1'
const BOARD_FILE = join(DIR, '.pi', 'kanban', `${BOARD_ID}.json`)
const REMOTE_PORT = 7697
const PIN = '246813'

const COL = {
  backlog: 'col-1a2b3c4d',
  todo: 'col-2b3c4d5e',
  progress: 'col-3c4d5e6f',
  review: 'col-4d5e6f7a',
  done: 'col-5e6f7a8b'
}

const iso = (h, m) => `2026-11-25T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`

function boardJson(sessionA, sessionB) {
  return {
    version: 1,
    id: BOARD_ID,
    name: 'TaskLite',
    rev: 7 + (Math.floor(Date.now() / 1000) % 1000),
    workflow: '',
    columns: [
      { id: COL.backlog, name: 'Backlog' },
      { id: COL.todo, name: 'Todo' },
      { id: COL.progress, name: 'In Progress' },
      { id: COL.review, name: 'Review' },
      { id: COL.done, name: 'Done' }
    ],
    cards: [
      {
        id: 'c-11aa22bb', title: 'Add CSV export for the board', columnId: COL.backlog, order: 0,
        createdAt: iso(8, 10), updatedAt: iso(8, 10), description: 'Export the current board (columns, cards, order) as CSV for spreadsheets.',
        images: [], comments: []
      },
      {
        id: 'c-22bb33cc', title: 'Keyboard shortcuts for card actions', columnId: COL.backlog, order: 1,
        createdAt: iso(8, 30), updatedAt: iso(8, 30), description: 'Shortcuts to open, assign and move the selected card without the mouse.',
        images: [], comments: []
      },
      {
        id: 'c-33cc44dd', title: 'Dark theme contrast audit', columnId: COL.todo, order: 0,
        createdAt: iso(9, 0), updatedAt: iso(9, 0), description: 'Check column tints, badges and dots against WCAG AA in the dark theme.',
        images: [], comments: [],
        sessions: [{ id: 's-closed-1', title: 'Contrast audit notes', at: iso(9, 0) }]
      },
      {
        id: 'c-44dd55ee', title: 'Card archive instead of delete', columnId: COL.todo, order: 1,
        createdAt: iso(9, 5), updatedAt: iso(9, 5), description: 'Soft-delete cards into an archive with restore from the card menu.',
        images: [], comments: []
      },
      {
        id: 'c-55ee66ff', title: 'Drag-and-drop multi-select', columnId: COL.progress, order: 0,
        createdAt: iso(9, 20), updatedAt: iso(10, 2),
        description: 'Drag several cards at once: select with Ctrl+click, drop onto a column moves the whole selection.',
        images: ['attachments/tasklite-drag-mock.png'],
        comments: [
          {
            id: 'm-aa11bb22', author: 'agent',
            text: 'Linked session: session:' + sessionA + '. The selection set lives in BoardView; the drop handler reuses the single-card move path for the whole selection.',
            images: ['attachments/tasklite-selection.png'],
            at: iso(9, 24),
            session: { id: sessionA, title: 'Drag-select refactor' },
            commits: [{ hash: '9f14e2a7c3b84d0561fa2be8c7d90413a5b62f70', message: 'kanban: multi-select drag skeleton' }]
          },
          {
            id: 'm-bb22cc33', author: 'user',
            text: 'Nice. Keep Escape as the only way to clear the selection, and show the counter near the cursor.',
            images: ['attachments/tasklite-counter.png'],
            at: iso(9, 41)
          },
          {
            id: 'm-cc33dd44', author: 'agent',
            text: 'Selection survives column collapse; collapsed counters now aggregate dotted cards too.',
            images: [], at: iso(10, 2)
          }
        ],
        sessions: [{ id: sessionA, title: 'Drag-select refactor', at: iso(9, 24) }],
        commits: [{ hash: '9f14e2a7c3b84d0561fa2be8c7d90413a5b62f70', message: 'kanban: multi-select drag skeleton', at: iso(9, 24) }]
      },
      {
        id: 'c-66ff77aa', title: 'Column WIP limits', columnId: COL.progress, order: 1,
        createdAt: iso(9, 50), updatedAt: iso(10, 10),
        description: 'Warn when a column exceeds its WIP limit; the limit is editable from the column menu.',
        images: [], comments: [
          {
            id: 'm-dd44ee55', author: 'agent',
            text: 'Linked session: session:' + sessionB + '. Drafting the rollout plan — a couple of open questions before coding.',
            images: [], at: iso(10, 10),
            session: { id: sessionB, title: 'WIP limits spike' }
          }
        ],
        sessions: [{ id: sessionB, title: 'WIP limits spike', at: iso(10, 10) }]
      },
      {
        id: 'c-77aa88bb', title: 'Board revision history', columnId: COL.review, order: 0,
        createdAt: iso(7, 40), updatedAt: iso(7, 40), description: 'Timeline of board changes with revert to any revision.',
        images: [], comments: []
      },
      {
        id: 'c-88bb99cc', title: 'Column color themes', columnId: COL.done, order: 0,
        createdAt: iso(6, 0), updatedAt: iso(6, 30), description: 'Per-column accent colors from the board theme.',
        images: [], comments: [],
        commits: [{ hash: '3c8d1e9f4a27b5c608d9e1f2a3b4c5d6e7f80912', message: 'kanban: column accent themes', at: iso(6, 30) }]
      },
      {
        id: 'c-99cc00dd', title: 'Unread badge for board updates', columnId: COL.done, order: 1,
        createdAt: iso(6, 10), updatedAt: iso(6, 45), description: 'Green dot on cards with unseen agent turns.',
        images: [], comments: []
      }
    ]
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function until(fn, timeout, what) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    last = await fn()
    if (last) return last
    await sleep(500)
  }
  throw new Error('timeout waiting for ' + what + ': ' + JSON.stringify(last))
}

async function main() {
  if (!existsSync(join(DIR, '.git'))) throw new Error('temp project missing: ' + DIR)
  const browser = await chromium.connectOverCDP(CDP)
  const page = browser.contexts()[0].pages()[0]
  const log = (...a) => console.log(...a)
  try {
    await page.waitForSelector('.right-bar', { timeout: 30000 })
    await page.keyboard.press('Escape')
    await sleep(500)

    // закрыть сессии прошлых прогонов (в рендерере строки остаются — перезагружаем окно)
    const stale = await page.evaluate(() => window.piwright.listSessions())
    if (stale.active.length > 0) {
      for (const row of stale.active) {
        await page.evaluate((h) => window.piwright.closeSession(h), row.hostId)
        log('closed stale session:', row.hostId.slice(0, 8))
      }
      await page.reload()
      await page.waitForSelector('.right-bar', { timeout: 30000 })
      await sleep(1200)
    }

    // две сессии с фейковым pi: A — busy-ход, B — ask-диалог
    const a = await page.evaluate(async (dir) => window.piwright.newSession({ kind: 'native', dir }), WIN_DIR)
    log('session A host:', a.hostId)
    await page.evaluate((h) => window.piwright.renameSession(h, 'Drag-select refactor'), a.hostId)
    await page.evaluate((h) => window.piwright.shareSession(h, true), a.hostId)

    const b = await page.evaluate(async (dir) => window.piwright.newSession({ kind: 'native', dir }), WIN_DIR)
    log('session B host:', b.hostId)
    await page.evaluate((h) => window.piwright.renameSession(h, 'WIP limits spike'), b.hostId)
    await page.evaluate((h) => window.piwright.shareSession(h, true), b.hostId)

    // раскрыть группу проекта в панели (после создания сессий)
    for (let i = 0; i < 5; i++) {
      try {
        await page.locator('.project .expand').first().click({ timeout: 2000 })
        await page.waitForSelector('.session-row', { timeout: 3000 })
        break
      } catch {
        if (i === 4) throw new Error('session rows did not appear after expand clicks')
      }
    }

    for (const [host, title, prompt] of [
      [a.hostId, 'Drag-select refactor', 'Implement drag-and-drop multi-select for the kanban board'],
      [b.hostId, 'WIP limits spike', 'Plan the WIP limits rollout [ask]']
    ]) {
      const row = page.locator('.session-row', { hasText: title })
      await until(async () => (await row.count()) > 0, 30000, 'session row ' + title)
      await row.first().click()
      await page.waitForSelector('.composer textarea', { timeout: 90000 })
      await sleep(800)
      const sent = await page.evaluate(async ([h, text]) => window.piwright.prompt(h, text, [], undefined), [host, prompt])
      if (!sent.ok) throw new Error('prompt failed: ' + sent.error)
      log('prompt sent:', title)
    }

    // ждём статусы: A — busy, B — question (ask-диалог открыт)
    const snap = await until(async () => {
      const s = await page.evaluate(() => window.piwright.listSessions())
      const ra = s.active.find((r) => r.hostId === a.hostId)
      const rb = s.active.find((r) => r.hostId === b.hostId)
      if (ra && rb && ra.dot === 'busy' && rb.dot === 'question') return { ra, rb }
      return null
    }, 30000, 'session dots busy+question')
    const idA = snap.ra.sessionId
    const idB = snap.rb.sessionId
    log('session ids:', idA, idB)

    // сид доски с реальными id сессий + вложения-картинки (с нуля — без суффиксов -1)
    rmSync(join(DIR, '.pi', 'kanban'), { recursive: true, force: true })
    mkdirSync(join(DIR, '.pi', 'kanban'), { recursive: true })
    writeFileSync(BOARD_FILE, JSON.stringify(boardJson(idA, idB), null, 2))
    log('board written:', BOARD_FILE)

    // зелёная точка непрочитанной закрытой сессии (kanbanCardAttention) + сброс свёрнутых колонок
    // projectKey сохраняет регистр пути (normalizeDir меняет только слэши)
    const normDir = WIN_DIR.replace(/\\/g, '/').replace(/\/+$/, '')
    await page.evaluate(async ([key]) => {
      const s = await window.piwright.getSettings()
      await window.piwright.setSettings({
        ...s,
        kanbanCardAttention: { ...s.kanbanCardAttention, [key]: { sessions: ['s-closed-1'], dismissed: [] } },
        kanbanColumnsCollapsed: {}
      })
    }, ['native\u0000' + normDir])
    log('attention seeded for', normDir)
    for (const name of ['tasklite-drag-mock.png', 'tasklite-selection.png', 'tasklite-counter.png']) {
      const base64 = readFileSync(join(IMG, name)).toString('base64')
      const put = await page.evaluate(async ([proj, n, data]) => window.piwright.kanbanAttachmentPut(proj, n, data), [{ kind: 'native', dir: WIN_DIR }, name, base64])
      if (!put || !put.name) throw new Error('attachment put failed: ' + JSON.stringify(put))
      log('attachment:', put.path)
    }

    // доска в панели (открыть панель канбана, если закрыта)
    const kbBtn = page.locator('.right-bar button[title="Kanban"], .right-bar button[title="Канбан"]')
    if (!(await kbBtn.getAttribute('class'))?.includes('active')) await kbBtn.click()
    await sleep(800)
    await until(async () => (await page.locator('.kanban-board-row', { hasText: 'TaskLite' }).count()) > 0, 15000, 'board row')
    await page.locator('.kanban-board-row', { hasText: 'TaskLite' }).locator('.kanban-board-name').click()
    await page.waitForSelector('.board-column', { timeout: 15000 })
    log('board tab open')

    // бейджи в дереве: раскрыть доску (если ещё не раскрыта), дождаться точек на задачах
    if ((await page.locator('.kanban-tree').count()) === 0) {
      await page.locator('.kanban-board-row', { hasText: 'TaskLite' }).locator('.expand').click()
    }
    // точки в дереве: busy и question на раскрытых карточках In Progress, зелёная — в Todo
    await until(async () =>
      (await page.locator('.kanban-tree-card', { hasText: 'Drag-and-drop multi-select' }).locator('.dot.busy').count()) === 1 &&
      (await page.locator('.kanban-tree-card', { hasText: 'Column WIP limits' }).locator('.dot.question').count()) === 1 &&
      (await page.locator('.kanban-tree-card', { hasText: 'Dark theme contrast audit' }).locator('.dot.idle').count()) === 1,
    15000, 'tree dots')

    // свернуть Todo — зелёный бейдж у свёрнутой колонки (идемпотентно)
    const todoCol = page.locator('.kanban-tree-col', { hasText: 'Todo' })
    if ((await todoCol.locator('.proj-badge').count()) === 0 && (await page.locator('.kanban-tree-card', { hasText: 'Dark theme contrast audit' }).count()) > 0) {
      await todoCol.locator('.expand').click()
    }
    await until(async () =>
      (await page.locator('.kanban-tree-col', { hasText: 'Todo' }).locator('.proj-badge.green').count()) === 1,
    10000, 'collapsed column badge')
    await sleep(800)

    await page.screenshot({ path: join(OUT, 'kanban-board.png') })
    log('shot 1: kanban-board.png')

    // модалка карточки: вложения, комментарии с чипами и картинками
    await page.locator('.board-card', { hasText: 'Drag-and-drop multi-select' }).first().dblclick()
    await page.waitForSelector('.board-card-modal', { timeout: 10000 })
    await until(async () => {
      const thumbs = await page.locator('.board-card-modal .board-thumb').count()
      if (thumbs < 3) return false
      return page.evaluate(() => [...document.querySelectorAll('.board-card-modal .board-thumb')].every((img) => img.naturalWidth > 0))
    }, 15000, 'modal thumbs loaded')
    await sleep(800)
    await page.screenshot({ path: join(OUT, 'kanban-card.png') })
    log('shot 2: kanban-card.png')
    await page.keyboard.press('Escape')
    await sleep(400)

    // remote: включить мост, дождаться running
    await page.evaluate(async (cfg) => {
      const s = await window.piwright.getSettings()
      await window.piwright.setSettings({
        ...s,
        notifications: { ...s.notifications, remote: { ...s.notifications.remote, enabled: true, port: cfg.port, staticPin: cfg.pin } }
      })
    }, { port: REMOTE_PORT, pin: PIN })
    await until(async () => {
      const st = await page.evaluate(() => window.piwright.remoteStatus())
      return st.running === true ? st : null
    }, 30000, 'remote running')
    log('remote running on', REMOTE_PORT)

    // телефон: отдельный браузер (newContext через CDP не работает), логин, сессия B, ask-карточка
    const pb = await chromium.launch({ channel: 'msedge' })
    const ctx = await pb.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
    const phone = await ctx.newPage()
    await phone.goto(`http://127.0.0.1:${REMOTE_PORT}/login`)
    await phone.fill('input[name=pin]', PIN)
    await phone.click('button[type=submit]')
    await phone.waitForSelector('#tabs .tab', { timeout: 15000 })
    await phone.locator('#tabs .tab', { hasText: 'WIP limits spike' }).click()
    await phone.waitForSelector('#dialogs .dialog', { timeout: 15000 })
    await until(async () => (await phone.locator('#dialogs .dialog .q').count()) === 2, 10000, 'ask questions rendered')
    await sleep(1000)
    await phone.screenshot({ path: join(OUT, 'remote-question.png') })
    log('shot 3: remote-question.png')
    await ctx.close()
    await pb.close()

    // выключить remote
    await page.evaluate(async () => {
      const s = await window.piwright.getSettings()
      await window.piwright.setSettings({
        ...s,
        notifications: { ...s.notifications, remote: { ...s.notifications.remote, enabled: false } }
      })
    })
    log('DONE')
  } finally {
    await browser.close().catch(() => {})
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('SHOT FAIL:', err)
    process.exit(1)
  })
