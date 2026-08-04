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

const HOLD = {
  unitId: 'u1',
  unitName: 'Cedar 1',
  familyAvailable: false as boolean | null,
  reason: 'Burst pipe',
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

function renderAvailability(sessionCmId = SESSION) {
  return renderHook(() => useUnitAvailability({ year: YEAR, sessionCmId }), { wrapper })
}

describe('useUnitAvailability', () => {
  it('sends the weekend, the unit and the explicit boolean', async () => {
    const { result } = renderAvailability()

    await act(async () => {
      await result.current.setAvailability(HOLD)
    })

    expect(setUnitAvailability).toHaveBeenCalledTimes(1)
    expect(setUnitAvailability.mock.calls[0]?.[1]).toEqual({
      year: YEAR,
      sessionCmId: SESSION,
      unitId: 'u1',
      familyAvailable: false,
      reason: 'Burst pipe',
    })
  })

  it('refreshes EVERY scenario of the weekend, not just the one on screen', async () => {
    // The failure this pins is silent. Availability carries no scenario, so a
    // hold recorded while a draft is open changes the mirror and every other
    // draft as well — and the weekend queries carry a 30 minute staleTime, so
    // "stale" means half an hour of a board showing a cabin as open after
    // staff closed it. Invalidating only the visible key looks correct on the
    // screen you are looking at, which is why nobody reports it.
    const { result } = renderAvailability()

    await act(async () => {
      await result.current.setAvailability(HOLD)
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
      void result.current.setAvailability(HOLD)
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

  it('says what a refused write was, rather than leaving the card looking saved', async () => {
    setUnitAvailability.mockRejectedValue(new Error('Permission required: bunking.manage'))

    const { result } = renderAvailability()
    await act(async () => {
      await result.current.setAvailability(HOLD).catch(() => undefined)
    })

    expect(toastError).toHaveBeenCalledWith('Permission required: bunking.manage')
  })

  it('refuses to write without a weekend rather than sending session_cm_id 0', async () => {
    // `sessionCmId` defaults to 0 on the board for the tests that do not
    // exercise writes, and the schema declares `gt=0`. Refusing here turns a
    // 422 into a caller bug, the way the placement hook refuses an empty
    // scenario.
    const { result } = renderAvailability(0)

    await expect(result.current.setAvailability(HOLD)).rejects.toThrow(/weekend/i)
    expect(setUnitAvailability).not.toHaveBeenCalled()
  })
})
