import { useCallback, useEffect, useRef, type PointerEvent } from 'react'

/**
 * Pointer tracking for a group of `.glow-card`s (see index.css): spread the
 * returned props on the container and mark each card `data-glow-card`.
 *
 * Every card — not just the hovered one — gets `--glow-x`/`--glow-y`, the
 * pointer's position relative to that card. That is what lets a neighbour's
 * edge light from the side the pointer is approaching.
 *
 * Cost budget: nothing happens between frames. A burst of pointer moves
 * collapses into one requestAnimationFrame that reads each card's rect once
 * and writes two custom properties — no React state, no re-render. Keep it
 * that way when reusing this on a denser surface (docs/reference/ui-uplift.md).
 */
export function useGlowGroup<T extends HTMLElement>() {
  const frame = useRef(0)
  const pointer = useRef({ x: 0, y: 0 })

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  const onPointerMove = useCallback((e: PointerEvent<T>) => {
    pointer.current = { x: e.clientX, y: e.clientY }
    if (frame.current) return
    const group = e.currentTarget
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      const { x, y } = pointer.current
      group.querySelectorAll<HTMLElement>('[data-glow-card]').forEach((card) => {
        const rect = card.getBoundingClientRect()
        card.style.setProperty('--glow-x', `${x - rect.left}px`)
        card.style.setProperty('--glow-y', `${y - rect.top}px`)
      })
    })
  }, [])

  const onPointerLeave = useCallback((e: PointerEvent<T>) => {
    cancelAnimationFrame(frame.current)
    frame.current = 0
    e.currentTarget.querySelectorAll<HTMLElement>('[data-glow-card]').forEach((card) => {
      card.style.removeProperty('--glow-x')
      card.style.removeProperty('--glow-y')
    })
  }, [])

  return { 'data-glow-group': '', onPointerMove, onPointerLeave }
}
