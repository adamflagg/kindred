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

vi.mock('../services/lodgingApi', () => ({
  setUnitAvailability: (...args: unknown[]) => setUnitAvailability(...args),
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
