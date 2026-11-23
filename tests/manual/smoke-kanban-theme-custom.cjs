/** Смоук пользовательской темы: чтение kanban-themes.json, кнопка «Удалить», удаление. */
const { chromium } = require('playwright-core')
const { writeFileSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'
const DATA = process.env.SMOKE_USERDATA

;(async () => {
  const file = join(DATA, 'kanban-themes.json')
  writeFileSync(
    file,
    JSON.stringify(
      {
        version: 1,
        themes: [
          {
            id: 'neon',
            name: 'Neon',
            accents: ['#ff00aa', '#00ffcc'],
            columnTint: 'rgba(255, 0, 170, 0.12)',
            columnBorder: 'rgba(255, 0, 170, 0.32)',
            cardTint: 'rgba(255, 0, 170, 0.08)',
            cardBorder: 'rgba(255, 0, 170, 0.26)',
            badge: '#ff66cc'
          }
        ]
      },
      null,
      2
    ),
    'utf8'
  )

  const b = await chromium.connectOverCDP(CDP)
  const p = b.contexts()[0].pages()[0]
  await p.reload()
  await p.waitForTimeout(3000)
  await p.locator('button[title*="Настройки"], button[title*="Settings"]').first().click()
  await p.waitForTimeout(800)
  await p.locator('.settings-nav button', { hasText: /Внешни|Appearance/ }).click()
  await p.waitForTimeout(800)

  const rows = p.locator('.kanban-theme')
  console.log('rows:', await rows.count())
  console.log('delete buttons:', await rows.locator('button', { hasText: /Удалить|Delete/ }).count())
  const neon = rows.filter({ hasText: 'Neon' })
  await neon.locator('input[type=radio]').click({ force: true })
  await p.waitForTimeout(2000)
  const tint = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--kb-column-tint').trim())
  console.log('neon tint:', tint)
  if (!tint.includes('255, 0, 170')) throw new Error(`custom theme not applied: ${tint}`)
  await p.locator('.settings-modal').screenshot({ path: join(DATA, 'kanban-theme-custom.png') })

  await neon.locator('button', { hasText: /Удалить|Delete/ }).evaluate((el) => el.click())
  await p.waitForTimeout(2000)
  console.log('rows after delete:', await rows.count())
  console.log('file after delete:', readFileSync(file, 'utf8').replace(/\s+/g, ' '))
  const theme = await p.evaluate(async () => (await window.piwright.getSettings()).kanbanTheme)
  console.log('settings.kanbanTheme after delete:', theme)
  if (theme !== 'slate') throw new Error(`selected theme not reset: ${theme}`)
  await b.close()
  console.log('OK')
})().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
