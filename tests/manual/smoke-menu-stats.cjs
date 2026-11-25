/* Smoke: пункт «Статистика» в меню File. Нативное меню из CDP не кликается — проверяем
   акселератор Ctrl+Shift+S (фокус смоук-окну через AttachThreadInput, как в smoke-menu-settings).
   Селекты: [0]=месяц, [1]=год, [2]=проект, [3]=модель. Проверяем: день → график с барами,
   месяц → график, фильтры проект/модель не ломают модалку, чекбоксы метрик, statsQuery IPC, Esc.
   Запуск: node tests/manual/smoke-menu-stats.cjs <smokeMainPid>. */
const { chromium } = require('playwright-core')
const { execSync } = require('node:child_process')

const CDP = process.env.SMOKE_CDP || 'http://localhost:9223'

async function modalState(p) {
  return p.evaluate(() => {
    const modal = document.querySelector('.stats-modal')
    return {
      open: document.querySelector('.stats-modal-overlay') !== null,
      bars: modal?.querySelectorAll('.stats-chart rect').length ?? 0,
      hint: modal?.querySelector('.panel-hint')?.textContent ?? null,
      overflow: modal ? modal.scrollWidth > modal.clientWidth : true,
      metrics: modal?.querySelectorAll('.stats-metric input').length ?? 0
    }
  })
}

async function main() {
  const pid = process.argv[2]
  if (!pid) throw new Error('usage: node smoke-menu-stats.cjs <smokeMainPid>')
  const b = await chromium.connectOverCDP(CDP)
  const p = b.contexts()[0].pages()[0]
  await p.waitForSelector('.app', { timeout: 30000 })

  const api = await p.evaluate(() => ({
    onMenuStats: typeof window.piwright.onMenuStats === 'function',
    statsQuery: typeof window.piwright.statsQuery === 'function'
  }))
  console.log('preload api:', JSON.stringify(api))
  if (!api.onMenuStats || !api.statsQuery) throw new Error('stats api missing in preload')

  const out = execSync(
    `powershell -NoProfile -ExecutionPolicy Bypass -File tests/manual/menu-focus.ps1 ${pid} 0x11 0x10 0x53`,
    { encoding: 'utf8' }
  )
  console.log(out.trim())

  await p.waitForSelector('.stats-modal-overlay', { timeout: 5000 })
  console.log('stats overlay opened by Ctrl+Shift+S: true')

  // Окно «Последние сутки»: сбросим kind (инстанс может хранить past-состояние), ждём график.
  await p.click('.stats-seg-btn:nth-child(1)')
  await p.waitForSelector('.stats-modal .stats-chart', { timeout: 60000 })
  const day = await modalState(p)
  console.log('day view:', JSON.stringify(day))
  if (day.bars === 0) throw new Error('day view has no bars')
  if (day.overflow) throw new Error('stats modal horizontal overflow')
  if (day.metrics !== 3) throw new Error('expected 3 metric checkboxes')

  // Окно «Месяц» (текущий месяц, по дням).
  await p.click('.stats-seg-btn:nth-child(2)')
  await p.waitForTimeout(1500)
  const month = await modalState(p)
  console.log('month view:', JSON.stringify(month))
  if (!month.open) throw new Error('modal closed after switching to month')
  if (month.bars === 0 && month.hint === null) throw new Error('month view rendered neither chart nor hint')

  // Фильтр по проекту (select nth=2): выбираем реальный проект, модалка жива.
  const projectOptions = await p.evaluate(() => document.querySelectorAll('.stats-modal select.stats-select')[2]?.options.length ?? 0)
  console.log('project filter options:', projectOptions)
  if (projectOptions > 1) {
    await p.selectOption('.stats-modal select.stats-select >> nth=2', { index: 1 })
    await p.waitForTimeout(1500)
    const after = await modalState(p)
    console.log('after project filter:', JSON.stringify(after))
    if (!after.open) throw new Error('modal closed after project filter change')
    await p.selectOption('.stats-modal select.stats-select >> nth=2', { index: 0 })
    await p.waitForTimeout(1500)
  }

  // Фильтр по модели (select nth=3).
  const modelOptions = await p.evaluate(() => document.querySelectorAll('.stats-modal select.stats-select')[3]?.options.length ?? 0)
  console.log('model filter options:', modelOptions)
  if (modelOptions > 1) {
    await p.selectOption('.stats-modal select.stats-select >> nth=3', { index: 1 })
    await p.waitForTimeout(1500)
    const after = await modalState(p)
    if (!after.open) throw new Error('modal closed after model filter change')
    console.log('model filter applied: true')
    await p.selectOption('.stats-modal select.stats-select >> nth=3', { index: 0 })
    await p.waitForTimeout(1500)
  }

  // Чекбокс метрики: снятие/установка не закрывает модалку.
  await p.click('.stats-metric:nth-of-type(1) input')
  await p.waitForTimeout(300)
  const hidden = await modalState(p)
  if (!hidden.open) throw new Error('modal closed after metric toggle')
  await p.click('.stats-metric:nth-of-type(1) input')
  await p.waitForTimeout(300)

  // Прямой IPC: окно «день» → 24 часовых бакета; произвольный месяц → дни.
  const query = await p.evaluate(() =>
    window.piwright.statsQuery({ kind: 'day', project: null, model: null }).then((r) => ({
      granularity: r.granularity,
      points: r.points.length,
      projects: r.projects.length,
      models: r.models.length
    }))
  )
  console.log('statsQuery day:', JSON.stringify(query))
  if (query.granularity !== 'hour' || query.points !== 24) throw new Error('unexpected statsQuery day result')

  const custom = await p.evaluate(() =>
    window.piwright.statsQuery({ kind: 'custom', month: 1, year: 2026, project: null, model: null }).then((r) => ({
      granularity: r.granularity,
      points: r.points.length
    }))
  )
  console.log('statsQuery custom:', JSON.stringify(custom))
  if (custom.granularity !== 'day' || custom.points !== 31) throw new Error('unexpected statsQuery custom result')

  await p.keyboard.press('Escape')
  await p.waitForSelector('.stats-modal-overlay', { state: 'detached', timeout: 5000 })
  console.log('overlay closed by Esc: true')
  console.log('SMOKE OK')
  await b.close()
}

main().catch((e) => { console.error('SMOKE FAIL:', e.message); process.exit(1) })
