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

const PERSON = 8000101
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
    const { rows: out } = await fetchCamperJourney(0, CURRENT_YEAR)
    expect(out).toEqual([])
    expect(mockAttendeesGetFullList).not.toHaveBeenCalled()
  })

  it('sources rows from attendees and queries by year <= currentYear, enrolled, curated types', async () => {
    // #2113: family camp was reversed into the journey set (was excluded to
    // mirror All Campers). Adult programs joined it too, for adult guests'
    // journeys; bmitzvah/hebrew/school/teen/other remain excluded —
    // CAMPER_JOURNEY_TYPES was widened, not opened up entirely.
    // The read now runs THROUGH the current year so the header counts include
    // it; the rows themselves stay prior-year (pinned below).
    mockAttendeesGetFullList.mockResolvedValue([attendee(2023, 100, 'main', 'Session 3')])
    await fetchCamperJourney(PERSON, CURRENT_YEAR)
    const filter = String(mockAttendeesGetFullList.mock.calls[0]?.[0]?.filter ?? '')
    expect(filter).toContain(`person_id = ${PERSON}`)
    expect(filter).toContain(`year <= ${CURRENT_YEAR}`)
    expect(filter).toContain('status = "enrolled"')
    expect(filter).toContain('session.session_type = "family"') // #2113: now included
    expect(filter).toContain('session.session_type = "adult"')
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
    // other journey type; bmitzvah/hebrew/school/teen/other still can't.
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
    const { rows: out } = await fetchCamperJourney(PERSON, CURRENT_YEAR)
    expect(out[0]).toMatchObject({ year: 2023, sessionName: 'Session 3', bunkName: 'G-8B' })
  })

  // Regression for #2113 code review: widening CAMPER_JOURNEY_TYPES to include
  // 'family' means a lone family-camp assignment can now appear in yearAssignments
  // for a year that also has a summer enrollment. The exact-match branch used to
  // claim it for the family row — but the year-fallback (length===1) doesn't know
  // the assignment was already exact-matched elsewhere, and would attach the same
  // family bunk to the unrelated summer row too. This is the exact leak fb1a88d2
  // closed for current-year views (useCamperEnrollment) — reopening it here would
  // show a family lodging unit as if it were the camper's summer cabin.
  //
  // kindred#2466 UPDATED this test's family-row expectation: the family row's
  // `bunk_assignments` exact match ('Cabin FC-2') is now the CampMinder day
  // group, and is unconditionally dropped rather than shown — see the
  // dedicated 'kindred#2466' describe block below for the replacement
  // (household-housing) behavior. What this test still pins is the leak
  // guard: the main row must never inherit ANY family-session assignment via
  // the fallback, day-group or otherwise.
  it('does not leak a lone family-camp assignment onto an unrelated summer row via the year-fallback', async () => {
    mockAttendeesGetFullList.mockResolvedValue([
      attendee(2019, 100, 'main', 'Session 2'),
      attendee(2019, 900, 'family', 'Winter Family Weekend'),
    ])
    mockAssignmentsGetFullList.mockResolvedValue([assignment(2019, 900, 'Cabin FC-2', 'family')])
    const { rows: out } = await fetchCamperJourney(PERSON, CURRENT_YEAR)
    const main = out.find((r) => r.sessionName === 'Session 2')
    const family = out.find((r) => r.sessionName === 'Winter Family Weekend')
    // Day group dropped — no household housing was supplied, so no label at all.
    expect(family?.bunkName).toBeUndefined()
    expect(main?.bunkName).toBeUndefined() // must NOT inherit the family bunk via fallback
  })

  // RULED CHANGE (owner, 2026-09-22 late, Q9): this test used a QUEST row to
  // pin the fallback, and Quest rows never show a cabin now (their "bunk" is
  // a trip name). The fallback itself is unchanged, so it is pinned on an
  // embedded row instead.
  it('still applies the year-fallback within summer types (pre-existing behavior, unchanged)', async () => {
    // An embedded enrollment with no exact-match bunk, and exactly one
    // (non-family) assignment that year for a different session — the
    // fallback still fires, same as before #2113 widened the type filter.
    mockAttendeesGetFullList.mockResolvedValue([attendee(2020, 500, 'embedded', 'Session X')])
    mockAssignmentsGetFullList.mockResolvedValue([assignment(2020, 501, 'Q-Cabin', 'main')])
    const { rows: out } = await fetchCamperJourney(PERSON, CURRENT_YEAR)
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
    const { rows: out } = await fetchCamperJourney(PERSON, CURRENT_YEAR)
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
    const { rows: out } = await fetchCamperJourney(PERSON, CURRENT_YEAR)
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
    const { rows: out } = await fetchCamperJourney(PERSON, CURRENT_YEAR)
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
    const { rows: out } = await fetchCamperJourney(PERSON, CURRENT_YEAR)
    expect(out[0]?.bunkName).toBeUndefined()
  })

  it('includes a no-assignment (e.g. 2022 gap / teen) year with no bunk label', async () => {
    mockAttendeesGetFullList.mockResolvedValue([
      attendee(2024, 400, 'scit', 'Counselor In-Training'),
      attendee(2022, 100, 'main', 'Session 3'),
    ])
    // CM export gap: no 2022 rows; teens may be unbunked
    mockAssignmentsGetFullList.mockResolvedValue([])
    const { rows: out } = await fetchCamperJourney(PERSON, CURRENT_YEAR)
    expect(out.map((r) => r.year)).toEqual([2024, 2022]) // sorted -year
    for (const r of out) expect(r.bunkName).toBeUndefined()
  })

  it('sorts output by year descending regardless of input order', async () => {
    mockAttendeesGetFullList.mockResolvedValue([
      attendee(2019, 1, 'main', 'a'),
      attendee(2023, 2, 'main', 'b'),
      attendee(2021, 3, 'main', 'c'),
    ])
    const { rows: out } = await fetchCamperJourney(PERSON, CURRENT_YEAR)
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

    const { rows: out } = await fetchCamperJourney(PERSON, 2027)

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

    const { rows: out } = await fetchCamperJourney(PERSON, 2027)

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

    const { rows: out } = await fetchCamperJourney(PERSON, 2027)

    expect(out.map((record) => record.year)).toEqual([2026, 2024])
  })
})

