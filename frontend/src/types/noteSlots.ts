import type { ReactNode } from 'react'

/**
 * Optional board-note slots a card renders (board notes, 2026-09-25).
 *
 * Rendered only when supplied, so a card without slots is byte-identical to
 * the card before this existed. The card owns WHERE a slot sits; the caller
 * owns what goes in it.
 *
 * - `corner` -- absolutely positioned on the card's own top-right border
 *   corner, a SIBLING of the card's open control, never inside a `<button>`.
 */
export interface CardNoteSlots {
  corner?: ReactNode
}
