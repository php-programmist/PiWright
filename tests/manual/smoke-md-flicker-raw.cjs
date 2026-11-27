/* Smoke: md code block remount raw mutation log. */
const { spawn } = require('node:child_process')
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const http = require('node:http')
const { chromium } = require('playwright-core')

const REPO = join(__dirname, '..', '..')
const PORT = 9231
const CDP = `http://localhost:${PORT}`
const userData = mkdtempSync(join(tmpdir(), 'piwright-mdflicker-user-'))
const projDir = mkdtempSync(join(tmpdir(), 'piwright-mdflicker-proj-'))

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
  'Paragraph after the code block with quite a lot of text.',
  ''
].join('\n')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
  writeFileSync(join(projDir, 'test.md'), MD_CONTENT, 'utf8')
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

    await page.evaluate(() => {
      window.__log = []
      const live = document.querySelector('.file-body .md-live')
      const describe = (n) => {
        if (n.nodeType !== 1) return `#${n.nodeName}`
        const cls = n.className ? String(n.className) : ''
        const html = n.outerHTML ?? ''
        return `${n.tagName}.${cls} [${html.length}ch] ${html.slice(0, 80).replace(/\s+/g, ' ')}`
      }
      const obs = new MutationObserver((list) => {
        for (const m of list) {
          for (const n of m.addedNodes) window.__log.push({ t: Date.now(), kind: '+', parent: describe(m.target), node: describe(n) })
          for (const n of m.removedNodes) window.__log.push({ t: Date.now(), kind: '-', parent: describe(m.target), node: describe(n) })
        }
      })
      obs.observe(live, { childList: true, subtree: true })
    })

    const box = await page.locator('.file-body .code-block-wrap').first().boundingBox()
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    // 15s: hover on/off in 5s windows.
    await page.mouse.move(cx - 300, cy - 200)
    await sleep(5000)
    await page.mouse.move(cx, cy, { steps: 5 })
    await sleep(5000)
    await page.mouse.move(cx - 300, cy - 200, { steps: 5 })
    await sleep(5000)

    const log = await page.evaluate(() => window.__log)
    console.log(`total mutations: ${log.length}`)
    for (const e of log) console.log(`${e.t % 100000} ${e.kind} parent=${e.parent} node=${e.node}`)
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
