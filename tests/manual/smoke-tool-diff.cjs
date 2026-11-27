/* Smoke: "View diff" button on edit/write tool blocks (visible collapsed, opens the call's own diff).
 * Attach over CDP, seed a temp git project, run a real agent that overwrites a file with write
 * (HEAD content as original) and then edits it (oldText/newText as original/modified).
 * Run: node tests/manual/smoke-tool-diff.cjs  (expects smoke instance on 9223, SMOKE_CDP to override) */
const { chromium } = require('playwright-core')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const CDP = process.env.SMOKE_CDP ?? 'http://localhost:9223'

let passed = 0
function check(name, ok, detail = '') {
  passed += ok ? 1 : 0
  console.log(`${ok ? 'ok' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) process.exit(1)
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piwright-smoke-tooldiff-'))
  const fileRel = 'piwright-smoke-diff.txt'
  fs.writeFileSync(path.join(dir, fileRel), 'alpha')
  execSync(`git init -q`, { cwd: dir })
  execSync(`git -c user.email=smoke@local -c user.name=smoke add -A`, { cwd: dir })
  execSync(`git -c user.email=smoke@local -c user.name=smoke commit -qm init`, { cwd: dir })
  console.log('project dir:', dir)

  const browser = await chromium.connectOverCDP(CDP)
  const context = browser.contexts()[0]
  const page = context.pages()[0]
  await page.waitForSelector('.sessions-panel', { timeout: 30000 })

  // Seed the temp project as the only project, activate it.
  await page.evaluate((dir) => window.piwright.setSettings({ projects: [{ kind: 'native', dir }], lastProjectKey: `native\u0000${dir.replace(/\\/g, '/').replace(/\/+$/, '')}` }), dir)
  await page.reload()
  await page.waitForSelector('.sessions-panel', { timeout: 30000 })
  await page.waitForTimeout(500)

  const newBtn = await page.$('button[title="New session"], button[title="Новая сессия"]')
  check('new session button found', newBtn !== null)
  await newBtn.click()
  await page.waitForSelector('.composer textarea', { timeout: 90000 })
  console.log('new session created')

  const textarea = await page.$('.composer textarea')
  await textarea.fill(
    `Сделай ровно два действия, без объяснений и без markdown: 1) инструментом write полностью перезапиши файл ${fileRel} — содержимое файла должно быть ровно beta; 2) инструментом edit замени в этом файле beta на gamma.`
  )
  const sendBtn = await page.$('.composer button:not([class])')
  await sendBtn.click()
  console.log('prompt sent')

  await page.waitForFunction(() => !document.querySelector('.dot.streaming'), null, { timeout: 300000 })
  console.log('agent finished')

  // Both tool blocks present with collapsed summaries carrying the diff button.
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.tool-block > summary .tool-title')].filter((el) => el.textContent === 'write').length > 0 &&
      [...document.querySelectorAll('.tool-block > summary .tool-title')].filter((el) => el.textContent === 'edit').length > 0,
    null,
    { timeout: 30000 }
  )
  const blocks = await page.evaluate(() => {
    const find = (name) =>
      [...document.querySelectorAll('.tool-block')].find((b) => {
        const t = b.querySelector(':scope > summary .tool-title')
        return t !== null && t.textContent === name
      })
    const info = (b) => {
      if (b === undefined) return null
      const btn = b.querySelector(':scope > summary .tool-diff-btn')
      return {
        open: b.hasAttribute('open'),
        hasBtn: btn !== null,
        btnText: btn !== null ? btn.textContent.trim() : null,
        btnVisible: btn !== null && btn.offsetParent !== null
      }
    }
    return { write: info(find('write')), edit: info(find('edit')) }
  })
  check('write block collapsed with visible button', blocks.write !== null && !blocks.write.open && blocks.write.hasBtn && blocks.write.btnVisible, JSON.stringify(blocks.write))
  check('edit block collapsed with visible button', blocks.edit !== null && !blocks.edit.open && blocks.edit.hasBtn && blocks.edit.btnVisible, JSON.stringify(blocks.edit))
  check('button label', blocks.write.btnText === 'View diff' || blocks.write.btnText === 'Показать дифф', blocks.write.btnText)

  const tabsBefore = await page.$$eval('.tab', (els) => els.length)

  // Click the edit block button: tab opens, block stays collapsed, diff shows beta -> gamma.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.tool-block')].find((x) => x.querySelector(':scope > summary .tool-title')?.textContent === 'edit')
    b.querySelector(':scope > summary .tool-diff-btn').click()
  })
  await page.waitForFunction((n) => document.querySelectorAll('.tab').length > n, tabsBefore, { timeout: 10000 })
  await page.waitForTimeout(1000)
  const tabLabel = await page.$$eval('.tab', (els) => els[els.length - 1].textContent.trim())
  check('tab label is the file name', tabLabel.includes(fileRel), tabLabel)
  await page.waitForFunction(
    () => {
      const orig = document.querySelector('.diff-editor .editor.original')
      const mod = document.querySelector('.diff-editor .editor.modified')
      return orig !== null && mod !== null && orig.textContent.includes('beta') && !orig.textContent.includes('gamma') && mod.textContent.includes('gamma')
    },
    null,
    { timeout: 30000 }
  )
  console.log('edit diff shows beta -> gamma')
  check('edit diff panes', true)

  // Back to the session tab: the edit block must still be collapsed (button click did not toggle it).
  await page.click('.tab.session')
  await page.waitForSelector('.tool-block', { timeout: 10000 })
  const stillCollapsed = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.tool-block')].find((x) => x.querySelector(':scope > summary .tool-title')?.textContent === 'edit')
    return b !== undefined && !b.hasAttribute('open')
  })
  check('edit block stays collapsed after button click', stillCollapsed)

  // Click the write block button: HEAD content (alpha) as original, written content (beta) as modified.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.tool-block')].find((x) => x.querySelector(':scope > summary .tool-title')?.textContent === 'write')
    b.querySelector(':scope > summary .tool-diff-btn').click()
  })
  await page.waitForFunction(
    () => {
      const orig = document.querySelector('.diff-editor .editor.original')
      const mod = document.querySelector('.diff-editor .editor.modified')
      return orig !== null && mod !== null && orig.textContent.includes('alpha') && mod.textContent.includes('beta')
    },
    null,
    { timeout: 30000 }
  )
  console.log('write diff shows alpha -> beta')
  check('write diff panes (HEAD original)', true)

  // Layout pass: no horizontal overflow of the diff head, screenshot for text fit.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  check('no horizontal page overflow', !overflow)
  await page.screenshot({ path: 'tests/manual/smoke-tool-diff.png' })

  console.log(`SMOKE-OK ${passed} checks`)
  process.exit(0)
}

main().catch((err) => {
  console.log('SMOKE-FAIL:', err.message)
  process.exit(1)
})
