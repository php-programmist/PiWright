// Smoke: model dropdown refresh after manual models.json edit (kanban c-1f2a7bcb).
// Flow: attach CDP -> ensure a session with a live pi host -> read dropdown options ->
// append a temp model to models.json -> trigger window focus refresh -> re-read options.
// SMOKE_CDP=http://localhost:9223 node tests/manual/smoke-models-refresh.cjs
const { chromium } = require('playwright-core')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const browser = await chromium.connectOverCDP(CDP)
  const context = browser.contexts()[0]
  const page = context.pages()[0] ?? await context.newPage()
  // Live host: reuse the active session or create one programmatically.
  const snap = await page.evaluate(async () => window.piwright.listSessions())
  let hostId = snap.active[0]?.hostId ?? null
  if (hostId === null) {
    hostId = await page.evaluate(async () => {
      const created = await window.piwright.newSession({ kind: 'native', dir: 'D:\\Projects\\piwright' })
      return created.hostId
    })
  }
  if (hostId === null) throw new Error('no active session host')
  console.log('hostId:', hostId)
  await page.waitForSelector('.session-row', { timeout: 90000 })
  // Activate the session in the UI so ChatView (and the dropdown) renders.
  await page.locator('.session-row').first().click()
  await page.waitForSelector('.model-select', { timeout: 90000 })

  // Wait until the host is ready and the dropdown has models.
  await page.waitForFunction(() => {
    const sel = document.querySelector('.model-select')
    return sel !== null && sel.options.length > 0
  }, { timeout: 90000 })

  const readOptions = () => page.evaluate(() => {
    const sel = document.querySelector('.model-select')
    return sel ? [...sel.options].map((o) => o.value) : []
  })
  const before = await readOptions()
  console.log('options before:', before.length)

  // Append a temp model to native models.json.
  const file = path.join(os.homedir(), '.pi', 'agent', 'models.json')
  const backup = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
  const doc = backup !== null ? JSON.parse(backup) : { providers: {} }
  const tempId = `smoke-temp-model-${Date.now()}`
  if (!doc.providers || typeof doc.providers !== 'object') doc.providers = {}
  const key = Object.keys(doc.providers)[0]
  const provider = key !== undefined ? key : 'smoke'
  if (doc.providers[provider] === undefined) doc.providers[provider] = { models: [] }
  if (!Array.isArray(doc.providers[provider].models)) doc.providers[provider].models = []
  doc.providers[provider].models.push({
    id: tempId, name: 'Smoke Temp Model', provider, baseUrl: 'http://localhost:1/v1', api: 'openai-completions', contextWindow: 4096, maxTokens: 1024
  })
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n')
  console.log('temp model appended:', `${provider}/${tempId}`)

  // Simulate returning to the window: focus + visibilitychange are the refresh triggers.
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await sleep(3000)

  const after = await readOptions()
  const fresh = after.includes(`${provider}/${tempId}`)
  console.log('options after:', after.length, '| temp model in dropdown:', fresh)

  // Cleanup: restore models.json, remove temp model from the live host too.
  if (backup !== null) fs.writeFileSync(file, backup)
  else fs.rmSync(file)
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await sleep(3000)
  const restored = await readOptions()
  console.log('options restored:', restored.length, '| temp gone:', !restored.includes(`${provider}/${tempId}`))

  await browser.close()
  if (!fresh) { console.error('FAIL: dropdown did not pick up the new model'); process.exit(1) }
  console.log('SMOKE OK')
}

main().catch((err) => { console.error(err); process.exit(1) })
