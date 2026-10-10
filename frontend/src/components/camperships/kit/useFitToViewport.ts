import { useEffect, useState, type RefObject } from 'react'

/** The box stops this far short of the window's bottom (design-language §23: the first note peeks above the fold). */
const GAP = 40
const FLOOR = 420

/**
 * A screen box's size (design-language §23; the same measure as AidTable's scroll box): its max height is the
 * window below the box's page position, less 40px, never under 420px. What sits under the box (History's notes)
 * does not shrink it: the page scrolls to reach it. Its width sizes the opened row's sticky line. Recomputed on
 * resize, and when the page's own height changes (late content above the box moves its top without the window
 * resizing).
 */
export function useFitToViewport(ref: RefObject<HTMLElement | null>): {
  maxHeight: number
  width: number
} {
  const [size, setSize] = useState({ maxHeight: FLOOR, width: 0 })
  useEffect(() => {
    const measure = () => {
      const element = ref.current
      if (element === null) return
      // The box's place in the page, not the window: scrolling the page does not change it.
      const top = element.getBoundingClientRect().top + window.scrollY
      const maxHeight = Math.max(FLOOR, Math.round(window.innerHeight - top - GAP))
      const width = element.clientWidth
      // Same figures keep the same state, so a caller passing a fresh ref object each render can't loop.
      setSize((previous) =>
        previous.maxHeight === maxHeight && previous.width === width
          ? previous
          : { maxHeight, width }
      )
    }
    measure()
    window.addEventListener('resize', measure)
    // The body's size changes when content above the box arrives or wraps; the unchanged-size guard in
    // `measure` is what keeps the box's own resize from looping through this observer.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(document.body)
    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [ref])
  return size
}
