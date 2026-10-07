import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

import { flowColumns, type FlowCell } from './programsCostsFlow'

const sameHeights = (a: readonly number[] | null, b: readonly number[]) =>
  a !== null && a.length === b.length && a.every((h, i) => Math.abs(h - (b[i] ?? 0)) < 0.5)

/**
 * Programs and costs' flow, measured (spec §5.2 F). `ref` goes on the flow box; after every render each drawn item
 * (`data-flow-item`, never a repeated "continued" head) is measured, and `cut` re-cuts the items at those heights. An
 * item is as tall in any column as in the one it sits in (every column is one width), so the rendered items are the
 * measure: no hidden copy. Until the first measure `cut` uses the heights it is given. In jsdom every height is 0, so
 * everything lands in one column (`flowColumns`' zero case).
 */
export function useFlowColumns(count: number): {
  ref: RefObject<HTMLDivElement | null>
  cut: (heights: number[], heads: Set<number>) => FlowCell[][]
} {
  const ref = useRef<HTMLDivElement | null>(null)
  const [measured, setMeasured] = useState<readonly number[] | null>(null)
  const [resized, setResized] = useState(0)

  useLayoutEffect(() => {
    const box = ref.current
    if (box === null || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => setResized((n) => n + 1))
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  // Every render re-measures; state changes only when a height did, so this settles.
  useLayoutEffect(() => {
    const box = ref.current
    if (box === null) return
    const heights: number[] = []
    for (const el of box.querySelectorAll<HTMLElement>('[data-flow-item]')) {
      if (el.dataset['flowContinued'] !== undefined) continue
      heights[Number(el.dataset['flowItem'])] = el.getBoundingClientRect().height
    }
    const next = Array.from({ length: heights.length }, (_, i) => heights[i] ?? 0)
    setMeasured((prev) => (sameHeights(prev, next) ? prev : next))
  }, [count, resized])

  const cut = (heights: number[], heads: Set<number>) => {
    const use = measured !== null && measured.length === heights.length ? [...measured] : heights
    return flowColumns(use, heads, count)
  }
  return { ref, cut }
}
