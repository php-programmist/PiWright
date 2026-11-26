/* Smoke: files panel context menu "Show in folder" reveals file/folder in Explorer.
 * Attach over CDP, open Files panel for the seeded project, right-click a dir row and
 * a file row, assert the menu item exists, click it (Explorer window is verified by the
 * caller via Shell.Application snapshot), and check IPC path-escape / ssh guards. */
const { chromium } = require('playwright-core')

const LABELS = ['Show in folder', 'Показать в папке']

async function openMenuAndClickReveal(page, rowSelector) {
  const row = await page.$(rowSelector)
  if (row === null) throw new Error(`row not found: ${rowSelector}`)
  await row.click({ button: 'right' })
  await page.waitForSelector('.files-menu', { timeout: 5000 })
  const texts = await page.$$eval('.files-menu .project-menu-item', (els) => els.map((e) => (e.textContent ?? '').trim()))
  console.log('menu items:', JSON.stringify(texts))
  const label = LABELS.find((l) => texts.includes(l))
  if (label === undefined) throw new Error(`no reveal item in menu: ${JSON.stringify(texts)}`)
  const btn = await page.$$eval(
    '.files-menu .project-menu-item',
    (els, l) => {
      const el = els.find((e) => (e.textContent ?? '').trim() === l)
      if (el === undefined) return false
      el.click()
      return true
    },
    label
  )
  if (!btn) throw new Error('reveal button click failed')
  console.log(`reveal clicked on ${rowSelector}`)
}

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9223')
  const page = browser.contexts()[0].pages()[0]
  await page.waitForSelector('.project-row', { timeout: 30000 })

  await page.click('.project-name')
  const filesBtn = await page.$('button[title="Files"], button[title="Файлы"]')
  if (filesBtn === null) throw new Error('Files toggle button not found')
  await filesBtn.click()
  await page.waitForSelector('.files-body .tree-row', { timeout: 20000 })
  console.log('files panel open')

  await openMenuAndClickReveal(page, '.files-body .tree-row')
  await page.waitForSelector('.files-menu', { state: 'detached', timeout: 5000 }).catch(() => {})

  const fileRow = await page.$('.files-body .tree-row.file')
  if (fileRow === null) throw new Error('no file row in tree root')
  await openMenuAndClickReveal(page, '.files-body .tree-row.file')

  const guards = await page.evaluate(async () => {
    const project = { kind: 'native', dir: 'D:\\Projects\\piwright' }
    const escapeResult = await window.piwright.filesReveal(project, '../../outside')
    const sshResult = await window.piwright.filesReveal({ kind: 'ssh', dir: '/tmp/x', serverId: 'missing' }, 'a')
    return { escapeResult, sshResult }
  })
  console.log('escape guard:', JSON.stringify(guards.escapeResult))
  console.log('ssh guard:', JSON.stringify(guards.sshResult))
  if (guards.escapeResult.ok !== false) throw new Error('escape path was not rejected')
  if (guards.sshResult.ok !== false) throw new Error('ssh project was not rejected')

  console.log('SMOKE-OK')
  process.exit(0)
}

main().catch((err) => {
  console.log('SMOKE-FAIL:', err.message)
  process.exit(1)
})
