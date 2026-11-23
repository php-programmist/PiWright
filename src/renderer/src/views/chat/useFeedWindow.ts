import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

/** Сколько записей восстановленной ленты показываем сразу (хвост). */
export const RESTORE_WINDOW = 40
/** Сколько старых записей докладываем вверх, когда проскроллили до верха окна. */
export const RESTORE_CHUNK = 40

export interface FeedWindowOptions {
  /** Вызывается на скролл с признаком «долистали до низа». */
  onScroll?: (atBottom: boolean) => void
}

export interface FeedWindow {
  /** Индекс первой записи ленты, попадающей в DOM; хвост ленты рендерится всегда. */
  windowStart: number
  handleScroll: () => void
}

/**
 * Окно длинной ленты, растущее вверх: восстановленная сессия показывает только хвост
 * (RESTORE_WINDOW записей), скролл вверх докладывает старые записи чанками — scrollHeight
 * всегда состоит из реально отрисованного контента, поэтому ползунок длинный внизу
 * и укорачивается по мере прокрутки вверх. Реплей истории приходит одной пачкой —
 * скачок длины больше 5 записей сбрасывает окно на хвост.
 */
export function useFeedWindow(items: readonly unknown[], containerRef: RefObject<HTMLElement | null>, opts: FeedWindowOptions = {}): FeedWindow {
  const [windowStart, setWindowStart] = useState(() => Math.max(0, items.length - RESTORE_WINDOW))
  const optsRef = useRef(opts)
  const anchorRef = useRef<{ height: number; top: number } | null>(null)

  useLayoutEffect(() => {
    optsRef.current = opts
  })

  // Реплей/замена ленты пачкой: окно обратно на хвост, пока кадр не закоммичен.
  const [prevLen, setPrevLen] = useState(items.length)
  if (items.length - prevLen > 5) {
    setPrevLen(items.length)
    setWindowStart(Math.max(0, items.length - RESTORE_WINDOW))
  }

  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (el === null) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 40
    optsRef.current.onScroll?.(atBottom)
    if (windowStart > 0 && el.scrollTop < 60) {
      anchorRef.current = { height: el.scrollHeight, top: el.scrollTop }
      setWindowStart((ws) => Math.max(0, ws - RESTORE_CHUNK))
    }
  }, [containerRef, windowStart])

  // Контент над вьюпортом подрос — сохраняем визуальную позицию.
  useLayoutEffect(() => {
    const el = containerRef.current
    const anchor = anchorRef.current
    if (el === null || anchor === null) return
    anchorRef.current = null
    el.scrollTop = anchor.top + (el.scrollHeight - anchor.height)
  }, [windowStart, containerRef])

  // Хвост не заполнил два экрана — докладываем окно вверх, иначе скроллить негде.
  useEffect(() => {
    if (windowStart === 0) return
    const raf = requestAnimationFrame(() => {
      const el = containerRef.current
      if (el === null || el.scrollHeight >= el.clientHeight * 2) return
      anchorRef.current = { height: el.scrollHeight, top: el.scrollTop }
      setWindowStart((ws) => Math.max(0, ws - RESTORE_CHUNK))
    })
    return () => cancelAnimationFrame(raf)
  }, [windowStart, items.length, containerRef])

  return { windowStart, handleScroll }
}
