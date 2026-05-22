/**
 * Hook for fetching camper enrollment data
 * Queries attendees with enrollment status and builds Camper objects
 */

import { useQuery } from '@tanstack/react-query'
import { pb } from '../../lib/pocketbase'
import {
  buildSummerSessionTypeFilter,
  buildCamperDetailSessionTypeFilter,
  isSummerCampSessionType,
} from '../../utils/sessionTypePredicates'
import { queryKeys } from '../../utils/queryKeys'
import { normalizeGender } from '../../utils/genderUtils'

import { sortEnrolledFirst } from '../../utils/enrollmentSort'
import { filterEnrollmentsByStatus } from '../../utils/enrollmentFilter'
import type { Camper } from '../../types/app-types'
import type {
  AttendeesResponse,
  BunkAssignmentsResponse,
  BunksResponse,
  CampSessionsResponse,
  PersonsResponse,
} from '../../types/pocketbase-types'

interface AttendeeExpand {
  person?: PersonsResponse
  session?: CampSessionsResponse
}

interface AssignmentExpand {
  person?: PersonsResponse
  session?: CampSessionsResponse
  bunk?: BunksResponse
}

export interface UseCamperEnrollmentResult {
  /** Only actually enrolled campers (status === 'enrolled') */
  enrolledCampers: Camper[]
  /** All attendees including non-enrolled (for fallback display) */
  allAttendees: Camper[]
  isLoading: boolean
  error: Error | null
}

export function useCamperEnrollment(
  personCmId: number | null,
  currentYear: number
): UseCamperEnrollmentResult {
  const isValidPersonId = !!personCmId && !isNaN(personCmId)

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.enrolledCampers(personCmId ?? 0, currentYear),
    queryFn: async () => {
      if (!personCmId) throw new Error('Invalid person ID')

      // Query attendees — source of truth for enrollment. Teen programs
      // (scit/tli) are included so a teen-only camper's page loads.
      const attendeeTypeFilter = buildCamperDetailSessionTypeFilter()
      const filter = `person_id = ${personCmId} && year = ${currentYear} && (${attendeeTypeFilter})`

      const attendees = await pb.collection<AttendeesResponse>('attendees').getFullList({
        filter,
        expand: 'person,session',
      })

      if (attendees.length === 0) {
        return { allCampers: [] }
      }

      // Person data is now expanded in attendees, get from first attendee
      const person = (attendees[0]?.expand as AttendeeExpand | undefined)?.person
      if (!person) {
        throw new Error(`Person with CampMinder ID ${personCmId} not found`)
      }

      // Load this person's assignments for valid *summer* session types only.
      // Teens have no bunk; restricting to summer also prevents family-camp bunks
      // (which sync but are out-of-scope for summer views) from leaking onto a
      // summer attendee row via the AG fallback below.
      const assignmentTypeFilter = buildSummerSessionTypeFilter()
      const assignmentFilter = `person.cm_id = ${personCmId} && year = ${currentYear} && (${assignmentTypeFilter})`
      const personAssignments = await pb
        .collection<BunkAssignmentsResponse>('bunk_assignments')
        .getFullList({
          filter: assignmentFilter,
          expand: 'person,session,bunk',
        })

      // Transform attendees to campers
      const allCampers = attendees.map((attendee) => {
        const expand = attendee.expand as AttendeeExpand | undefined
        const expandedSession = expand?.session
        const expandedPerson = expand?.person ?? person

        // Find assignment for this attendee's session
        // First try exact session match (for regular campers)

        let assignment = personAssignments.find(
          (a) =>
            (a.expand as AssignmentExpand | undefined)?.session?.cm_id === expandedSession?.cm_id
        )

        // Fallback: AG campers' bunks live under the parent main session, so
        // an exact session_cm_id match won't exist. Restrict to AG attendees
        // with no other summer attendee — a non-AG attendee whose bunk doesn't
        // match exactly should show no bunk, not borrow another session's.
        if (
          !assignment &&
          personAssignments.length > 0 &&
          attendees.length === 1 &&
          expandedSession?.session_type === 'ag'
        ) {
          assignment = personAssignments.find((a) =>
            isSummerCampSessionType(
              (a.expand as AssignmentExpand | undefined)?.session?.session_type ?? ''
            )
          )
        }

        const assignedBunk = (assignment?.expand as AssignmentExpand | undefined)?.bunk

        const displayName = `${expandedPerson.first_name} ${expandedPerson.last_name}`.trim() || ''
        const gender = normalizeGender(expandedPerson.gender)

        return {
          id: `${attendee.person_id}:${expandedSession?.cm_id ?? 0}`,
          attendee_id: attendee.id,
          attendee_status: attendee.status,
          name: displayName,
          first_name: expandedPerson.first_name,
          last_name: expandedPerson.last_name,
          preferred_name: expandedPerson.preferred_name,
          age: expandedPerson.age,
          birthdate: expandedPerson.birthdate,
          grade: expandedPerson.grade,
          gender,
          session_cm_id: expandedSession?.cm_id ?? 0,
          ...(assignedBunk?.cm_id !== undefined && { assigned_bunk_cm_id: assignedBunk.cm_id }),
          assigned_bunk: assignedBunk?.id ?? '',
          person_cm_id: expandedPerson.cm_id,
          created: attendee.created || new Date().toISOString(),
          updated: attendee.updated || new Date().toISOString(),
          years_at_camp: expandedPerson.years_at_camp || 0,
          school: expandedPerson.normalized_school || expandedPerson.school,
          pronouns: expandedPerson.gender_pronoun_name || '',
          email: '',
          tags: [],
          gender_identity_id: expandedPerson.gender_identity_id,
          gender_identity_name: expandedPerson.gender_identity_name,
          gender_identity_write_in: expandedPerson.gender_identity_write_in,
          gender_pronoun_id: expandedPerson.gender_pronoun_id,
          gender_pronoun_name: expandedPerson.gender_pronoun_name,
          gender_pronoun_write_in: expandedPerson.gender_pronoun_write_in,
          household_id: expandedPerson.household_id,
          expand: {
            session: expandedSession ?? null,
            assigned_bunk: assignedBunk ?? null,
          },
        } satisfies Camper
      })

      // Sort: enrolled first, then by session type priority
      allCampers.sort((a, b) => {
        const aType = (a.expand.session as { session_type?: string } | undefined)?.session_type
        const bType = (b.expand.session as { session_type?: string } | undefined)?.session_type
        return sortEnrolledFirst(a.attendee_status, aType, b.attendee_status, bType)
      })

      return { allCampers }
    },
    enabled: isValidPersonId,
    retry: false,
  })

  const allAttendees = data?.allCampers ?? []
  const { enrolled } = filterEnrollmentsByStatus(allAttendees, (c) => c.attendee_status)

  return {
    enrolledCampers: enrolled,
    allAttendees,
    isLoading,
    error: error,
  }
}
