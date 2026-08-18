/**
 * The lodging API client must route through fetchWithAuth.
 *
 * The PocketBase JWT lives in localStorage, not in a cookie, so a raw
 * `fetch(url, { credentials: 'include' })` silently 401s on every protected
 * FastAPI endpoint. Services take fetchWithAuth as a parameter; they never
 * import it (see frontend/CLAUDE.md, "Auth — easy to get wrong").
 */
import { describe, expect, it, vi } from 'vitest'

import {
  fetchHouseholdMedical,
  fetchWeekendRoster,
  fetchWeekendSessions,
  fetchWeekendSummary,
  placeParty,
  setSlotMerge,
  setUnitAvailability,
  unplaceParty,
} from './lodgingApi'

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

describe('fetchWeekendSessions', () => {
  it('calls the sessions endpoint through fetchWithAuth with the year', async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ year: 2026, sessions: [] }))

    const result = await fetchWeekendSessions(mockFetch, 2026)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url] = mockFetch.mock.calls[0] as [string]
    expect(url).toBe('/api/lodging/sessions?year=2026')
    expect(result).toEqual({ year: 2026, sessions: [] })
  })

  it('throws with the status when the response is not ok', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    })

    await expect(fetchWeekendSessions(mockFetch, 2026)).rejects.toThrow(/401/)
  })
})

describe('fetchWeekendSummary', () => {
  it('asks for the whole year in one request', () => {
    // The lander used to call the roster once per weekend; that endpoint's
    // cost is dominated by year-scoped work identical across weekends.
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ year: 2026, weekends: [] }))

    return fetchWeekendSummary(mockFetch, 2026).then(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url] = mockFetch.mock.calls[0] as [string]
      expect(url).toBe('/api/lodging/summary?year=2026')
    })
  })

  it('surfaces a failure rather than rendering an empty lander', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    await expect(fetchWeekendSummary(mockFetch, 2026)).rejects.toThrow(/500/)
  })
})

describe('fetchWeekendRoster', () => {
  it('passes both year and session_cm_id, and omits an empty scenario', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        okResponse({ year: 2026, session_cm_id: 1000001, parties: [], units: [], counts: {} })
      )

    await fetchWeekendRoster(mockFetch, 2026, 1000001, '')

    const [url] = mockFetch.mock.calls[0] as [string]
    expect(url).toBe('/api/lodging/roster?year=2026&session_cm_id=1000001')
  })

  it('sends the scenario, because a dropped one silently reads the mirror', async () => {
    // The failure this pins is invisible rather than loud. `scenario` is
    // `Query("")` server-side, so a request that forgets it returns 200 with
    // the CampMinder mirror — staff would see a populated board, believe it
    // was their draft, and drag against rows no scenario owns.
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        okResponse({ year: 2026, session_cm_id: 1000001, parties: [], units: [], counts: {} })
      )

    await fetchWeekendRoster(mockFetch, 2026, 1000001, 'scn7x2k9qw3mnbv')

    const [url] = mockFetch.mock.calls[0] as [string]
    expect(url).toBe('/api/lodging/roster?year=2026&session_cm_id=1000001&scenario=scn7x2k9qw3mnbv')
  })

  it('surfaces a FastAPI HTTPException detail when the body has one', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({
        detail: 'No family or adult session with CampMinder id 9999999 in 2026',
      }),
    })

    await expect(fetchWeekendRoster(mockFetch, 2026, 9999999, '')).rejects.toThrow(
      /No family or adult session with CampMinder id 9999999/
    )
  })
})

