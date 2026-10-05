import { useLayoutEffect, useRef, useState } from 'react'

import { foldBadges } from './strip'

const px = (value: string) => Number.parseFloat(value) || 0
const widthOf = (element: Element) => element.getBoundingClientRect().width

/**
 * How many exception badges stay on the strip's line (owner 2026-10-04); null: all of them. The
 * badges get what the nav leaves after its padding, the lenses, the pipeline, the two gaps between
 * them and the badge group's own border and padding. Their widths are read off the measuring copy
 * (`data-measure="badge"`, `data-measure="chip"`), never off the badges drawn, so a fold can never
 * change the widths that decided it. Re-folds whenever the nav, the lenses, the pipeline or a
 * measured badge changes size, and when `badgesKey` (what the badges say) changes. A nav with no
 * width (not laid out) folds nothing.
 */
export function useBadgeFold(badgesKey: string) {
  const navRef = useRef<HTMLElement>(null)
  const lensesRef = useRef<HTMLSpanElement>(null)
  const pipeRef = useRef<HTMLSpanElement>(null)
  const groupRef = useRef<HTMLSpanElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const [shown, setShown] = useState<number | null>(null)

  useLayoutEffect(() => {
    const nav = navRef.current
    const lenses = lensesRef.current
    const pipe = pipeRef.current
    const group = groupRef.current
    const measure = measureRef.current
    if (!nav || !lenses || !pipe || !group || !measure) return
    const fold = () => {
      if (nav.clientWidth === 0) {
        setShown(null)
        return
      }
      const navStyle = getComputedStyle(nav)
      const groupStyle = getComputedStyle(group)
      const available =
        nav.clientWidth -
        px(navStyle.paddingLeft) -
        px(navStyle.paddingRight) -
        widthOf(lenses) -
        widthOf(pipe) -
        2 * px(navStyle.columnGap) -
        px(groupStyle.borderLeftWidth) -
        px(groupStyle.paddingLeft)
      const widths = [...measure.querySelectorAll('[data-measure="badge"]')].map(widthOf)
      const chip = measure.querySelector('[data-measure="chip"]')
      const next = foldBadges(
        widths,
        chip === null ? 0 : widthOf(chip),
        available,
        px(groupStyle.columnGap)
      )
      setShown(next === widths.length ? null : next)
    }
    fold()
    // jsdom has no ResizeObserver of its own (the test setup stubs one); guard as useAnchoredOverlay does.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(fold)
    for (const element of [nav, lenses, pipe, ...measure.children]) observer.observe(element)
    return () => observer.disconnect()
  }, [badgesKey])

  return { navRef, lensesRef, pipeRef, groupRef, measureRef, shown }
}