// kindred#2466: the housing slot on a family-camp row shows the household's
// ACTUAL HOUSING, resolved from its own family-camp journey, never the
// CampMinder day group `bunk_assignments` matches on a family session.
// `fetchCamperJourney`'s `options.familyHousingYears` is the household journey's
// `years` (`HouseholdJourneyYear[]`, kindred#2073/#2461) — the caller already
// has this from `useHouseholdJourney`, so no new fetch happens here.
describe('family-camp housing (kindred#2466)', () => {
  interface FamilyHousingYearOverrides {
    year?: number
    housing?: 'placed' | 'not_placed' | 'unknown'
    cabin_name?: string
    cabin_name_raw?: string
    housing_session_cm_id?: number | null
  }

  function familyHousingYear(overrides: FamilyHousingYearOverrides = {}) {
    return {
      year: 2024,
      housing: 'placed' as const,
      cabin_name: 'Cedar Lodge',
      cabin_name_raw: 'Cedar Lodge',
      housing_session_cm_id: 900,
      ...overrides,
    }
  }

  it('drops the day group entirely when no household housing is supplied', async () => {
    mockAttendeesGetFullList.mockResolvedValue([
      attendee(2024, 900, 'family', 'Family Camp 2: Keshet Weekend'),
    ])
    // A day-group bunk_assignments row exists (it always does, per the
    // production data) but must never surface as `bunkName`.
    mockAssignmentsGetFullList.mockResolvedValue([
      assignment(2024, 900, 'Acorns (with parents)', 'family'),
    ])
    const { rows: out } = await fetchCamperJourney(PERSON, CURRENT_YEAR)
    expect(out[0]?.bunkName).toBeUndefined()
  })

  it("shows the household cabin name when the year unambiguously attributes it to this row's session", async () => {
    mockAttendeesGetFullList.mockResolvedValue([
      attendee(2024, 900, 'family', 'Family Camp 2: Keshet Weekend'),
    ])
    mockAssignmentsGetFullList.mockResolvedValue([
      assignment(2024, 900, 'Acorns (with parents)', 'family'),
    ])
    const { rows: out } = await fetchCamperJourney(PERSON, CURRENT_YEAR, {
      familyHousingYears: [familyHousingYear()],
    })
    expect(out[0]).toMatchObject({ year: 2024, bunkName: 'Cedar Lodge' })
  })

  it('declines when the year attributes housing to a DIFFERENT weekend (ambiguous multi-weekend year)', async () => {
    mockAttendeesGetFullList.mockResolvedValue([
      attendee(2024, 900, 'family', 'Family Camp 2: Keshet Weekend'),
      attendee(2024, 901, 'family', 'Family Camp 5'),
    ])
    mockAssignmentsGetFullList.mockResolvedValue([])
    // housing_session_cm_id names session 900 only — session 901 gets nothing.
    const { rows: out } = await fetchCamperJourney(PERSON, CURRENT_YEAR, {
      familyHousingYears: [familyHousingYear({ housing_session_cm_id: 900 })],
    })
    const keshet = out.find((r) => r.sessionName === 'Family Camp 2: Keshet Weekend')
    const fc5 = out.find((r) => r.sessionName === 'Family Camp 5')
    expect(keshet?.bunkName).toBe('Cedar Lodge')
    expect(fc5?.bunkName).toBeUndefined()
  })

  // RULED CHANGE (owner, 2026-09-22 late): this test used to pin "no label"
  // for a placed year whose cabin is not pinned to one weekend — a household
  // that attended 2+ weekends that season, where kindred#2461 declines to say
  // which weekend CampMinder's one per-year value describes. The owner: "just
  // show the same cabin for all… it's not helpful to show nothing; no one
  // will care if historical data is wrong." So EVERY family weekend that
  // season now carries the season's cabin.
  it('labels EVERY family weekend of a placed season whose cabin is not pinned to one weekend', async () => {
    mockAttendeesGetFullList.mockResolvedValue([
      attendee(2024, 900, 'family', 'Family Camp 2: Keshet Weekend'),
      attendee(2024, 901, 'family', 'Family Camp 5'),
    ])
    mockAssignmentsGetFullList.mockResolvedValue([])
    const { rows: out } = await fetchCamperJourney(PERSON, CURRENT_YEAR, {
      familyHousingYears: [
        familyHousingYear({ housing_session_cm_id: null, cabin_name_raw: 'Old Cedar' }),
      ],
    })
    const keshet = out.find((r) => r.sessionName === 'Family Camp 2: Keshet Weekend')
    const fc5 = out.find((r) => r.sessionName === 'Family Camp 5')
    // The provenance tooltip travels the same way as on a pinned year.
    expect(keshet).toMatchObject({ bunkName: 'Cedar Lodge', bunkNameRecorded: 'Old Cedar' })
    expect(fc5).toMatchObject({ bunkName: 'Cedar Lodge', bunkNameRecorded: 'Old Cedar' })
  })

  it('still labels nothing for an unpinned season with no cabin', async () => {
    mockAttendeesGetFullList.mockResolvedValue([
      attendee(2024, 900, 'family', 'Family Camp 2: Keshet Weekend'),
    ])
    mockAssignmentsGetFullList.mockResolvedValue([])
    const { rows: out } = await fetchCamperJourney(PERSON, CURRENT_YEAR, {
      familyHousingYears: [familyHousingYear({ housing_session_cm_id: null, cabin_name: '  ' })],
    })
    expect(out[0]?.bunkName).toBeUndefined()
  })

  it('never lets an unpinned season label a non-family row', async () => {
    mockAttendeesGetFullList.mockResolvedValue([attendee(2024, 500, 'main', 'Session 3')])
    mockAssignmentsGetFullList.mockResolvedValue([])
    const { rows: out } = await fetchCamperJourney(PERSON, CURRENT_YEAR, {
      familyHousingYears: [familyHousingYear({ housing_session_cm_id: null })],
    })
    expect(out[0]?.bunkName).toBeUndefined()
  })

  it('declines when the year is not placed', async () => {
    mockAttendeesGetFullList.mockResolvedValue([
      attendee(2024, 900, 'family', 'Family Camp 2: Keshet Weekend'),
    ])
    mockAssignmentsGetFullList.mockResolvedValue([])
    const { rows: out } = await fetchCamperJourney(PERSON, CURRENT_YEAR, {
      familyHousingYears: [familyHousingYear({ housing: 'not_placed', cabin_name: '' })],
    })
    expect(out[0]?.bunkName).toBeUndefined()
  })

  it('never applies household housing to a non-family row, even if the year matches by coincidence', async () => {
    mockAttendeesGetFullList.mockResolvedValue([attendee(2024, 500, 'main', 'Session 3')])
    mockAssignmentsGetFullList.mockResolvedValue([assignment(2024, 500, 'G-4A')])
    const { rows: out } = await fetchCamperJourney(PERSON, CURRENT_YEAR, {
      familyHousingYears: [familyHousingYear({ housing_session_cm_id: 500 })],
    })
    expect(out[0]?.bunkName).toBe('G-4A') // unaffected — still the real summer bunk
  })
})

