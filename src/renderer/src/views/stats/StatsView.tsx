/** Модальное окно статистики токенов (File → Statistics): столбчатая диаграмма in/out/cached
 *  read по всем проектам, окно (сутки/месяц/год/произвольный месяц), фильтры по проекту и
 *  модели, выбор показателей. Диаграмма — рукописный SVG (графических библиотек в проекте нет). */
import { useEffect, useMemo } from 'react'
import { useStatsStore } from '../../stores/stats'
import { useSessionsStore } from '../../stores/sessions'
import { useT } from '../../lib/i18n'
import type { StatsGranularity, StatsPoint } from '../../../../shared/ipc-contracts'

const W = 760
const H = 280
const PAD_L = 56
const PAD_R = 12
const PAD_T = 12
const PAD_B = 26
const PLOT_W = W - PAD_L - PAD_R
const PLOT_H = H - PAD_T - PAD_B

const METRICS = [
  { key: 'input', color: 'var(--blue)' },
  { key: 'output', color: 'var(--green)' },
  { key: 'cacheRead', color: 'var(--yellow)' }
] as const

const STATS_FIRST_YEAR = 2026

type MetricKey = (typeof METRICS)[number]['key']

function niceMax(v: number): number {
  if (v <= 0) return 1
  const base = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 5, 10]) if (v <= m * base) return m * base
  return 10 * base
}

