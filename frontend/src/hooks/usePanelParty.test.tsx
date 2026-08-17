/**
 * `usePanelParty` is the extraction of the triplicated `panelParty`
 * derivation from `HouseholdRosterTable`, `LodgingBoard` and `LodgingMap`
 * (kindred#2139), storing `selectedKey` rather than the full party object so
 * the presence check and "get fresh data" collapse into one operation
 * (kindred#2137's recommended fix).
 */
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { RosterPartyRow } from '../types/lodging'
import { usePanelParty } from './usePanelParty'

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 2000001,
    person_cm_id: 0,
    display_name: 'Johnson Family',
    unit_code: '',
    unit_name: '',
    ...overrides,
  }
}

describe('usePanelParty — basic open/close', () => {
  it('starts with no panel open', () => {
    const { result } = renderHook(() => usePanelParty([party()]))
    expect(result.current.panelParty).toBeNull()
    expect(result.current.requestClose).toBe(false)
  })

  it('opens the panel for the clicked party', () => {
    const johnson = party()
    const { result } = renderHook(() => usePanelParty([johnson]))
    act(() => {
      result.current.openParty(johnson)
    })
    expect(result.current.panelParty).toBe(johnson)
  })

  it('closePanel clears both the selection and any pending close', () => {
    const johnson = party()
    const { result } = renderHook(() => usePanelParty([johnson]))
    act(() => {
      result.current.openParty(johnson)
    })
    act(() => {
      result.current.requestPanelClose()
    })
    expect(result.current.requestClose).toBe(true)

    act(() => {
      result.current.closePanel()
    })
    expect(result.current.panelParty).toBeNull()
    expect(result.current.requestClose).toBe(false)
  })

  it('opening a new party clears a pending close from the previous one', () => {
    const johnson = party({ household_cm_id: 2000001, display_name: 'Johnson' })
    const garcia = party({ household_cm_id: 2000002, display_name: 'Garcia' })
    const { result } = renderHook(() => usePanelParty([johnson, garcia]))
    act(() => {
      result.current.openParty(johnson)
    })
    act(() => {
      result.current.requestPanelClose()
    })
    expect(result.current.requestClose).toBe(true)

    act(() => {
      result.current.openParty(garcia)
    })
    expect(result.current.panelParty).toBe(garcia)
    expect(result.current.requestClose).toBe(false)
  })
})

describe('usePanelParty — kindred#2137 bug 1: silent reopen (A -> B -> A)', () => {
  it('does not resurrect the panel when the party returns on a later rerender', () => {
    const johnson = party({ household_cm_id: 2000001 })
    const garcia = party({ household_cm_id: 2000002 })

    const { result, rerender } = renderHook(({ parties }) => usePanelParty(parties), {
      initialProps: { parties: [johnson, garcia] },
    })

    act(() => {
      result.current.openParty(johnson)
    })
    expect(result.current.panelParty).toBe(johnson)

    // B: johnson drops out of the roster (weekend switch) -- the panel must
    // close, exactly as #2062 already required.
    rerender({ parties: [garcia] })
    expect(result.current.panelParty).toBeNull()

    // A: back to a roster that once again contains johnson (switching back
    // to the first weekend, already cached). Without clearing the stored
    // selection, `partyKey` would match again and the panel would reopen
    // with no click -- re-issuing a medical fetch for a household nobody asked
    // to see. This is the bug.
    rerender({ parties: [johnson, garcia] })
    expect(result.current.panelParty).toBeNull()
  })
})

describe('usePanelParty — kindred#2137 bug 2: requestClose latches across the same path', () => {
  it('clears a pending close when the party departs, not just when closePanel runs', () => {
    const johnson = party({ household_cm_id: 2000001 })
    const garcia = party({ household_cm_id: 2000002 })

    const { result, rerender } = renderHook(({ parties }) => usePanelParty(parties), {
      initialProps: { parties: [johnson, garcia] },
    })

    act(() => {
      result.current.openParty(johnson)
    })
    act(() => {
      result.current.requestPanelClose()
    })
    expect(result.current.requestClose).toBe(true)

    // johnson departs before the 300ms exit animation finishes -- the
    // element unmounts, so `onClose` (which is what normally clears
    // `requestClose`) never runs. Without a fix, `requestClose` stays latched
    // true.
    rerender({ parties: [garcia] })
    expect(result.current.panelParty).toBeNull()
    expect(result.current.requestClose).toBe(false)

    // If johnson reappears now, the panel must mount fresh -- not already
    // mid-exit.
    rerender({ parties: [johnson, garcia] })
    expect(result.current.panelParty).toBeNull()
    expect(result.current.requestClose).toBe(false)
  })
})

describe('usePanelParty — kindred#2137 bug 3: stale captured object vs. live row', () => {
  it('reflects the LIVE matching party, not the object captured at click time', () => {
    const johnson = party({ household_cm_id: 2000001, unit_code: 'cedar-1', unit_name: 'Cedar 1' })

    const { result, rerender } = renderHook(({ parties }) => usePanelParty(parties), {
      initialProps: { parties: [johnson] },
    })

    act(() => {
      result.current.openParty(johnson)
    })
    expect(result.current.panelParty?.unit_name).toBe('Cedar 1')

    // An optimistic drag placement (`dragPlacement.ts`'s `applyPlacement`)
    // returns a NEW party object with a changed `unit_code`/`unit_name`, kept
    // at the same `partyKey`. The panel must show the post-drag cabin, not
    // the object it captured when the row was clicked.
    const draggedJohnson = { ...johnson, unit_code: 'ridge-a', unit_name: 'Ridge A' }
    rerender({ parties: [draggedJohnson] })

    expect(result.current.panelParty).toBe(draggedJohnson)
    expect(result.current.panelParty?.unit_name).toBe('Ridge A')
  })
})

describe('usePanelParty — memoization on the pan hot path (kindred#2139)', () => {
  it('does not re-scan parties on an unrelated rerender with unchanged inputs', () => {
    const johnson = party({ household_cm_id: 2000001 })
    let findCalls = 0
    const parties = Object.assign([johnson], {
      find(callback: (p: RosterPartyRow) => boolean) {
        findCalls += 1
        return Array.prototype.find.call(this, callback) as RosterPartyRow | undefined
      },
    })

    const { result, rerender } = renderHook(({ parties }) => usePanelParty(parties), {
      initialProps: { parties },
    })

    act(() => {
      result.current.openParty(johnson)
    })
    expect(findCalls).toBe(1)

    // LodgingMap's `setView` fires on every `pointermove` while panning, which
    // re-renders the whole component tree with the SAME `parties` reference
    // and the SAME selection. That must not re-walk the roster.
    rerender({ parties })
    rerender({ parties })
    expect(findCalls).toBe(1)
  })
})
