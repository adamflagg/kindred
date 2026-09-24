/**
 * fetchCamperJourney — the client half of the camper journey's one server
 * read (kindred#2776).
 *
 * The merge this file used to test moved to the server with its tests, one
 * for one: `tests/unit/api/services/test_camper_journey_service.py`. What is
 * left here is the wire: which URL, and how the server's snake_case row
 * becomes the `HistoricalRecord` every journey surface already renders.
 */
import { describe, expect, it, vi } from 'vitest'

import type { ApiCamperJourneyResponse, ApiCamperJourneyRow } from '../../types/api-types'
import { fetchCamperJourney } from './fetchCamperJourney'

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

  it('reads an empty payload as an empty journey', async () => {
    expect(await fetchCamperJourney(fetchReturning({}), 3000001, 2026)).toEqual({
      rows: [],
      counts: { summers: 0, familyWeekends: 0, adultWeekends: 0 },
      teenCabins: [],
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
