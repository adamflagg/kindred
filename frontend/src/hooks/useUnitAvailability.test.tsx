/**
 * Writing one unit's availability for one weekend.
 *
 * The behaviour worth pinning here is the invalidation, and it is NOT the
 * placement hook's. A placement belongs to one scenario, so `useLodgingPlacement`
 * invalidates that scenario's roster key. Availability belongs to the WEEKEND —
 * a burst pipe closes a cabin in every plan for it — so a write made while one
 * draft is open has to refresh the mirror and every other draft too.
 *
 * Fictional data throughout.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WeekendRoster } from '../types/lodging'
import { queryKeys } from '../utils/queryKeys'
import { useUnitAvailability } from './useUnitAvailability'

const setUnitAvailability = vi.fn()
const deleteWriteIn = vi.fn()

vi.mock('../services/lodgingApi', () => ({
  setUnitAvailability: (...args: unknown[]) => setUnitAvailability(...args),
  deleteWriteIn: (...args: unknown[]) => deleteWriteIn(...args),
}))

vi.mock('./useApiWithAuth', () => ({
  useApiWithAuth: () => ({ fetchWithAuth: vi.fn(), isAuthenticated: true, isAuthLoading: false }),
}))

const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock('react-hot-toast', () => ({
  default: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}))

const YEAR = 2026
const SESSION = 1000001
const DRAFT = 'scn7x2k9qw3mnbv'

const WRITE_IN = {
  unitId: 'u1',
  unitName: 'Cedar 1',
  familyAvailable: false as boolean | null,
  occupantName: 'Emma Johnson',
  reason: '',
  partySize: null as number | null,
  previousOccupantName: null as string | null,
}

const REMOVAL = {
  unitId: 'u1',
  unitName: 'Cedar 1',
  occupantName: 'Emma Johnson',
}

let client: QueryClient

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function rosterKey(scenario: string) {
  return queryKeys.weekendRoster(YEAR, SESSION, scenario)
}

function seededRoster(): WeekendRoster {
  return { year: YEAR, session_cm_id: SESSION, parties: [], units: [] }
}

beforeEach(() => {
  vi.clearAllMocks()
  setUnitAvailability.mockResolvedValue({ record_id: 'r1', deleted: false })
  deleteWriteIn.mockResolvedValue({ record_id: 'wi1', deleted: true })
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  client.setQueryData(rosterKey(''), seededRoster())
  client.setQueryData(rosterKey(DRAFT), seededRoster())
})

function renderAvailability(sessionCmId = SESSION, scenario = '') {
  return renderHook(() => useUnitAvailability({ year: YEAR, sessionCmId, scenario }), { wrapper })
}

describe('useUnitAvailability', () => {
  it('sends the weekend, the unit and the explicit boolean', async () => {
    const { result } = renderAvailability()

    await act(async () => {
      await result.current.setAvailability(WRITE_IN)
    })

    expect(setUnitAvailability).toHaveBeenCalledTimes(1)
    expect(setUnitAvailability.mock.calls[0]?.[1]).toEqual({
      year: YEAR,
      sessionCmId: SESSION,
      scenario: '',
      unitId: 'u1',
      familyAvailable: false,
      occupantName: 'Emma Johnson',
      reason: '',
      partySize: null,
      previousOccupantName: null,
    })
  })

  it('forwards a non-null party size, rather than hardcoding one', async () => {
    // MAJOR B: `WRITE_IN`'s own `partySize: null` cannot distinguish
    // FORWARDING `intent.partySize` from hardcoding `null` at this hop's
    // `mutationFn` — both produce the same `null` on the wire. This is the
    // one assertion in this file that would catch the hardcode.
    const { result } = renderAvailability()

    await act(async () => {
      await result.current.setAvailability({ ...WRITE_IN, partySize: 3 })
    })

    expect(setUnitAvailability.mock.calls[0]?.[1]).toMatchObject({ partySize: 3 })
  })

  it('sends the scenario it was opened on, so the write lands on that board', async () => {
    // kindred#2382 PR 4. A scenario's write-ins REPLACE the live ones on read
    // (PR 3), so an occupancy written to the live table from inside a scenario
    // is replaced away by that scenario's own read — the staff member records
    // a write-in and the board they made it on does not show it.
    //
    // Still not GATED on having one, which is the distinction from
    // `useLodgingPlacement`: blank is the live board, and staff evaluating the
    // real board must be able to write onto it.
    const { result } = renderAvailability(SESSION, DRAFT)

    await act(async () => {
      await result.current.setAvailability(WRITE_IN)
    })

    expect(setUnitAvailability.mock.calls[0]?.[1]).toMatchObject({ scenario: DRAFT })
  })

  it('refreshes EVERY scenario of the weekend, not just the one on screen', async () => {
    // The failure this pins is silent. ONE WRITE CAN MOVE TWO BOARDS: an
    // occupancy lands on the scenario named on the request, while a RELEASE is
    // a weekend-level fact every scenario of that weekend inherits, because
    // `lodging_availability` still has no scenario column (kindred#2382 split
    // the occupancy half out and left the role half where it was). And the
    // weekend queries carry a 30 minute staleTime, so "stale" means half an
    // hour of a board showing a cabin as open after staff closed it.
    // Invalidating only the visible key looks correct on the screen you are
    // looking at, which is why nobody reports it.
    const { result } = renderAvailability()

    await act(async () => {
      await result.current.setAvailability(WRITE_IN)
    })

    await waitFor(() => {
      expect(client.getQueryState(rosterKey(DRAFT))?.isInvalidated).toBe(true)
      expect(client.getQueryState(rosterKey(''))?.isInvalidated).toBe(true)
    })
  })

  it('names only the unit being written, so one card waits and the rest do not', async () => {
    // A bare `isPending` would disable the control on all 81 cards while one
    // cabin is being held.
    let release: (value: unknown) => void = () => undefined
    setUnitAvailability.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      })
    )

    const { result } = renderAvailability()
    act(() => {
      void result.current.setAvailability(WRITE_IN)
    })

    await waitFor(() => {
      expect(result.current.pendingUnitId).toBe('u1')
    })

    await act(async () => {
      release({ record_id: 'r1', deleted: false })
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(result.current.pendingUnitId).toBe('')
    })
  })

  it('stays SILENT on success, like every other direct-manipulation write on this board', async () => {
    /*
     * Owner ruling, 2026-08-18: no toast for adding or removing a write-in.
     *
     *   > "idk what '<cabin> follows its usual role again' is needed for, if
     *   >  anything. dont think we need toasts for adding or removing write
     *   >  ins."
     *
     * This hook was the only mutation on the weekend board that confirmed
     * success in a toast. `useLodgingPlacement` (place/move/unplace a family)
     * and `useUnitMerge` (merge/split a building) both raise errors only, and
     * the board redraws either way — the card IS the confirmation.
     *
     * Asserted as "no success toast at all", not "a different string", so a
     * future re-introduction fails here rather than passing with new wording.
     */
    const { result } = renderAvailability()

    await act(async () => {
      await result.current.setAvailability(WRITE_IN)
    })

    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('stays silent when a write-in is REMOVED, too', async () => {
    // The clear branch — the one that said "<cabin> follows its usual role
    // again", which is the message that prompted the ruling. Removing a
    // write-in is the X on its own card; the card disappearing is the
    // confirmation.
    const { result } = renderAvailability()

    await act(async () => {
      await result.current.setAvailability({ ...WRITE_IN, familyAvailable: null, occupantName: '' })
    })

    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('says what a refused write was, rather than leaving the card looking saved', async () => {
    setUnitAvailability.mockRejectedValue(new Error('Permission required: bunking.manage'))

    const { result } = renderAvailability()
    await act(async () => {
      await result.current.setAvailability(WRITE_IN).catch(() => undefined)
    })

    expect(toastError).toHaveBeenCalledWith('Permission required: bunking.manage')
  })

  it('refuses to write without a weekend rather than sending session_cm_id 0', async () => {
    // `sessionCmId` defaults to 0 on the board for the tests that do not
    // exercise writes, and the schema declares `gt=0`. Refusing here turns a
    // 422 into a caller bug, the way the placement hook refuses an empty
    // scenario.
    const { result } = renderAvailability(0)

    await expect(result.current.setAvailability(WRITE_IN)).rejects.toThrow(/weekend/i)
    expect(setUnitAvailability).not.toHaveBeenCalled()
  })
})

