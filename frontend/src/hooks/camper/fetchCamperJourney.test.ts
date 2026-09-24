/**
 * fetchCamperJourney — the client half of the camper journey's one server
 * read (kindred#2776).
 *
 * The merge this file used to test moved to the server with its tests, one
 * for one: `tests/unit/api/services/test_camper_journey_service.py`. What is
 * left here is the wire: which URL, and how the server's snake_case row
 * becomes the `HistoricalRecord` every journey surface already renders.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiCamperJourneyResponse, ApiCamperJourneyRow } from '../../types/api-types'
import { fetchCamperJourney, fetchParentMainSessions } from './fetchCamperJourney'

// `fetchParentMainSessions` still reads PocketBase directly, for the
// CURRENT-year rows the client builds (`useCamperHistory`,
// `CamperDetailsPanel`). Both of those mock it, so these are its only tests.
const mockSessionsGetFullList = vi.hoisted(() => vi.fn())
vi.mock('../../lib/pocketbase', () => ({
  pb: {
    collection: vi.fn((name: string) => {
      if (name === 'camp_sessions') return { getFullList: mockSessionsGetFullList }
      throw new Error(`Unexpected collection: ${name}`)
    }),
  },
}))

// Every field of the generated row, so a field the server adds or drops is a
// compile error here rather than a value this mapping silently loses.
const FULL_ROW: Required<ApiCamperJourneyRow> = {
  year: 2024,
  session_name: 'Family Camp 2: Keshet Weekend',
  session_type: 'family',
  bunk_name: 'Meadow House 1',
  bunk_name_recorded: 'Old Meadow 1',
  start_date: '2024-05-24 00:00:00.000Z',
  end_date: '2024-05-26 00:00:00.000Z',
}

function ok(body: ApiCamperJourneyResponse) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response
}

function fetchReturning(body: ApiCamperJourneyResponse) {
  return vi.fn((_url: string, _options?: RequestInit) => Promise.resolve(ok(body)))
}

describe('fetchCamperJourney', () => {
  it('reads the one journey endpoint for the person and the viewed year', async () => {
    const fetchWithAuth = fetchReturning({})
    await fetchCamperJourney(fetchWithAuth, 3000001, 2026)
    expect(fetchWithAuth).toHaveBeenCalledTimes(1)
    expect(fetchWithAuth.mock.calls[0]?.[0]).toBe('/api/campers/3000001/journey?year=2026')
  })

  it('maps a server row onto the HistoricalRecord every journey surface renders', async () => {
    const { rows } = await fetchCamperJourney(fetchReturning({ rows: [FULL_ROW] }), 3000001, 2026)
    expect(rows).toEqual([
      {
        year: 2024,
        sessionName: 'Family Camp 2: Keshet Weekend',
        sessionType: 'family',
        bunkName: 'Meadow House 1',
        bunkNameRecorded: 'Old Meadow 1',
        startDate: '2024-05-24 00:00:00.000Z',
        endDate: '2024-05-26 00:00:00.000Z',
      },
    ])
  })

  it('leaves a field OFF the record where the server sends null, as the client merge did', async () => {
    const { rows } = await fetchCamperJourney(
      fetchReturning({
        rows: [
          {
            ...FULL_ROW,
            bunk_name: null,
            bunk_name_recorded: null,
            start_date: null,
            end_date: null,
          },
        ],
      }),
      3000001,
      2026
    )
    expect(rows[0]).toEqual({
      year: 2024,
      sessionName: 'Family Camp 2: Keshet Weekend',
      sessionType: 'family',
    })
    expect(Object.keys(rows[0] ?? {})).not.toContain('bunkName')
  })

  it('keeps an empty string the server sends — an unnamed bunk or an undated session is a value', async () => {
    const { rows } = await fetchCamperJourney(
      fetchReturning({ rows: [{ ...FULL_ROW, bunk_name: '', start_date: '', end_date: '' }] }),
      3000001,
      2026
    )
    expect(rows[0]).toMatchObject({ bunkName: '', startDate: '', endDate: '' })
  })

  it('maps the counts onto JourneyCounts', async () => {
    const { counts } = await fetchCamperJourney(
      fetchReturning({ counts: { summers: 4, family_weekends: 2, adult_weekends: 5 } }),
      3000001,
      2026
    )
    expect(counts).toEqual({ summers: 4, familyWeekends: 2, adultWeekends: 5 })
  })

  it('passes the teen cabins through for the current-year rows', async () => {
    const teen = {
      year: 2026,
      session_cm_id: 2001,
      cabin_name: 'Village Cabin 2',
      cabin_name_raw: 'Teen 2',
    }
    const { teenCabins } = await fetchCamperJourney(
      fetchReturning({ teen_cabins: [teen] }),
      3000001,
      2026
    )
    expect(teenCabins).toEqual([teen])
  })

  // kindred#2812: a parent's current-year family weekends — the one kind of
  // current-year row the client cannot build from live attendees — travel
  // beside the prior years, mapped the same way.
  it("maps a parent's current-year family rows apart from the prior years", async () => {
    const current = { ...FULL_ROW, year: 2026, bunk_name_recorded: null }
    const { rows, currentYearParentRows } = await fetchCamperJourney(
      fetchReturning({ rows: [FULL_ROW], current_year_parent_rows: [current] }),
      3000001,
      2026
    )
    expect(rows.map((r) => r.year)).toEqual([2024])
    expect(currentYearParentRows).toEqual([
      {
        year: 2026,
        sessionName: 'Family Camp 2: Keshet Weekend',
        sessionType: 'family',
        bunkName: 'Meadow House 1',
        startDate: '2024-05-24 00:00:00.000Z',
        endDate: '2024-05-26 00:00:00.000Z',
      },
    ])
  })

  it('passes the attributed adult cabins through for the current-year rows', async () => {
    const adult = {
      year: 2026,
      session_cm_id: 1001,
      cabin_name: 'Meadow House 1',
      cabin_name_raw: 'Old Meadow 1',
    }
    const { adultCabins } = await fetchCamperJourney(
      fetchReturning({ adult_cabins: [adult] }),
      3000001,
      2026
    )
    expect(adultCabins).toEqual([adult])
  })

  // Owner ruling 2026-09-24 (on #2814): the household's cabin per family
  // weekend, so a child's live current-year family row can show it.
  it("passes the household's family cabins through for the current-year rows", async () => {
    const family = {
      year: 2026,
      session_cm_id: 106,
      cabin_name: 'Meadow House 1',
      cabin_name_raw: 'Old Meadow 1',
    }
    const { familyCabins } = await fetchCamperJourney(
      fetchReturning({ family_cabins: [family] }),
      3000001,
      2026
    )
    expect(familyCabins).toEqual([family])
  })

  it('reads an empty payload as an empty journey', async () => {
    expect(await fetchCamperJourney(fetchReturning({}), 3000001, 2026)).toEqual({
      rows: [],
      currentYearParentRows: [],
      counts: { summers: 0, familyWeekends: 0, adultWeekends: 0 },
      teenCabins: [],
      adultCabins: [],
      familyCabins: [],
    })
  })

  it('throws on a failed read rather than returning an empty journey', async () => {
    const fetchWithAuth = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ detail: 'Internal server error' }),
      } as unknown as Response)
    )
    await expect(fetchCamperJourney(fetchWithAuth, 3000001, 2026)).rejects.toThrow()
  })
})

describe('fetchParentMainSessions', () => {
  beforeEach(() => {
    mockSessionsGetFullList.mockReset()
  })

  it('reads nothing for no pairs', async () => {
    const out = await fetchParentMainSessions([])
    expect(out.size).toBe(0)
    expect(mockSessionsGetFullList).not.toHaveBeenCalled()
  })

  it('reads every (year, cm_id) pair once, in one query — session ids are reused across years', async () => {
    mockSessionsGetFullList.mockResolvedValue([])
    await fetchParentMainSessions([
      { year: 2024, cmId: 100 },
      { year: 2024, cmId: 100 },
      { year: 2025, cmId: 100 },
    ])
    expect(mockSessionsGetFullList).toHaveBeenCalledTimes(1)
    const filter = (mockSessionsGetFullList.mock.calls[0]?.[0] as { filter: string }).filter
    expect(filter).toBe('(year = 2024 && cm_id = 100) || (year = 2025 && cm_id = 100)')
  })

  it('keys each session by year and cm_id, so one year never labels another', async () => {
    const s2024 = { year: 2024, cm_id: 100, name: 'Session 2' }
    const s2025 = { year: 2025, cm_id: 100, name: 'Session 3' }
    mockSessionsGetFullList.mockResolvedValue([s2024, s2025])
    const out = await fetchParentMainSessions([
      { year: 2024, cmId: 100 },
      { year: 2025, cmId: 100 },
    ])
    expect(out.get('2024:100')).toBe(s2024)
    expect(out.get('2025:100')).toBe(s2025)
    expect(out.size).toBe(2)
  })
})
