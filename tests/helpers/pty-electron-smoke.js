/* eslint-disable @typescript-eslint/no-require-imports -- скрипт для ELECTRON_RUN_AS_NODE, без бандлера */
const pty = require('node-pty')
const p = pty.spawn('powershell.exe', ['-NoLogo', '-Command', 'echo pty-under-electron-ok'], {
  name: 'xterm-256color',
  cwd: __dirname
})
let out = ''
p.onData((d) => {
  out += d
})
p.onExit(({ exitCode }) => {
  const ok = out.includes('pty-under-electron-ok')
  console.log('ELECTRON PTY SMOKE:', ok ? 'PASS' : 'FAIL', 'exit', exitCode)
  process.exit(ok ? 0 : 1)
})
setTimeout(() => {
  console.log('ELECTRON PTY SMOKE: TIMEOUT, got:', JSON.stringify(out.slice(0, 200)))
  process.exit(1)
}, 15000)
