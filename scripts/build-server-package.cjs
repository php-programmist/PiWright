/** Собирает dist-server/ — стейджинг npm-пакета piwright-server (headless-сервер веб-режима).
 *  Вход: npm run build (out/ собран). Состав: out/headless + out/chunks + out/daemon (фоновые
 *  сессии) + out/renderer (статика SPA), bin-обёртка и README из server/. Зависимости
 *  chokidar/node-pty/ssh2 объявляются обычными dependencies (ставятся на машине потребителя —
 *  node-pty берёт prebuild или собирает node-gyp). electron/electron-updater — стабы в
 *  bundleDependencies: общий чанк бандла делает top-level require('electron')/('electron-updater')
 *  (все использования зафейжены в рантайме), без стабов в чистом node пакет не стартует,
 *  а реальные пакеты тянут бинарник Electron. Публикация: npm publish dist-server (CI release.yml). */
const fs = require('node:fs')
const path = require('node:path')
const { releaseNotes } = require('./release-notes.cjs')

const root = path.join(__dirname, '..')
const outDir = path.join(root, 'dist-server')

for (const rel of ['out/headless/index.js', 'out/daemon/index.js', 'out/renderer/index.html']) {
  if (!fs.existsSync(path.join(root, rel))) {
    throw new Error(`${rel} is missing — run "npm run build" first`)
  }
}
if (!fs.existsSync(path.join(root, 'out', 'chunks'))) {
  throw new Error('out/chunks is missing — run "npm run build" first')
}

fs.rmSync(outDir, { recursive: true, force: true })
for (const dir of ['headless', 'chunks', 'daemon', 'renderer']) {
  fs.cpSync(path.join(root, 'out', dir), path.join(outDir, 'out', dir), { recursive: true })
}
fs.cpSync(path.join(root, 'server', 'bin'), path.join(outDir, 'bin'), { recursive: true })
// npm-страница рендерит только README — секция изменений текущей версии вшивается перед License.
const readme = fs.readFileSync(path.join(root, 'server', 'README.md'), 'utf8')
const licenseMarker = '\n## License\n'
if (!readme.includes(licenseMarker)) throw new Error('server/README.md has no License section')
const notes = releaseNotes(root)
// Секция несёт свой заголовок «## vX.Y.Z (дата)» — для README он дубль под «Changes in», стрипаем первую строку.
const notesBody = notes.slice(notes.indexOf('\n') + 1).trim()
fs.writeFileSync(
  path.join(outDir, 'README.md'),
  readme.replace(licenseMarker, `\n## Changes in ${JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version}\n\n${notesBody}\n\n## License\n`)
)

const STUB_VERSION = '0.0.0-stub'
for (const name of ['electron', 'electron-updater']) {
  const dir = path.join(outDir, 'node_modules', name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name, version: STUB_VERSION, main: 'index.js' }, null, 2) + '\n'
  )
  fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = {}\n')
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const manifest = {
  name: 'piwright-server',
  version: pkg.version,
  description: 'Headless web server for PiWright — the pi coding agent workbench in a browser',
  license: pkg.license,
  author: pkg.author,
  repository: pkg.repository,
  bin: { 'piwright-server': 'bin/piwright-server.js' },
  engines: { node: '>=20' },
  files: ['bin/', 'out/', 'README.md'],
  dependencies: {
    chokidar: pkg.dependencies.chokidar,
    'node-pty': pkg.dependencies['node-pty'],
    ssh2: pkg.dependencies.ssh2,
    electron: STUB_VERSION,
    'electron-updater': STUB_VERSION
  },
  bundleDependencies: ['electron', 'electron-updater']
}
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')

const size = (dir) => {
  let total = 0
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) total += fs.statSync(path.join(entry.parentPath ?? entry.path, entry.name)).size
  }
  return total
}
console.log(`dist-server: version ${manifest.version}, ${(size(outDir) / 1024 / 1024).toFixed(1)} MB`)
