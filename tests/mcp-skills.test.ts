import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listMcpServers, mcpFilePath, saveMcpServers } from '../src/main/mcp/mcp-config'
import { probeMcp } from '../src/main/mcp/mcp-probe'
import { parseSkillMd, disableKeyFor, listSkillsIn, toggleSkillIn } from '../src/main/skills/skills-service'
import { DEFAULT_SETTINGS } from '../src/main/settings/settings'
import type { ProjectEntry } from '../src/shared/ipc-contracts'

vi.mock('electron', () => ({ shell: { openPath: async () => '' } }))

let dir = ''
let projectDir = ''

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'piwright-mcp-'))
  projectDir = join(dir, 'proj')
  await fs.mkdir(projectDir, { recursive: true })
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const project = (): ProjectEntry => ({ kind: 'native', dir: projectDir })
const settings = (): typeof DEFAULT_SETTINGS => ({ ...DEFAULT_SETTINGS })

describe('mcp-config', () => {
  it('project scope path is <project>/.pi/mcp.json', async () => {
    expect(await mcpFilePath(project(), 'project', settings())).toBe(join(projectDir, '.pi', 'mcp.json'))
  })

  it('list on missing file yields empty servers, exists=false', async () => {
    const res = await listMcpServers(project(), 'project', settings())
    expect(res.ok).toBe(true)
    expect(res.exists).toBe(false)
    expect(res.servers).toEqual([])
    expect(res.file).toBe(join(projectDir, '.pi', 'mcp.json'))
  })

  it('save writes mcpServers and preserves other top-level keys; list reads back', async () => {
    await fs.mkdir(join(projectDir, '.pi'), { recursive: true })
    await fs.writeFile(join(projectDir, '.pi', 'mcp.json'), JSON.stringify({ mcpServers: { old: { enabled: false } }, other: 1 }), 'utf8')
    const res = await saveMcpServers(project(), 'project', settings(), [
      { name: 'context7', config: { url: 'https://mcp.context7.com/mcp', exposure: 'direct' } },
      { name: 'fs', config: { command: 'npx', args: ['-y', 'server'], enabled: false } }
    ])
    expect(res.ok).toBe(true)
    const raw = JSON.parse(await fs.readFile(join(projectDir, '.pi', 'mcp.json'), 'utf8')) as Record<string, unknown>
    expect(raw['other']).toBe(1)
    const list = await listMcpServers(project(), 'project', settings())
    expect(list.servers.map((s) => s.name).sort()).toEqual(['context7', 'fs'])
    expect(list.servers.find((s) => s.name === 'fs')?.config['enabled']).toBe(false)
  })

  it('save rejects bad names and non-objects', async () => {
    expect((await saveMcpServers(project(), 'project', settings(), [{ name: 'bad name!', config: {} }])).ok).toBe(false)
    expect((await saveMcpServers(project(), 'project', settings(), [{ name: 'x', config: 'nope' }])).ok).toBe(false)
    expect((await saveMcpServers(project(), 'project', settings(), 'nope')).ok).toBe(false)
  })
})

describe('mcp-probe (stdio)', () => {
  it('counts tools from a fake stdio server', async () => {
    const serverScript = [
      'let buf = ""',
      'process.stdin.setEncoding("utf8")',
      'process.stdin.on("data", (chunk) => {',
      '  buf += chunk',
      '  let i',
      '  while ((i = buf.indexOf("\\n")) >= 0) {',
      '    const line = buf.slice(0, i); buf = buf.slice(i + 1)',
      '    if (!line.trim()) continue',
      '    const msg = JSON.parse(line)',
      '    if (msg.method === "initialize") {',
      '      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "fake", version: "0" } } }) + "\\n")',
      '    } else if (msg.method === "tools/list") {',
      '      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "a" }, { name: "b" }] } }) + "\\n")',
      '    }',
      '  }',
      '})'
    ].join('\n')
    const res = await probeMcp({ command: process.execPath, args: ['-e', serverScript] }, null)
    expect(res.ok).toBe(true)
    expect(res.error).toBeNull()
    expect(res.toolCount).toBe(2)
  }, 20000)

  it('config without command/url fails fast', async () => {
    const res = await probeMcp({}, null)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('neither command nor url')
  })

  it('missing binary reports error', async () => {
    const res = await probeMcp({ command: 'definitely-not-a-real-binary-xyz' }, null)
    expect(res.ok).toBe(false)
    expect(res.error).not.toBeNull()
  }, 20000)
})

