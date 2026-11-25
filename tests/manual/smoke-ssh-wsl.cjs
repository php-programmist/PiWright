/* Живой смоук SSH-транспорта против реального sshd в WSL Ubuntu:
 * 1) exec (echo $HOME, command -v pi), 2) SFTP write/read, 3) spawn `pi --mode rpc`
 * с RPC-хендшейком get_state. Запуск: node tests/manual/smoke-ssh-wsl.cjs
 * Подготовка (делает сам скрипт): ssh-keygen → authorized_keys дефолтного юзера WSL. */
const { execSync } = require('node:child_process')
const { generateKeyPairSync } = require('node:crypto')
const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')
const { Client } = require(process.env.PIWRIGHT_SSH2 || 'ssh2')

const DISTRO = process.env['WSL_DISTRO'] || 'Ubuntu'
let pass = 0
let fail = 0
function check(name, cond, detail = '') {
  if (cond) {
    pass += 1
    console.log(`PASS ${name}`)
  } else {
    fail += 1
    console.log(`FAIL ${name} ${detail}`)
  }
}

function wsl(cmd) {
  return execSync(`wsl -d ${DISTRO} --exec bash -lc ${JSON.stringify(cmd)}`, { encoding: 'utf8', timeout: 30000 })
}

// --- подготовка ключа ---
const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piwright-ssh-smoke-'))
const keyPath = path.join(keyDir, 'id_ed25519')
execSync(`ssh-keygen -q -t ed25519 -N "" -f "${keyPath}"`, { stdio: 'ignore' })
const pub = fs.readFileSync(`${keyPath}.pub`, 'utf8').trim()
const wslUser = wsl('whoami').trim()
wsl(`mkdir -p ~/.ssh && grep -qF "${pub}" ~/.ssh/authorized_keys 2>/dev/null || echo "${pub}" >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys`)
console.log(`wsl user: ${wslUser}`)

// sshd должен слушать: пробуем поднять (без пароля — под root через -u root).
try {
  wsl(`ss -tln | grep -q ':22 ' || (service ssh start >/dev/null 2>&1 || service sshd start >/dev/null 2>&1)`)
} catch {}
let sshdUp = false
try {
  sshdUp = wsl(`ss -tln | grep -q ':22 ' && echo up`).includes('up')
} catch {}
if (!sshdUp) {
  console.log('SKIP: sshd в WSL не поднялся (нет openssh-server или порт занят)')
  process.exit(0)
}

const privateKey = fs.readFileSync(keyPath, 'utf8')

const client = new Client()
const state = { ready: false }

function connect() {
  return new Promise((resolve, reject) => {
    client
      .on('ready', () => {
        state.ready = true
        resolve()
      })
      .on('error', reject)
      .connect({
        host: '127.0.0.1',
        port: 22,
        username: wslUser,
        privateKey,
        readyTimeout: 15000,
        keepaliveInterval: 5000
      })
  })
}

function exec(command, login = false) {
  // Квотинг как в приложении: одинарные кавычки вокруг команды (shell.ts shellQuote).
  const inner = login ? `bash -lic '${command.replace(/'/g, "'\\''")}'` : command
  return new Promise((resolve, reject) => {
    client.exec(inner, (err, stream) => {
      if (err) return reject(err)
      let stdout = ''
      let stderr = ''
      stream.on('data', (d) => (stdout += d))
      stream.stderr.on('data', (d) => (stderr += d))
      stream.on('exit', (code) => resolve({ code, stdout, stderr }))
    })
  })
}

function sftpRoundtrip() {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) return reject(err)
      const file = `/tmp/piwright-smoke-${Date.now()}.txt`
      sftp.writeFile(file, 'piwright-smoke', (werr) => {
        if (werr) return reject(werr)
        sftp.readFile(file, (rerr, data) => {
          if (rerr) return reject(rerr)
          sftp.unlink(file, (uerr) => resolve({ data: data.toString('utf8'), unlinkErr: uerr ?? null }))
        })
      })
    })
  })
}

function piHandshake() {
  return new Promise((resolve, reject) => {
    const inner = `bash -lic 'pi --mode rpc'`
    client.exec(inner, (err, stream) => {
      if (err) return reject(err)
      let buffer = ''
      const timer = setTimeout(() => {
        stream.close()
        reject(new Error('pi handshake timeout'))
      }, 60000)
      stream.on('data', (d) => {
        buffer += d.toString('utf8')
        for (const line of buffer.split('\n')) {
          if (!line.trim()) continue
          try {
            const msg = JSON.parse(line)
            if (msg.type === 'response' && msg.command === 'get_state') {
              clearTimeout(timer)
              stream.close()
              resolve(msg)
              return
            }
          } catch {}
        }
      })
      stream.stderr.on('data', () => {})
      stream.write(JSON.stringify({ id: 1, type: 'get_state' }) + '\n')
    })
  })
}

async function main() {
  await connect()
  check('connect to WSL sshd with key', state.ready)

  const home = await exec('echo "$HOME"', true)
  check('exec login-shell $HOME', home.stdout.trim().startsWith('/home/'), home.stdout)

  const pi = await exec('command -v pi 2>/dev/null', true)
  check('pi found on server', pi.stdout.trim().length > 0, pi.stdout || pi.stderr)

  const sftp = await sftpRoundtrip()
  check('sftp write/read/unlink', sftp.data === 'piwright-smoke' && sftp.unlinkErr === null)

  const response = await piHandshake()
  const data = response.data ?? {}
  check('pi --mode rpc get_state response', response.success === true, JSON.stringify(response).slice(0, 200))
  check(
    'pi reports session info',
    typeof data === 'object' && data !== null && (typeof data['id'] === 'string' || typeof data['cwd'] === 'string' || typeof data['model'] === 'object'),
    JSON.stringify(data).slice(0, 200)
  )

  client.end()
  fs.rmSync(keyDir, { recursive: true, force: true })
  console.log(`\nSMOKE ${fail === 0 ? 'OK' : 'FAILED'}: ${pass} pass, ${fail} fail`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('SMOKE ERROR:', err.message)
  process.exit(1)
})
