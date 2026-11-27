/* Smoke: несколько git-репозиториев в проекте (главный + вложенный spec).
 * 1) Git-панель: плоский список содержит spec/-пути; тумблер группировки → секции .git-repo
 *    (главный + spec), сворачивание секции, выключение тумблера возвращает плоский список.
 * 2) Git Log: селект репозитория (.gitlog-repo-select) с 2 опциями, выбор spec показывает
 *    только коммиты spec, файлы коммита — без префикса spec/, клик по файлу открывает дифф.
 * Run: npm run build, smoke instance on 9227 (SMOKE_CDP), then node tests/manual/smoke-git-multirepo.cjs */
const { chromium } = require('playwright-core')
const { execSync } = require('node:child_process')
const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9227'
let pass = 0
let fail = 0
function check(name, cond, detail = '') {
  if (cond) {
    pass += 1
    console.log(`ok: ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    fail += 1
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const outer = mkdtempSync(join(tmpdir(), 'piwright-smoke-multirepo-'))
const winDir = outer.replace(/\//g, '\\')
function gitIn(dir, cmd) {
  execSync(`git ${cmd}`, { cwd: dir, stdio: 'pipe' })
}

// Главный репо: коммит + незакоммиченные правки
gitIn(outer, 'init -q -b main')
gitIn(outer, 'config user.email smoke@test')
gitIn(outer, 'config user.name smoke')
writeFileSync(join(outer, 'app.txt'), 'app-v1')
gitIn(outer, 'add .')
gitIn(outer, 'commit -q -m main-only-commit-beta')
writeFileSync(join(outer, 'app.txt'), 'app-v2')
writeFileSync(join(outer, 'extra.txt'), 'extra')

// Вложенный репо spec: свои коммиты + незакоммиченная правка
const nested = join(outer, 'spec')
mkdirSync(nested)
gitIn(nested, 'init -q -b main')
gitIn(nested, 'config user.email smoke@test')
gitIn(nested, 'config user.name smoke')
writeFileSync(join(nested, 'journal.md'), 'journal-v1')
gitIn(nested, 'add .')
gitIn(nested, 'commit -q -m spec-root')
gitIn(nested, 'commit -q --allow-empty -m spec-only-commit-alpha')
writeFileSync(join(nested, 'journal.md'), 'journal-v2')

async function main() {
  const browser = await chromium.connectOverCDP(CDP)
  const page = browser.contexts()[0].pages()[0]
  page.on('pageerror', (e) => console.log('PAGE ERR:', String(e).slice(0, 300)))

  await page.waitForSelector('.right-bar', { timeout: 30000 })
  await page.evaluate(async (dir) => {
    const s = await window.piwright.getSettings()
    if (!(s.projects ?? []).some((p) => p.dir === dir)) {
      await window.piwright.setSettings({ projects: [...(s.projects ?? []), { kind: 'native', dir }] })
    }
  }, winDir)
  await page.reload()
  await page.waitForSelector('.right-bar', { timeout: 30000 })
  await page.waitForTimeout(1000)

  const expand = page.locator('button[title="Развернуть панель"], button[title="Expand panel"]')
  if ((await expand.count()) > 0) {
    await expand.click()
    await page.waitForTimeout(800)
  }
  const current = await page.locator('.session-row.current').count()
  if (current === 0) {
    await page.locator('button[title="Новая сессия"], button[title="New session"]').first().click()
    await page.waitForSelector('.session-row.current', { timeout: 90000 })
    await page.waitForTimeout(2000)
  }

  // --- Git-панель: плоский список ---
  if ((await page.locator('.git-panel').count()) === 0) {
    await page.locator('.right-bar button[title="Git"], .right-bar button[title="Git"]').first().click()
    await page.waitForSelector('.git-panel', { timeout: 10000 })
  }
  await page.waitForSelector('.git-file', { timeout: 15000 })
  await page.waitForTimeout(1500)
  const flatNames = await page.locator('.git-file-name').allTextContents()
  check('flat list shows nested repo files', flatNames.some((n) => n === 'journal.md'), flatNames.join(', '))
  check('grouping off by default', (await page.locator('.git-repo').count()) === 0)

  // --- Тумблер группировки ---
  const toggle = page.locator('.git-head button[title="Group changes by repository"], .git-head button[title="Группировать изменения по репозиториям"]')
  check('grouping toggle present', (await toggle.count()) === 1)
  await toggle.click()
  await page.waitForTimeout(400)
  const repos = await page.locator('.git-repo .git-folder-name').allTextContents()
  check('two repo sections', repos.length === 2 && repos.includes('spec'), repos.join(' | '))
  const specHeader = page.locator('.git-repo', { hasText: 'spec' }).first()
  const activeOn = await toggle.evaluate((el) => el.classList.contains('active'))
  check('toggle highlighted when on', activeOn)
  // Файлы секции — внутри wrapper-дива заголовка (header + FileTree в одном контейнере)
  const specCount = await specHeader.evaluate((h) => h.parentElement.querySelectorAll('.git-file').length)
  check('spec section contains its files', specCount > 0, `count=${specCount}`)
  // Сворачивание секции spec
  await specHeader.click()
  await page.waitForTimeout(300)
  const afterCollapse = await specHeader.evaluate((h) => h.parentElement.querySelectorAll('.git-file').length)
  check('collapsed spec section hides files', afterCollapse === 0, `count=${afterCollapse}`)
  await specHeader.click()
  await page.waitForTimeout(300)
  // Выключение тумблера — плоский список
  await toggle.click()
  await page.waitForTimeout(400)
  check('toggle off restores flat list', (await page.locator('.git-repo').count()) === 0 && (await page.locator('.git-file').count()) > 0)
  // Тумблер подсвечен в активном состоянии (проверка на втором включении не нужна — класс .active)
  await page.screenshot({ path: 'tests/manual/out-git-multirepo-1-flat.png' })

  // --- Git Log: фильтр репозитория ---
  const gitLogBtn = page.locator('.right-bar button[title*="Git Log"], .right-bar button[title*="История Git"]').first()
  await gitLogBtn.click()
  await page.waitForSelector('.gitlog-dock', { timeout: 10000 })
  await page.waitForTimeout(1500)
  const repoSelect = page.locator('.gitlog-repo-select')
  check('repo filter visible', (await repoSelect.count()) === 1)
  const options = await repoSelect.locator('option').allTextContents()
  check('repo filter has main + spec', options.length === 2 && options.includes('spec'), options.join(' | '))
  const beforeSubjects = (await page.locator('.gitlog-subject').allTextContents()).join(' | ')
  check('main history shown by default', beforeSubjects.includes('main-only-commit-beta') && !beforeSubjects.includes('spec-only-commit-alpha'), beforeSubjects.slice(0, 120))

  await repoSelect.selectOption({ label: 'spec' })
  await page.waitForTimeout(1500)
  const specSubjects = (await page.locator('.gitlog-subject').allTextContents()).join(' | ')
  check('spec repo history after filter', specSubjects.includes('spec-only-commit-alpha') && !specSubjects.includes('main-only-commit-beta'), specSubjects.slice(0, 120))
  await page.screenshot({ path: 'tests/manual/out-git-multirepo-2-log-spec.png' })

  // Файлы коммита spec — без префикса; клик открывает дифф (spec-root трогал journal.md,
  // allow-empty коммит файлов не имеет)
  await page.locator('.gitlog-row', { hasText: 'spec-root' }).click()
  await page.waitForSelector('.gitlog-file', { timeout: 10000 })
  const filePaths = await page.locator('.gitlog-file-path').allTextContents()
  check('commit files without spec/ prefix', filePaths.length > 0 && filePaths.every((p) => !p.startsWith('spec/')), filePaths.join(', '))
  await page.locator('.gitlog-file').first().click()
  await page.waitForSelector('.diff-overlay', { timeout: 15000 })
  await page.waitForTimeout(1500)
  const diffTitle = (await page.locator('.diff-title').textContent()) ?? ''
  check('diff tab opened for nested repo file', diffTitle === 'journal.md', diffTitle)
  const diffText = await page.evaluate(() => {
    const editors = document.querySelectorAll('.diff-overlay .monaco-editor .view-lines')
    return [...editors].map((el) => el.textContent).join('\n')
  })
  check('diff content from spec repo', diffText.includes('journal-v'), diffText.slice(0, 80))
  await page.screenshot({ path: 'tests/manual/out-git-multirepo-3-diff.png' })

  // --- Pass criteria: нет переполнения ---
  const overflow = await page.evaluate(() => {
    const bad = []
    for (const sel of ['.git-panel', '.gitlog-dock', '.gitlog-head']) {
      for (const el of document.querySelectorAll(sel)) {
        if (el.scrollWidth > el.clientWidth + 1) bad.push(`${sel}: ${el.scrollWidth}>${el.clientWidth}`)
      }
    }
    return bad
  })
  check('no horizontal overflow', overflow.length === 0, overflow.join('; '))

  console.log(`SMOKE ${pass > 0 && fail === 0 ? 'OK' : 'FAILED'} ${pass}/${pass + fail}`)
  await browser.close()
  try {
    rmSync(outer, { recursive: true, force: true })
  } catch {
    // temp-репо может держать живая сессия смоук-инстанса — не критично
  }
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('SMOKE ERROR:', e)
  process.exit(1)
})
