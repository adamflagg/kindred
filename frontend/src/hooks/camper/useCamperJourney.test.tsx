/**
 * useCamperJourney — the one feed every journey surface reads (spec §5.3).
 * It absorbs the household plumbing useCamperHistory's tests used to pin.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { personJourneyFacts, useCamperJourney } from './useCamperJourney'

const PERSON = 3000001
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

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

const personRow = (year: number, extra: Record<string, unknown> = {}) => ({
  year,
  household_id: 555,
  years_at_camp: 0,
  age: 43.01,
  ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
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
})

describe('useCamperJourney', () => {
  it("threads the person's household id into useHouseholdJourney", async () => {
    renderHook(() => useCamperJourney(PERSON, YEAR), { wrapper })
    await waitFor(() => expect(mockUseHouseholdJourney).toHaveBeenCalledWith(555))
  })

  it('withholds both protected reads while auth is still loading', async () => {
    auth.value = { isLoading: true }
    renderHook(() => useCamperJourney(PERSON, YEAR), { wrapper })
    await waitFor(() => expect(mockPersonsGetFullList).toHaveBeenCalled())
    expect(mockUseHouseholdJourney).not.toHaveBeenCalledWith(555)
    expect(mockUsePersonHousing).not.toHaveBeenCalledWith(PERSON)
    expect(mockFetchCamperJourney).not.toHaveBeenCalled()
  })

  it('does not run the feed while a housing read is still pending', async () => {
    housing.value = { data: undefined, isPending: true, dataUpdatedAt: 0 }
    renderHook(() => useCamperJourney(PERSON, YEAR), { wrapper })
    await waitFor(() => expect(mockUsePersonHousing).toHaveBeenCalledWith(PERSON))
    expect(mockFetchCamperJourney).not.toHaveBeenCalled()
  })

  it('runs the feed ONCE, with both housing inputs, after they settle', async () => {
    // SPEC CHANGE (adult camper journey §5.3): the old shape ran the feed
    // before housing arrived and again after, blanking the rows in between.
    const years = [{ year: 2024, housing: 'placed' }]
    const weekends = [
      { year: 2024, session_cm_id: 1001, cabin_name: 'River F', cabin_name_raw: 'River F' },
    ]
    household.value = { data: { years }, isPending: false, dataUpdatedAt: 1 }
    housing.value = { data: { weekends }, isPending: false, dataUpdatedAt: 1 }

    renderHook(() => useCamperJourney(PERSON, YEAR), { wrapper })

    await waitFor(() => expect(mockFetchCamperJourney).toHaveBeenCalledTimes(1))
    expect(mockFetchCamperJourney).toHaveBeenCalledWith(PERSON, YEAR, {
      familyHousingYears: years,
      adultHousingWeekends: weekends,
      viewerIsAdult: true,
    })
  })

  it('runs with no family housing when the person has no household', async () => {
    mockPersonsGetFullList.mockResolvedValue([personRow(YEAR, { household_id: 0 })])
    household.value = { data: undefined, isPending: true, dataUpdatedAt: 0 }
    renderHook(() => useCamperJourney(PERSON, YEAR), { wrapper })
    await waitFor(() => expect(mockFetchCamperJourney).toHaveBeenCalledTimes(1))
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

  it('reads nothing for no person', () => {
    renderHook(() => useCamperJourney(null, YEAR), { wrapper })
    expect(mockPersonsGetFullList).not.toHaveBeenCalled()
    expect(mockFetchCamperJourney).not.toHaveBeenCalled()
  })
})