describe('adult programs', () => {
  // Each test starts from no enrollments — without this, a test that sets no
  // attendees inherits the previous test's mock (vi.fn keeps its last value).
  beforeEach(() => {
    mockAttendeesGetFullList.mockReset().mockResolvedValue([])
    mockAssignmentsGetFullList.mockReset().mockResolvedValue([])
    mockSessionsGetFullList.mockReset().mockResolvedValue([])
  })

  function housing(year: number, sessionCmId: number, cabin: string) {
    return { year, session_cm_id: sessionCmId, cabin_name: cabin, cabin_name_raw: cabin }
  }

  it('labels an adult row with its attributed cabin', async () => {
    mockAttendeesGetFullList.mockResolvedValue([attendee(2024, 1001, 'adult', "Women's Weekend")])
    const { rows } = await fetchCamperJourney(PERSON, CURRENT_YEAR, {
      adultHousingWeekends: [housing(2024, 1001, 'River F')],
    })
    expect(rows[0]).toMatchObject({ year: 2024, sessionType: 'adult', bunkName: 'River F' })
  })

  it("carries the as-typed string as bunkNameRecorded when the server's cabin_name differs from cabin_name_raw", async () => {
    mockAttendeesGetFullList.mockResolvedValue([attendee(2022, 1001, 'adult', "Women's Weekend")])
    const { rows } = await fetchCamperJourney(PERSON, CURRENT_YEAR, {
      adultHousingWeekends: [
        {
          year: 2022,
          session_cm_id: 1001,
          cabin_name: 'Meadow House 1',
          cabin_name_raw: 'Old Meadow 1',
        },
      ],
    })
    expect(rows[0]).toMatchObject({ bunkName: 'Meadow House 1', bunkNameRecorded: 'Old Meadow 1' })
  })

  it('omits bunkNameRecorded on an adult row when the server already agrees with itself', async () => {
    mockAttendeesGetFullList.mockResolvedValue([attendee(2024, 1001, 'adult', "Women's Weekend")])
    const { rows } = await fetchCamperJourney(PERSON, CURRENT_YEAR, {
      adultHousingWeekends: [housing(2024, 1001, 'River F')],
    })
    expect(rows[0]?.bunkNameRecorded).toBeUndefined()
  })

  // I2 (review): both sides are trimmed before the disagreement check, so
  // outer whitespace on the server's raw string must never look like a real
  // disagreement and spawn a spurious tooltip.
  it('never treats outer whitespace on cabin_name_raw as a disagreement with a trimmed cabin_name', async () => {
    mockAttendeesGetFullList.mockResolvedValue([attendee(2024, 1001, 'adult', "Women's Weekend")])
    const { rows } = await fetchCamperJourney(PERSON, CURRENT_YEAR, {
      adultHousingWeekends: [
        { year: 2024, session_cm_id: 1001, cabin_name: 'River F', cabin_name_raw: '  River F  ' },
      ],
    })
    expect(rows[0]?.bunkNameRecorded).toBeUndefined()
  })

  it('never labels an adult row with a bunk, even a lone same-year one', async () => {
    mockAttendeesGetFullList.mockResolvedValue([attendee(2024, 1001, 'adult', "Women's Weekend")])
    mockAssignmentsGetFullList.mockResolvedValue([assignment(2024, 555, 'G-8B', 'main')])
    const { rows } = await fetchCamperJourney(PERSON, CURRENT_YEAR)
    expect(rows[0]?.bunkName).toBeUndefined()
  })

  it('leaves an adult row unlabeled when its weekend has no attributed cabin', async () => {
    mockAttendeesGetFullList.mockResolvedValue([
      attendee(2024, 1002, 'adult', 'Divorce & Discovery'),
    ])
    const { rows } = await fetchCamperJourney(PERSON, CURRENT_YEAR, {
      adultHousingWeekends: [housing(2024, 1001, 'River F')],
    })
    expect(rows[0]?.bunkName).toBeUndefined()
  })

  it('counts adult weekends through the current year while rows stay prior-year', async () => {
    mockAttendeesGetFullList.mockResolvedValue([
      attendee(2024, 1001, 'adult', "Women's Weekend"),
      attendee(2025, 1001, 'adult', "Women's Weekend"),
      attendee(CURRENT_YEAR, 1001, 'adult', "Women's Weekend"),
    ])
    const out = await fetchCamperJourney(PERSON, CURRENT_YEAR)
    expect(out.rows.map((r) => r.year)).toEqual([2025, 2024])
    // (year, session) pairs — CampMinder reuses session ids across years.
    expect(out.adultWeekends).toBe(3)
  })
})

