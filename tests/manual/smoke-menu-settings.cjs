/* Smoke: пункт «Настройки» в меню File. Нативное меню из CDP не кликается — проверяем
   акселератор Ctrl+,: фокус смоук-окну через AttachThreadInput (PID главного процесса
   смоук-инстанса на порту 9223), keybd_event Ctrl+OemComma, ждём .settings-modal-overlay,
   закрываем Esc. Запуск: node tests/manual/smoke-menu-settings.cjs <smokeMainPid>. */
const { chromium } = require('playwright-core')
const { execSync } = require('node:child_process')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'

async function main() {
  const pid = process.argv[2]
  if (!pid) throw new Error('usage: node smoke-menu-settings.cjs <smokeMainPid>')
  const b = await chromium.connectOverCDP(CDP)
  const p = b.contexts()[0].pages()[0]
  await p.waitForSelector('.app', { timeout: 30000 })

  const hasApi = await p.evaluate(() => typeof window.piwright.onMenuSettings === 'function')
  console.log('onMenuSettings api:', hasApi)
  if (!hasApi) throw new Error('onMenuSettings missing in preload')

  const out = execSync(
    `powershell -NoProfile -ExecutionPolicy Bypass -File tests/manual/menu-focus.ps1 ${pid}`,
    { encoding: 'utf8' }
  )
  console.log(out.trim())

  await p.waitForSelector('.settings-modal-overlay', { timeout: 5000 })
  console.log('settings overlay opened by Ctrl+,: true')
  await p.keyboard.press('Escape')
  await p.waitForSelector('.settings-modal-overlay', { state: 'detached', timeout: 5000 })
  console.log('overlay closed by Esc: true')
  console.log('SMOKE OK')
  await b.close()
}

main().catch((e) => { console.error('SMOKE FAIL:', e.message); process.exit(1) })
