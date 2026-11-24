/* Смоук дерева задач в панели канбана: шеврон раскрытия доски, колонки с цветной плашкой,
 * задачи с точками, сворачивание колонок, счётчики-бейджи, меню «...» доски.
 * Запуск против smoke-инстанса:
 *   npm run build
 *   npx electron . --smoke --remote-debugging-port=9223 --user-data-dir=%TEMP%\piwright-smoke-userdata
 *   node tests/manual/smoke-kanban-panel-tree.cjs
 */
const { execSync } = require('node:child_process')
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { chromium } = require('playwright-core')

const BOARD = 'SMOKE-TREE'
const rx = (ru, en) => new RegExp(`${ru}|${en}`)

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'piwright-smoke-tree-'))
  const winDir = dir.replace(/\//g, '\\')
  const run = (cmd) => execSync(cmd, { cwd: dir, stdio: 'pipe' })
  run('git init -q -b main')
  run('git config user.email smoke@test')
  run('git config user.name smoke')
  writeFileSync(join(dir, 'a.txt'), '1')
  run('git add .')
  run('git commit -q -m base-1')

  const browser = await chromium.connectOverCDP('http://localhost:9223')
  const page = await browser.contexts()[0].pages()[0]
  const log = (...a) => console.log(...a)
  const ok = []
  const check = (name, cond) => { ok.push(cond); log(cond ? `OK  ${name}` : `FAIL ${name}`) }
  try {
    await page.waitForSelector('.right-bar', { timeout: 30000 })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)

    const boot = await page.evaluate(async (d) => {
      const s = await window.piwright.getSettings()
      const has = (s.projects ?? []).some((p) => p.dir === d)
      if (!has) await window.piwright.setSettings({ projects: [...(s.projects ?? []), { kind: 'native', dir: d }], kanbanEnabled: true })
      return true
    }, winDir)
    log('boot project:', boot)
    await page.reload()
    await page.waitForSelector('.right-bar', { timeout: 30000 })
    await page.waitForTimeout(1200)

    // открыть панель канбана
    const kbBtn = page.locator('.right-bar button[title="Канбан"], .right-bar button[title="Kanban"]')
    if (!(await kbBtn.getAttribute('class'))?.includes('active')) await kbBtn.click()
    await page.waitForTimeout(800)

    // доска от прошлого прогона — удалить через меню «...»
    const oldRow = page.locator('.kanban-board-row', { hasText: BOARD })
    if (await oldRow.count()) {
      await oldRow.locator('.kanban-board-action').evaluate((el) => el.click())
      await page.waitForTimeout(400)
      await page.locator('.project-menu button', { hasText: rx('Удалить доску', 'Delete board') }).click()
      await page.waitForTimeout(400)
      await page.locator('.files-rename-box button', { hasText: rx('Удалить', 'Delete') }).last().click()
      await page.waitForTimeout(800)
    }

    // создать временную доску
    await page.locator('.kanban-add').click()
    await page.locator('.kanban-name-input').fill(BOARD)
    await page.locator('.kanban-name-input').press('Enter')
    await page.waitForTimeout(800)

    // размер иконки добавления (стандартная крупная, как у проектов)
    const addSize = await page.locator('.kanban-add').evaluate((el) => getComputedStyle(el).fontSize)
    check(`add icon font-size 25px (got ${addSize})`, addSize === '25px')

    // у строки доски шеврон + счётчик + «...», а отдельных ✎/✕ больше нет
    const row = page.locator('.kanban-board-row', { hasText: BOARD })
    check('board row has expand chevron', (await row.locator('.expand').count()) === 1)
    check('board row has count', (await row.locator('.kanban-board-count').count()) === 1)
    check('board row has menu button', (await row.locator('.kanban-board-action').count()) === 1)

    // меню «...»: переименовать / свернуть все / развернуть все / удалить
    await row.locator('.kanban-board-action').evaluate((el) => el.click())
    await page.waitForTimeout(400)
    const menu = page.locator('.project-menu')
    check('menu rename', (await menu.locator('button', { hasText: rx('Переименовать', 'Rename') }).count()) === 1)
    check('menu collapse all', (await menu.locator('button', { hasText: rx('Свернуть все колонки', 'Collapse all columns') }).count()) === 1)
    check('menu expand all', (await menu.locator('button', { hasText: rx('Развернуть все колонки', 'Expand all columns') }).count()) === 1)
    check('menu delete', (await menu.locator('button', { hasText: rx('Удалить доску', 'Delete board') }).count()) === 1)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    // раскрыть дерево
    await row.locator('.expand').evaluate((el) => el.click())
    await page.waitForTimeout(1000)
    const tree = page.locator('.kanban-tree-board', { hasText: BOARD })
    check('tree appears', (await tree.locator('.kanban-tree').count()) === 1)
    check('tree has 5 columns', (await tree.locator('.kanban-tree-col').count()) === 5)
    const backlogCol = tree.locator('.kanban-tree-col', { hasText: 'Backlog' })
    check('backlog col has accent bar', (await backlogCol.locator('.kanban-col-accent').count()) === 1)
    const accentColor = await backlogCol.locator('.kanban-col-accent').evaluate((el) => getComputedStyle(el).backgroundColor)
    check(`accent bar colored (got ${accentColor})`, accentColor !== 'rgba(0, 0, 0, 0)')

    // добавить задачу в Backlog через вкладку доски
    await page.locator('.kanban-board-name', { hasText: BOARD }).click()
    await page.waitForTimeout(1000)
    const column = (name) => page.locator('.board-column', { has: page.locator('.board-column-name', { hasText: name }) })
    await column('Backlog').locator('.board-card-add').click()
    await column('Backlog').locator('.kanban-name-input').fill('SMOKE-TASK-1')
    await column('Backlog').locator('.kanban-name-input').press('Enter')
    await page.waitForTimeout(600)
    await column('Backlog').locator('.board-card-add').click()
    await column('Backlog').locator('.kanban-name-input').fill('SMOKE-TASK-2')
    await column('Backlog').locator('.kanban-name-input').press('Enter')
    await page.waitForTimeout(600)

    // на карточке доски точка-заглушка (невидимая) — выравнивание сохранено
    const cardDot = column('Backlog').locator('.board-card', { hasText: 'SMOKE-TASK-1' }).locator('.dot')
    check('board card has dot placeholder', (await cardDot.count()) === 1)

    // вернуться в панель: задачи в дереве
    const treeCard = tree.locator('.kanban-tree-card', { hasText: 'SMOKE-TASK-1' })
    check('tree shows task', (await treeCard.count()) === 1)

    // свернуть колонку Backlog шевроном
    await backlogCol.locator('.expand').evaluate((el) => el.click())
    await page.waitForTimeout(600)
    check('collapsed: tasks hidden', (await tree.locator('.kanban-tree-card', { hasText: 'SMOKE-TASK-1' }).count()) === 0)
    check('collapsed: count stays', (await backlogCol.locator('.kanban-board-count').textContent()) === '2')

    // развернуть обратно через шеврон
    await backlogCol.locator('.expand').evaluate((el) => el.click())
    await page.waitForTimeout(600)
    check('expanded: tasks visible', (await tree.locator('.kanban-tree-card', { hasText: 'SMOKE-TASK-1' }).count()) === 1)

    // «Свернуть все» из меню доски
    await row.locator('.kanban-board-action').evaluate((el) => el.click())
    await page.waitForTimeout(400)
    await page.locator('.project-menu button', { hasText: rx('Свернуть все колонки', 'Collapse all columns') }).click()
    await page.waitForTimeout(800)
    check('collapse all: no tasks visible', (await tree.locator('.kanban-tree-card').count()) === 0)
    check('collapse all: 5 collapsed chevrons', (await page.locator('.kanban-tree-col .expand', { hasText: '▸' }).count()) === 5)

    // «Развернуть все»
    await row.locator('.kanban-board-action').evaluate((el) => el.click())
    await page.waitForTimeout(400)
    await page.locator('.project-menu button', { hasText: rx('Развернуть все колонки', 'Expand all columns') }).click()
    await page.waitForTimeout(800)
    check('expand all: tasks visible', (await tree.locator('.kanban-tree-card', { hasText: 'SMOKE-TASK-1' }).count()) === 1)

    // persist: перезагрузка страницы — дерево и свёрнутость колонок живут в settings
    await backlogCol.locator('.expand').evaluate((el) => el.click())
    await page.waitForTimeout(800)
    await page.reload()
    await page.waitForSelector('.right-bar', { timeout: 30000 })
    await page.waitForTimeout(1200)
    const kbBtn2 = page.locator('.right-bar button[title="Канбан"], .right-bar button[title="Kanban"]')
    if (!(await kbBtn2.getAttribute('class'))?.includes('active')) await kbBtn2.click()
    await page.waitForTimeout(800)
    const row2 = page.locator('.kanban-board-row', { hasText: BOARD })
    const expandedAfter = await row2.locator('.expand').textContent()
    check('persist: board still expanded', expandedAfter === '▾')
    const tree2 = page.locator('.kanban-tree-board', { hasText: BOARD })
    check('persist: backlog still collapsed', (await tree2.locator('.kanban-tree-card').count()) === 0)

    // скриншот панели с деревом
    await tree2.locator('.kanban-tree-col', { hasText: 'Backlog' }).locator('.expand').evaluate((el) => el.click())
    await page.waitForTimeout(800)
    await page.locator('.kanban-panel').screenshot({ path: join(__dirname, 'out-kanban-panel-tree.png') })

    // убрать за собой
    await row2.locator('.kanban-board-action').evaluate((el) => el.click())
    await page.waitForTimeout(400)
    await page.locator('.project-menu button', { hasText: rx('Удалить доску', 'Delete board') }).click()
    await page.waitForTimeout(400)
    await page.locator('.files-rename-box button', { hasText: rx('Удалить', 'Delete') }).last().click()
    await page.waitForTimeout(800)
    check('cleanup: board removed', (await page.locator('.kanban-board-row', { hasText: BOARD }).count()) === 0)

    log(`RESULT: ${ok.filter(Boolean).length}/${ok.length}`)
    if (ok.some((v) => !v)) process.exitCode = 1
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
