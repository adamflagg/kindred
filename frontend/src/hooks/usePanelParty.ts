import { useCallback, useMemo, useState } from 'react'

import { partyKey } from '../components/weekend/partyKey'
import type { RosterPartyRow } from '../types/lodging'

export interface UsePanelPartyResult {
  /**
   * The party `FamilyDetailsPanel` should render for, resolved fresh against
   * the CURRENT `parties` on every render — never the object captured when
   * the row was clicked. Read this once and pass the one value to all three
   * places that need it (the panel's own render, `isPanelOpen`,
   * `useDismissOnDeadSpace`'s open flag) rather than re-deriving it, or a
   * caller that only updates the panel render site leaves the other two
   * stale.
   */
  panelParty: RosterPartyRow | null
  /** Drives `FamilyDetailsPanel`'s exit animation. */
  requestClose: boolean
  /** Call from a party's own click handler (a row, a card, a mark). */
  openParty: (party: RosterPartyRow) => void
  /** `FamilyDetailsPanel`'s `onClose` — the animation has finished. */
  closePanel: () => void
  /** Dead-space dismissal: start the exit animation without closing yet. */
  requestPanelClose: () => void
}

/**
 * The `panelParty` derivation triplicated across `HouseholdRosterTable`,
 * `LodgingBoard` and `LodgingMap` (kindred#2139) — one definition, because
 * three drifted out of sync the moment a fourth surface needed the same
 * "which party is the details panel open for" question answered.
 *
 * STORES `selectedKey: string | null`, not the party object itself
 * (kindred#2137's recommended fix). That makes "is the selection still in
 * the roster" and "get its current data" the SAME lookup:
 *
 *   parties.find((p) => partyKey(p) === selectedKey)
 *
 * A stored object answers the first question by comparing keys anyway
 * (`partyKey(p) === partyKey(selected)`) and then hands back the STALE
 * captured object instead of the live match — kindred#2137 bug 3. An
 * optimistic drag placement (`dragPlacement.ts`'s `applyPlacement`) returns a
 * new party object with a changed `unit_code`/`unit_name` at the same
 * `partyKey`, so the stale-object shape shows the pre-drag cabin until the
 * panel is closed and reopened.
 *
 * MEMOIZED on `[parties, selectedKey]` — this lands on `LodgingMap`'s pan hot
 * path, where `setView` fires on every `pointermove` and re-renders the whole
 * map with an unchanged `parties` reference. Without memoization every pan
 * frame re-scans the roster; `useMemo` skips that entirely when neither
 * input moved. The scan itself is also O(N), not O(2N): `selectedKey` is a
 * plain string computed once at `openParty` time, so `.find` never
 * recomputes `partyKey` for the selection inside its own callback the way
 * the old triplicated code did (`partyKey(selected)` sitting inside
 * `.some()`, once per candidate).
 *
 * CLEARS `selectedKey` (and any pending `requestClose`) DURING RENDER when
 * the derived `panelParty` resolves to `null` but a selection is still on
 * record — React's own "storing information from previous renders" pattern,
 * the same one `WeekendRosterPage.tsx` already uses for its session-change
 * reset. This is deliberately NOT a `useEffect` + `setState`: all three call
 * sites this hook replaces carried a comment explaining that an Effect adds
 * an extra commit pass a render-time correction avoids, and calling
 * `setState` conditionally in the render body does not add a paint — React
 * discards this render's output and re-renders synchronously with the
 * corrected state before anything commits.
 *
 * This is what closes kindred#2137 bugs 1 and 2 for free: without it,
 * `selectedKey` outlives its own party's departure from `parties` (a
 * weekend switch, a refetch), and if the SAME key re-matches later (the
 * household is enrolled in a weekend staff already had cached), the panel
 * silently reopens and re-issues a real medical fetch for a household nobody
 * asked to see. `requestClose` has the identical latch: a dead-space click
 * starts the exit animation, the party departs before the 300ms animation
 * finishes, the element unmounts before `onClose` can fire, and
 * `requestClose` stays latched `true` — so when the party reappears the
 * panel mounts already mid-exit. Clearing both together closes both paths in
 * one place.
 */
export function usePanelParty(parties: RosterPartyRow[]): UsePanelPartyResult {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [requestClose, setRequestClose] = useState(false)

  const panelParty = useMemo<RosterPartyRow | null>(() => {
    if (selectedKey === null) return null
    return parties.find((p) => partyKey(p) === selectedKey) ?? null
  }, [parties, selectedKey])

  if (selectedKey !== null && panelParty === null) {
    setSelectedKey(null)
    if (requestClose) setRequestClose(false)
  }

  const openParty = useCallback((party: RosterPartyRow) => {
    setRequestClose(false)
    setSelectedKey(partyKey(party))
  }, [])

  const closePanel = useCallback(() => {
    setSelectedKey(null)
    setRequestClose(false)
  }, [])

  const requestPanelClose = useCallback(() => {
    setRequestClose(true)
  }, [])

  return { panelParty, requestClose, openParty, closePanel, requestPanelClose }
}
