/**
 * Tests for useCamperEnrollment hook.
 *
 * Regression: campers enrolled in BOTH a summer session and a family-camp
 * session were having the family-camp bunk leak onto their summer attendee
 * row, because the bunk_assignments query and its fallback didn't filter
 * by session_type. See <PR link>.
 *
 * TDD: Tests written BEFORE implementation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createWrapper, expectDefined } from '../../test/testUtils'
import { useCamperEnrollment } from './useCamperEnrollment'

const mockAttendeesGetFullList = vi.fn()
const mockAssignmentsGetFullList = vi.fn()

vi.mock('../../lib/pocketbase', () => ({
  pb: {
    collection: vi.fn((name: string) => {
      if (name === 'attendees') return { getFullList: mockAttendeesGetFullList }
      if (name === 'bunk_assignments') return { getFullList: mockAssignmentsGetFullList }
      throw new Error(`Unexpected collection: ${name}`)
    }),
  },
}))

const PERSON_CM_ID = 8000001
const YEAR = 2026

const fakePerson = {
  id: 'person_pb_1',
  cm_id: PERSON_CM_ID,
  first_name: 'Emma',
  last_name: 'Johnson',
  preferred_name: null,
  age: 14,
  birthdate: '2012-06-15',
  grade: 8,
  gender: 'F',
  normalized_school: 'Riverside Elementary',
  school: 'Riverside Elementary',
  years_at_camp: 4,
  household_id: 999,
  year: YEAR,
  created: '2026-01-01T00:00:00Z',
  updated: '2026-01-01T00:00:00Z',
}

function makeAttendee(opts: {
  id: string
  sessionPbId: string
  sessionCmId: number
  sessionType: string
}) {
  return {
    id: opts.id,
    person_id: PERSON_CM_ID,
    person: fakePerson.id,
    session: opts.sessionPbId,
    status: 'enrolled',
    status_id: 2,
    year: YEAR,
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
    expand: {
      person: fakePerson,
      session: {
        id: opts.sessionPbId,
        cm_id: opts.sessionCmId,
        name: `Session ${opts.sessionCmId}`,
        session_type: opts.sessionType,
      },
    },
  }
}

function makeAssignment(opts: {
  id: string
  sessionPbId: string
  sessionCmId: number
  sessionType: string
  bunkPbId: string
  bunkCmId: number
  bunkName: string
}) {
  return {
    id: opts.id,
    year: YEAR,
    person: fakePerson.id,
    session: opts.sessionPbId,
    bunk: opts.bunkPbId,
    expand: {
      person: fakePerson,
      session: {
        id: opts.sessionPbId,
        cm_id: opts.sessionCmId,
        name: `Session ${opts.sessionCmId}`,
        session_type: opts.sessionType,
      },
      bunk: {
        id: opts.bunkPbId,
        cm_id: opts.bunkCmId,
        name: opts.bunkName,
      },
    },
  }
}

describe('useCamperEnrollment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not leak family-camp bunk onto a summer attendee', async () => {
    // Camper enrolled in summer Session 2a + has a family-camp bunk assignment.
    mockAttendeesGetFullList.mockResolvedValue([
      makeAttendee({
        id: 'att_2a',
        sessionPbId: 'sess_2a',
        sessionCmId: 1356533,
        sessionType: 'embedded',
      }),
    ])
    mockAssignmentsGetFullList.mockResolvedValue([
      makeAssignment({
        id: 'asn_fc6',
        sessionPbId: 'sess_fc6',
        sessionCmId: 1309519,
        sessionType: 'family',
        bunkPbId: 'bunk_pp',
        bunkCmId: 9000001,
        bunkName: 'Ponderosa Pines',
      }),
    ])

    const { result } = renderHook(() => useCamperEnrollment(PERSON_CM_ID, YEAR), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.allAttendees).toHaveLength(1)
    const camper = expectDefined(result.current.allAttendees[0], 'first attendee')
    expect(camper.session_cm_id).toBe(1356533)
    expect(camper.assigned_bunk_cm_id).toBeUndefined()
    expect(camper.assigned_bunk).toBe('')
  })

  it('does not leak family-camp bunk onto multiple summer attendees', async () => {
    // Camper enrolled in BOTH Session 2a and Session 3a + family-camp bunk only.
    mockAttendeesGetFullList.mockResolvedValue([
      makeAttendee({
        id: 'att_2a',
        sessionPbId: 'sess_2a',
        sessionCmId: 1356533,
        sessionType: 'embedded',
      }),
      makeAttendee({
        id: 'att_3a',
        sessionPbId: 'sess_3a',
        sessionCmId: 1344555,
        sessionType: 'embedded',
      }),
    ])
    mockAssignmentsGetFullList.mockResolvedValue([
      makeAssignment({
        id: 'asn_fc6',
        sessionPbId: 'sess_fc6',
        sessionCmId: 1309519,
        sessionType: 'family',
        bunkPbId: 'bunk_pp',
        bunkCmId: 9000001,
        bunkName: 'Ponderosa Pines',
      }),
    ])

    const { result } = renderHook(() => useCamperEnrollment(PERSON_CM_ID, YEAR), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.allAttendees).toHaveLength(2)
    for (const camper of result.current.allAttendees) {
      expect(camper.assigned_bunk_cm_id).toBeUndefined()
      expect(camper.assigned_bunk).toBe('')
    }
  })

  it('still applies a matching summer bunk to the right summer session', async () => {
    mockAttendeesGetFullList.mockResolvedValue([
      makeAttendee({
        id: 'att_2',
        sessionPbId: 'sess_2',
        sessionCmId: 1356533,
        sessionType: 'main',
      }),
    ])
    mockAssignmentsGetFullList.mockResolvedValue([
      makeAssignment({
        id: 'asn_2',
        sessionPbId: 'sess_2',
        sessionCmId: 1356533,
        sessionType: 'main',
        bunkPbId: 'bunk_summer',
        bunkCmId: 7000001,
        bunkName: 'Cabin 5',
      }),
    ])

    const { result } = renderHook(() => useCamperEnrollment(PERSON_CM_ID, YEAR), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.allAttendees).toHaveLength(1)
    expect(expectDefined(result.current.allAttendees[0]).assigned_bunk_cm_id).toBe(7000001)
  })

  it('does not leak one summer attendee’s bunk onto another summer attendee (cross-session)', async () => {
    // Multi-summer-session enrollee with a bunk for ONE of the sessions only.
    // The unmatched attendee must NOT inherit the matched attendee's bunk.
    mockAttendeesGetFullList.mockResolvedValue([
      makeAttendee({
        id: 'att_2a',
        sessionPbId: 'sess_2a',
        sessionCmId: 1356533,
        sessionType: 'embedded',
      }),
      makeAttendee({
        id: 'att_3a',
        sessionPbId: 'sess_3a',
        sessionCmId: 1344555,
        sessionType: 'embedded',
      }),
    ])
    mockAssignmentsGetFullList.mockResolvedValue([
      makeAssignment({
        id: 'asn_2a',
        sessionPbId: 'sess_2a',
        sessionCmId: 1356533,
        sessionType: 'embedded',
        bunkPbId: 'bunk_5',
        bunkCmId: 7000005,
        bunkName: 'Cabin 5',
      }),
    ])

    const { result } = renderHook(() => useCamperEnrollment(PERSON_CM_ID, YEAR), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.allAttendees).toHaveLength(2)
    const att2a = result.current.allAttendees.find((c) => c.session_cm_id === 1356533)
    const att3a = result.current.allAttendees.find((c) => c.session_cm_id === 1344555)
    expect(expectDefined(att2a, 'session 2a attendee').assigned_bunk_cm_id).toBe(7000005)
    expect(expectDefined(att3a, 'session 3a attendee').assigned_bunk_cm_id).toBeUndefined()
  })

  it('does not fire the fallback for a non-AG single attendee with a mismatched summer assignment', async () => {
    // A single embedded attendee whose only summer assignment is for a
    // different session must not borrow that bunk via the fallback.
    mockAttendeesGetFullList.mockResolvedValue([
      makeAttendee({
        id: 'att_2a',
        sessionPbId: 'sess_2a',
        sessionCmId: 1356533,
        sessionType: 'embedded',
      }),
    ])
    mockAssignmentsGetFullList.mockResolvedValue([
      makeAssignment({
        id: 'asn_other',
        sessionPbId: 'sess_other',
        sessionCmId: 1300000,
        sessionType: 'main',
        bunkPbId: 'bunk_other',
        bunkCmId: 7000077,
        bunkName: 'Cabin 7',
      }),
    ])

    const { result } = renderHook(() => useCamperEnrollment(PERSON_CM_ID, YEAR), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.allAttendees).toHaveLength(1)
    expect(expectDefined(result.current.allAttendees[0]).assigned_bunk_cm_id).toBeUndefined()
  })

  it('preserves the AG fallback: summer attendee with no exact session match still gets a summer bunk', async () => {
    // The original purpose of the fallback: an AG-typed attendee whose bunk
    // assignment is recorded under the parent main session.
    mockAttendeesGetFullList.mockResolvedValue([
      makeAttendee({
        id: 'att_ag',
        sessionPbId: 'sess_2a_ag',
        sessionCmId: 1356533,
        sessionType: 'ag',
      }),
    ])
    mockAssignmentsGetFullList.mockResolvedValue([
      makeAssignment({
        id: 'asn_parent_main',
        sessionPbId: 'sess_2_main',
        sessionCmId: 1300000,
        sessionType: 'main',
        bunkPbId: 'bunk_main',
        bunkCmId: 7000099,
        bunkName: 'Cabin 9',
      }),
    ])

    const { result } = renderHook(() => useCamperEnrollment(PERSON_CM_ID, YEAR), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.allAttendees).toHaveLength(1)
    expect(expectDefined(result.current.allAttendees[0]).assigned_bunk_cm_id).toBe(7000099)
  })

  it('loads a teen-only (scit) attendee and queries attendees with teen types included', async () => {
    mockAttendeesGetFullList.mockResolvedValue([
      makeAttendee({
        id: 'att_scit',
        sessionPbId: 'sess_scit',
        sessionCmId: 1407000,
        sessionType: 'scit',
      }),
    ])
    mockAssignmentsGetFullList.mockResolvedValue([]) // teens are never bunked

    const { result } = renderHook(() => useCamperEnrollment(PERSON_CM_ID, YEAR), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.allAttendees).toHaveLength(1)
    const teen = expectDefined(result.current.allAttendees[0], 'teen attendee')
    expect(teen.session_cm_id).toBe(1407000)
    expect(teen.assigned_bunk).toBe('')

    // The attendee fetch must include teen types in its filter.
    const attendeeFilter = String(mockAttendeesGetFullList.mock.calls[0]?.[0]?.filter ?? '')
    expect(attendeeFilter).toContain('session.session_type = "scit"')
    expect(attendeeFilter).toContain('session.session_type = "tli"')
    // The assignment fetch stays summer-only (no teen types).
    const assignmentFilter = String(mockAssignmentsGetFullList.mock.calls[0]?.[0]?.filter ?? '')
    expect(assignmentFilter).not.toContain('"scit"')
  })
})
