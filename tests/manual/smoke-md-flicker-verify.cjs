/* Smoke: md live view functional check after flicker fix.
 * Code block stability under re-renders, copy button, GFM checkbox toggle, block edit. */
const { spawn } = require('node:child_process')
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const http = require('node:http')
const { chromium } = require('playwright-core')

const REPO = join(__dirname, '..', '..')
const PORT = 9231
const CDP = `http://localhost:${PORT}`
const userData = mkdtempSync(join(tmpdir(), 'piwright-mdflicker-user-'))
const projDir = mkdtempSync(join(tmpdir(), 'piwright-mdflicker-proj-'))
const mdPath = join(projDir, 'test.md')

const MD_CONTENT = [
  '# Flicker test',
  '',
  'Some paragraph before the code block.',
  '',
  '```ts',
  'const a = 1',
  'function foo(): number {',
  '  return a + 2',
  '}',
  'console.log(foo())',
  '```',
  '',
  '- [ ] task one',
  '- [x] task two',
  '',
  'Paragraph after the code block.',
  ''
].join('\n')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, ok, extra) => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra !== undefined ? ' — ' + extra : ''}`)
  if (!ok) throw new Error(`check failed: ${name}`)
}

function cdpAlive() {
  return new Promise((resolve) => {
    const req = http.get(`${CDP}/json/version`, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(1500, () => {
      req.destroy()
      resolve(false)
    })
  })
}

function seedSettings() {
  mkdirSync(userData, { recursive: true })
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({
      projects: [{ kind: 'native', dir: projDir }],
      notifications: {
        sounds: { completion: '', await: '', error: '' },
        telegram: { chatId: '', events: { turnEnd: false, permission: false, question: false, error: false, loopEnd: false } },
        remote: { enabled: false, port: 7691, staticPin: '' },
        backgroundGraceMinutes: 30
      }
    }),
    'utf8'
  )
}

async function launchApp() {
  const electronPath = require('electron')
  const proc = spawn(electronPath, [REPO, '--smoke', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`], {
    cwd: REPO,
    stdio: 'ignore'
  })
  const deadline = Date.now() + 60000
  while (!(await cdpAlive())) {
    if (Date.now() > deadline) throw new Error('CDP never came up')
    await sleep(500)
  }
  return proc
}

async function main() {
  writeFileSync(mdPath, MD_CONTENT, 'utf8')
  seedSettings()
  const proc = await launchApp()
  try {
    const browser = await chromium.connectOverCDP(CDP)
    const page = browser.contexts().flatMap((c) => c.pages()).find((p) => !p.url().startsWith('devtools://'))
    await page.waitForSelector('.project-row', { timeout: 30000 })

    const row = page.locator('.project-row').first()
    await row.locator('button.icon', { hasText: '+' }).last().click()
    await page.waitForSelector('.session-row.current', { timeout: 90000 })

    const filesBtn = await page.$('button[title="Files"], button[title="Файлы"]')
    await filesBtn.click()
    await page.waitForSelector('.files-body .tree-row', { timeout: 20000 })
    const mdRow = page.locator('.files-body .tree-row.file', { hasText: 'test.md' }).first()
    await mdRow.click()
    await page.waitForSelector('.file-body .code-block-wrap', { timeout: 20000 })
    await sleep(1000)

    // 1. Stability: mark nodes, trigger re-renders (open another file and back, toggle nothing),
    //    sample button opacity and html length while hovering.
    await page.evaluate(() => {
      const wrap = document.querySelector('.file-body .code-block-wrap')
      if (wrap) wrap.__probe = 'wrap'
    })
    const box = await page.locator('.file-body .code-block-wrap').first().boundingBox()
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await page.mouse.move(cx - 200, cy - 100)
    await page.mouse.move(cx, cy, { steps: 8 })
    await sleep(400)

    const samples = []
    for (let i = 0; i < 30; i++) {
      samples.push(
        await page.evaluate(() => {
          const wrap = document.querySelector('.file-body .code-block-wrap')
          const block = document.querySelector('.file-body .code-block')
          const btn = document.querySelector('.file-body .code-copy-btn')
          return {
            btnOpacity: btn ? getComputedStyle(btn).opacity : null,
            wrapAlive: wrap ? wrap.__probe === 'wrap' : false,
            htmlLen: block ? block.innerHTML.length : -1,
            shiki: block ? block.innerHTML.includes('shiki') : false
          }
        })
      )
      await sleep(50)
    }
    const opacities = [...new Set(samples.map((s) => s.btnOpacity))]
    const htmlLens = [...new Set(samples.map((s) => s.htmlLen))]
    const remounts = samples.filter((s) => !s.wrapAlive).length
    check('copy button visible while hover', opacities.every((o) => o === '1'), JSON.stringify(opacities))
    check('code html stable (highlighted)', htmlLens.length === 1 && samples[0].shiki, JSON.stringify(htmlLens))
    check('no remounts while hover', remounts === 0, `${remounts}/30`)

    // 2. Copy button works.
    await page.evaluate(() => {
      const btn = document.querySelector('.file-body .code-copy-btn')
      btn.click()
    })
    await sleep(300)
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch((e) => `ERR:${e.message}`))
    check('copy to clipboard', typeof clip === 'string' && clip.includes('const a = 1'), JSON.stringify(clip).slice(0, 60))

    // 3. GFM checkbox toggle.
    const cb = await page.$('.file-body .markdown li.task-list-item input[type="checkbox"]')
    check('checkbox rendered', cb !== null)
    await cb.click()
    await sleep(500)
    const fileAfterToggle = readFileSync(mdPath, 'utf8')
    check('checkbox toggle saved', fileAfterToggle.includes('[x] task one'), '')

    // 4. Block edit: click code block -> textarea, change code, Ctrl+S.
    const codeBlockEl = await page.$('.file-body .code-block-wrap')
    await codeBlockEl.click()
    await page.waitForSelector('.file-body textarea.md-edit', { timeout: 5000 })
    const ta = await page.$('.file-body textarea.md-edit')
    const draft = await ta.inputValue()
    check('editor opened with source', draft.includes('```ts'), '')
    await ta.fill(draft.replace('const a = 1', 'const a = 42'))
    await ta.press('Control+S')
    await sleep(700)
    const fileAfterEdit = readFileSync(mdPath, 'utf8')
    check('edit saved', fileAfterEdit.includes('const a = 42'), '')
    await page.waitForFunction(
      () => {
        const block = document.querySelector('.file-body .code-block')
        return block !== null && block.textContent.includes('const a = 42')
      },
      null,
      { timeout: 10000 }
    )
    check('edited block re-rendered', true)

    console.log('SMOKE-OK')
    process.exit(0)
  } finally {
    proc.kill()
  }
}

main().catch((err) => {
  console.log('SMOKE-FAIL:', err.message)
  process.exit(1)
})
