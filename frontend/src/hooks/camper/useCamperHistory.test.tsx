/**
 * Tests for useCamperHistory — merges live current-year records with the shared
 * journey feed's prior years, applying AG collapse/relabel to the current year too.
 * TDD: written before implementation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createWrapper, expectDefined } from '../../test/testUtils'
import { useCamperHistory } from './useCamperHistory'
import type { CabinLabel } from './teenCabinLabel'
import type { Camper } from '../../types/app-types'
import type { HistoricalRecord, JourneyCounts } from './types'

const mockFetchParentMainSessions = vi.fn()
vi.mock('./fetchCamperJourney', () => ({
  fetchParentMainSessions: (...args: unknown[]) => mockFetchParentMainSessions(...args),
}))

// Prior years + header counts come from the one shared journey feed
// (useCamperJourney). Its own household/auth/housing plumbing is
// tested in useCamperJourney.test.tsx; here it is a plain source of rows.
let priorRows: HistoricalRecord[] = []
let journeyCounts: JourneyCounts = { summers: 0, familyWeekends: 0, adultWeekends: 0 }
// Q9 for CURRENT-year rows (owner ruling 2026-09-22, late): the registry-
// resolved TLI/SCIT map travels alongside the feed's rows/counts.
let teenCabinsByWeekend: Map<string, CabinLabel> = new Map()
// kindred#2812: a parent's current-year family rows (the one current-year row
// no live attendee builds) and the attributed adult cabins.
let currentYearParentRows: HistoricalRecord[] = []
let adultCabinsByWeekend: Map<string, CabinLabel> = new Map()
let familyCabinsByWeekend: Map<string, CabinLabel> = new Map()
const mockUseCamperJourney = vi.fn()
vi.mock('./useCamperJourney', () => ({
  useCamperJourney: (...args: unknown[]) => mockUseCamperJourney(...args),
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
    person_cm_id: 8000101,
    attendee_status: 'enrolled',
    session_cm_id: opts.sessionCmId,
    // CR #4 fixture fidelity: production Camper rows always carry a
    // top-level `assigned_bunk` PB relation id (useCamperEnrollment.ts:156,
    // `assignedBunk?.id ?? ''`) alongside the display name under `expand`.
    // The stale-key test needs this field to actually MOVE alongside the
    // bunk change it's pinning.
    assigned_bunk: opts.bunkName ? `bunk-${opts.bunkName}` : '',
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
    priorRows = []
    journeyCounts = { summers: 0, familyWeekends: 0, adultWeekends: 0 }
    teenCabinsByWeekend = new Map()
    currentYearParentRows = []
    adultCabinsByWeekend = new Map()
    familyCabinsByWeekend = new Map()
    mockUseCamperJourney.mockImplementation(() => ({
      rows: priorRows,
      currentYearParentRows,
      counts: journeyCounts,
      isLoading: false,
      error: null,
      teenCabinsByWeekend,
      adultCabinsByWeekend,
      familyCabinsByWeekend,
    }))
    mockFetchParentMainSessions.mockResolvedValue(new Map())
  })

  it('reads the shared journey feed for the person and year', async () => {
    const camper = currentCamper({ sessionCmId: 500, sessionType: 'main' })
    const { result } = renderHook(() => useCamperHistory(8000101, YEAR, camper, [camper]), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(mockUseCamperJourney).toHaveBeenCalledWith(8000101, YEAR)
  })

  it("returns the shared feed's counts for the header count line", async () => {
    journeyCounts = { summers: 3, familyWeekends: 1, adultWeekends: 2 }
    const camper = currentCamper({ sessionCmId: 500, sessionType: 'main' })
    const { result } = renderHook(() => useCamperHistory(8000101, YEAR, camper, [camper]), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.counts).toEqual({ summers: 3, familyWeekends: 1, adultWeekends: 2 })
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
    priorRows = []
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
      () => useCamperHistory(8000101, YEAR, campers[0] as Camper, campers),
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
    priorRows = [
      { year: 2023, sessionName: 'Session 3', sessionType: 'main', bunkName: 'G-8B' },
      { year: 2022, sessionName: 'Session 3', sessionType: 'main' }, // CM gap: no bunk
    ]
    const camper = currentCamper({ sessionCmId: 500, sessionType: 'main', bunkName: 'Cabin 5' })
    const { result } = renderHook(() => useCamperHistory(8000101, YEAR, camper, [camper]), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.camperHistory.map((r) => r.year)).toEqual([2026, 2023, 2022])
    const r2022 = expectDefined(result.current.camperHistory.find((r) => r.year === 2022))
    expect(r2022.bunkName).toBeUndefined()
  })

  it('does not stamp "Unassigned" on a current-year teen record', async () => {
    const teen = currentCamper({ sessionCmId: 700, sessionType: 'scit' })
    const { result } = renderHook(() => useCamperHistory(8000101, YEAR, teen, [teen]), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const current = expectDefined(result.current.camperHistory.find((r) => r.year === YEAR))
    expect(current.bunkName).toBeUndefined()
  })

  // Q9 for CURRENT-year rows (owner ruling 2026-09-22, late): commit 6f205252
  // applied the registry-only rule to PRIOR years via the server's
  // teen_cabins. The current year still showed the raw CampMinder bunk (a
  // program group, or Quest's trip name) until now.
  it('hides a current-year SCIT bunk the registry does not resolve (a program group)', async () => {
    const scit = currentCamper({ sessionCmId: 700, sessionType: 'scit', bunkName: 'SCIT A' })
    const { result } = renderHook(() => useCamperHistory(8000101, YEAR, scit, [scit]), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const current = expectDefined(result.current.camperHistory.find((r) => r.year === YEAR))
    expect(current.bunkName).toBeUndefined()
    expect(current.bunkNameRecorded).toBeUndefined()
  })

  it('shows the registry cabin for a resolved current-year teen row, with the as-typed name on hover', async () => {
    teenCabinsByWeekend = new Map([
      [`${String(YEAR)}:700`, { cabinName: 'Village Cabin 2', cabinNameRaw: 'Teen 2' }],
    ])
    const teen = currentCamper({ sessionCmId: 700, sessionType: 'tli', bunkName: 'Teen 2' })
    const { result } = renderHook(() => useCamperHistory(8000101, YEAR, teen, [teen]), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const current = expectDefined(result.current.camperHistory.find((r) => r.year === YEAR))
    expect(current.bunkName).toBe('Village Cabin 2')
    expect(current.bunkNameRecorded).toBe('Teen 2')
  })

  it('never shows a cabin for a current-year Quest record, even with an assigned bunk', async () => {
    const quest = currentCamper({ sessionCmId: 900, sessionType: 'quest', bunkName: 'Trip Name' })
    const { result } = renderHook(() => useCamperHistory(8000101, YEAR, quest, [quest]), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const current = expectDefined(result.current.camperHistory.find((r) => r.year === YEAR))
    expect(current.bunkName).toBeUndefined()
    expect(current.bunkNameRecorded).toBeUndefined()
  })

  it('still stamps "Unassigned" on a current-year bunkable (main) record with no bunk', async () => {
    const unplaced = currentCamper({ sessionCmId: 500, sessionType: 'main' })
    const { result } = renderHook(() => useCamperHistory(8000101, YEAR, unplaced, [unplaced]), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const current = expectDefined(result.current.camperHistory.find((r) => r.year === YEAR))
    expect(current.bunkName).toBe('Unassigned')
  })

  it('collapses a current-year Main + AG enrollment into one Main row', async () => {
    const main = currentCamper({ sessionCmId: 100, sessionType: 'main' })
    const ag = currentCamper({ sessionCmId: 101, sessionType: 'ag', parentId: 100 })
    const { result } = renderHook(() => useCamperHistory(8000101, YEAR, main, [main, ag]), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const current = result.current.camperHistory.filter((r) => r.year === YEAR)
    expect(current).toHaveLength(1)
    expect(current[0]).toMatchObject({ sessionType: 'main', sessionName: 'Session 100' })
  })

  // CR #4 (kindred#2753): the old key was `['camper-current-year-rows',
  // personCmId, currentYear, camper?.expand?.session, camper?.expand?.assigned_bunk,
  // allAttendees?.length]` — a SECONDARY attendee's status/session/bunk
  // change never moved the key at all (only its own object refs and
  // `.length` could), so a real-world change like this one would leave the
  // cached rows stale until something unrelated forced a refetch.
  it("re-runs when a secondary attendee's status/bunk changes even though the count and primary camper stay the same", async () => {
    const primary = currentCamper({ sessionCmId: 500, sessionType: 'main', bunkName: 'Cabin 5' })
    const secondaryBefore = currentCamper({ sessionCmId: 600, sessionType: 'main' })
    const { result, rerender } = renderHook(
      ({ attendees }: { attendees: Camper[] }) =>
        useCamperHistory(8000101, YEAR, primary, attendees),
      { wrapper: createWrapper(), initialProps: { attendees: [primary, secondaryBefore] } }
    )
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const row600Before = result.current.camperHistory.find((r) => r.sessionName === 'Session 600')
    expect(row600Before?.bunkName).toBe('Unassigned')

    // Same length, same primary camper — only the secondary attendee's own
    // bunk changed.
    const secondaryAfter = currentCamper({
      sessionCmId: 600,
      sessionType: 'main',
      bunkName: 'Cabin 9',
    })
    rerender({ attendees: [primary, secondaryAfter] })

    await waitFor(() => {
      const row600 = result.current.camperHistory.find((r) => r.sessionName === 'Session 600')
      expect(row600?.bunkName).toBe('Cabin 9')
    })
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
    const { result } = renderHook(() => useCamperHistory(8000101, YEAR, ag, [ag]), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const current = expectDefined(result.current.camperHistory.find((r) => r.year === YEAR))
    expect(current.sessionType).toBe('main')
    expect(current.sessionName).toBe('Session B')
    expect(mockFetchParentMainSessions).toHaveBeenCalledWith([{ year: 2026, cmId: 199 }])
  })

  // ==========================================================================
  // kindred#2812 (owner rulings 2026-09-24): the current year, everywhere.
  // ==========================================================================

  it("shows a 2026 parent's household weekends FC1 and FC6 with their cabins, and counts what it shows", async () => {
    // Her own current-year attendee row is WW alone: a parent has no
    // family-camp attendee row, so FC1 and FC6 come from the feed.
    journeyCounts = { summers: 0, familyWeekends: 2, adultWeekends: 1 }
    currentYearParentRows = [
      {
        year: YEAR,
        sessionName: 'Family Camp 1: Memorial Day Weekend',
        sessionType: 'family',
        bunkName: 'Cedar Lodge',
        startDate: '2026-05-22',
      },
      {
        year: YEAR,
        sessionName: 'Family Camp 6',
        sessionType: 'family',
        bunkName: 'Meadow House 1',
        bunkNameRecorded: 'Old Meadow 1',
        startDate: '2026-09-18',
      },
    ]
    adultCabinsByWeekend = new Map([
      [`${String(YEAR)}:1001`, { cabinName: 'River F', cabinNameRaw: 'River F' }],
    ])
    const ww = currentCamper({
      sessionCmId: 1001,
      sessionType: 'adult',
      name: "Women's Weekend",
      startDate: '2026-07-10',
    })
    const { result } = renderHook(() => useCamperHistory(8000101, YEAR, ww, [ww]), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    const current = result.current.camperHistory.filter((r) => r.year === YEAR)
    expect(current.map((r) => [r.sessionName, r.bunkName])).toEqual([
      ['Family Camp 1: Memorial Day Weekend', 'Cedar Lodge'],
      ["Women's Weekend", 'River F'],
      ['Family Camp 6', 'Meadow House 1'],
    ])
    const history = result.current.camperHistory
    expect(history.filter((r) => r.sessionType === 'family')).toHaveLength(
      result.current.counts.familyWeekends
    )
    expect(history.filter((r) => r.sessionType === 'adult')).toHaveLength(
      result.current.counts.adultWeekends
    )
  })

  it('labels a current-year adult row with the attributed registry name, never its raw bunk', async () => {
    adultCabinsByWeekend = new Map([
      [`${String(YEAR)}:1001`, { cabinName: 'Meadow House 1', cabinNameRaw: 'Old Meadow 1' }],
    ])
    const ww = currentCamper({
      sessionCmId: 1001,
      sessionType: 'adult',
      name: "Women's Weekend",
      bunkName: 'Raw Bunk',
    })
    const { result } = renderHook(() => useCamperHistory(8000101, YEAR, ww, [ww]), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    const current = result.current.camperHistory.filter((r) => r.year === YEAR)
    expect(current).toHaveLength(1)
    expect(current[0]).toMatchObject({
      sessionName: "Women's Weekend",
      bunkName: 'Meadow House 1',
      bunkNameRecorded: 'Old Meadow 1',
    })
  })

  it('shows a current-year adult row with no cabin when none has been typed yet', async () => {
    const ww = currentCamper({
      sessionCmId: 1001,
      sessionType: 'adult',
      name: "Women's Weekend",
      bunkName: 'Raw Bunk',
    })
    const { result } = renderHook(() => useCamperHistory(8000101, YEAR, ww, [ww]), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    const current = expectDefined(result.current.camperHistory.find((r) => r.year === YEAR))
    expect(current.sessionName).toBe("Women's Weekend")
    expect(current.bunkName).toBeUndefined()
  })

  // Owner ruling 2026-09-24 (on #2814): "there's no reason not to".
  it("shows a child's current-year FC1 and FC6 with the household cabin their parent's rows show", async () => {
    familyCabinsByWeekend = new Map([
      [`${String(YEAR)}:101`, { cabinName: 'Cedar Lodge', cabinNameRaw: 'Cedar Lodge' }],
      [`${String(YEAR)}:106`, { cabinName: 'Meadow House 1', cabinNameRaw: 'Old Meadow 1' }],
    ])
    const campers = [
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
        startDate: '2026-09-18',
      }),
    ]
    const { result } = renderHook(
      () => useCamperHistory(8000101, YEAR, campers[0] as Camper, campers),
      { wrapper: createWrapper() }
    )
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(
      result.current.camperHistory.map((r) => [r.sessionName, r.bunkName, r.bunkNameRecorded])
    ).toEqual([
      ['Family Camp 1: Memorial Day Weekend', 'Cedar Lodge', undefined],
      ['Family Camp 6', 'Meadow House 1', 'Old Meadow 1'],
    ])
  })

  it('shows no cabin on a current-year family weekend the household has none for', async () => {
    const fc6 = currentCamper({
      sessionCmId: 106,
      sessionType: 'family',
      name: 'Family Camp 6',
      bunkName: 'Acorns',
    })
    const { result } = renderHook(() => useCamperHistory(8000101, YEAR, fc6, [fc6]), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    const current = expectDefined(result.current.camperHistory.find((r) => r.year === YEAR))
    expect(current.bunkName).toBeUndefined()
  })

  it('shows two summer sessions in one year as two rows, even in the same cabin', async () => {
    priorRows = [
      { year: 2025, sessionName: 'Session 2a', sessionType: 'embedded', bunkName: 'B-2' },
    ]
    const campers = [
      currentCamper({
        sessionCmId: 201,
        sessionType: 'embedded',
        name: 'Session 2a',
        startDate: '2026-06-14',
        bunkName: 'B-1',
      }),
      currentCamper({
        sessionCmId: 301,
        sessionType: 'embedded',
        name: 'Session 3a',
        startDate: '2026-07-05',
        bunkName: 'B-1',
      }),
    ]
    const { result } = renderHook(
      () => useCamperHistory(8000101, YEAR, campers[0] as Camper, campers),
      { wrapper: createWrapper() }
    )
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.camperHistory.map((r) => [r.year, r.sessionName, r.bunkName])).toEqual([
      [YEAR, 'Session 2a', 'B-1'],
      [YEAR, 'Session 3a', 'B-1'],
      [2025, 'Session 2a', 'B-2'],
    ])
  })
})
