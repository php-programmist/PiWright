const { chromium } = require('playwright-core')

const PIWRIGHT = 'D:\\Projects\\piwright'
const SPEC = 'D:\\Projects\\piwright\\spec'
const css = (s) => s.replace(/\\/g, '\\\\')

;(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9223')
  const p = b.contexts()[0].pages()[0]
  await p.waitForTimeout(1500)

  // 1. Два проекта: piwright (сессия будет тут) и spec (нажмём Skills/MCP тут).
  const s0 = await p.evaluate(async () => {
    const cur = await window.piwright.getSettings()
    const projects = [
      { kind: 'native', dir: 'D:\\Projects\\piwright' },
      { kind: 'native', dir: 'D:\\Projects\\piwright\\spec' }
    ]
    await window.piwright.setSettings({ ...cur, projects })
    return projects.length
  })
  console.log('projects set:', s0)
  await p.reload()
  await p.waitForTimeout(2500)
  await p.locator('.project-name').first().waitFor({ timeout: 30000 })

  // 2. Новая сессия в piwright — активная сессия другого проекта (условие бага).
  const pwRow = p.locator('.project', { has: p.locator(`.project-name[title="${css(PIWRIGHT)}"]`) })
  await pwRow.locator('button[title*="New session"], button[title*="Новая сессия"]').first().click()
  await p.locator('.session-row').first().waitFor({ timeout: 90000 })
  await p.waitForTimeout(1500)
  console.log('session rows:', await p.locator('.session-row').count())

  // 3. Переключиться на spec (сессий там нет).
  await p.locator(`.project-name[title="${css(SPEC)}"]`).click()
  await p.waitForTimeout(500)

  // 4. Skills в spec.
  await p.locator('.right-bar button[title="Skills"], .right-bar button[title="Навыки"]').first().click()
  await p.waitForTimeout(1200)
  const skillsState = await p.evaluate(() => {
    const active = document.querySelector('.project.active .project-name')
    return {
      activeProject: active ? active.getAttribute('title') : null,
      skillsHeader: !!document.querySelector('.center-view .center-head h2')
    }
  })
  const s1 = await p.evaluate(async () => (await window.piwright.getSettings()).projectTabs)
  const specKey = Object.keys(s1).find((k) => k.includes('spec'))
  const pwKey = Object.keys(s1).find((k) => k.includes('piwright') && !k.includes('spec'))
  console.log('after Skills: activeProject =', JSON.stringify(skillsState.activeProject))
  console.log('spec tabs:', JSON.stringify(s1[specKey]))
  console.log('piwright tabs:', JSON.stringify(s1[pwKey]))
  const skillsOk =
    skillsState.activeProject === SPEC &&
    JSON.stringify(s1[specKey]).includes('"skills"') &&
    !(pwKey in s1 && JSON.stringify(s1[pwKey]).includes('"skills"'))
  console.log('SKILLS OK:', skillsOk)
  await p.screenshot({ path: 'tests/manual/out-smoke-skills-spec.png' })

  // 5. MCP в spec.
  await p.locator('.right-bar button[title="MCP servers"], .right-bar button[title="MCP-серверы"]').first().click()
  await p.waitForTimeout(1200)
  const mcpState = await p.evaluate(() => {
    const active = document.querySelector('.project.active .project-name')
    return { activeProject: active ? active.getAttribute('title') : null }
  })
  const s2 = await p.evaluate(async () => (await window.piwright.getSettings()).projectTabs)
  console.log('after MCP: activeProject =', JSON.stringify(mcpState.activeProject))
  console.log('spec tabs:', JSON.stringify(s2[specKey]))
  console.log('piwright tabs:', JSON.stringify(s2[pwKey]))
  const mcpOk =
    mcpState.activeProject === SPEC &&
    JSON.stringify(s2[specKey]).includes('"mcp"') &&
    !(pwKey in s2 && JSON.stringify(s2[pwKey]).includes('"mcp"'))
  console.log('MCP OK:', mcpOk)
  await p.screenshot({ path: 'tests/manual/out-smoke-mcp-spec.png' })

  await b.close()
  if (!skillsOk || !mcpOk) process.exit(1)
})().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
