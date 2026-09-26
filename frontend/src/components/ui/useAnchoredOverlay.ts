/**
 * Anchoring a portaled overlay below or beside the thing that opened it,
 * against the overlay's MEASURED size -- the way `Tooltip`'s `place()`
 * measures its bubble -- and re-placing it on every scroll and resize.
 *
 * It never dismisses anything. Whether a scroll closes an overlay is that
 * overlay's own call: a board-note popover never closes on scroll (board
 * notes, 2026-09-25), while `ConfirmActionPopover` closes on a scroll OUTSIDE
 * itself because its anchor rect is a click-time snapshot.
 */
import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

export interface AnchorRect {
  top: number
  left: number
  width: number
  height: number
}

export type AnchoredPlacement = 'below' | 'beside'

export interface AnchoredPosition {
  top: number
  left: number
}

export function computeAnchoredPosition(
  anchor: AnchorRect,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  placement: AnchoredPlacement,
  gap = 8,
  edge = 8
): AnchoredPosition {
  if (placement === 'below') {
    let top = anchor.top + anchor.height + gap
    let left = anchor.left + anchor.width / 2 - size.width / 2
    if (top + size.height > viewport.height - edge)
      top = Math.max(edge, anchor.top - size.height - gap)
    if (left + size.width > viewport.width - edge)
      left = Math.max(edge, viewport.width - size.width - edge)
    if (left < edge) left = edge
    return { top, left }
  }
  // Beside: right of the anchor, else left of it, else below it; always
  // clamped into the viewport vertically.
  let left = anchor.left + anchor.width + gap
  let top = anchor.top - 6
  if (left + size.width > viewport.width - edge) left = anchor.left - size.width - gap
  if (left < edge) {
    left = Math.max(edge, Math.min(viewport.width - size.width - edge, anchor.left))
    top = anchor.top + anchor.height + 6
  }
  top = Math.max(edge, Math.min(viewport.height - size.height - edge, top))
  return { top, left }
}

export interface AnchoredOverlayOptions {
  open: boolean
  /** Read at every placement, so it may follow a live element. */
  getAnchorRect: () => AnchorRect | null
  placement: AnchoredPlacement
  gap?: number
  edge?: number
}

export function useAnchoredOverlay<T extends HTMLElement>({
  open,
  getAnchorRect,
  placement,
  gap = 8,
  edge = 8,
}: AnchoredOverlayOptions): { ref: RefObject<T | null>; position: AnchoredPosition | null } {
  const ref = useRef<T>(null)
  // Held in a ref so an inline arrow at the call site does not re-run the
  // placement effect below (and re-add its listeners) on every render --
  // useOverlayEscape's shape. Synced in its own layout effect rather than
  // written during render: this component runs under react-hooks 7's
  // `react-hooks/refs` rule, which flags a direct `ref.current =` in the
  // render body even though the value never feeds a render decision.
  const anchorRef = useRef(getAnchorRect)
  useLayoutEffect(() => {
    anchorRef.current = getAnchorRect
  }, [getAnchorRect])
  const [position, setPosition] = useState<AnchoredPosition | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      // A nested function, not a bare `setPosition(null)` at the top of the
      // effect body: `react-hooks/set-state-in-effect` doesn't trace into a
      // called function to see the setState inside it -- `place()` below
      // gets the same pass. Needed for real, not just for the lint: a
      // consumer that trusts `position !== null` must not see the position
      // from before this close once the overlay reopens with its anchor not
      // yet mounted (`getAnchorRect()` returning null on the first
      // placement pass) -- see the "clears position on close" regression
      // test.
      const clear = () => setPosition(null)
      clear()
      return
    }
    const place = () => {
      const element = ref.current
      const anchor = anchorRef.current()
      if (!element || !anchor) return
      const next = computeAnchoredPosition(
        anchor,
        { width: element.offsetWidth, height: element.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        placement,
        gap,
        edge
      )
      setPosition((prev) => (prev?.top === next.top && prev.left === next.left ? prev : next))
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    // The overlay's own height changes (a note editor expanding its plan-only
    // box); jsdom has no ResizeObserver, hence the guard.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    if (observer && ref.current) observer.observe(ref.current)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      observer?.disconnect()
    }
  }, [open, placement, gap, edge])

  return { ref, position }
}
