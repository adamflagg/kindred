/**
 * Tests for useCamperCohorts hook.
 *
 * Verifies that the hook correctly counts same-session enrolled campers
 * by normalized school/congregation/city, excluding the current camper
 * and non-enrolled (cancelled/waitlisted) attendees.
 *
 * TDD: Tests written BEFORE implementation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createWrapper } from '../test/testUtils'
import { useCamperCohorts } from './useCamperCohorts'

// Mock pocketbase
const mockGetFullList = vi.fn()
vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: vi.fn(() => ({
      getFullList: mockGetFullList,
    })),
  },
}))

// Fixture helpers
function makeAttendee(overrides: {
  id: string
  person_id: number
  status_id: number
  status?: string
  normalizedSchool?: string | null
  normalizedCongregation?: string | null
  normalizedCity?: string | null
  gender?: string | null
  firstName?: string
  lastName?: string
  preferredName?: string | null
  grade?: number | null
  sessionType?: string
}) {
  return {
    id: overrides.id,
    person_id: overrides.person_id,
    status_id: overrides.status_id,
    // Mirror server enum: status_id 2 → 'enrolled' (other values → other strings)
    status: overrides.status ?? (overrides.status_id === 2 ? 'enrolled' : 'cancelled'),
    expand: {
      person: {
        cm_id: overrides.person_id,
        first_name: overrides.firstName ?? 'First',
        last_name: overrides.lastName ?? 'Last',
        preferred_name: overrides.preferredName ?? null,
        grade: overrides.grade ?? null,
        gender: overrides.gender ?? null,
        normalized_school: overrides.normalizedSchool ?? null,
        normalized_congregation: overrides.normalizedCongregation ?? null,
        normalized_city: overrides.normalizedCity ?? null,
      },
      session: {
        session_type: overrides.sessionType ?? 'main',
      },
    },
  }
}

describe('useCamperCohorts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null cohorts when personCmId is null', () => {
    const { result } = renderHook(() => useCamperCohorts(null, 201, 2025), {
      wrapper: createWrapper(),
    })
    expect(result.current.cohorts).toBeNull()
    expect(result.current.isLoading).toBe(false)
  })

  it('returns null cohorts when sessionCmId is 0', () => {
    const { result } = renderHook(() => useCamperCohorts(1000001, 0, 2025), {
      wrapper: createWrapper(),
    })
    expect(result.current.cohorts).toBeNull()
    expect(result.current.isLoading).toBe(false)
  })

  it('counts same-session enrolled campers sharing the same normalized_school', async () => {
    // Simulate: current camper (1000001) + 4 others at "Riverside Elementary" + 1 different school
    mockGetFullList.mockResolvedValue([
      // current camper — must be excluded
      makeAttendee({
        id: 'a1',
        person_id: 1000001,
        status_id: 2,
        normalizedSchool: 'Riverside Elementary',
      }),
      // same school, enrolled
      makeAttendee({
        id: 'a2',
        person_id: 1000002,
        status_id: 2,
        normalizedSchool: 'Riverside Elementary',
      }),
      makeAttendee({
        id: 'a3',
        person_id: 1000003,
        status_id: 2,
        normalizedSchool: 'Riverside Elementary',
      }),
      makeAttendee({
        id: 'a4',
        person_id: 1000004,
        status_id: 2,
        normalizedSchool: 'Riverside Elementary',
      }),
      makeAttendee({
        id: 'a5',
        person_id: 1000005,
        status_id: 2,
        normalizedSchool: 'Riverside Elementary',
      }),
      // different school
      makeAttendee({
        id: 'a6',
        person_id: 1000006,
        status_id: 2,
        normalizedSchool: 'Oak Valley Middle',
      }),
    ])

    const { result } = renderHook(() => useCamperCohorts(1000001, 201, 2025), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.cohorts?.school).toMatchObject({
      label: 'Riverside Elementary',
      count: 4, // 5 total with same school - 1 (current camper) = 4
    })
  })

  it('excludes cancelled and waitlisted attendees from the count', async () => {
    mockGetFullList.mockResolvedValue([
      // current camper enrolled
      makeAttendee({
        id: 'a1',
        person_id: 1000001,
        status_id: 2,
        normalizedSchool: 'Hillcrest High',
      }),
      // enrolled — counts
      makeAttendee({
        id: 'a2',
        person_id: 1000002,
        status_id: 2,
        normalizedSchool: 'Hillcrest High',
      }),
      // cancelled — should NOT count
      makeAttendee({
        id: 'a3',
        person_id: 1000003,
        status_id: 4,
        normalizedSchool: 'Hillcrest High',
      }),
      // waitlisted — should NOT count
      makeAttendee({
        id: 'a4',
        person_id: 1000004,
        status_id: 3,
        normalizedSchool: 'Hillcrest High',
      }),
      // enrolled different school — should not appear in school count
      makeAttendee({
        id: 'a5',
        person_id: 1000005,
        status_id: 2,
        normalizedSchool: 'Oak Valley Middle',
      }),
    ])

    const { result } = renderHook(() => useCamperCohorts(1000001, 201, 2025), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // Only 1 enrolled non-self camper at Hillcrest High
    expect(result.current.cohorts?.school?.count).toBe(1)
  })

  it('excludes the current camper from the count (regression guard)', async () => {
    mockGetFullList.mockResolvedValue([
      makeAttendee({
        id: 'a1',
        person_id: 1000001,
        status_id: 2,
        normalizedSchool: 'Riverside Elementary',
      }),
      makeAttendee({
        id: 'a2',
        person_id: 1000002,
        status_id: 2,
        normalizedSchool: 'Riverside Elementary',
      }),
    ])

    const { result } = renderHook(() => useCamperCohorts(1000001, 201, 2025), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // count = 1, not 2 — self excluded
    expect(result.current.cohorts?.school?.count).toBe(1)
  })

  it('returns null for school cohort when current camper has no normalized_school', async () => {
    mockGetFullList.mockResolvedValue([
      // current camper has no school
      makeAttendee({ id: 'a1', person_id: 1000001, status_id: 2, normalizedSchool: null }),
      makeAttendee({
        id: 'a2',
        person_id: 1000002,
        status_id: 2,
        normalizedSchool: 'Riverside Elementary',
      }),
    ])

    const { result } = renderHook(() => useCamperCohorts(1000001, 201, 2025), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.cohorts?.school).toBeNull()
  })

  it('non-AG session: excludes opposite-gender campers from school count', async () => {
    // Self is M in a 'main' (non-AG) session. F campers from same school must NOT count.
    mockGetFullList.mockResolvedValue([
      makeAttendee({
        id: 'a1',
        person_id: 1000001,
        status_id: 2,
        gender: 'M',
        normalizedSchool: 'Riverside Elementary',
        sessionType: 'main',
      }),
      // same gender, same school — counts
      makeAttendee({
        id: 'a2',
        person_id: 1000002,
        status_id: 2,
        gender: 'M',
        normalizedSchool: 'Riverside Elementary',
        sessionType: 'main',
      }),
      // opposite gender, same school — must NOT count
      makeAttendee({
        id: 'a3',
        person_id: 1000003,
        status_id: 2,
        gender: 'F',
        normalizedSchool: 'Riverside Elementary',
        sessionType: 'main',
      }),
      makeAttendee({
        id: 'a4',
        person_id: 1000004,
        status_id: 2,
        gender: 'F',
        normalizedSchool: 'Riverside Elementary',
        sessionType: 'main',
      }),
    ])

    const { result } = renderHook(() => useCamperCohorts(1000001, 201, 2025), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // Only 1 valid bunkmate (a2) — a3/a4 filtered out
    expect(result.current.cohorts?.school?.count).toBe(1)
    expect(result.current.cohorts?.school?.attendees).toHaveLength(1)
    expect(result.current.cohorts?.school?.attendees?.[0]?.personCmId).toBe(1000002)
  })

  it('AG session: includes all genders in cohort counts', async () => {
    mockGetFullList.mockResolvedValue([
      makeAttendee({
        id: 'a1',
        person_id: 1000001,
        status_id: 2,
        gender: 'M',
        normalizedSchool: 'Riverside Elementary',
        sessionType: 'ag',
      }),
      makeAttendee({
        id: 'a2',
        person_id: 1000002,
        status_id: 2,
        gender: 'M',
        normalizedSchool: 'Riverside Elementary',
        sessionType: 'ag',
      }),
      makeAttendee({
        id: 'a3',
        person_id: 1000003,
        status_id: 2,
        gender: 'F',
        normalizedSchool: 'Riverside Elementary',
        sessionType: 'ag',
      }),
    ])

    const { result } = renderHook(() => useCamperCohorts(1000001, 201, 2025), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // Both same-gender (a2) and opposite-gender (a3) counted in AG session
    expect(result.current.cohorts?.school?.count).toBe(2)
  })

  it('non-AG session, self has null gender: skips gender filter (treats as AG)', async () => {
    // When self has no gender on file, we cannot determine bunkability — fall
    // back to showing all matches (let the staffer judge) rather than silently
    // matching only other null-gender campers.
    mockGetFullList.mockResolvedValue([
      makeAttendee({
        id: 'a1',
        person_id: 1000001,
        status_id: 2,
        gender: null,
        normalizedSchool: 'Riverside Elementary',
        sessionType: 'main',
      }),
      makeAttendee({
        id: 'a2',
        person_id: 1000002,
        status_id: 2,
        gender: 'M',
        normalizedSchool: 'Riverside Elementary',
        sessionType: 'main',
      }),
      makeAttendee({
        id: 'a3',
        person_id: 1000003,
        status_id: 2,
        gender: 'F',
        normalizedSchool: 'Riverside Elementary',
        sessionType: 'main',
      }),
    ])

    const { result } = renderHook(() => useCamperCohorts(1000001, 201, 2025), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // Both genders surfaced — caller can see all candidates
    expect(result.current.cohorts?.school?.count).toBe(2)
  })

  it('embedded session: applies same-gender filter (non-AG)', async () => {
    mockGetFullList.mockResolvedValue([
      makeAttendee({
        id: 'a1',
        person_id: 1000001,
        status_id: 2,
        gender: 'F',
        normalizedSchool: 'Hillcrest High',
        sessionType: 'embedded',
      }),
      // same gender — counts
      makeAttendee({
        id: 'a2',
        person_id: 1000002,
        status_id: 2,
        gender: 'F',
        normalizedSchool: 'Hillcrest High',
        sessionType: 'embedded',
      }),
      // opposite gender — must NOT count
      makeAttendee({
        id: 'a3',
        person_id: 1000003,
        status_id: 2,
        gender: 'M',
        normalizedSchool: 'Hillcrest High',
        sessionType: 'embedded',
      }),
    ])

    const { result } = renderHook(() => useCamperCohorts(1000001, 201, 2025), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.cohorts?.school?.count).toBe(1)
  })

  it('returns matched attendee details (name, grade, gender) per cohort', async () => {
    mockGetFullList.mockResolvedValue([
      makeAttendee({
        id: 'a1',
        person_id: 1000001,
        status_id: 2,
        gender: 'M',
        firstName: 'Liam',
        lastName: 'Garcia',
        grade: 7,
        normalizedSchool: 'Oak Valley Middle',
        sessionType: 'main',
      }),
      makeAttendee({
        id: 'a2',
        person_id: 1000002,
        status_id: 2,
        gender: 'M',
        firstName: 'Samuel',
        lastName: 'Johnson',
        preferredName: 'Sam',
        grade: 7,
        normalizedSchool: 'Oak Valley Middle',
        sessionType: 'main',
      }),
    ])

    const { result } = renderHook(() => useCamperCohorts(1000001, 201, 2025), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    const matched = result.current.cohorts?.school?.attendees ?? []
    expect(matched).toHaveLength(1)
    expect(matched[0]).toMatchObject({
      personCmId: 1000002,
      firstName: 'Samuel',
      lastName: 'Johnson',
      preferredName: 'Sam',
      grade: 7,
      gender: 'M',
    })
  })

  it('counts congregation and city cohorts independently', async () => {
    mockGetFullList.mockResolvedValue([
      makeAttendee({
        id: 'a1',
        person_id: 1000001,
        status_id: 2,
        normalizedSchool: 'Riverside Elementary',
        normalizedCongregation: 'Beth Shalom',
        normalizedCity: 'Springfield',
      }),
      makeAttendee({
        id: 'a2',
        person_id: 1000002,
        status_id: 2,
        normalizedSchool: 'Riverside Elementary',
        normalizedCongregation: 'Beth Shalom',
        normalizedCity: 'Springfield',
      }),
      makeAttendee({
        id: 'a3',
        person_id: 1000003,
        status_id: 2,
        normalizedSchool: 'Oak Valley Middle',
        normalizedCongregation: 'Beth Shalom',
        normalizedCity: 'Riverside',
      }),
    ])

    const { result } = renderHook(() => useCamperCohorts(1000001, 201, 2025), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // school: a2 matches, a3 doesn't → count 1
    expect(result.current.cohorts?.school).toMatchObject({
      label: 'Riverside Elementary',
      count: 1,
    })
    // congregation: a2 and a3 both match Beth Shalom → count 2
    expect(result.current.cohorts?.congregation).toMatchObject({ label: 'Beth Shalom', count: 2 })
    // city: only a2 matches Springfield → count 1
    expect(result.current.cohorts?.city).toMatchObject({ label: 'Springfield', count: 1 })
  })
})
