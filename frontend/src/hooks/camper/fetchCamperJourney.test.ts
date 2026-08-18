/**
 * Tests for fetchCamperJourney — the shared prior-year journey source.
 * TDD: written before implementation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchCamperJourney } from './fetchCamperJourney'

const mockAttendeesGetFullList = vi.fn()
const mockAssignmentsGetFullList = vi.fn()
const mockSessionsGetFullList = vi.fn()

vi.mock('../../lib/pocketbase', () => ({
  pb: {
    collection: vi.fn((name: string) => {
      if (name === 'attendees') return { getFullList: mockAttendeesGetFullList }
      if (name === 'bunk_assignments') return { getFullList: mockAssignmentsGetFullList }
      if (name === 'camp_sessions') return { getFullList: mockSessionsGetFullList }
      throw new Error(`Unexpected collection: ${name}`)
    }),
  },
}))

const PERSON = 12887873
const CURRENT_YEAR = 2026

function attendee(
  year: number,
  sessionCmId: number,
  sessionType: string,
  name: string,
  parentId?: number,
  startDate?: string
) {
  return {
    id: `att-${year}-${sessionCmId}`,
    person_id: PERSON,
    year,
    status: 'enrolled',
    expand: {
      session: {
        id: `sess-${sessionCmId}`,
        cm_id: sessionCmId,
        name,
        session_type: sessionType,
        ...(parentId !== undefined ? { parent_id: parentId } : {}),
        ...(startDate !== undefined ? { start_date: startDate } : {}),
      },
    },
  }
}

function assignment(
  year: number,
  sessionCmId: number | null,
  bunkName: string,
  sessionType?: string
) {
  return {
    id: `asn-${year}-${sessionCmId ?? 'x'}`,
    year,
    expand: {
      ...(sessionCmId !== null
        ? { session: { cm_id: sessionCmId, ...(sessionType ? { session_type: sessionType } : {}) } }
        : {}),
      bunk: { name: bunkName },
    },
  }
}

describe('fetchCamperJourney', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAttendeesGetFullList.mockResolvedValue([])
    mockAssignmentsGetFullList.mockResolvedValue([])
    mockSessionsGetFullList.mockResolvedValue([])
  })

  it('returns [] without querying when personCmId is falsy', async () => {
    const out = await fetchCamperJourney(0, CURRENT_YEAR)
    expect(out).toEqual([])
    expect(mockAttendeesGetFullList).not.toHaveBeenCalled()
  })

  it('sources rows from attendees and queries by year < currentYear, enrolled, curated types', async () => {
    // #2113: family camp was reversed into the journey set (was excluded to
    // mirror All Campers). bmitzvah/hebrew/adult/school/teen/other remain
    // excluded — CAMPER_JOURNEY_TYPES was widened, not opened up entirely.
    mockAttendeesGetFullList.mockResolvedValue([attendee(2023, 100, 'main', 'Session 3')])
    await fetchCamperJourney(PERSON, CURRENT_YEAR)
    const filter = String(mockAttendeesGetFullList.mock.calls[0]?.[0]?.filter ?? '')
    expect(filter).toContain(`person_id = ${PERSON}`)
    expect(filter).toContain(`year < ${CURRENT_YEAR}`)
    expect(filter).toContain('status = "enrolled"')
    expect(filter).toContain('session.session_type = "family"') // #2113: now included
    expect(filter).not.toContain('"bmitzvah"') // still excluded — not a journey type
    expect(filter).toContain('session.session_type = "scit"')
  })

  it('restricts the bunk_assignments query to journey session types (family included, others still excluded)', async () => {
    // The year-fallback attaches a lone same-year assignment to an unbunked
    // enrolled row when there's exactly one. Restricting the query to journey
    // session types stops a NON-journey type (e.g. bmitzvah) from leaking in
    // via that fallback — the same leak fb1a88d2 closed for current-year views
    // in useCamperEnrollment. Family is now a journey type (#2113), so a lone
    // family-camp bunk legitimately participates in the fallback like any
    // other journey type; bmitzvah/hebrew/adult/school/teen/other still can't.
    mockAttendeesGetFullList.mockResolvedValue([attendee(2022, 100, 'main', 'Session 3')])
    await fetchCamperJourney(PERSON, CURRENT_YEAR)
    const filter = String(mockAssignmentsGetFullList.mock.calls[0]?.[0]?.filter ?? '')
    expect(filter).toContain(`person.cm_id = ${PERSON}`)
    expect(filter).toContain(`year < ${CURRENT_YEAR}`)
    expect(filter).toContain('session.session_type = "family"')
    expect(filter).not.toContain('"bmitzvah"')
    expect(filter).toContain('session.session_type = "main"')
  })

  it('labels a row via exact (year, session) assignment match', async () => {
    mockAttendeesGetFullList.mockResolvedValue([attendee(2023, 100, 'main', 'Session 3')])
    mockAssignmentsGetFullList.mockResolvedValue([assignment(2023, 100, 'G-8B')])
    const out = await fetchCamperJourney(PERSON, CURRENT_YEAR)
    expect(out[0]).toMatchObject({ year: 2023, sessionName: 'Session 3', bunkName: 'G-8B' })
  })

  // Regression for #2113 code review: widening CAMPER_JOURNEY_TYPES to include
  // 'family' means a lone family-camp assignment can now appear in yearAssignments
  // for a year that also has a summer enrollment. The exact-match branch correctly
  // claims it for the family row — but the year-fallback (length===1) doesn't know
  // the assignment was already exact-matched elsewhere, and would attach the same
  // family bunk to the unrelated summer row too. This is the exact leak fb1a88d2
  // closed for current-year views (useCamperEnrollment) — reopening it here would
  // show a family lodging unit as if it were the camper's summer cabin.
  it('does not leak a lone family-camp assignment onto an unrelated summer row via the year-fallback', async () => {
    mockAttendeesGetFullList.mockResolvedValue([
      attendee(2019, 100, 'main', 'Session 2'),
      attendee(2019, 900, 'family', 'Winter Family Weekend'),
    ])
    mockAssignmentsGetFullList.mockResolvedValue([assignment(2019, 900, 'Cabin FC-2', 'family')])
    const out = await fetchCamperJourney(PERSON, CURRENT_YEAR)
    const main = out.find((r) => r.sessionName === 'Session 2')
    const family = out.find((r) => r.sessionName === 'Winter Family Weekend')
    expect(family?.bunkName).toBe('Cabin FC-2') // exact match — correct
    expect(main?.bunkName).toBeUndefined() // must NOT inherit the family bunk via fallback
  })

  it('still applies the year-fallback within summer/teen types (pre-existing behavior, unchanged)', async () => {
    // A quest enrollment with no exact-match bunk, and exactly one (non-family)
    // assignment that year for a different session — the fallback still fires,
    // same as before #2113 widened the type filter.
    mockAttendeesGetFullList.mockResolvedValue([attendee(2020, 500, 'quest', 'Quest Session')])
    mockAssignmentsGetFullList.mockResolvedValue([assignment(2020, 501, 'Q-Cabin', 'main')])
    const out = await fetchCamperJourney(PERSON, CURRENT_YEAR)
    expect(out[0]?.bunkName).toBe('Q-Cabin')
  })

  it('relabels an AG-only year to its parent main via camp_sessions lookup, keeping the AG bunk', async () => {
    // AG enrollment session cm_id 200 (parent main 199 NOT enrolled, so the AG row
    // survives). The bunk is filed under the AG session itself (exact match → AG-4).
    // The parent-main NAME comes from the camp_sessions lookup by (year, parent_id).
    mockAttendeesGetFullList.mockResolvedValue([attendee(2021, 200, 'ag', 'Session B (AG)', 199)])
    mockAssignmentsGetFullList.mockResolvedValue([assignment(2021, 200, 'AG-4')])
    mockSessionsGetFullList.mockResolvedValue([
      { year: 2021, cm_id: 199, name: 'Session B', session_type: 'main' },
    ])
    const out = await fetchCamperJourney(PERSON, CURRENT_YEAR)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      year: 2021,
      sessionType: 'main',
      sessionName: 'Session B',
      bunkName: 'AG-4',
    })
    const lookupFilter = String(mockSessionsGetFullList.mock.calls[0]?.[0]?.filter ?? '')
    expect(lookupFilter).toContain('cm_id = 199')
    expect(lookupFilter).toContain('year = 2021')
  })

  it('collapses a same-year Main + AG enrollment into one Main row', async () => {
    // AG (cm_id 101) is the child of the enrolled main (cm_id 100) → drop the AG
    // row, show the single Main row (carrying the bunk if any; none here).
    mockAttendeesGetFullList.mockResolvedValue([
      attendee(2023, 100, 'main', 'Session 2'),
      attendee(2023, 101, 'ag', 'Session 2 AG', 100),
    ])
    const out = await fetchCamperJourney(PERSON, CURRENT_YEAR)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ year: 2023, sessionType: 'main', sessionName: 'Session 2' })
  })

  // Regression for #2113 code review: cm_id and parent_id both default to 0
  // when unset (same sentinel agCollapse.ts guards against for current-year
  // enrollments). Without a `> 0` guard here, a cm_id-less session (cm_id 0)
  // seeds 0 into enrolledByYear, and an unrelated parentless AG row (parent_id
  // 0) would then match has(0) and get silently dropped from the journey.
  it('does not collapse a parentless AG row (parent_id 0) against an unrelated cm_id-less session (cm_id 0)', async () => {
    mockAttendeesGetFullList.mockResolvedValue([
      attendee(2023, 0, 'main', 'Session With No CM ID'),
      attendee(2023, 200, 'ag', 'Standalone AG Session', 0),
    ])
    const out = await fetchCamperJourney(PERSON, CURRENT_YEAR)
    expect(out).toHaveLength(2)
    expect(out.map((r) => r.sessionName)).toEqual(
      expect.arrayContaining(['Session With No CM ID', 'Standalone AG Session'])
    )
  })

  it('leaves a row unlabeled when its year has >=2 assignments and none match the session', async () => {
    mockAttendeesGetFullList.mockResolvedValue([attendee(2020, 300, 'embedded', 'Session X')])
    mockAssignmentsGetFullList.mockResolvedValue([
      assignment(2020, 301, 'Cabin 1'),
      assignment(2020, 302, 'Cabin 2'),
    ])
    const out = await fetchCamperJourney(PERSON, CURRENT_YEAR)
    expect(out[0]?.bunkName).toBeUndefined()
  })

  it('includes a no-assignment (e.g. 2022 gap / teen) year with no bunk label', async () => {
    mockAttendeesGetFullList.mockResolvedValue([
      attendee(2024, 400, 'scit', 'Counselor In-Training'),
      attendee(2022, 100, 'main', 'Session 3'),
    ])
    // CM export gap: no 2022 rows; teens may be unbunked
    mockAssignmentsGetFullList.mockResolvedValue([])
    const out = await fetchCamperJourney(PERSON, CURRENT_YEAR)
    expect(out.map((r) => r.year)).toEqual([2024, 2022]) // sorted -year
    for (const r of out) expect(r.bunkName).toBeUndefined()
  })

  it('sorts output by year descending regardless of input order', async () => {
    mockAttendeesGetFullList.mockResolvedValue([
      attendee(2019, 1, 'main', 'a'),
      attendee(2023, 2, 'main', 'b'),
      attendee(2021, 3, 'main', 'c'),
    ])
    const out = await fetchCamperJourney(PERSON, CURRENT_YEAR)
    expect(out.map((r) => r.year)).toEqual([2023, 2021, 2019])
  })
})

describe('ordering within a year', () => {
  /*
   * Owner report, 2026-08-18: a camper who went to Family Camp 1 in May, two
   * summer sessions in June and July, and Family Camp 6 in September read as
   * "2a, 3a, FC1, FC6" — summer first and both family weekends after it.
   *
   * The sort was `b.year - a.year` alone, so within a year the rows kept the
   * order the attendee fetch produced, which groups by program. The journey is
   * a chronology and must cross programs.
   */
  it('orders a year chronologically ACROSS programs, not program by program', async () => {
    mockAttendeesGetFullList.mockResolvedValue([
      attendee(2026, 201, 'embedded', 'Session 2a', undefined, '2026-06-14'),
      attendee(2026, 202, 'embedded', 'Session 3a', undefined, '2026-07-05'),
      attendee(2026, 101, 'family', 'Family Camp 1: Memorial Day Weekend', undefined, '2026-05-22'),
      attendee(2026, 106, 'family', 'Family Camp 6', undefined, '2026-09-24'),
    ])
    mockAssignmentsGetFullList.mockResolvedValue([])

    const out = await fetchCamperJourney(PERSON, 2027)

    expect(out.map((record) => record.sessionName)).toEqual([
      'Family Camp 1: Memorial Day Weekend',
      'Session 2a',
      'Session 3a',
      'Family Camp 6',
    ])
  })

  it('keeps a row with no start date LAST in its year, never first', async () => {
    // An empty string compares below every real date, so a naive comparator
    // floats an undated row to the top of its year — where it reads as the
    // first thing that happened.
    mockAttendeesGetFullList.mockResolvedValue([
      attendee(2026, 300, 'main', 'Undated Session'),
      attendee(2026, 101, 'family', 'Family Camp 1: Memorial Day Weekend', undefined, '2026-05-22'),
    ])
    mockAssignmentsGetFullList.mockResolvedValue([])

    const out = await fetchCamperJourney(PERSON, 2027)

    expect(out.map((record) => record.sessionName)).toEqual([
      'Family Camp 1: Memorial Day Weekend',
      'Undated Session',
    ])
  })

  it('still orders years newest first', async () => {
    mockAttendeesGetFullList.mockResolvedValue([
      attendee(2024, 101, 'family', 'Family Camp 1: Memorial Day Weekend', undefined, '2024-05-24'),
      attendee(2026, 101, 'family', 'Family Camp 1: Memorial Day Weekend', undefined, '2026-05-22'),
    ])
    mockAssignmentsGetFullList.mockResolvedValue([])

    const out = await fetchCamperJourney(PERSON, 2027)

    expect(out.map((record) => record.year)).toEqual([2026, 2024])
  })
})
