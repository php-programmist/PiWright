/** Extracts the CHANGELOG.md section for the current version (package.json) — single source
 *  for GitHub Release bodies (release.yml body_path) and the npm README of piwright-server.
 *  Usage: node scripts/release-notes.cjs [outfile] — stdout when outfile omitted. */
const fs = require('node:fs')
const path = require('node:path')

/** Section = lines from the `## ` heading containing version to the next `## ` heading. */
function extractSection(changelog, version) {
  const lines = changelog.split(/\r?\n/)
  const start = lines.findIndex((l) => /^##\s/.test(l) && l.includes(version))
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i
      break
    }
  }
  return lines
    .slice(start, end)
    .join('\n')
    .trim()
}

function releaseNotes(rootDir = path.join(__dirname, '..')) {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'))
  const changelog = fs.readFileSync(path.join(rootDir, 'CHANGELOG.md'), 'utf8')
  const section = extractSection(changelog, pkg.version)
  if (section === null) throw new Error(`CHANGELOG.md has no section for version ${pkg.version}`)
  return section
}

module.exports = { extractSection, releaseNotes }

if (require.main === module) {
  const text = releaseNotes()
  const out = process.argv[2]
  if (out !== undefined) fs.writeFileSync(path.resolve(out), text + '\n')
  else process.stdout.write(text + '\n')
}