describe('placeParty', () => {
  const WEEKEND = { year: 2026, sessionCmId: 1000001, scenario: 'scn7x2k9qw3mnbv' }

  it('POSTs the party grain, the scenario and the unit set', async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ ok: true }))

    await placeParty(mockFetch, {
      ...WEEKEND,
      grain: { household_cm_id: 2000001 },
      unitIds: ['u1'],
    })

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/lodging/placements')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body as string)).toEqual({
      year: 2026,
      session_cm_id: 1000001,
      scenario: 'scn7x2k9qw3mnbv',
      household_cm_id: 2000001,
      unit_ids: ['u1'],
    })
  })

  it('sends person_cm_id alone for an adult weekend', async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ ok: true }))

    await placeParty(mockFetch, { ...WEEKEND, grain: { person_cm_id: 5150 }, unitIds: ['u1'] })

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body).not.toHaveProperty('household_cm_id')
    expect(body.person_cm_id).toBe(5150)
  })

  it('never sends an empty unit set, which the server rejects as a 422', async () => {
    // An empty `unit_ids` used to be the TOMBSTONE — "unplaced in this
    // scenario". kindred#1974 retired it: unplacing is now DELETE, and the
    // schema pins `min_length=1`. Catching it here turns a confusing rollback
    // into a caller bug. HANDOFF instructed exactly this mistake until #1974
    // and has since been corrected; the guard outlives the bad instruction.
    const mockFetch = vi.fn()

    await expect(
      placeParty(mockFetch, { ...WEEKEND, grain: { household_cm_id: 2000001 }, unitIds: [] })
    ).rejects.toThrow(/at least one unit/i)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('carries the status of a rejected write so the card can roll back with a reason', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ detail: 'Permission required: bunking.manage' }),
    })

    await expect(
      placeParty(mockFetch, { ...WEEKEND, grain: { household_cm_id: 2000001 }, unitIds: ['u1'] })
    ).rejects.toMatchObject({ status: 403, message: 'Permission required: bunking.manage' })
  })
})

describe('unplaceParty', () => {
  const WEEKEND = { year: 2026, sessionCmId: 1000001, scenario: 'scn7x2k9qw3mnbv' }

  it('DELETEs with the party grain in the body', async () => {
    // DELETE with a body, not a query string: the endpoint takes
    // `PlacementDeleteRequest`. `fetch` sends a DELETE body fine; it is the
    // shape the server declares that decides this, not convention.
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ ok: true }))

    await unplaceParty(mockFetch, { ...WEEKEND, grain: { household_cm_id: 2000001 } })

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/lodging/placements')
    expect(options.method).toBe('DELETE')
    expect(JSON.parse(options.body as string)).toEqual({
      year: 2026,
      session_cm_id: 1000001,
      scenario: 'scn7x2k9qw3mnbv',
      household_cm_id: 2000001,
    })
  })

  it('surfaces the failure detail', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ detail: 'No placement to remove' }),
    })

    await expect(
      unplaceParty(mockFetch, { ...WEEKEND, grain: { household_cm_id: 2000001 } })
    ).rejects.toThrow(/No placement to remove/)
  })
})

