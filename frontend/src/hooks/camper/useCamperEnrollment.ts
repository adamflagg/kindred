/**
 * Hook for fetching camper enrollment data
 * Queries attendees with enrollment status and builds Camper objects
 */

import { useQuery } from '@tanstack/react-query'
import { pb } from '../../lib/pocketbase'
import { VALID_SUMMER_SESSION_TYPES } from '../../constants/sessionTypes'

import { sortEnrolledFirst } from '../../utils/enrollmentSort'
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
  enrolledCampers: Camper[]
  isLoading: boolean
  error: Error | null
}

export function useCamperEnrollment(
  personCmId: number | null,
  currentYear: number
): UseCamperEnrollmentResult {
  const isValidPersonId = !!personCmId && !isNaN(personCmId)

  const {
    data: enrolledCampers = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['enrolled-campers', personCmId, currentYear],
    queryFn: async () => {
      if (!personCmId) throw new Error('Invalid person ID')

      // Query attendees with enrollment status check - source of truth for enrollment
      // Filter to only valid summer session types (main, embedded, ag)
      const sessionTypeFilter = VALID_SUMMER_SESSION_TYPES.map(
        (t) => `session.session_type = "${t}"`
      ).join(' || ')
      const filter = `person_id = ${personCmId} && year = ${currentYear} && (${sessionTypeFilter})`

      const attendees = await pb.collection<AttendeesResponse>('attendees').getFullList({
        filter,
        expand: 'person,session',
      })

      if (attendees.length === 0) {
        return []
      }

      // Person data is now expanded in attendees, get from first attendee
      const person = (attendees[0]?.expand as AttendeeExpand | undefined)?.person
      if (!person) {
        throw new Error(`Person with CampMinder ID ${personCmId} not found`)
      }

      // Load all assignments for this person with expand to get bunk and session info
      const assignmentFilter = `year = ${currentYear}`
      const allAssignments = await pb
        .collection<BunkAssignmentsResponse>('bunk_assignments')
        .getFullList({
          filter: assignmentFilter,
          expand: 'person,session,bunk',
        })

      // Filter assignments for this person (using person CM ID from expanded person)

      const personAssignments = allAssignments.filter(
        (a) => (a.expand as AssignmentExpand | undefined)?.person?.cm_id === personCmId
      )

      // Transform attendees to campers
      const campers = attendees.map((attendee) => {
        const expand = attendee.expand as AttendeeExpand | undefined
        const expandedSession = expand?.session
        const expandedPerson = expand?.person ?? person

        // Find assignment for this attendee's session
        // First try exact session match (for regular campers)

        let assignment = personAssignments.find(
          (a) =>
            (a.expand as AssignmentExpand | undefined)?.session?.cm_id === expandedSession?.cm_id
        )

        // If no match found (e.g., AG campers with parent session assignments),
        // fall back to any assignment for this person in the current year
        if (!assignment && personAssignments.length > 0) {
          assignment = personAssignments[0] // Person only has one bunk per year
        }

        const assignedBunk = (assignment?.expand as AssignmentExpand | undefined)?.bunk

        const displayName = `${expandedPerson.first_name} ${expandedPerson.last_name}`.trim() || ''
        const g = expandedPerson.gender
        const gender: 'M' | 'F' | 'NB' = g === 'M' || g === 'F' || g === 'NB' ? g : 'NB'

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
          assigned_bunk_cm_id: assignedBunk?.cm_id,
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
            session: expandedSession,
            assigned_bunk: assignedBunk,
          },
        } as Camper
      })

      // Sort: enrolled first, then by session type priority
      campers.sort((a, b) => {
        const aType = (a.expand?.session as { session_type?: string } | undefined)?.session_type
        const bType = (b.expand?.session as { session_type?: string } | undefined)?.session_type
        return sortEnrolledFirst(a.attendee_status, aType, b.attendee_status, bType)
      })

      return campers
    },
    enabled: isValidPersonId,
    retry: false,
  })

  return {
    enrolledCampers,
    isLoading,
    error: error,
  }
}
