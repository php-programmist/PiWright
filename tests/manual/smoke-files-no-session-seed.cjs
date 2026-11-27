/* Seeds settings.json for smoke-files-no-session: ssh project + fake server (127.0.0.1:1)
 * + persisted skills tab + lastProjectKey. Written as a script because the key contains \u0000. */
const fs = require('node:fs')
const path = require('node:path')
const ud = process.argv[2]
if (!ud) throw new Error('usage: node smoke-files-no-session-seed.cjs <user-data-dir>')
fs.mkdirSync(ud, { recursive: true })
const key = 'ssh\u0000/home/smoke/proj'
const settings = {
  language: 'en',
  projects: [{ kind: 'ssh', dir: '/home/smoke/proj', name: 'smoke-ssh', serverId: 'srv-smoke-1' }],
  sshServers: [{ id: 'srv-smoke-1', name: 'smoke', host: '127.0.0.1', port: 1, user: 'smoke', auth: 'password' }],
  projectTabs: { [key]: { tabs: [{ kind: 'skills' }], activeIndex: 0 } },
  lastProjectKey: key
}
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify(settings, null, 2), 'utf8')
console.log('SEEDED', path.join(ud, 'settings.json'))