describe('useUnitAvailability — renaming one occupant', () => {
  it('forwards the name the form loaded, rather than dropping it at this hop', async () => {
    // kindred#2583 step 4. The rename is a COMPARE-AND-SWAP and this hop is
    // where it would silently become a create: dropping the field here sends
    // `undefined`, the server reads "renames nobody", and the write is keyed
    // on the NEW name — which misses, and creates a second row the moment
    // step 8 narrows the index.
    const { result } = renderAvailability()

    await act(async () => {
      await result.current.setAvailability({ ...WRITE_IN, previousOccupantName: 'Emma Johnson' })
    })

    expect(setUnitAvailability.mock.calls[0]?.[1]).toMatchObject({
      previousOccupantName: 'Emma Johnson',
    })
  })

  it('forwards a BLANK previous name as a name, not as an absence', async () => {
    // `''` addresses the row whose occupant is unnamed. Any `|| null`,
    // `?? null` or truthiness test on the way through collapses it into "no
    // rename" and puts that one row back on the bare-rename path.
    const { result } = renderAvailability()

    await act(async () => {
      await result.current.setAvailability({ ...WRITE_IN, previousOccupantName: '' })
    })

    expect(setUnitAvailability.mock.calls[0]?.[1]).toMatchObject({ previousOccupantName: '' })
  })

  it('raises the conflict message when the row moved under the card', async () => {
    // The whole of the client-side conflict handling, by ruling: staff are
    // each assigned their own weekend and work async on it, so a failed swap
    // fires essentially never. A toast telling them to reopen the card is the
    // requirement; there is no merge dialog and no retry flow.
    setUnitAvailability.mockRejectedValue(
      new Error('the write-in for Emma Johnson is no longer on this unit')
    )

    const { result } = renderAvailability()
    await act(async () => {
      await result.current
        .setAvailability({ ...WRITE_IN, previousOccupantName: 'Emma Johnson' })
        .catch(() => undefined)
    })

    expect(toastError).toHaveBeenCalledWith(
      'the write-in for Emma Johnson is no longer on this unit'
    )
  })
})

