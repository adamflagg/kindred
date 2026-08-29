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
  deleteWriteIn,
  executeWriteInPush,
  fetchHouseholdMedical,
  fetchPushPreview,
  fetchWeekendRoster,
  fetchWeekendSessions,
  fetchWeekendSummary,
  placeParty,
  setSlotMerge,
  setUnitAvailability,
  unplaceParty,
  unpushWriteIns,
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
  const WEEKEND = { year: 2026, sessionCmId: 1000001, unitId: 'u1', scenario: '' }

  it('PUTs the weekend, the unit and the explicit boolean', async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ record_id: 'r1', deleted: false }))

    const result = await setUnitAvailability(mockFetch, {
      ...WEEKEND,
      familyAvailable: false,
      occupantName: 'Emma Johnson',
      reason: 'Kitchen lead, Fri–Sun',
      partySize: null,
      previousOccupantName: null,
    })

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/lodging/availability')
    expect(options.method).toBe('PUT')
    // The scenario travels, and travels BLANK here — blank is the live board,
    // a scope in its own right, not a missing value (kindred#2382 PR 4). It is
    // sent rather than omitted for the same reason `family_available: false` is:
    // a key dropped on the way out is indistinguishable from a key nobody set.
    //
    // `occupant_name` travels under the column's own name (kindred#2078);
    // only `reason` is renamed on the wire, and only because 1500000135 reused
    // a `note` column that already existed. `party_size` is `null` here for
    // the same reason — a key dropped is indistinguishable from a key nobody
    // set, and `null` is a real, common answer (kindred#2503), not a missing
    // one.
    expect(JSON.parse(options.body as string)).toEqual({
      year: 2026,
      session_cm_id: 1000001,
      scenario: '',
      unit_id: 'u1',
      family_available: false,
      occupant_name: 'Emma Johnson',
      reason: 'Kitchen lead, Fri–Sun',
      party_size: null,
      // kindred#2583 step 4. `null` is "this write renames nobody" and is the
      // create path's answer; a string is the pencil's compare-and-swap. Sent
      // rather than omitted for the reason every other field here is: a key
      // dropped on the way out is indistinguishable from a key nobody set,
      // and here the two mean different verbs.
      previous_occupant_name: null,
    })
    expect(result).toEqual({ record_id: 'r1', deleted: false })
  })

  it('sends the recorded party size, never dropping it on the way to the wire', async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ record_id: 'r1', deleted: false }))

    await setUnitAvailability(mockFetch, {
      ...WEEKEND,
      familyAvailable: false,
      occupantName: 'Emma Johnson',
      reason: '',
      partySize: 3,
      previousOccupantName: null,
    })

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.party_size).toBe(3)
  })

  it('sends the scenario staff are looking at, so the write lands on that board', async () => {
    // THE regression this closes. Reads REPLACE since kindred#2382 PR 3, so a
    // write-in recorded inside a scenario and written to the LIVE table is
    // replaced away by that scenario's own read — the staff member does not see
    // the write-in on the board they just made it on.
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ record_id: 'r1', deleted: false }))

    await setUnitAvailability(mockFetch, {
      ...WEEKEND,
      scenario: 'scn7x2k9qw3mnbv',
      familyAvailable: false,
      occupantName: 'Emma Johnson',
      reason: '',
      partySize: null,
      previousOccupantName: null,
    })

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.scenario).toBe('scn7x2k9qw3mnbv')
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
      partySize: null,
      previousOccupantName: null,
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
      partySize: null,
      previousOccupantName: null,
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
        partySize: null,
        previousOccupantName: null,
      })
    ).rejects.toMatchObject({ status: 403, message: 'Permission required: bunking.manage' })
  })
})

describe('setUnitAvailability — renaming one occupant', () => {
  const WEEKEND = { year: 2026, sessionCmId: 1000001, unitId: 'u1', scenario: '' }

  it('sends the name the form LOADED, so the server resolves that row', async () => {
    // kindred#2583 step 4. Under Design B the occupant's name IS the row's
    // address, so an edit that changes it cannot address itself: a write
    // carrying only the new name misses the occupant-keyed finder, and the
    // moment step 8 narrows the index that miss is a CREATE — one rename
    // leaving two rows with the old occupant still in the cabin.
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ record_id: 'r1', deleted: false }))

    await setUnitAvailability(mockFetch, {
      ...WEEKEND,
      familyAvailable: false,
      occupantName: 'Emma Johnston',
      reason: '',
      partySize: null,
      previousOccupantName: 'Emma Johnson',
    })

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.previous_occupant_name).toBe('Emma Johnson')
    expect(body.occupant_name).toBe('Emma Johnston')
  })

  it('sends a BLANK previous name as a name, not as an absence', async () => {
    // `''` addresses the row whose occupant is unnamed — real and reachable,
    // because the ingest path stays permissive — and its pencil can make no
    // other edit, since the form refuses to save a blank name. A
    // blank-as-absent sentinel would leave exactly that row doing the bare
    // rename this field exists to forbid.
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ record_id: 'r1', deleted: false }))

    await setUnitAvailability(mockFetch, {
      ...WEEKEND,
      familyAvailable: false,
      occupantName: 'Emma Johnson',
      reason: '',
      partySize: null,
      previousOccupantName: '',
    })

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.previous_occupant_name).toBe('')
  })
})