describe("family camp, today's name with recorded provenance, and as a parent", () => {
  // Each test starts from no enrollments — without this, a test that sets no
  // attendees inherits the previous test's mock (vi.fn keeps its last value).
  beforeEach(() => {
    mockAttendeesGetFullList.mockReset().mockResolvedValue([])
    mockAssignmentsGetFullList.mockReset().mockResolvedValue([])
    mockSessionsGetFullList.mockReset().mockResolvedValue([])
  })

  function householdYear(overrides: Record<string, unknown> = {}) {
    return {
      year: 2024,
      housing: 'placed' as const,
      cabin_name: 'Meadow House 1',
      cabin_name_raw: 'Old Meadow 1',
      housing_session_cm_id: 900,
      sessions: [
        { session_cm_id: 900, name: 'Family Camp 2: Keshet Weekend', start_date: '2024-05-24' },
      ],
      adults: [],
      children: [],
      ...overrides,
    }
  }

  // RULED CHANGE (owner, 2026-09-22 evening): this morning's ruling had the
  // label be the AS-RECORDED string. The owner reversed it on the visual
  // pass — too long, and one ran off the card — back to the kindred#2332
  // pattern the household journey card already uses: today's registry name
  // as the label, the as-typed string only in a hover tooltip.
  it("labels a child's family row with today's registry name, not the as-typed string", async () => {
    mockAttendeesGetFullList.mockResolvedValue([
      attendee(2024, 900, 'family', 'Family Camp 2: Keshet Weekend'),
    ])
    const { rows } = await fetchCamperJourney(PERSON, CURRENT_YEAR, {
      familyHousingYears: [householdYear()],
    })
    expect(rows[0]?.bunkName).toBe('Meadow House 1')
  })

  it('adds the weekends a child in the household attended, for an adult viewer', async () => {
    const out = await fetchCamperJourney(PERSON, CURRENT_YEAR, {
      familyHousingYears: [householdYear()],
      viewerIsAdult: true,
    })
    expect(out.rows).toEqual([
      expect.objectContaining({
        year: 2024,
        sessionType: 'family',
        sessionName: 'Family Camp 2: Keshet Weekend',
        // RULED CHANGE (owner, 2026-09-22 evening) — see the test above.
        bunkName: 'Meadow House 1',
      }),
    ])
    expect(out.familyWeekends).toBe(1)
  })

  it('adds no parent rows for a child viewer', async () => {
    const out = await fetchCamperJourney(PERSON, CURRENT_YEAR, {
      familyHousingYears: [householdYear()],
    })
    expect(out.rows).toEqual([])
    expect(out.familyWeekends).toBe(0)
  })

  it('does not double a weekend the adult attended themself', async () => {
    mockAttendeesGetFullList.mockResolvedValue([
      attendee(2024, 900, 'family', 'Family Camp 2: Keshet Weekend'),
    ])
    const out = await fetchCamperJourney(PERSON, CURRENT_YEAR, {
      familyHousingYears: [householdYear()],
      viewerIsAdult: true,
    })
    expect(out.rows).toHaveLength(1)
    expect(out.familyWeekends).toBe(1)
  })

  // A PINNED year keeps its behavior: only the pinned weekend is labeled.
  // (This test used `housing_session_cm_id: null` to mean "elsewhere"; with
  // the ruled change below, null now labels every weekend, so "elsewhere" is
  // spelled as an actual different weekend.)
  it('shows a parent weekend with no cabin when the year pins the cabin elsewhere', async () => {
    const { rows } = await fetchCamperJourney(PERSON, CURRENT_YEAR, {
      familyHousingYears: [householdYear({ housing_session_cm_id: 901 })],
      viewerIsAdult: true,
    })
    expect(rows[0]?.bunkName).toBeUndefined()
  })

  // RULED CHANGE (owner, 2026-09-22 late): an unpinned placed season — the
  // household attended 2+ weekends — used to leave every parent weekend
  // unlabeled. "Just show the same cabin for all": each weekend now carries
  // the season's cabin, with the same provenance tooltip.
  it('labels EVERY parent weekend of a placed season whose cabin is not pinned', async () => {
    const { rows } = await fetchCamperJourney(PERSON, CURRENT_YEAR, {
      familyHousingYears: [
        householdYear({
          housing_session_cm_id: null,
          sessions: [
            { session_cm_id: 900, name: 'Family Camp 2: Keshet Weekend', start_date: '2024-05-24' },
            { session_cm_id: 901, name: 'Family Camp 5', start_date: '2024-08-16' },
          ],
        }),
      ],
      viewerIsAdult: true,
    })
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row).toMatchObject({ bunkName: 'Meadow House 1', bunkNameRecorded: 'Old Meadow 1' })
    }
  })

  it('adds no row and counts nothing for a paper-registration year (no sessions)', async () => {
    const out = await fetchCamperJourney(PERSON, CURRENT_YEAR, {
      familyHousingYears: [householdYear({ sessions: [] })],
      viewerIsAdult: true,
    })
    expect(out.rows).toEqual([])
    expect(out.familyWeekends).toBe(0)
  })

  it('counts a current-year parent weekend but adds no row for it', async () => {
    const out = await fetchCamperJourney(PERSON, CURRENT_YEAR, {
      familyHousingYears: [householdYear({ year: CURRENT_YEAR })],
      viewerIsAdult: true,
    })
    expect(out.rows).toEqual([])
    expect(out.familyWeekends).toBe(1)
  })

  it('carries the as-typed string as bunkNameRecorded when it differs from the label', async () => {
    mockAttendeesGetFullList.mockResolvedValue([
      attendee(2024, 900, 'family', 'Family Camp 2: Keshet Weekend'),
    ])
    const { rows } = await fetchCamperJourney(PERSON, CURRENT_YEAR, {
      familyHousingYears: [householdYear()],
    })
    expect(rows[0]).toMatchObject({ bunkName: 'Meadow House 1', bunkNameRecorded: 'Old Meadow 1' })
  })

  it('omits bunkNameRecorded when the as-typed string already IS the label', async () => {
    mockAttendeesGetFullList.mockResolvedValue([
      attendee(2024, 900, 'family', 'Family Camp 2: Keshet Weekend'),
    ])
    const { rows } = await fetchCamperJourney(PERSON, CURRENT_YEAR, {
      familyHousingYears: [
        householdYear({ cabin_name: 'Cedar Lodge', cabin_name_raw: 'Cedar Lodge' }),
      ],
    })
    expect(rows[0]?.bunkName).toBe('Cedar Lodge')
    expect(rows[0]?.bunkNameRecorded).toBeUndefined()
  })

  it('carries bunkNameRecorded on a parent row too, for an adult viewer', async () => {
    const out = await fetchCamperJourney(PERSON, CURRENT_YEAR, {
      familyHousingYears: [householdYear()],
      viewerIsAdult: true,
    })
    expect(out.rows[0]).toMatchObject({
      bunkName: 'Meadow House 1',
      bunkNameRecorded: 'Old Meadow 1',
    })
  })

  // I2 (review): both sides are trimmed before the disagreement check, so
  // outer whitespace on the household record's raw string must never look
  // like a real disagreement and spawn a spurious tooltip.
  it('never treats outer whitespace on the household record cabin_name_raw as a disagreement', async () => {
    mockAttendeesGetFullList.mockResolvedValue([
      attendee(2024, 900, 'family', 'Family Camp 2: Keshet Weekend'),
    ])
    const { rows } = await fetchCamperJourney(PERSON, CURRENT_YEAR, {
      familyHousingYears: [householdYear({ cabin_name: 'River F', cabin_name_raw: '  River F  ' })],
    })
    expect(rows[0]?.bunkNameRecorded).toBeUndefined()
  })
})

