/**
 * useCamperJourney — the one feed every journey surface reads.
 * It absorbs the household plumbing useCamperHistory's tests used to pin.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { queryKeys } from '../../utils/queryKeys'
import type { HistoricalRecord } from './types'
import { personJourneyFacts, useCamperJourney } from './useCamperJourney'

const PERSON = 3000001
const OTHER_PERSON = 3000002
const YEAR = 2026

const mockPersonsGetFullList = vi.fn()
vi.mock('../../lib/pocketbase', () => ({
  pb: { collection: vi.fn(() => ({ getFullList: mockPersonsGetFullList })) },
}))

const mockFetchCamperJourney = vi.fn()
vi.mock('./fetchCamperJourney', () => ({
  fetchCamperJourney: (...args: unknown[]) => mockFetchCamperJourney(...args),
}))

const household = { value: { data: undefined as unknown, isPending: true, dataUpdatedAt: 0 } }
const housing = { value: { data: undefined as unknown, isPending: true, dataUpdatedAt: 0 } }
const mockUseHouseholdJourney = vi.fn((_id: number | null) => household.value)
const mockUsePersonHousing = vi.fn((_id: number | null) => housing.value)
vi.mock('../useWeekendRoster', () => ({
  useHouseholdJourney: (id: number | null) => mockUseHouseholdJourney(id),
  usePersonHousing: (id: number | null) => mockUsePersonHousing(id),
}))

const auth = { value: { isLoading: false } }
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth.value }))

let client: QueryClient

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/** Let pending promises and React Query's batched notifications land. */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const JOURNEY_ROW: HistoricalRecord = { year: 2024, sessionName: 'Session 2', sessionType: 'main' }

const personRow = (year: number, extra: Record<string, unknown> = {}) => ({
  year,
  household_id: 555,
  years_at_camp: 0,
  age: 43.01,
  ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  auth.value = { isLoading: false }
  household.value = { data: { years: [] }, isPending: false, dataUpdatedAt: 1 }
  housing.value = { data: { weekends: [] }, isPending: false, dataUpdatedAt: 1 }
  mockPersonsGetFullList.mockResolvedValue([personRow(YEAR)])
  mockFetchCamperJourney.mockResolvedValue({ rows: [], familyWeekends: 0, adultWeekends: 0 })
})

describe('personJourneyFacts', () => {
  it('takes summers from the most recent NON-ZERO years_at_camp — CampMinder zeroes it for adults', () => {
    const facts = personJourneyFacts(
      [personRow(2019, { years_at_camp: 1, age: 21.11 }), personRow(YEAR)],
      YEAR
    )
    expect(facts.summers).toBe(1)
  })

  it("ignores a LATER year's count when viewing an earlier year", () => {
    const rows = [personRow(2024, { years_at_camp: 2 }), personRow(YEAR, { years_at_camp: 5 })]
    expect(personJourneyFacts(rows, 2024).summers).toBe(2)
  })

  it('reads household and adulthood off the view-year row', () => {
    expect(personJourneyFacts([personRow(YEAR)], YEAR)).toEqual({
      householdId: 555,
      summers: 0,
      isAdult: true,
    })
    expect(personJourneyFacts([personRow(YEAR, { age: 12.04, household_id: 0 })], YEAR)).toEqual({
      householdId: null,
      summers: 0,
      isAdult: false,
    })
  })

  // CR #5 (kindred#2753): the old `?? newestFirst[0]` fallback picked the
  // NEWEST row whenever every row postdated viewYear, leaking a later year's
  // household/adulthood into an earlier view. There is no row "closest to
  // viewYear from below" here — there is no row below it at all — so the
  // correct view is NO row.
  it('uses no view row when every row postdates viewYear — never leaks a later household/adulthood', () => {
    const rows = [personRow(2027, { household_id: 999, age: 45 })]
    expect(personJourneyFacts(rows, 2026)).toEqual({
      householdId: null,
      summers: 0,
      isAdult: false,
    })
  })

  // M2 (review, kindred#2753): the mutation `>= ADULT_AGE` -> `>= 18`
  // survived every existing test because none used an age between 18 and
  // 21. This pins the raised cutoff (owner ruling 2026-09-22: 18 -> 21) so
  // a revert to 18 breaks a test here, not just prod.
  it('is not an adult at 19.11 — below the raised 21 cutoff', () => {
    expect(personJourneyFacts([personRow(YEAR, { age: 19.11 })], YEAR).isAdult).toBe(false)
  })
})