describe('useUnitAvailability — removing ONE occupant', () => {
  it('sends the row-addressed delete, not the clear verb', async () => {
    // kindred#2583 step 7's verb. `family_available: null` is
    // CLEAR-THIS-UNIT-ENTIRELY — the role row and EVERY occupancy row on the
    // unit — so a × still sending it would delete the co-occupant the moment
    // step 8 makes a co-occupant possible.
    const { result } = renderAvailability()

    await act(async () => {
      await result.current.removeWriteIn(REMOVAL)
    })

    expect(deleteWriteIn).toHaveBeenCalledTimes(1)
    expect(deleteWriteIn.mock.calls[0]?.[1]).toEqual({
      year: YEAR,
      sessionCmId: SESSION,
      scenario: '',
      unitId: 'u1',
      occupantName: 'Emma Johnson',
    })
    expect(setUnitAvailability).not.toHaveBeenCalled()
  })

  it('removes from the scenario it was opened on', async () => {
    const { result } = renderAvailability(SESSION, DRAFT)

    await act(async () => {
      await result.current.removeWriteIn(REMOVAL)
    })

    expect(deleteWriteIn.mock.calls[0]?.[1]).toMatchObject({ scenario: DRAFT })
  })

  it('refreshes EVERY scenario of the weekend, as the write does', async () => {
    // Same argument as the write's own invalidation, and the same 30-minute
    // staleTime behind it: a removal made inside one draft has to refresh the
    // mirror and every other draft, or a board somewhere still draws an
    // occupant who is gone.
    const { result } = renderAvailability()

    await act(async () => {
      await result.current.removeWriteIn(REMOVAL)
    })

    await waitFor(() => {
      expect(client.getQueryState(rosterKey(DRAFT))?.isInvalidated).toBe(true)
      expect(client.getQueryState(rosterKey(''))?.isInvalidated).toBe(true)
    })
  })

  it('names the unit being removed from, so one card waits and the rest do not', async () => {
    // `pendingUnitId` is ONE answer covering both mutations. The board keys
    // every corner control off it, so a removal that did not report itself
    // would leave the × live for the whole round trip and invite a second
    // click on a row already going away.
    let release: (value: unknown) => void = () => undefined
    deleteWriteIn.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      })
    )

    const { result } = renderAvailability()
    act(() => {
      void result.current.removeWriteIn(REMOVAL)
    })

    await waitFor(() => {
      expect(result.current.pendingUnitId).toBe('u1')
    })

    await act(async () => {
      release({ record_id: 'wi1', deleted: true })
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(result.current.pendingUnitId).toBe('')
    })
  })

  it('stays SILENT on success, like every other write on this board', async () => {
    const { result } = renderAvailability()

    await act(async () => {
      await result.current.removeWriteIn(REMOVAL)
    })

    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('says what a refused removal was', async () => {
    deleteWriteIn.mockRejectedValue(new Error('Permission required: bunking.manage'))

    const { result } = renderAvailability()
    await act(async () => {
      await result.current.removeWriteIn(REMOVAL).catch(() => undefined)
    })

    expect(toastError).toHaveBeenCalledWith('Permission required: bunking.manage')
  })

  it('refuses to remove without a weekend, exactly as the write does', async () => {
    const { result } = renderAvailability(0)

    await expect(result.current.removeWriteIn(REMOVAL)).rejects.toThrow(/weekend/i)
    expect(deleteWriteIn).not.toHaveBeenCalled()
  })
})
