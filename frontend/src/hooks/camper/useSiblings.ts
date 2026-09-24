/**
 * Hook for fetching sibling data based on household_id
 * Finds other enrolled campers in the same household
 *
 * Owner rulings 2026-09-22: enrolled only —
 * pending never implies attendance; an adult viewer sees every household
 * member, adults included; a child viewer's set excludes adult programs,
 * which is what keeps parents out; no grade filter.
 */

import { useQuery } from '@tanstack/react-query'
import { pb } from '../../lib/pocketbase'
import {
  buildCamperJourneySessionTypeFilter,
  buildKidProgramSessionTypeFilter,
  isAdultSessionType,
  isFamilySessionType,
  isQuestSessionType,
  isTeenProgramType,
} from '../../utils/sessionTypePredicates'
import type {
  PersonsResponse,
  AttendeesResponse,
  BunkAssignmentsResponse,
  BunksResponse,
  CampSessionsResponse,
} from '../../types/pocketbase-types'
import { sortEnrolledFirst } from '../../utils/enrollmentSort'
import { earliestSessionStart } from '../../utils/displayAge'
import type { SiblingWithEnrollment } from './types'

export interface UseSiblingsResult {
  siblings: SiblingWithEnrollment[]
  isLoading: boolean
  error: Error | null
}

type SessionOrderFields = Pick<CampSessionsResponse, 'start_date' | 'name'>

/** Earliest start date first (a missing date sorts last), then by name. */
function compareStartThenName(
  a: SessionOrderFields | undefined,
  b: SessionOrderFields | undefined
): number {
  const aStart = a?.start_date ?? ''
  const bStart = b?.start_date ?? ''
  if (aStart !== bStart) {
    if (aStart === '') return 1
    if (bStart === '') return -1
    return aStart < bStart ? -1 : 1
  }
  return (a?.name ?? '').localeCompare(b?.name ?? '')
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
      // which programs qualify.
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

            // Sort enrolled first, then by session type priority (summer types
            // first). Family, teen and adult programs all share one priority,
            // so break those ties by start date, then name — otherwise the
            // primary program would depend on PocketBase's return order.
            const sortedAttendees = attendees.sort((a, b) => {
              const aSession = a.expand.session
              const bSession = b.expand.session
              const aType = aSession?.session_type ?? 'unknown'
              const bType = bSession?.session_type ?? 'unknown'
              return (
                sortEnrolledFirst(a.status, aType, b.status, bType) ||
                compareStartThenName(aSession, bSession)
              )
            })

            const primaryAttendee = sortedAttendees[0]
            if (!primaryAttendee) {
              return null
            }
            const session = primaryAttendee.expand.session
            const earliestStart = earliestSessionStart(sortedAttendees.map((a) => a.expand.session))
            const additionalSessions = sortedAttendees
              .slice(1)
              .map((a) => a.expand.session)
              .filter((s): s is CampSessionsResponse => s !== undefined)
              .map((s) => ({ name: s.name, session_type: s.session_type }))

            // Try to get bunk assignment. Family camp and adult programs have
            // no cabin here: CampMinder's bunk for a family session is the
            // day group, which must never render as a cabin (kindred#2466).
            // Nor do TLI/SCIT and Quest (owner ruling 2026-09-22 late, Q9):
            // a teen program's bunk is a program group ("SCIT A", "TLI") and
            // a Quest's is a trip name.
            let bunkName: string | null = null
            if (
              session &&
              !isFamilySessionType(session.session_type) &&
              !isAdultSessionType(session.session_type) &&
              !isTeenProgramType(session.session_type) &&
              !isQuestSessionType(session.session_type)
            ) {
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
              ...(earliestStart && { earliestSessionStart: earliestStart }),
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
    // Deliberately below the app default: each sibling's cabin comes from
    // bunk_assignments, and none of its writers (board drag-drop, Refresh
    // Bunking) invalidate 'camper-siblings', so a cached list would keep
    // showing a cabin the board has since changed.
    staleTime: 0,
  })

  return {
    siblings,
    isLoading,
    error: error,
  }
}