describe('setUnitAvailability', () => {
  const WEEKEND = { year: 2026, sessionCmId: 1000001, unitId: 'u1' }

  it('PUTs the weekend, the unit and the explicit boolean', async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ record_id: 'r1', deleted: false }))

    const result = await setUnitAvailability(mockFetch, {
      ...WEEKEND,
      familyAvailable: false,
      occupantName: 'Emma Johnson',
      reason: 'Kitchen lead, Fri–Sun',
    })

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/lodging/availability')
    expect(options.method).toBe('PUT')
    // No scenario. The endpoint takes none since 1500000135, and sending one
    // would be a 422 against a model that no longer extends ScenarioWriteRequest.
    //
    // `occupant_name` travels under the column's own name (kindred#2078);
    // only `reason` is renamed on the wire, and only because 1500000135 reused
    // a `note` column that already existed.
    expect(JSON.parse(options.body as string)).toEqual({
      year: 2026,
      session_cm_id: 1000001,
      unit_id: 'u1',
      family_available: false,
      occupant_name: 'Emma Johnson',
      reason: 'Kitchen lead, Fri–Sun',
    })
    expect(result).toEqual({ record_id: 'r1', deleted: false })
  })

  it('sends a write-in as an explicit false, never as a missing field', async () => {
    // THE trap. `false` and `null` are different answers — false is "closed
    // this weekend", null DELETES the row and hands the question back to the
    // unit's role. Any falsy handling on the way out (`|| null`, a spread that
    // drops it, `familyAvailable ? ... : undefined`) turns "hold this cabin"
    // into "clear the override", and the write reads as a no-op that staff
    // only notice when a family arrives at a cabin somebody else is sleeping in.
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ record_id: 'r1', deleted: false }))

    await setUnitAvailability(mockFetch, {
      ...WEEKEND,
      familyAvailable: false,
      occupantName: 'Emma Johnson',
      reason: '',
    })

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body).toHaveProperty('family_available')
    expect(body.family_available).toBe(false)
  })

  it('clears with an explicit null and reports the row as deleted', async () => {
    // `null` is how "whatever this unit's role says" is spelled. There is no
    // value meaning "normal": writing one would pin the unit against a later
    // change to its role. `deleted` is the caller's only way to tell a cleared
    // override from a written one.
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ record_id: '', deleted: true }))

    const result = await setUnitAvailability(mockFetch, {
      ...WEEKEND,
      familyAvailable: null,
      occupantName: '',
      reason: '',
    })

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.family_available).toBeNull()
    expect(result.deleted).toBe(true)
  })

  it('carries the status of a refused write so the card can say why', async () => {
    // The endpoint is gated on `bunking.manage`. The control is gated on the
    // same permission, so a 403 here means the token expired mid-session
    // rather than that the user never had it — which is a different sentence.
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ detail: 'Permission required: bunking.manage' }),
    })

    await expect(
      setUnitAvailability(mockFetch, {
        ...WEEKEND,
        familyAvailable: true,
        occupantName: '',
        reason: 'Overflow',
      })
    ).rejects.toMatchObject({ status: 403, message: 'Permission required: bunking.manage' })
  })
})

describe('setSlotMerge', () => {
  const WEEKEND = { year: 2026, session_cm_id: 1000001, scenario: 'scn7x2k9qw3mnbv', unit_id: 'u7' }

  it('PUTs the weekend, the scenario, the container and the combined flag', async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ record_id: 'u7', deleted: false }))

    const result = await setSlotMerge(mockFetch, { ...WEEKEND, combined: true })

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/lodging/merge')
    expect(options.method).toBe('PUT')
    expect(JSON.parse(options.body as string)).toEqual({
      year: 2026,
      session_cm_id: 1000001,
      scenario: 'scn7x2k9qw3mnbv',
      unit_id: 'u7',
      combined: true,
    })
    expect(result).toEqual({ record_id: 'u7', deleted: false })
  })

  it('sends a split as an explicit false, never a missing field', async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ record_id: 'u7', deleted: false }))

    await setSlotMerge(mockFetch, { ...WEEKEND, combined: false })

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body).toHaveProperty('combined')
    expect(body.combined).toBe(false)
  })

  it('carries the status of a refused write so the card can say why', async () => {
    // A blank `scenario` is NOT what gets refused — it is the legal
    // weekend-level row (1500000140), and the case above pins that it is sent
    // rather than withheld. This is about surfacing whatever the server does
    // refuse, so the body names a refusal the API can still make.
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ detail: 'Unit is required' }),
    })

    await expect(
      setSlotMerge(mockFetch, { ...WEEKEND, unit_id: '', combined: true })
    ).rejects.toMatchObject({
      status: 422,
      message: 'Unit is required',
    })
  })
})

describe('fetchHouseholdMedical', () => {
  it('hits the `bunking.manage`-gated medical endpoint through fetchWithAuth', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(okResponse({ household_cm_id: 2000001, year: 2026 }))

    await fetchHouseholdMedical(mockFetch, 2026, 2000001)

    const [url] = mockFetch.mock.calls[0] as [string]
    expect(url).toBe('/api/lodging/households/2000001/medical?year=2026')
  })

  it('reports a 403 clearly so the UI can show a permission message', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ detail: 'Permission required: bunking.manage' }),
    })

    await expect(fetchHouseholdMedical(mockFetch, 2026, 2000001)).rejects.toThrow(/bunking\.manage/)
  })
})
