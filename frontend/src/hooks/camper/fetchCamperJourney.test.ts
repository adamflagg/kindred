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
  parentId?: number
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
      },
    },
  }
}

function assignment(year: number, sessionCmId: number | null, bunkName: string) {
  return {
    id: `asn-${year}-${sessionCmId ?? 'x'}`,
    year,
    expand: {
      ...(sessionCmId !== null ? { session: { cm_id: sessionCmId } } : {}),
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
    mockAttendeesGetFullList.mockResolvedValue([attendee(2023, 100, 'main', 'Session 3')])
    await fetchCamperJourney(PERSON, CURRENT_YEAR)
    const filter = String(mockAttendeesGetFullList.mock.calls[0]?.[0]?.filter ?? '')
    expect(filter).toContain(`person_id = ${PERSON}`)
    expect(filter).toContain(`year < ${CURRENT_YEAR}`)
    expect(filter).toContain('status = "enrolled"')
    expect(filter).not.toContain('"family"') // family excluded — journey mirrors All Campers
    expect(filter).toContain('session.session_type = "scit"')
  })

  it('restricts the bunk_assignments query to journey session types (no family-camp bunk leak)', async () => {
    // A summer enrollment with no summer bunk + a lone family-camp bunk that year
    // must NOT have the family bunk attached via the length===1 fallback. The
    // query itself excludes non-journey (family) session types — mirrors the
    // fb1a88d2 fix applied to current-year views in useCamperEnrollment.
    mockAttendeesGetFullList.mockResolvedValue([attendee(2022, 100, 'main', 'Session 3')])
    await fetchCamperJourney(PERSON, CURRENT_YEAR)
    const filter = String(mockAssignmentsGetFullList.mock.calls[0]?.[0]?.filter ?? '')
    expect(filter).toContain(`person.cm_id = ${PERSON}`)
    expect(filter).toContain(`year < ${CURRENT_YEAR}`)
    expect(filter).not.toContain('"family"')
    expect(filter).toContain('session.session_type = "main"')
  })

  it('labels a row via exact (year, session) assignment match', async () => {
    mockAttendeesGetFullList.mockResolvedValue([attendee(2023, 100, 'main', 'Session 3')])
    mockAssignmentsGetFullList.mockResolvedValue([assignment(2023, 100, 'G-8B')])
    const out = await fetchCamperJourney(PERSON, CURRENT_YEAR)
    expect(out[0]).toMatchObject({ year: 2023, sessionName: 'Session 3', bunkName: 'G-8B' })
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
