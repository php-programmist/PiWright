import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Entry } from '../../stores/chat'
import { FEED_POOL, buildPrefix, computeRange, spacerHeights } from '../../lib/virtual-feed'

export interface VirtualFeedOptions {
  /** Размер пула записей в DOM; по умолчанию FEED_POOL. */
  pool?: number
  /** true — лента прибита к низу: окно берётся от хвоста, минуя оценочные высоты середины. */
  pinRef?: RefObject<boolean>
  /** Вызывается на скролл (rAF-троттлинг) с признаком «долистали до низа». */
  onScroll?: (atBottom: boolean) => void
}

export interface VirtualFeed {
  /** Окно записей в DOM: items.slice(start, end). */
  range: { start: number; end: number }
  topSpacer: number
  bottomSpacer: number
  handleScroll: () => void
  /** Окно от хвоста ленты (перед scrollIntoView к bottomRef). */
  jumpToBottom: () => void
}

/**
 * Переиспользование DOM в длинной ленте: в DOM живёт фиксированный пул записей
 * (по умолчанию ~100), невидимые размонтируются и заменяются распорками с известными
 * высотами; при скролле пул перезаписывается данными других записей. Высоты отрисованных
 * записей меряет ResizeObserver, неотрисованные оцениваются по kind (lib/virtual-feed).
 * Сдвиг контента над вьюпортом из-за уточнения высот компенсируется якорем
 * (первая отрисованная запись остаётся на месте).
 */
export function useVirtualFeed(items: readonly Entry[], containerRef: RefObject<HTMLElement | null>, opts: VirtualFeedOptions = {}): VirtualFeed {
  const pool = opts.pool ?? FEED_POOL
  // heightsRef — истина для колбэков вне рендера; heights (state) — снимок для рендера распорок.
  const heightsRef = useRef(new Map<number, number>())
  const [heights, setHeights] = useState<ReadonlyMap<number, number>>(() => new Map())
  const [range, setRange] = useState({ start: 0, end: 0 })
  const observedElsRef = useRef(new Map<number, Element>())
  const roRef = useRef<ResizeObserver | null>(null)
  const anchorRef = useRef<{ id: number; offset: number } | null>(null)
  const scrollRafRef = useRef(0)
  const itemsRef = useRef(items)
  const optsRef = useRef(opts)

  // Свежие items/opts для колбэков вне рендера (скролл, rAF); объявлен первым — к моменту
  // следующих layout-эффектов значения уже обновлены.
  useLayoutEffect(() => {
    itemsRef.current = items
    optsRef.current = opts
  })

  const recompute = useCallback(() => {
    const el = containerRef.current
    const list = itemsRef.current
    let next: { start: number; end: number }
    if (list.length === 0) {
      next = { start: 0, end: 0 }
    } else if (optsRef.current.pinRef?.current === true) {
      const start = Math.max(0, list.length - pool)
      next = { start, end: list.length }
    } else {
      const prefix = buildPrefix(list, heightsRef.current)
      const center = el !== null ? el.scrollTop + el.clientHeight / 2 : 0
      next = computeRange(prefix, pool, center)
    }
    setRange((prev) => (prev.start === next.start && prev.end === next.end ? prev : next))
  }, [containerRef, pool])

  const handleScroll = useCallback(() => {
    if (scrollRafRef.current !== 0) return
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0
      const el = containerRef.current
      if (el === null) return
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 40
      optsRef.current.onScroll?.(atBottom)
      recompute()
    })
  }, [containerRef, recompute])

  const jumpToBottom = useCallback(() => {
    const len = itemsRef.current.length
    const start = Math.max(0, len - pool)
    setRange((prev) => (prev.start === start && prev.end === len ? prev : { start, end: len }))
  }, [pool])

  // Замер отрисованных записей; перед уточнением распорок якорим первую запись окна.
  const measure = useCallback(
    (entries: ResizeObserverEntry[]): void => {
      const el = containerRef.current
      if (el === null) return
      const prev = heightsRef.current
      let changed = false
      const next = new Map(prev)
      for (const r of entries) {
        const target = r.target as HTMLElement
        const id = Number(target.dataset.entryId)
        const h = Math.round(target.offsetHeight)
        if (Number.isFinite(h) && h > 0 && prev.get(id) !== h) {
          next.set(id, h)
          changed = true
        }
      }
      if (!changed) return
      heightsRef.current = next
      setHeights(next)
      const first = el.querySelector<HTMLElement>('[data-entry-id]')
      if (first !== null) {
        // Позиция в координатах контента: скролл юзера между замером и применением не мешает.
        anchorRef.current = {
          id: Number(first.dataset.entryId),
          offset: first.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop
        }
      }
    },
    [containerRef]
  )

  // Смена набора записей: чистим замеры убранных id и пересчитываем окно до отрисовки.
  useLayoutEffect(() => {
    const prev = heightsRef.current
    if (prev.size > 0) {
      const live = new Set(items.map((e) => e.id))
      let next: Map<number, number> | null = null
      for (const id of prev.keys()) {
        if (!live.has(id)) {
          if (next === null) next = new Map(prev)
          next.delete(id)
        }
      }
      if (next !== null) {
        heightsRef.current = next
        setHeights(next)
      }
    }
    recompute()
  }, [items, recompute])

  // Синхронизация наблюдаемых элементов с текущим окном (после коммита DOM).
  useLayoutEffect(() => {
    const el = containerRef.current
    if (el === null) return
    if (roRef.current === null) roRef.current = new ResizeObserver(measure)
    const ro = roRef.current
    const observed = observedElsRef.current
    const live = new Set<number>()
    for (const child of el.querySelectorAll<HTMLElement>('[data-entry-id]')) {
      const id = Number(child.dataset.entryId)
      live.add(id)
      if (!observed.has(id)) {
        ro.observe(child)
        observed.set(id, child)
      }
    }
    for (const [id, target] of observed) {
      if (!live.has(id)) {
        ro.unobserve(target)
        observed.delete(id)
      }
    }
  }, [containerRef, measure])

  // Якорная компенсация: контент над вьюпортом уточнился — держим визуальную позицию.
  useLayoutEffect(() => {
    const el = containerRef.current
    if (el === null) return
    const anchor = anchorRef.current
    anchorRef.current = null
    if (anchor === null) return
    const slot = el.querySelector<HTMLElement>(`[data-entry-id="${anchor.id}"]`)
    if (slot === null) return
    const delta = slot.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - anchor.offset
    if (delta !== 0) el.scrollTop += delta
  }, [range, heights, items, containerRef])

  // Размонтирование: гасим наблюдатель и отложенный кадр.
  useLayoutEffect(() => {
    const ro = roRef
    const observed = observedElsRef
    const scrollRaf = scrollRafRef
    return () => {
      ro.current?.disconnect()
      ro.current = null
      observed.current.clear()
      if (scrollRaf.current !== 0) cancelAnimationFrame(scrollRaf.current)
    }
  }, [])

  const prefix = useMemo(() => buildPrefix(items, heights), [items, heights])
  const spacers = useMemo(() => spacerHeights(prefix, range.start, range.end), [prefix, range])

  return { range, topSpacer: spacers.top, bottomSpacer: spacers.bottom, handleScroll, jumpToBottom }
}
