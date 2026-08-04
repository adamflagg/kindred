/**
 * The placement mutation: optimistic apply, rollback on rejection, and the
 * invalidation the 30-minute staleTime makes mandatory.
 *
 * These are behaviours the drag interaction cannot be tested for — jsdom does
 * not do pointer drags — so they are pinned at the hook, which is where they
 * actually live.
 *
 * Fictional data throughout.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RosterPartyRow, WeekendRoster } from '../types/lodging'
import { queryKeys } from '../utils/queryKeys'
import { useLodgingPlacement } from './useLodgingPlacement'

const placeParty = vi.fn()
const unplaceParty = vi.fn()

vi.mock('../services/lodgingApi', () => ({
  placeParty: (...args: unknown[]) => placeParty(...args),
  unplaceParty: (...args: unknown[]) => unplaceParty(...args),
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
const SCENARIO = 'scn7x2k9qw3mnbv'

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 101,
    person_cm_id: 0,
    display_name: 'Johnson',
    sort_name: 'Johnson',
    adults: [],
    children: [],
    party_size: 3,
    unit_code: '',
    unit_name: '',
    unit_codes: [],
    is_merged_slot: false,
    arrival_eta: '',
    is_returning: false,
    ...overrides,
  } as RosterPartyRow
}

function roster(parties: RosterPartyRow[]): WeekendRoster {
  return {
    year: YEAR,
    session_cm_id: SESSION,
    session_name: 'Family Camp Weekend 1',
    session_type: 'family',
    parties,
    units: [],
    counts: {
      parties_total: parties.length,
      parties_assigned: 0,
      parties_unassigned: parties.length,
    },
  } as WeekendRoster
}

let client: QueryClient

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function rosterKey(scenario = SCENARIO) {
  return queryKeys.weekendRoster(YEAR, SESSION, scenario)
}

function cachedParty(scenario = SCENARIO): RosterPartyRow | undefined {
  return client.getQueryData<WeekendRoster>(rosterKey(scenario))?.parties?.[0]
}

const PLACE = {
  kind: 'place' as const,
  party: party(),
  unitId: 'u1',
  unitCode: 'cedar-1',
  unitName: 'Cedar 1',
}

beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  client.setQueryData(rosterKey(), roster([party()]))
})

function renderPlacement(scenario = SCENARIO) {
  return renderHook(() => useLodgingPlacement({ year: YEAR, sessionCmId: SESSION, scenario }), {
    wrapper,
  })
}

describe('useLodgingPlacement', () => {
  it('moves the card before the write resolves', async () => {
    // The whole point of the optimistic layer. React Query serves previous
    // data during a refetch and the board derives its layout from `parties`,
    // so without this the card sits in its old cabin until the roster returns.
    let release: () => void = () => undefined
    placeParty.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve
      })
    )

    const { result } = renderPlacement()
    act(() => {
      void result.current.move(PLACE)
    })

    await waitFor(() => {
      expect(cachedParty()).toMatchObject({ unit_code: 'cedar-1', unit_name: 'Cedar 1' })
    })

    act(() => {
      release()
    })
  })

  it('sends the scenario, the weekend and the grain to the write', async () => {
    placeParty.mockResolvedValue(undefined)
    const { result } = renderPlacement()

    await act(async () => {
      await result.current.move(PLACE)
    })

    expect(placeParty).toHaveBeenCalledTimes(1)
    expect(placeParty.mock.calls[0]?.[1]).toMatchObject({
      year: YEAR,
      sessionCmId: SESSION,
      scenario: SCENARIO,
      grain: { household_cm_id: 101 },
      unitIds: ['u1'],
    })
  })

  it('calls DELETE rather than POST when unplacing', async () => {
    // kindred#1974 retired the tombstone. A POST with an empty `unit_ids` is a
    // 422, and older HANDOFF text tells the reader to send exactly that.
    unplaceParty.mockResolvedValue(undefined)
    const placed = party({ unit_code: 'cedar-1', unit_name: 'Cedar 1', unit_codes: ['cedar-1'] })
    client.setQueryData(rosterKey(), roster([placed]))
    const { result } = renderPlacement()

    await act(async () => {
      await result.current.move({ kind: 'unplace', party: placed })
    })

    expect(unplaceParty).toHaveBeenCalledTimes(1)
    expect(placeParty).not.toHaveBeenCalled()
    expect(unplaceParty.mock.calls[0]?.[1]).toMatchObject({
      scenario: SCENARIO,
      grain: { household_cm_id: 101 },
    })
  })

  it('rolls the card back and says why when the write is rejected', async () => {
    // HANDOFF:612-613 puts this in scope verbatim: "A silent revert is not
    // acceptable." Both halves are asserted — the card returns AND staff are
    // told, because a card that springs back with no explanation reads as a
    // broken drag rather than a refused write.
    placeParty.mockRejectedValue(
      Object.assign(new Error('Permission required: bunking.manage'), { status: 403 })
    )
    const { result } = renderPlacement()

    await act(async () => {
      await result.current.move(PLACE).catch(() => undefined)
    })

    expect(cachedParty()).toMatchObject({ unit_code: '', unit_name: '' })
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('bunking.manage'))
  })

  it('invalidates the scenario-dimensioned roster key and the summary', async () => {
    // Weekend queries carry the app-default 30 minute staleTime (PR #1965), so
    // nothing refreshes on its own. #1967 added the scenario to the roster key,
    // so invalidating the mirror's slot would leave the draft stale for half an
    // hour — the failure is invisible and slow, which is the worst kind.
    placeParty.mockResolvedValue(undefined)
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderPlacement()

    await act(async () => {
      await result.current.move(PLACE)
    })

    const keys = invalidate.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey))
    expect(keys).toContain(JSON.stringify(rosterKey()))
    expect(keys).toContain(JSON.stringify(queryKeys.weekendSummary(YEAR)))
  })

  it('invalidates even when the write fails', async () => {
    // A rejected write can still have changed the server — a unique-index race
    // resolves as a 409 over a row that now exists. Rolling back the cache and
    // NOT refetching would leave the board confidently wrong.
    placeParty.mockRejectedValue(new Error('nope'))
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderPlacement()

    await act(async () => {
      await result.current.move(PLACE).catch(() => undefined)
    })

    const keys = invalidate.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey))
    expect(keys).toContain(JSON.stringify(rosterKey()))
  })

  it('refuses to write with no scenario selected', async () => {
    // With no scenario the board is read-only for everyone, which is what
    // summer's `isProductionMode` does. The UI disables its drop targets, but
    // an endpoint reached anyway would be the one path around that gate — and
    // the server would 422 on `min_length=1` regardless, so this only decides
    // whether staff see a confusing error.
    const { result } = renderPlacement('')

    await act(async () => {
      await result.current.move(PLACE).catch(() => undefined)
    })

    expect(placeParty).not.toHaveBeenCalled()
    expect(cachedParty('')).toBeUndefined()
  })
})
