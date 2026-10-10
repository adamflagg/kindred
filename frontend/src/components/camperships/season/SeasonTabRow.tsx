import { useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { SeasonTabRowContext } from './seasonTabRow'

/**
 * Draws its children in the Season tab row's slot. They stay in the tab's own tree, so they keep its state and actions
 * (the pile's Update Applications is the sandbox's own, queued behind its pending writes). Nothing shows without a slot.
 */
export function InSeasonTabRow({ children }: { children: ReactNode }) {
  const slot = useContext(SeasonTabRowContext)
  return slot === null ? null : createPortal(children, slot)
}