describe('deleteWriteIn', () => {
  const WEEKEND = { year: 2026, sessionCmId: 1000001, scenario: '' }

  it('DELETEs the row addressed by its unit and its occupant', async () => {
    // kindred#2583 step 7's verb, wired up by step 4. `PUT /availability`
    // with `family_available: null` stays CLEAR-THIS-UNIT-ENTIRELY — role row
    // plus every occupancy row — which is why the corner × cannot send it any
    // more: the moment step 8 narrows the index, one click would take the
    // co-occupant with it.
    //
    // DELETE with a body, as `unplaceParty` above: the row is named by values
    // the client already holds and its record id is not among them (Design A,
    // which would have published one, was declined).
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ record_id: 'wi1', deleted: true }))

    const result = await deleteWriteIn(mockFetch, {
      ...WEEKEND,
      unitId: 'u1',
      occupantName: 'Emma Johnson',
    })

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/lodging/write-ins')
    expect(options.method).toBe('DELETE')
    expect(JSON.parse(options.body as string)).toEqual({
      year: 2026,
      session_cm_id: 1000001,
      scenario: '',
      unit_id: 'u1',
      occupant_name: 'Emma Johnson',
    })
    expect(result).toEqual({ record_id: 'wi1', deleted: true })
  })

  it('sends the scenario staff are looking at, so the removal lands on that board', async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ record_id: 'wd1', deleted: true }))

    await deleteWriteIn(mockFetch, {
      ...WEEKEND,
      scenario: 'scn7x2k9qw3mnbv',
      unitId: 'u1',
      occupantName: 'Emma Johnson',
    })

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.scenario).toBe('scn7x2k9qw3mnbv')
  })

  it('surfaces the failure detail', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ detail: 'Weekend 1000001 not found for 2026' }),
    })

    await expect(
      deleteWriteIn(mockFetch, { ...WEEKEND, unitId: 'u1', occupantName: 'Emma Johnson' })
    ).rejects.toThrow(/Weekend 1000001 not found/)
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

describe('fetchPushPreview', () => {
  it('GETs the preview with year, session_cm_id and an encoded scenario', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      okResponse({
        year: 2026,
        session_cm_id: 1000001,
        scenario: 'scn7x2k9qw3mnbv',
        digest: 'd'.repeat(64),
        buildings: [],
      })
    )

    const result = await fetchPushPreview(mockFetch, {
      year: 2026,
      sessionCmId: 1000001,
      scenario: 'scn7x2k9qw3mnbv',
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url] = mockFetch.mock.calls[0] as [string]
    expect(url).toBe(
      '/api/lodging/push/preview?year=2026&session_cm_id=1000001&scenario=scn7x2k9qw3mnbv'
    )
    expect(result.digest).toBe('d'.repeat(64))
  })

  it('encodes a scenario id with characters that need escaping', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      okResponse({
        year: 2026,
        session_cm_id: 1000001,
        scenario: 'scn a/b',
        digest: 'd'.repeat(64),
        buildings: [],
      })
    )

    await fetchPushPreview(mockFetch, { year: 2026, sessionCmId: 1000001, scenario: 'scn a/b' })

    const [url] = mockFetch.mock.calls[0] as [string]
    expect(url).toBe(
      '/api/lodging/push/preview?year=2026&session_cm_id=1000001&scenario=scn%20a%2Fb'
    )
  })

  it('surfaces the FastAPI detail on a plain failure', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({
        detail: 'No family or adult session with CampMinder id 9999999 in 2026',
      }),
    })

    await expect(
      fetchPushPreview(mockFetch, { year: 2026, sessionCmId: 9999999, scenario: 'scn1' })
    ).rejects.toThrow(/No family or adult session with CampMinder id 9999999/)
  })
})