// Owner ruling 2026-09-22 (late, Q9). CampMinder's "bunk" for a teen program is
// usually a program GROUP ("SCIT A", "TLI"), and for Quest a trip name. A
// TLI/SCIT row's cabin comes ONLY from the server's `teen_cabins` (resolved
// through the one registry resolver, kindred#2332) — never the raw bunk — and a
// Quest row never shows a cabin.
describe('teen-program and Quest cabins (Q9)', () => {
  beforeEach(() => {
    mockAttendeesGetFullList.mockReset().mockResolvedValue([])
    mockAssignmentsGetFullList.mockReset().mockResolvedValue([])
    mockSessionsGetFullList.mockReset().mockResolvedValue([])
  })

  const resolved = {
    year: 2025,
    session_cm_id: 2001,
    cabin_name: 'Village Cabin 2',
    cabin_name_raw: 'Teen 2',
  }

  it("labels a TLI/SCIT row with the server's registry name, the as-typed string on hover", async () => {
    mockAttendeesGetFullList.mockResolvedValue([
      attendee(2025, 2001, 'scit', 'Counselor In-Training'),
    ])
    mockAssignmentsGetFullList.mockResolvedValue([assignment(2025, 2001, 'Teen 2', 'scit')])
    const { rows } = await fetchCamperJourney(PERSON, CURRENT_YEAR, { teenCabins: [resolved] })
    expect(rows[0]).toMatchObject({ bunkName: 'Village Cabin 2', bunkNameRecorded: 'Teen 2' })
  })

  it('gives an unresolved TLI/SCIT row no label — never the raw program group', async () => {
    mockAttendeesGetFullList.mockResolvedValue([
      attendee(2025, 2001, 'scit', 'Counselor In-Training'),
      attendee(2025, 2002, 'tli', 'Teen Leadership'),
    ])
    mockAssignmentsGetFullList.mockResolvedValue([
      assignment(2025, 2001, 'SCIT A', 'scit'),
      assignment(2025, 2002, 'TLI', 'tli'),
    ])
    const { rows } = await fetchCamperJourney(PERSON, CURRENT_YEAR, { teenCabins: [] })
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.bunkName).toBeUndefined()
      expect(row.bunkNameRecorded).toBeUndefined()
    }
  })

  it('omits the hover when the registry name already IS the recorded string', async () => {
    mockAttendeesGetFullList.mockResolvedValue([attendee(2025, 2002, 'tli', 'Teen Leadership')])
    const { rows } = await fetchCamperJourney(PERSON, CURRENT_YEAR, {
      teenCabins: [
        {
          year: 2025,
          session_cm_id: 2002,
          cabin_name: 'Cedar Lodge',
          cabin_name_raw: 'Cedar Lodge',
        },
      ],
    })
    expect(rows[0]?.bunkName).toBe('Cedar Lodge')
    expect(rows[0]?.bunkNameRecorded).toBeUndefined()
  })

  it('never borrows a teen cabin from another year or session', async () => {
    mockAttendeesGetFullList.mockResolvedValue([
      attendee(2024, 2001, 'scit', 'Counselor In-Training'),
    ])
    const { rows } = await fetchCamperJourney(PERSON, CURRENT_YEAR, { teenCabins: [resolved] })
    expect(rows[0]?.bunkName).toBeUndefined()
  })

  it('gives a Quest row no label even when a bunk_assignment exists', async () => {
    mockAttendeesGetFullList.mockResolvedValue([attendee(2025, 3001, 'quest', 'Quest Session')])
    mockAssignmentsGetFullList.mockResolvedValue([assignment(2025, 3001, 'Trip Name', 'quest')])
    const { rows } = await fetchCamperJourney(PERSON, CURRENT_YEAR)
    expect(rows[0]?.bunkName).toBeUndefined()
  })

  it('never lets a lone program-group bunk reach a summer row through the year-fallback', async () => {
    // Session 2 has no bunk of its own that year; the only assignment is the
    // SCIT program group. The fallback must not hand "SCIT A" to the summer row.
    mockAttendeesGetFullList.mockResolvedValue([
      attendee(2025, 100, 'main', 'Session 2'),
      attendee(2025, 2001, 'scit', 'Counselor In-Training'),
    ])
    mockAssignmentsGetFullList.mockResolvedValue([assignment(2025, 2001, 'SCIT A', 'scit')])
    const { rows } = await fetchCamperJourney(PERSON, CURRENT_YEAR)
    for (const row of rows) expect(row.bunkName).toBeUndefined()
  })
})