describe('useCamperJourney', () => {
  it("threads the person's household id into useHouseholdJourney", async () => {
    renderHook(() => useCamperJourney(PERSON, YEAR), { wrapper })
    await waitFor(() => expect(mockUseHouseholdJourney).toHaveBeenCalledWith(555))
  })

  it('withholds both protected reads while auth is still loading', async () => {
    // CR #6 (kindred#2753) also gates personQ itself on auth loading, so
    // there are no facts to wait on here any more — the whole read chain
    // starts from nothing while auth is pending. Ruled change: this test
    // used to wait for personQ to settle (it didn't gate on auth) before
    // checking the reads that DO depend on facts; now nothing in the chain
    // fires at all, so a plain flush is enough.
    auth.value = { isLoading: true }
    renderHook(() => useCamperJourney(PERSON, YEAR), { wrapper })
    await flush()
    expect(mockUseHouseholdJourney).not.toHaveBeenCalledWith(555)
    expect(mockUsePersonHousing).not.toHaveBeenCalledWith(PERSON)
    expect(mockFetchCamperJourney).not.toHaveBeenCalled()
  })

  // CR #6 (kindred#2753): personQ reads the `persons` collection, which
  // requires auth (`persons.listRule`) just like the household/housing reads
  // it feeds — but it was the one read in this hook not gated on
  // `isAuthLoading`, so a cached-but-stale or bypass-pending auth state could
  // send it out while auth is still settling.
  it("gates personQ's own persons fetch on auth loading, like its sibling reads", async () => {
    auth.value = { isLoading: true }
    const { rerender } = renderHook(() => useCamperJourney(PERSON, YEAR), { wrapper })
    await flush()
    expect(mockPersonsGetFullList).not.toHaveBeenCalled()

    auth.value = { isLoading: false }
    rerender()
    await waitFor(() => expect(mockPersonsGetFullList).toHaveBeenCalled())
  })

  it('does not run the feed while a housing read is still pending', async () => {
    housing.value = { data: undefined, isPending: true, dataUpdatedAt: 0 }
    renderHook(() => useCamperJourney(PERSON, YEAR), { wrapper })
    // Evidence the person's facts exist, so the feed gate is live.
    await waitFor(() => expect(mockUseHouseholdJourney).toHaveBeenCalledWith(555))
    await flush()
    expect(mockUsePersonHousing).toHaveBeenCalledWith(PERSON)
    expect(mockFetchCamperJourney).not.toHaveBeenCalled()
  })

  it('does not run the feed while the household read is still pending', async () => {
    household.value = { data: undefined, isPending: true, dataUpdatedAt: 0 }
    renderHook(() => useCamperJourney(PERSON, YEAR), { wrapper })
    await waitFor(() => expect(mockUseHouseholdJourney).toHaveBeenCalledWith(555))
    await flush()
    expect(mockFetchCamperJourney).not.toHaveBeenCalled()
  })

  it('runs the feed ONCE, with both housing inputs, after they settle', async () => {
    // Deliberate change from the old shape, which ran the feed
    // before housing arrived and again after, blanking the rows in between.
    const years = [{ year: 2024, housing: 'placed' }]
    const weekends = [
      { year: 2024, session_cm_id: 1001, cabin_name: 'River F', cabin_name_raw: 'River F' },
    ]
    // Q9 (owner, 2026-09-22 late): the same read carries the TLI/SCIT cabins
    // the registry resolves, and they travel with the adult list.
    const teenCabins = [
      { year: 2025, session_cm_id: 2001, cabin_name: 'Village Cabin 2', cabin_name_raw: 'Teen 2' },
    ]
    household.value = { data: { years }, isPending: false, dataUpdatedAt: 1 }
    housing.value = {
      data: { weekends, teen_cabins: teenCabins },
      isPending: false,
      dataUpdatedAt: 1,
    }

    renderHook(() => useCamperJourney(PERSON, YEAR), { wrapper })

    await waitFor(() => expect(mockFetchCamperJourney).toHaveBeenCalled())
    await flush()
    expect(mockFetchCamperJourney).toHaveBeenCalledTimes(1)
    expect(mockFetchCamperJourney).toHaveBeenCalledWith(PERSON, YEAR, {
      familyHousingYears: years,
      adultHousingWeekends: weekends,
      teenCabins,
      viewerIsAdult: true,
    })
  })

  it('runs the feed exactly once when housing settles AFTER the first render', async () => {
    const weekends = [
      { year: 2024, session_cm_id: 1001, cabin_name: 'River F', cabin_name_raw: 'River F' },
    ]
    housing.value = { data: undefined, isPending: true, dataUpdatedAt: 0 }
    const { rerender } = renderHook(() => useCamperJourney(PERSON, YEAR), { wrapper })
    await waitFor(() => expect(mockUseHouseholdJourney).toHaveBeenCalledWith(555))
    await flush()
    expect(mockFetchCamperJourney).not.toHaveBeenCalled()

    housing.value = { data: { weekends }, isPending: false, dataUpdatedAt: 1 }
    rerender()
    await waitFor(() => expect(mockFetchCamperJourney).toHaveBeenCalled())
    await flush()
    expect(mockFetchCamperJourney).toHaveBeenCalledTimes(1)
    expect(mockFetchCamperJourney.mock.calls[0]?.[2]).toMatchObject({
      adultHousingWeekends: weekends,
    })
  })

  it('reports loading while it waits for housing, and stops once the feed lands', async () => {
    housing.value = { data: undefined, isPending: true, dataUpdatedAt: 0 }
    const { result, rerender } = renderHook(() => useCamperJourney(PERSON, YEAR), { wrapper })
    await waitFor(() => expect(mockUseHouseholdJourney).toHaveBeenCalledWith(555))
    await flush()
    // A disabled feed is not "fetching" — without this, callers render an
    // empty journey instead of a loader while housing is in flight.
    expect(result.current.isLoading).toBe(true)

    housing.value = { data: { weekends: [] }, isPending: false, dataUpdatedAt: 1 }
    rerender()
    await waitFor(() => expect(result.current.isLoading).toBe(false))
  })

  it('keeps the rows on screen while a housing refetch re-runs the feed', async () => {
    mockFetchCamperJourney.mockResolvedValue({
      rows: [JOURNEY_ROW],
      familyWeekends: 0,
      adultWeekends: 0,
    })
    const { result, rerender } = renderHook(() => useCamperJourney(PERSON, YEAR), { wrapper })
    await waitFor(() => expect(result.current.rows).toEqual([JOURNEY_ROW]))

    // Hold the re-run in flight so the in-between render is observable.
    mockFetchCamperJourney.mockReturnValue(new Promise(() => {}))
    housing.value = { ...housing.value, dataUpdatedAt: 2 }
    rerender()
    await waitFor(() => expect(mockFetchCamperJourney).toHaveBeenCalledTimes(2))
    await flush()
    expect(result.current.rows).toEqual([JOURNEY_ROW])
  })

  it("never shows one person's rows while another person's journey loads", async () => {
    mockFetchCamperJourney.mockResolvedValue({
      rows: [JOURNEY_ROW],
      familyWeekends: 0,
      adultWeekends: 0,
    })
    const { result, rerender } = renderHook(({ id }) => useCamperJourney(id, YEAR), {
      wrapper,
      initialProps: { id: PERSON },
    })
    await waitFor(() => expect(result.current.rows).toEqual([JOURNEY_ROW]))

    mockFetchCamperJourney.mockReturnValue(new Promise(() => {}))
    rerender({ id: OTHER_PERSON })
    await waitFor(() =>
      expect(mockFetchCamperJourney).toHaveBeenCalledWith(OTHER_PERSON, YEAR, expect.anything())
    )
    await flush()
    expect(result.current.rows).toEqual([])
    expect(result.current.isLoading).toBe(true)
  })

  it("never shows the previous view year's rows while the new year loads", async () => {
    mockPersonsGetFullList.mockResolvedValue([personRow(YEAR), personRow(YEAR - 1)])
    mockFetchCamperJourney.mockResolvedValue({
      rows: [JOURNEY_ROW],
      familyWeekends: 0,
      adultWeekends: 0,
    })
    const { result, rerender } = renderHook(({ year }) => useCamperJourney(PERSON, year), {
      wrapper,
      initialProps: { year: YEAR },
    })
    await waitFor(() => expect(result.current.rows).toEqual([JOURNEY_ROW]))

    mockFetchCamperJourney.mockReturnValue(new Promise(() => {}))
    rerender({ year: YEAR - 1 })
    await waitFor(() =>
      expect(mockFetchCamperJourney).toHaveBeenCalledWith(PERSON, YEAR - 1, expect.anything())
    )
    await flush()
    expect(result.current.rows).toEqual([])
    expect(result.current.isLoading).toBe(true)
  })

  it('runs with no family housing when the person has no household', async () => {
    mockPersonsGetFullList.mockResolvedValue([personRow(YEAR, { household_id: 0 })])
    household.value = { data: undefined, isPending: true, dataUpdatedAt: 0 }
    renderHook(() => useCamperJourney(PERSON, YEAR), { wrapper })
    await waitFor(() => expect(mockFetchCamperJourney).toHaveBeenCalled())
    await flush()
    expect(mockFetchCamperJourney).toHaveBeenCalledTimes(1)
    expect(mockFetchCamperJourney.mock.calls[0]?.[2]).toMatchObject({ familyHousingYears: [] })
    expect(mockUseHouseholdJourney).toHaveBeenLastCalledWith(null)
  })

  it('composes counts from summers and the feed', async () => {
    mockPersonsGetFullList.mockResolvedValue([
      personRow(2019, { years_at_camp: 1 }),
      personRow(YEAR),
    ])
    mockFetchCamperJourney.mockResolvedValue({ rows: [], familyWeekends: 2, adultWeekends: 5 })
    const { result } = renderHook(() => useCamperJourney(PERSON, YEAR), { wrapper })
    await waitFor(() =>
      expect(result.current.counts).toEqual({ summers: 1, familyWeekends: 2, adultWeekends: 5 })
    )
  })

  // CR #7 (kindred#2753): the feed key carried both housing reads'
  // dataUpdatedAt but not `facts?.isAdult` / `facts?.householdId`, so a
  // persons refetch that flips adulthood (or moves the household) with
  // neither housing read also refreshing would leave the feed computed for
  // the WRONG viewerIsAdult until something else happened to bust the key.
  it('re-runs the feed when a persons refetch changes isAdult, even with housing unchanged', async () => {
    mockPersonsGetFullList.mockResolvedValue([personRow(YEAR, { age: 12.5 })])
    renderHook(() => useCamperJourney(PERSON, YEAR), { wrapper })
    await waitFor(() => expect(mockFetchCamperJourney).toHaveBeenCalledTimes(1))
    expect(mockFetchCamperJourney).toHaveBeenLastCalledWith(
      PERSON,
      YEAR,
      expect.objectContaining({ viewerIsAdult: false })
    )

    // Simulate a persons refetch that flips adulthood with NOTHING else
    // moving — household/housing dataUpdatedAt stay exactly as they were.
    mockPersonsGetFullList.mockResolvedValue([personRow(YEAR, { age: 25 })])
    await act(async () => {
      await client.invalidateQueries({ queryKey: queryKeys.personRecords(PERSON) })
    })
    await flush()

    await waitFor(() => expect(mockFetchCamperJourney).toHaveBeenCalledTimes(2))
    expect(mockFetchCamperJourney).toHaveBeenLastCalledWith(
      PERSON,
      YEAR,
      expect.objectContaining({ viewerIsAdult: true })
    )
  })

  it('reads nothing for no person', async () => {
    const { result } = renderHook(() => useCamperJourney(null, YEAR), { wrapper })
    await flush()
    expect(mockPersonsGetFullList).not.toHaveBeenCalled()
    expect(mockFetchCamperJourney).not.toHaveBeenCalled()
    expect(mockUsePersonHousing).toHaveBeenLastCalledWith(null)
    expect(mockUseHouseholdJourney).toHaveBeenLastCalledWith(null)
    expect(result.current.isLoading).toBe(false)
  })
})
