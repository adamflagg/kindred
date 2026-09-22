/**
 * Hook for fetching sibling data based on household_id
 * Finds other enrolled campers in the same household
 *
 * Owner rulings 2026-09-22 (adult camper journey §6.4): enrolled only —
 * pending never implies attendance; an adult viewer sees every household
 * member, adults included; a child viewer's set excludes adult programs,
 * which is what keeps parents out; no grade filter.
 */

import { useQuery } from '@tanstack/react-query'
import { pb } from '../../lib/pocketbase'
import {
  buildCamperJourneySessionTypeFilter,
  buildKidProgramSessionTypeFilter,
} from '../../utils/sessionTypePredicates'
import type {
  PersonsResponse,
  AttendeesResponse,
  BunkAssignmentsResponse,
  BunksResponse,
  CampSessionsResponse,
} from '../../types/pocketbase-types'
import { sortEnrolledFirst } from '../../utils/enrollmentSort'
import type { SiblingWithEnrollment } from './types'

export interface UseSiblingsResult {
  siblings: SiblingWithEnrollment[]
  isLoading: boolean
  error: Error | null
}

export function useSiblings(
  householdId: number | undefined,
  personCmId: number | null,
  currentYear: number,
  viewer: 'child' | 'adult' = 'child'
): UseSiblingsResult {
  const {
    data: siblings = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['camper-siblings', householdId, personCmId, currentYear, viewer],
    queryFn: async () => {
      if (!householdId || householdId === 0 || !personCmId) {
        return []
      }

      // Find other persons with the same household_id. Parents are excluded
      // by PROGRAM (kid programs exclude 'adult'), not by grade — do not
      // re-add a `grade > 0` filter here.
      const siblingFilter = `household_id = ${householdId} && cm_id != ${personCmId} && year = ${currentYear}`

      let siblingPersons: PersonsResponse[]
      try {
        siblingPersons = await pb.collection<PersonsResponse>('persons').getFullList({
          filter: siblingFilter,
          sort: '-birthdate', // Oldest first
        })
      } catch (err) {
        console.error('Error fetching siblings:', err)
        return []
      }

      if (siblingPersons.length === 0) return []

      // For each household member, check if they're enrolled (status_id = 2)
      // in a qualifying program this year — the viewer-dependent set decides
      // which programs qualify (spec §6.4).
      const siblingsWithEnrollment = await Promise.all(
        siblingPersons.map(async (siblingPerson) => {
          const sessionTypeFilter =
            viewer === 'adult'
              ? buildCamperJourneySessionTypeFilter()
              : buildKidProgramSessionTypeFilter()
          const enrollmentFilter = `person_id = ${siblingPerson.cm_id} && year = ${currentYear} && status_id = 2 && (${sessionTypeFilter})`

          try {
            const attendees = await pb
              .collection('attendees')
              .getFullList<AttendeesResponse<{ session?: CampSessionsResponse }>>({
                filter: enrollmentFilter,
                expand: 'session',
                $autoCancel: false,
              })

            if (attendees.length === 0) {
              return null // No attendee records this year
            }

            // Sort enrolled first, then by session type priority
            const sortedAttendees = attendees.sort((a, b) => {
              const aType = a.expand.session?.session_type ?? 'unknown'
              const bType = b.expand.session?.session_type ?? 'unknown'
              return sortEnrolledFirst(a.status, aType, b.status, bType)
            })

            const primaryAttendee = sortedAttendees[0]
            if (!primaryAttendee) {
              return null
            }
            const session = primaryAttendee.expand.session
            const additionalSessions = sortedAttendees
              .slice(1)
              .map((a) => a.expand.session)
              .filter((s): s is CampSessionsResponse => s !== undefined)
              .map((s) => ({ name: s.name, session_type: s.session_type }))

            // Try to get bunk assignment
            let bunkName: string | null = null
            if (session) {
              try {
                const assignments = await pb
                  .collection('bunk_assignments')
                  .getFullList<BunkAssignmentsResponse<{ bunk?: BunksResponse }>>({
                    filter: `person = "${siblingPerson.id || ''}" && session = "${session.id || ''}" && year = ${currentYear}`,
                    expand: 'bunk',
                    $autoCancel: false,
                  })

                if (assignments.length > 0 && assignments[0]) {
                  bunkName = assignments[0].expand.bunk?.name ?? null
                }
              } catch {
                // Assignment fetch failed, continue without bunk
              }
            }

            return {
              ...siblingPerson,
              ...(session && {
                session: {
                  id: session.id,
                  cm_id: session.cm_id,
                  name: session.name,
                  session_type: session.session_type,
                  start_date: session.start_date,
                  end_date: session.end_date,
                },
              }),
              bunkName,
              attendeeStatus: primaryAttendee.status,
              additionalSessions,
            } satisfies SiblingWithEnrollment
          } catch (err) {
            console.error(`Error checking enrollment for sibling ${siblingPerson.cm_id}:`, err)
            return null
          }
        })
      )

      // Filter out nulls (siblings not enrolled). TS infers the narrowing from
      // `s !== null` (inferred type predicate), so no explicit annotation is
      // needed — and the precise literal type is a subtype of
      // SiblingWithEnrollment, which the hook's return boundary requires.
      return siblingsWithEnrollment.filter((s) => s !== null)
    },
    enabled: !!(householdId && householdId > 0),
    staleTime: 0, // Always fetch fresh data
  })

  return {
    siblings,
    isLoading,
    error: error,
  }
}
