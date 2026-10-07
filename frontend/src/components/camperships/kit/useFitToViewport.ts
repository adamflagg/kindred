import { useEffect, useState, type RefObject } from 'react'

const GAP = 24
const FLOOR = 320

/**
 * A screen box's size (spec §7.2 C): its max height fills the window below its top, less 24px, never under 320px,
 * so the page never scrolls past it; its width sizes the opened row's sticky line. Recomputed on resize.
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
      const top = element.getBoundingClientRect().top
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
    return () => window.removeEventListener('resize', measure)
  }, [ref])
  return size
}
