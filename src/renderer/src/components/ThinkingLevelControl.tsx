import { useEffect, useRef, useState } from 'react'
import { useT } from '../lib/i18n'

const LEVEL_KEYS: Record<string, string> = {
  off: 'thinking off',
  minimal: 'thinking minimal',
  low: 'thinking low',
  medium: 'thinking medium',
  high: 'thinking high',
  xhigh: 'thinking xhigh',
  max: 'thinking max'
}

function BarsIcon({ filled }: { filled: number }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={1.5 + i * 3}
          y={10.5 - (i + 1) * 2.4}
          width="2"
          height={(i + 1) * 2.4}
          rx="1"
          fill={i < filled ? 'currentColor' : 'none'}
          stroke={i < filled ? 'none' : 'currentColor'}
          strokeWidth="1"
          opacity={i < filled ? 1 : 0.35}
        />
      ))}
    </svg>
  )
}

interface Props {
  levels: string[]
  current: string | null
  onChange: (level: string) => void
}

export function ThinkingLevelControl({ levels, current, onChange }: Props) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const last = levels.length - 1
  const index = current !== null ? levels.indexOf(current) : -1
  const label = current !== null ? t(LEVEL_KEYS[current] ?? current) : t('thinking level')
  const filled = index <= 0 ? 0 : Math.round((index / Math.max(1, last)) * 3)
  const percent = index <= 0 ? 0 : last > 0 ? (index / last) * 100 : 0
  const chipLeft = Math.min(88, Math.max(12, percent))

  return (
    <div className="thinking-control" ref={rootRef}>
      <button className="thinking-button" title={t('thinking level')} onClick={() => setOpen((v) => !v)}>
        <BarsIcon filled={filled} />
        <span>{label}</span>
        <span className="thinking-chevron">▾</span>
      </button>
      {open && (
        <div className="thinking-popover">
          <div className="thinking-slider-wrap">
            {index >= 0 && (
              <span className="thinking-chip" style={{ left: `${chipLeft}%` }}>
                <BarsIcon filled={filled} />
                {label}
              </span>
            )}
            <input
              className="thinking-slider"
              type="range"
              min={0}
              max={Math.max(1, last)}
              step={1}
              value={Math.max(0, index)}
              onChange={(e) => onChange(levels[Number(e.target.value)])}
            />
          </div>
          <div className="thinking-ticks">
            {levels.map((level, i) => (
              <span key={level} className={i === index ? 'active' : ''}>
                {t(LEVEL_KEYS[level] ?? level)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
