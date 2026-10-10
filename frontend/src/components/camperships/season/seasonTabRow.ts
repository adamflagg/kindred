import { createContext } from 'react'

/**
 * The Season tab row's right-hand slot, for a tab that puts its own controls there (owner, 2026-10-10, toolbar fit E:
 * Scenarios' pile and Update Applications sit before Approve…). AidSeasonPage builds the slot and provides it; null
 * while it isn't mounted, and on every tab that has none. A tab draws into it with InSeasonTabRow.
 */
export const SeasonTabRowContext = createContext<HTMLElement | null>(null)
