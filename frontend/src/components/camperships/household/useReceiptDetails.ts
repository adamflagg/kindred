import { useState } from 'react'

import type { ApiAidHouseholdRequest } from '../../../types/api-types'
import { opensByItself } from './householdModel'

/**
 * The card's receipt state (household-v4 section 1 (B)): folded, it opens from the header's Show
 * Details; a hold opens it by itself (D34), including one that arrives later, but a hold that stays
 * does not re-open a receipt staff folded (M9). Adjusted during render, React's pattern for state
 * that follows a prop, as kit/Receipt does.
 */
export function useReceiptDetails(request: ApiAidHouseholdRequest): {
  open: boolean
  toggle: () => void
} {
  const held = opensByItself(request)
  const [open, setOpen] = useState(held)
  const [sawHeld, setSawHeld] = useState(held)
  if (held !== sawHeld) {
    setSawHeld(held)
    if (held) setOpen(true)
  }
  return { open, toggle: () => setOpen(!open) }
}