export function StatsView(): React.JSX.Element {
  const t = useT()
  const language = useSessionsStore((s) => s.settings?.language ?? 'en')
  const close = useStatsStore((s) => s.closeModal)
  const kind = useStatsStore((s) => s.kind)
  const month = useStatsStore((s) => s.month)
  const year = useStatsStore((s) => s.year)
  const project = useStatsStore((s) => s.project)
  const model = useStatsStore((s) => s.model)
  const metrics = useStatsStore((s) => s.metrics)
  const result = useStatsStore((s) => s.result)
  const loading = useStatsStore((s) => s.loading)
  const setKind = useStatsStore((s) => s.setKind)
  const setCustom = useStatsStore((s) => s.setCustom)
  const setProject = useStatsStore((s) => s.setProject)
  const setModel = useStatsStore((s) => s.setModel)
  const toggleMetric = useStatsStore((s) => s.toggleMetric)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const locale = language === 'ru' ? 'ru-RU' : 'en-US'
  const monthNames = useMemo(
    () => Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat(locale, { month: 'long' }).format(new Date(2026, i, 1))),
    [locale]
  )
  const years = Array.from(
    { length: Math.max(1, new Date().getFullYear() - STATS_FIRST_YEAR + 1) },
    (_, i) => new Date().getFullYear() - i
  )

  const visible = METRICS.filter((m) => metrics[m.key])
  const points = result?.points ?? []
  const hasData = points.some((p) => p.input > 0 || p.output > 0 || p.cacheRead > 0)
  const full = new Intl.NumberFormat(locale)
  const totals = { input: 0, output: 0, cacheRead: 0 }
  for (const p of points) {
    totals.input += p.input
    totals.output += p.output
    totals.cacheRead += p.cacheRead
  }

  return (
    <div
      className="stats-modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="stats-modal">
        <div className="settings-head">
          <span>{t('Statistics')}</span>
          <button className="settings-close" onClick={close} title={t('Close')} aria-label={t('Close')}>
            ×
          </button>
        </div>
        <div className="stats-controls">
          <div className="stats-seg">
            <button className={kind === 'day' ? 'stats-seg-btn active' : 'stats-seg-btn'} onClick={() => setKind('day')}>
              {t('Last 24 hours')}
            </button>
            <button className={kind === 'month' ? 'stats-seg-btn active' : 'stats-seg-btn'} onClick={() => setKind('month')}>
              {t('Month')}
            </button>
            <button className={kind === 'year' ? 'stats-seg-btn active' : 'stats-seg-btn'} onClick={() => setKind('year')}>
              {t('Year')}
            </button>
          </div>
          <select
            className="stats-select"
            value={kind === 'custom' ? month : -1}
            onChange={(e) => {
              const m = Number(e.target.value)
              if (m >= 1) setCustom(m, year)
            }}
          >
            <option value={-1} disabled>
              {t('Custom month')}
            </option>
            {monthNames.map((name, i) => (
              <option key={name} value={i + 1}>
                {name}
              </option>
            ))}
          </select>
          <select
            className="stats-select"
            value={kind === 'custom' ? year : -1}
            onChange={(e) => {
              const y = Number(e.target.value)
              if (y > 0) setCustom(month, y)
            }}
          >
            <option value={-1} disabled>
              {t('Custom year')}
            </option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div className="stats-controls">
          <select
            className="stats-select"
            value={project ?? ''}
            onChange={(e) => setProject(e.target.value === '' ? null : e.target.value)}
          >
            <option value="">{t('All projects')}</option>
            {(result?.projects ?? []).map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
          <select className="stats-select" value={model ?? ''} onChange={(e) => setModel(e.target.value === '' ? null : e.target.value)}>
            <option value="">{t('All models')}</option>
            {(result?.models ?? []).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {METRICS.map((m) => (
            <label key={m.key} className="stats-metric">
              <input type="checkbox" checked={metrics[m.key]} onChange={() => toggleMetric(m.key)} />
              <span className="stats-dot" style={{ background: m.color }} />
              {t(METRIC_LABELS[m.key])}
            </label>
          ))}
        </div>
        {hasData && visible.length > 0 && (
          <div className="stats-totals">
            {visible.map((m) => (
              <span key={m.key} className="stats-total">
                <span className="stats-dot" style={{ background: m.color }} />
                {t(METRIC_LABELS[m.key])}: {full.format(totals[m.key])}
              </span>
            ))}
          </div>
        )}
        <div className="stats-chart-box">
          {result === null && loading ? (
            <div className="panel-hint">{t('Loading…')}</div>
          ) : !hasData || visible.length === 0 ? (
            <div className="panel-hint">{t('No data')}</div>
          ) : (
            <Chart points={points} granularity={result?.granularity ?? 'day'} visible={visible} locale={locale} />
          )}
        </div>
      </div>
    </div>
  )
}

const METRIC_LABELS: Record<MetricKey, string> = {
  input: 'In',
  output: 'Out',
  cacheRead: 'Cached read'
}

function Chart({
  points,
  granularity,
  visible,
  locale
}: {
  points: StatsPoint[]
  granularity: StatsGranularity
  visible: readonly { key: MetricKey; color: string }[]
  locale: string
}): React.JSX.Element {
  const t = useT()
  const max = niceMax(Math.max(...points.map((p) => visible.reduce((sum, m) => sum + p[m.key], 0)), 1))
  const n = points.length
  const groupW = PLOT_W / n
  const barW = Math.min(20, (groupW * 0.72) / visible.length)

  const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 })
  const full = new Intl.NumberFormat(locale)
  const labelFmt =
    granularity === 'hour'
      ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' })
      : granularity === 'day'
        ? new Intl.DateTimeFormat(locale, { day: 'numeric' })
        : new Intl.DateTimeFormat(locale, { month: 'short' })
  const fullFmt = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    ...(granularity === 'hour' ? { timeStyle: 'short' } : {})
  })

  const step = Math.max(1, Math.ceil(n / 12))
  const gridFrac = [0, 0.25, 0.5, 0.75, 1]

  return (
    <svg className="stats-chart" viewBox={`0 0 ${W} ${H}`} role="img">
      {gridFrac.map((f) => {
        const y = PAD_T + PLOT_H * (1 - f)
        return (
          <g key={f}>
            <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} className="stats-grid" />
            <text x={PAD_L - 6} y={y + 4} className="stats-axis" textAnchor="end">
              {compact.format(max * f)}
            </text>
          </g>
        )
      })}
      {points.map((p, i) => {
        const x0 = PAD_L + i * groupW + (groupW - barW * visible.length) / 2
        return (
          <g key={p.t}>
            {visible.map((m, mi) => {
              const v = p[m.key]
              const h = v > 0 ? Math.max(1, (PLOT_H * v) / max) : 0
              const x = x0 + mi * barW
              return (
                <rect key={m.key} x={x} y={PAD_T + PLOT_H - h} width={barW} height={h} fill={m.color} rx={1}>
                  <title>
                    {`${fullFmt.format(new Date(p.t))}\n${visible
                      .map((mm) => `${t(METRIC_LABELS[mm.key])}: ${full.format(p[mm.key])}`)
                      .join('\n')}`}
                  </title>
                </rect>
              )
            })}
            {i % step === 0 && (
              <text x={PAD_L + i * groupW + groupW / 2} y={H - 8} className="stats-axis" textAnchor="middle">
                {labelFmt.format(new Date(p.t))}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
