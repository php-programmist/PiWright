const { chromium } = require('playwright-core')

// The user's machine runs the Russian layout: Playwright's Control+c arrives at Chromium
// as key='с', keyCode=86 (VK_V), code=KeyC. xterm's built-in Ctrl+C check reads key/keyCode,
// so without the custom handler (physical event.code) it falls through to a literal 'с'.
async function selectAllAndReadClipboard(page) {
  const box = await page.locator('.term-host').boundingBox()
  await page.mouse.move(box.x + 5, box.y + 5)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 5, box.y + box.height - 5, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''))
  await page.mouse.click(box.x + box.width - 10, box.y + box.height - 10)
  await page.waitForTimeout(200)
  return clip
}

async function waitForPrompt(page) {
  for (let i = 0; i < 40; i++) {
    const clip = await selectAllAndReadClipboard(page)
    if (/D:\\.+>/.test(clip)) return
    await page.waitForTimeout(1000)
  }
  throw new Error('prompt did not appear within 40s')
}

async function main() {
  const browser = await chromium.connectOverCDP(process.env.SMOKE_CDP || 'http://localhost:9223')
  const ctx = browser.contexts()[0]
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  page.on('console', (m) => console.log('[page]', m.text()))
  await page.waitForSelector('.app', { timeout: 30000 })

  const hasProject = await page.locator('.project-name').count()
  if (hasProject === 0) {
    await page.evaluate(() =>
      window.piwright.setSettings({ projects: [{ kind: 'native', dir: 'D:\\Projects\\piwright' }] })
    )
    await page.reload()
    await page.waitForSelector('.project-name', { timeout: 30000 })
  }
  await page.locator('.project-name').first().click()
  await page.waitForTimeout(500)

  if ((await page.locator('.terminal-dock').count()) === 0) {
    await page.click('.term-toggle')
  }
  const tabsBefore = await page.locator('.term-tab').count()
  await page.click('.terminal-head .term-new')
  await page.waitForSelector('.term-host', { timeout: 30000 })

  await page.locator('.term-host').click()
  await page.waitForTimeout(300)
  // PSReadLine needs seconds to initialize; Ctrl+C typed before the prompt is ready lands
  // in the early input buffer and is echoed literally (PSReadLine #1393) — wait for the prompt.
  await waitForPrompt(page)
  await page.keyboard.type('cls')
  await page.keyboard.press('Enter')
  await waitForPrompt(page)

  // Case A: no selection -> SIGINT. The 'zzz' line must be cancelled (^C echoed), never
  // executed, and the literal 'zzzс' must never reach PowerShell.
  await page.keyboard.type('zzz')
  await page.waitForTimeout(200)
  await page.keyboard.press('Control+c')
  await page.waitForTimeout(300)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(800)
  let clip = await selectAllAndReadClipboard(page)
  console.log('--- buffer after case A ---\n' + clip)
  if (!/\^C/.test(clip)) throw new Error('no ^C echo — Ctrl+C did not send SIGINT')
  if (/zzzс/.test(clip)) throw new Error('literal "zzzс" reached the shell — Ctrl+C typed a letter')
  if (/zzz.*(not recognized|не распознано)/i.test(clip)) throw new Error('zzz line was executed, not cancelled')

  // Case B: with selection -> copy path, must NOT cancel the input line. Type a command,
  // drag-select output, press Ctrl+C, then Enter: the command must still execute.
  await page.keyboard.type('ZZQCMD')
  await page.waitForTimeout(200)
  const box = await page.locator('.term-host').boundingBox()
  await page.mouse.move(box.x + 5, box.y + 5)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + 20, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  const selClip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''))
  console.log('clipboard after drag-select:', JSON.stringify(selClip))
  if (selClip.trim().length === 0) throw new Error('drag did not create a selection')
  await page.keyboard.press('Control+c')
  await page.waitForTimeout(300)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1000)
  clip = await selectAllAndReadClipboard(page)
  console.log('--- buffer after case B ---\n' + clip)
  if (!/ZZQCMD.*(not recognized|не распознано)/is.test(clip)) {
    throw new Error('ZZQCMD line did not execute — Ctrl+C with selection sent SIGINT')
  }

  // Cleanup: close the tab spawned by this smoke
  const closeButtons = page.locator('.term-tab .term-close')
  const extra = (await closeButtons.count()) - tabsBefore
  for (let i = 0; i < extra; i++) {
    await closeButtons.last().click()
    await page.waitForTimeout(400)
  }

  await browser.close()
  console.log('SMOKE PASSED')
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e.message)
  process.exit(1)
})
