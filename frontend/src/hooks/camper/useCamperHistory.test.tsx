/**
 * Tests for useCamperHistory — merges live current-year records with the shared
 * prior-year fetcher, applying AG collapse/relabel to the current year too.
 * TDD: written before implementation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createWrapper, expectDefined } from '../../test/testUtils'
import { useCamperHistory } from './useCamperHistory'
import type { Camper } from '../../types/app-types'

const mockFetchCamperJourney = vi.fn()
const mockFetchParentMainSessions = vi.fn()
vi.mock('./fetchCamperJourney', () => ({
  fetchCamperJourney: (...args: unknown[]) => mockFetchCamperJourney(...args),
  fetchParentMainSessions: (...args: unknown[]) => mockFetchParentMainSessions(...args),
}))

// kindred#2466: useCamperHistory threads the household journey's `years`
// into fetchCamperJourney so a family-camp row can show the household's
// actual housing instead of the CampMinder day group. Mocked here (rather
// than exercising the real useHouseholdJourney -> useApiWithAuth -> useAuth
// chain) because `createWrapper()` provides no AuthProvider.
const mockUseHouseholdJourney = vi.fn()
vi.mock('../useWeekendRoster', () => ({
  useHouseholdJourney: (...args: unknown[]) => mockUseHouseholdJourney(...args),
}))

const YEAR = 2026

function currentCamper(opts: {
  sessionCmId: number
  sessionType: string
  parentId?: number
  bunkName?: string
  name?: string
  startDate?: string
  householdId?: number
}): Camper {
  return {
    person_cm_id: 12887873,
    attendee_status: 'enrolled',
    session_cm_id: opts.sessionCmId,
    ...(opts.householdId !== undefined ? { household_id: opts.householdId } : {}),
    expand: {
      session: {
        cm_id: opts.sessionCmId,
        name: opts.name ?? `Session ${opts.sessionCmId}`,
        session_type: opts.sessionType,
        start_date: opts.startDate ?? '',
        end_date: '',
        ...(opts.parentId !== undefined ? { parent_id: opts.parentId } : {}),
      },
      assigned_bunk: opts.bunkName ? { name: opts.bunkName } : null,
    },
  } as unknown as Camper
}

describe('useCamperHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchCamperJourney.mockResolvedValue([])
    mockFetchParentMainSessions.mockResolvedValue(new Map())
    mockUseHouseholdJourney.mockReturnValue({ data: undefined })
  })

  // kindred#2466
  describe('household journey plumbing', () => {
    it('passes null to useHouseholdJourney when the camper has no household_id', async () => {
      const camper = currentCamper({ sessionCmId: 500, sessionType: 'main' })
      const { result } = renderHook(() => useCamperHistory(12887873, YEAR, camper, [camper]), {
        wrapper: createWrapper(),
      })
      await waitFor(() => expect(result.current.isLoading).toBe(false))
      expect(mockUseHouseholdJourney).toHaveBeenCalledWith(null)
    })

    it("threads the household's CampMinder id into useHouseholdJourney", async () => {
      const camper = currentCamper({ sessionCmId: 500, sessionType: 'main', householdId: 4200001 })
      const { result } = renderHook(() => useCamperHistory(12887873, YEAR, camper, [camper]), {
        wrapper: createWrapper(),
      })
      await waitFor(() => expect(result.current.isLoading).toBe(false))
      expect(mockUseHouseholdJourney).toHaveBeenCalledWith(4200001)
    })

    it('threads the resolved household journey years into fetchCamperJourney', async () => {
      const years = [
        { year: 2024, housing: 'placed', cabin_name: 'Cedar Lodge', housing_session_cm_id: 900 },
      ]
      mockUseHouseholdJourney.mockReturnValue({ data: { household_cm_id: 4200001, years } })
      const camper = currentCamper({ sessionCmId: 500, sessionType: 'main', householdId: 4200001 })
      const { result } = renderHook(() => useCamperHistory(12887873, YEAR, camper, [camper]), {
        wrapper: createWrapper(),
      })
      await waitFor(() => expect(result.current.isLoading).toBe(false))
      expect(mockFetchCamperJourney).toHaveBeenCalledWith(12887873, YEAR, years)
    })

    it('threads an empty array into fetchCamperJourney when no household journey has resolved yet', async () => {
      const camper = currentCamper({ sessionCmId: 500, sessionType: 'main', householdId: 4200001 })
      const { result } = renderHook(() => useCamperHistory(12887873, YEAR, camper, [camper]), {
        wrapper: createWrapper(),
      })
      await waitFor(() => expect(result.current.isLoading).toBe(false))
      expect(mockFetchCamperJourney).toHaveBeenCalledWith(12887873, YEAR, [])
    })
  })

  it('orders the CURRENT year chronologically across programs', async () => {
    /*
     * THE REPORTED DEFECT, and it lived here rather than in the fetcher.
     *
     * Prior-year rows arrive chronological by luck of the fetch order, so a
     * year-only sort preserved them and 2025 read correctly. The current
     * year's rows are built per-camper and grouped by program, and the same
     * sort preserved THAT — so 2026 read "2a, 3a, FC1, FC6" for a camper who
     * actually went to Family Camp 1 in May, two summer sessions in June and
     * July, and Family Camp 6 in September.
     */
    mockFetchCamperJourney.mockResolvedValue([])
    const campers = [
      currentCamper({
        sessionCmId: 201,
        sessionType: 'embedded',
        name: 'Session 2a',
        startDate: '2026-06-14',
      }),
      currentCamper({
        sessionCmId: 202,
        sessionType: 'embedded',
        name: 'Session 3a',
        startDate: '2026-07-05',
      }),
      currentCamper({
        sessionCmId: 101,
        sessionType: 'family',
        name: 'Family Camp 1: Memorial Day Weekend',
        startDate: '2026-05-22',
      }),
      currentCamper({
        sessionCmId: 106,
        sessionType: 'family',
        name: 'Family Camp 6',
        startDate: '2026-09-24',
      }),
    ]
    const { result } = renderHook(
      () => useCamperHistory(12887873, YEAR, campers[0] as Camper, campers),
      { wrapper: createWrapper() }
    )
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.camperHistory.map((r) => r.sessionName)).toEqual([
      'Family Camp 1: Memorial Day Weekend',
      'Session 2a',
      'Session 3a',
      'Family Camp 6',
    ])
  })

  it('merges current-year + prior fetcher rows and surfaces a 2022 gap year, sorted -year', async () => {
    mockFetchCamperJourney.mockResolvedValue([
      { year: 2023, sessionName: 'Session 3', sessionType: 'main', bunkName: 'G-8B' },
      { year: 2022, sessionName: 'Session 3', sessionType: 'main' }, // CM gap: no bunk
    ])
    const camper = currentCamper({ sessionCmId: 500, sessionType: 'main', bunkName: 'Cabin 5' })
    const { result } = renderHook(() => useCamperHistory(12887873, YEAR, camper, [camper]), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.camperHistory.map((r) => r.year)).toEqual([2026, 2023, 2022])
    const r2022 = expectDefined(result.current.camperHistory.find((r) => r.year === 2022))
    expect(r2022.bunkName).toBeUndefined()
  })

  it('does not stamp "Unassigned" on a current-year teen record', async () => {
    const teen = currentCamper({ sessionCmId: 700, sessionType: 'scit' })
    const { result } = renderHook(() => useCamperHistory(12887873, YEAR, teen, [teen]), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const current = expectDefined(result.current.camperHistory.find((r) => r.year === YEAR))
    expect(current.bunkName).toBeUndefined()
  })

  it('still stamps "Unassigned" on a current-year bunkable (main) record with no bunk', async () => {
    const unplaced = currentCamper({ sessionCmId: 500, sessionType: 'main' })
    const { result } = renderHook(() => useCamperHistory(12887873, YEAR, unplaced, [unplaced]), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const current = expectDefined(result.current.camperHistory.find((r) => r.year === YEAR))
    expect(current.bunkName).toBe('Unassigned')
  })

  it('collapses a current-year Main + AG enrollment into one Main row', async () => {
    const main = currentCamper({ sessionCmId: 100, sessionType: 'main' })
    const ag = currentCamper({ sessionCmId: 101, sessionType: 'ag', parentId: 100 })
    const { result } = renderHook(() => useCamperHistory(12887873, YEAR, main, [main, ag]), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const current = result.current.camperHistory.filter((r) => r.year === YEAR)
    expect(current).toHaveLength(1)
    expect(current[0]).toMatchObject({ sessionType: 'main', sessionName: 'Session 100' })
  })

  it('relabels a current-year AG-only camper to its parent main (never session_type ag)', async () => {
    const ag = currentCamper({ sessionCmId: 200, sessionType: 'ag', parentId: 199 })
    mockFetchParentMainSessions.mockResolvedValue(
      new Map([
        [
          '2026:199',
          {
            cm_id: 199,
            year: 2026,
            name: 'Session B',
            session_type: 'main',
            start_date: '',
            end_date: '',
          },
        ],
      ])
    )
    const { result } = renderHook(() => useCamperHistory(12887873, YEAR, ag, [ag]), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const current = expectDefined(result.current.camperHistory.find((r) => r.year === YEAR))
    expect(current.sessionType).toBe('main')
    expect(current.sessionName).toBe('Session B')
    expect(mockFetchParentMainSessions).toHaveBeenCalledWith([{ year: 2026, cmId: 199 }])
  })
})