describe('executeWriteInPush', () => {
  const BASE = {
    year: 2026,
    sessionCmId: 1000001,
    scenario: 'scn7x2k9qw3mnbv',
    digest: 'd'.repeat(64),
  }

  it('POSTs year, session_cm_id, scenario, digest and decisions verbatim', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      okResponse({
        push_id: 'pu1',
        added: 1,
        removed: 0,
        replaced: 1,
        kept: 0,
        matched: 3,
        no_op: false,
      })
    )

    const result = await executeWriteInPush(mockFetch, {
      ...BASE,
      decisions: { 'cedar-9': 'scenario', 'aspen-5': 'remove' },
    })

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/lodging/push')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body as string)).toEqual({
      year: 2026,
      session_cm_id: 1000001,
      scenario: 'scn7x2k9qw3mnbv',
      digest: 'd'.repeat(64),
      decisions: { 'cedar-9': 'scenario', 'aspen-5': 'remove' },
    })
    expect(result).toEqual({
      push_id: 'pu1',
      added: 1,
      removed: 0,
      replaced: 1,
      kept: 0,
      matched: 3,
      no_op: false,
    })
  })

  it('sends an empty decisions object rather than omitting it, when nothing needs one', async () => {
    // A `conflict`/`remove` building needs a decision; `add`/`match` never do.
    // Omitting the key on a push with no decisions would be indistinguishable
    // from a caller that forgot the field entirely — sending `{}` explicitly
    // is what tells the server "reviewed, nothing to decide" rather than
    // "the client didn't populate this".
    const mockFetch = vi.fn().mockResolvedValue(
      okResponse({
        push_id: '',
        added: 0,
        removed: 0,
        replaced: 0,
        kept: 1,
        matched: 0,
        no_op: true,
      })
    )

    await executeWriteInPush(mockFetch, { ...BASE, decisions: {} })

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body).toHaveProperty('decisions')
    expect(body.decisions).toEqual({})
  })

  it('exposes the parsed stale report on a 409, not just a bare status', async () => {
    // `execute_push` refuses with a FRESH report the moment its own digest
    // check disagrees. The UI (Task 10) replaces its cached preview with
    // `error.detail.report` — losing the object here would mean it can only
    // say "409" and never show what actually changed.
    const staleReport = {
      year: 2026,
      session_cm_id: 1000001,
      scenario: 'scn7x2k9qw3mnbv',
      digest: 'e'.repeat(64),
      buildings: [],
    }
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ detail: { reason: 'stale', report: staleReport } }),
    })

    await expect(executeWriteInPush(mockFetch, { ...BASE, decisions: {} })).rejects.toMatchObject({
      status: 409,
      detail: { reason: 'stale', report: staleReport },
    })
  })

  it('surfaces a 422 as the plain string FastAPI validation sends', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ detail: 'scenario must not be blank' }),
    })

    await expect(
      executeWriteInPush(mockFetch, { ...BASE, scenario: '', decisions: {} })
    ).rejects.toMatchObject({ status: 422, message: 'scenario must not be blank' })
  })
})

describe('unpushWriteIns', () => {
  it('POSTs to the unpush endpoint with year and session_cm_id as query params', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(okResponse({ push_id: 'pu1', restored: 1, deleted: 2 }))

    const result = await unpushWriteIns(mockFetch, {
      pushId: 'pu1',
      year: 2026,
      sessionCmId: 1000001,
    })

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/lodging/push/pu1/unpush?year=2026&session_cm_id=1000001')
    expect(options.method).toBe('POST')
    expect(result).toEqual({ push_id: 'pu1', restored: 1, deleted: 2 })
  })

  it('exposes the already_unpushed reason on a 409, with no report to carry', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ detail: { reason: 'already_unpushed' } }),
    })

    await expect(
      unpushWriteIns(mockFetch, { pushId: 'pu1', year: 2026, sessionCmId: 1000001 })
    ).rejects.toMatchObject({ status: 409, detail: { reason: 'already_unpushed' } })
  })

  it('exposes the drifted building names on a 409-drift', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ detail: { reason: 'drift', buildings: ['Cedar 9', 'Aspen 5'] } }),
    })

    await expect(
      unpushWriteIns(mockFetch, { pushId: 'pu1', year: 2026, sessionCmId: 1000001 })
    ).rejects.toMatchObject({
      status: 409,
      detail: { reason: 'drift', buildings: ['Cedar 9', 'Aspen 5'] },
    })
  })

  it('surfaces a 404 for an unknown push id', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ detail: 'push pu404 not found' }),
    })

    await expect(
      unpushWriteIns(mockFetch, { pushId: 'pu404', year: 2026, sessionCmId: 1000001 })
    ).rejects.toThrow(/push pu404 not found/)
  })
})