describe('skills', () => {
  async function writeSkill(root: string, name: string, description: string): Promise<void> {
    const dir = join(root, name)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\nbody`, 'utf8')
  }

  it('parseSkillMd reads frontmatter, rejects non-skills', async () => {
    const file = join(dir, 'SKILL.md')
    await fs.writeFile(file, '---\nname: alpha\ndescription: does things\n---\nbody', 'utf8')
    expect(await parseSkillMd(file)).toEqual({ name: 'alpha', description: 'does things' })
    await fs.writeFile(file, 'no frontmatter', 'utf8')
    expect(await parseSkillMd(file)).toBeNull()
    await fs.writeFile(file, '---\ndescription: no name\n---\n', 'utf8')
    expect(await parseSkillMd(file)).toBeNull()
  })

  it('listSkillsIn scans user + project dirs with enabled state from settings.json', async () => {
    const agentDir = join(dir, 'agent')
    await writeSkill(join(agentDir, 'skills'), 'user-skill', 'user one')
    await writeSkill(join(projectDir, '.pi', 'skills'), 'proj-skill', 'project one')
    await writeSkill(join(projectDir, '.agents', 'skills'), 'agents-skill', 'agents one')
    const settingsFile = join(agentDir, 'settings.json')
    await fs.writeFile(settingsFile, JSON.stringify({ model: 'x', skills: ['-skills/user-skill/SKILL.md'] }), 'utf8')
    const skills = await listSkillsIn(agentDir, settingsFile, projectDir)
    const byName = new Map(skills.map((s) => [s.name, s]))
    expect(byName.get('user-skill')).toMatchObject({ source: 'user', enabled: false })
    expect(byName.get('proj-skill')).toMatchObject({ source: 'project', enabled: true })
    expect(byName.get('agents-skill')).toMatchObject({ source: 'project', enabled: true })
  })

  it('disableKeyFor: relative for user skills, absolute for native project skills', () => {
    const agentDir = 'C:\\Users\\u\\.pi\\agent'
    expect(disableKeyFor(agentDir, 'D:\\p', 'C:\\Users\\u\\.pi\\agent\\skills\\a\\SKILL.md')).toBe('skills/a/SKILL.md')
    expect(disableKeyFor(agentDir, 'D:\\p', 'D:\\p\\.pi\\skills\\b\\SKILL.md')).toBe('D:/p/.pi/skills/b/SKILL.md')
    expect(disableKeyFor(agentDir, 'D:\\p', 'E:\\elsewhere\\SKILL.md')).toBeNull()
  })

  it('toggleSkillIn writes -key entries and keeps other settings', async () => {
    const settingsFile = join(dir, 'settings.json')
    await fs.writeFile(settingsFile, JSON.stringify({ model: 'x' }), 'utf8')
    expect((await toggleSkillIn(settingsFile, 'skills/a/SKILL.md', false)).ok).toBe(true)
    let raw = JSON.parse(await fs.readFile(settingsFile, 'utf8')) as Record<string, unknown>
    expect(raw['model']).toBe('x')
    expect(raw['skills']).toEqual(['-skills/a/SKILL.md'])
    await toggleSkillIn(settingsFile, 'skills/a/SKILL.md', true)
    raw = JSON.parse(await fs.readFile(settingsFile, 'utf8')) as Record<string, unknown>
    expect(raw['skills']).toEqual([])
  })
})
