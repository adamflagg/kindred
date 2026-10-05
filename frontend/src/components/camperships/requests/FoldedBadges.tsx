import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useOverlayEscape } from '../../../hooks/useOverlayEscape'
import { useAnchoredOverlay } from '../../ui/useAnchoredOverlay'
import { STRIP_BADGE, STRIP_BADGE_ON, STRIP_FOLDED } from '../kit/kitStyles'
import type { BadgeTone } from './strip'

/**
 * The strip's +N chip (owner 2026-10-04): the badges folded off the line, opened on a click (never
 * a hover) as a list anchored under the chip. Escape, a click outside, or picking an item closes it.
 * Ringed when the picked stage is among the folded badges.
 */
export function FoldedBadges({
  count,
  tone,
  on,
  children,
}: {
  count: number
  tone: BadgeTone
  on: boolean
  /** The folded badges, each a link into its view. */
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const chipRef = useRef<HTMLButtonElement>(null)
  const { ref: listRef, position } = useAnchoredOverlay<HTMLDivElement>({
    open,
    getAnchorRect: () => chipRef.current?.getBoundingClientRect() ?? null,
    placement: 'below',
    gap: 4,
  })
  useOverlayEscape(open, close)

  useEffect(() => {
    if (!open) return
    // The chip toggles on its own click, so a press on it is not "outside".
    const outside = (event: MouseEvent) => {
      const target = event.target as Node
      if (chipRef.current?.contains(target) || listRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [open, listRef])

  return (
    <>
      <button
        ref={chipRef}
        type="button"
        className={on ? `${STRIP_BADGE[tone]} ${STRIP_BADGE_ON}` : STRIP_BADGE[tone]}
        data-state={on ? 'on' : undefined}
        onClick={() => setOpen((was) => !was)}
      >
        +{count}
      </button>
      {open &&
        createPortal(
          // A click on an item opens its view (the link's own handler runs first), then closes the list.
          <div
            ref={listRef}
            data-testid="strip-folded"
            className={STRIP_FOLDED}
            style={{
              top: `${String(position?.top ?? -9999)}px`,
              left: `${String(position?.left ?? -9999)}px`,
            }}
            onClick={close}
          >
            {children}
          </div>,
          document.body
        )}
    </>
  )
}
