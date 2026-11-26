/* Probe: replicate DaemonClient.launchDaemon (win32 path) with fixed quoting.
 * Spawns powershell exactly like the app, then checks daemon.log appears.
 * Usage: node daemon-launch-probe.js <execPath> <daemonJs> <userDataDir> <appVersion>
 * Temp dirs only; kills the daemon it started. */
const { spawn, execSync } = require('node:child_process')
const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

const [execPath, daemonJs, userDataDir, appVersion] = process.argv.slice(2)
if (!execPath || !daemonJs || !userDataDir) {
  console.error('usage: node daemon-launch-probe.js <execPath> <daemonJs> <userDataDir> <appVersion>')
  process.exit(1)
}

const psq = (value) => `'"${value.replace(/'/g, "''")}"'`
const command = [
  'Start-Process', '-FilePath', `'${execPath.replace(/'/g, "''")}'`,
  '-ArgumentList', psq(daemonJs), ',', psq('--user-data'), ',', psq(userDataDir), ',', psq('--app-version'), ',', psq(appVersion),
  '-WindowStyle', 'Hidden'
].join(' ')

const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
  stdio: 'ignore',
  windowsHide: true,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})
child.on('error', (err) => console.error('spawn error:', err.message))

const logPath = join(userDataDir, 'daemon.log')
let attempts = 0
const timer = setInterval(() => {
  attempts++
  if (existsSync(logPath)) {
    clearInterval(timer)
    console.log('DAEMON_STARTED')
    console.log(readFileSync(logPath, 'utf8').trim())
    // kill the daemon we started (by pipe hash in cmdline is not visible; kill by log pid)
    const pid = (readFileSync(logPath, 'utf8').match(/daemon pid (\d+)/) || [])[1]
    if (pid) {
      try { execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' }); console.log('killed', pid) } catch {}
    }
    process.exit(0)
  }
  if (attempts > 20) {
    clearInterval(timer)
    console.log('DAEMON_NOT_STARTED after 10s')
    process.exit(1)
  }
}, 500)
