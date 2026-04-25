/**
 * Hook for computing school/congregation/city cohort counts
 * for the camper detail panel (#15).
 *
 * Query strategy: fetch all enrolled attendees for the same session with
 * person expand, then count matches client-side. This avoids complex
 * cross-table PocketBase filter syntax and keeps the query simple.
 *
 * Session convention: uses the primary enrolled session (session_cm_id from
 * the primary attendee after enrolled-first sort). For multi-session campers,
 * the first enrolled session is used.
 *
 * Filtering: status_id = 2 (enrolled only). Excludes the current camper.
 */
import { useQuery } from '@tanstack/react-query'
import { pb } from '../lib/pocketbase'
import { queryKeys } from '../utils/queryKeys'

export interface CohortEntry {
  label: string
  count: number
}

export interface CamperCohorts {
  school: CohortEntry | null
  congregation: CohortEntry | null
  city: CohortEntry | null
}

export interface UseCamperCohortsResult {
  cohorts: CamperCohorts | null
  isLoading: boolean
}

interface AttendeeWithPerson {
  id: string
  person_id: number
  status_id: number
  expand?: {
    person?: {
      cm_id?: number
      normalized_school?: string | null
      normalized_congregation?: string | null
      normalized_city?: string | null
    }
  }
}

/**
 * Returns cohort counts for a camper within their session.
 *
 * @param personCmId - CampMinder ID of the current camper (used for exclusion)
 * @param sessionCmId - CampMinder ID of the session to scope counts to
 * @param year - Camp year
 */
export function useCamperCohorts(
  personCmId: number | null,
  sessionCmId: number,
  year: number
): UseCamperCohortsResult {
  const enabled = !!personCmId && sessionCmId > 0

  const { data: cohorts = null, isLoading } = useQuery({
    queryKey: queryKeys.camperCohorts(personCmId, sessionCmId, year),
    queryFn: async (): Promise<CamperCohorts | null> => {
      if (!personCmId || sessionCmId <= 0) return null

      // Fetch all enrolled attendees for this session with person data expanded
      const attendees = await pb.collection('attendees').getFullList<AttendeeWithPerson>({
        filter: `session.cm_id = ${sessionCmId} && year = ${year} && status_id = 2`,
        expand: 'person',
      })

      if (attendees.length === 0) return null

      // Find the current camper's person record to get their normalized fields
      const selfAttendee = attendees.find((a) => a.expand?.person?.cm_id === personCmId)
      const selfPerson = selfAttendee?.expand?.person

      if (!selfPerson) return null

      // Other enrolled attendees (exclude self, enforce status_id = 2 client-side
      // for defensive correctness even though the server query already filters)
      const others = attendees.filter(
        (a) => a.expand?.person?.cm_id !== personCmId && a.status_id === 2
      )

      function countMatches(
        selfValue: string | null | undefined,
        field: 'normalized_school' | 'normalized_congregation' | 'normalized_city'
      ): CohortEntry | null {
        if (!selfValue) return null
        const count = others.filter((a) => a.expand?.person?.[field] === selfValue).length
        return { label: selfValue, count }
      }

      return {
        school: countMatches(selfPerson.normalized_school, 'normalized_school'),
        congregation: countMatches(selfPerson.normalized_congregation, 'normalized_congregation'),
        city: countMatches(selfPerson.normalized_city, 'normalized_city'),
      }
    },
    enabled,
    staleTime: 5 * 60 * 1000, // 5 min — sync data, doesn't change often
  })

  return { cohorts, isLoading: enabled ? isLoading : false }
}
