/**
 * Hook for computing school/congregation/city cohort counts
 * for the camper detail panel (#15, #15b).
 *
 * Query strategy: fetch all enrolled attendees for the same session with
 * person + session expand, then count and collect matches client-side.
 *
 * Session convention: uses the primary enrolled session (session_cm_id from
 * the primary attendee after enrolled-first sort).
 *
 * Filtering:
 *  - status = "enrolled" (matches useSessionCamperPersons / SessionList /
 *    pocketbaseDataFetchers — predominant frontend convention). Excludes the
 *    current camper.
 *  - When session_type !== 'ag' AND self has a known gender, restricts cohort
 *    matches to same gender as self (non-AG bunks are gender-segregated, so
 *    opposite-gender campers are not valid bunkmates). When self has no
 *    gender on file, the gender filter is skipped — we cannot determine
 *    bunkability so surface all candidates and let the staffer judge.
 */
import { useQuery } from '@tanstack/react-query'
import { pb } from '../lib/pocketbase'
import { queryKeys, syncDataOptions } from '../utils/queryKeys'
import { isAgSession } from '../utils/sessionTypePredicates'

export interface CohortMatchedAttendee {
  attendeeId: string
  personCmId: number
  firstName: string
  lastName: string
  preferredName: string | null
  grade: number | null
  gender: string | null
}

export interface CohortEntry {
  label: string
  count: number
  attendees: CohortMatchedAttendee[]
}

export interface CamperCohorts {
  school: CohortEntry | null
  congregation: CohortEntry | null
  city: CohortEntry | null
  sessionType: string
  /**
   * True when the gender filter was skipped (AG session, or self has no
   * gender on file). Drives the modal subtitle so it honestly reflects what
   * was actually filtered rather than inferring from session type alone.
   */
  allGenders: boolean
}

export interface UseCamperCohortsResult {
  cohorts: CamperCohorts | null
  isLoading: boolean
}

interface AttendeeWithExpands {
  id: string
  person_id: number
  status?: string
  expand?: {
    person?: {
      cm_id?: number
      first_name?: string
      last_name?: string
      preferred_name?: string | null
      grade?: number | null
      gender?: string | null
      normalized_school?: string | null
      normalized_congregation?: string | null
      normalized_city?: string | null
    }
    session?: {
      session_type?: string
    }
  }
}

/**
 * Returns cohort counts and matched attendees for a camper within their session.
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

      const attendees = await pb.collection('attendees').getFullList<AttendeeWithExpands>({
        filter: `session.cm_id = ${sessionCmId} && year = ${year} && status = "enrolled"`,
        expand: 'person,session',
      })

      if (attendees.length === 0) return null

      const selfAttendee = attendees.find((a) => a.expand?.person?.cm_id === personCmId)
      const selfPerson = selfAttendee?.expand?.person
      if (!selfPerson) return null

      const selfSession = selfAttendee?.expand?.session
      const sessionType = selfSession?.session_type ?? 'main'
      const isAG = selfSession ? isAgSession(selfSession) : false
      const selfGender = selfPerson.gender ?? null
      // When self has no gender on file we cannot judge bunkability — fall back
      // to AG behavior (no gender filter) rather than silently matching only
      // other null-gender campers via the `null !== null` quirk.
      const skipGenderFilter = isAG || selfGender === null

      const others = attendees.filter((a) => {
        // Defense in depth — server filter already restricts to enrolled.
        if (a.status && a.status !== 'enrolled') return false
        const p = a.expand?.person
        if (!p || p.cm_id === personCmId) return false
        if (!skipGenderFilter && p.gender !== selfGender) return false
        return true
      })

      function buildEntry(
        selfValue: string | null | undefined,
        field: 'normalized_school' | 'normalized_congregation' | 'normalized_city'
      ): CohortEntry | null {
        if (!selfValue) return null
        const matches = others.filter((a) => a.expand?.person?.[field] === selfValue)
        const attendees: CohortMatchedAttendee[] = matches.map((a) => {
          const p = a.expand!.person!
          return {
            attendeeId: a.id,
            personCmId: p.cm_id ?? 0,
            firstName: p.first_name ?? '',
            lastName: p.last_name ?? '',
            preferredName: p.preferred_name ?? null,
            grade: p.grade ?? null,
            gender: p.gender ?? null,
          }
        })
        // Sort youngest-first with first-name tiebreaker — same convention the
        // requests-tab uses by default. Ungraded campers (null/0) sink to the
        // bottom regardless of name so the graded group reads cleanly.
        attendees.sort((a, b) => {
          const aGrade = a.grade && a.grade > 0 ? a.grade : null
          const bGrade = b.grade && b.grade > 0 ? b.grade : null
          if (aGrade !== bGrade) {
            if (aGrade === null) return 1
            if (bGrade === null) return -1
            return aGrade - bGrade
          }
          const aFirst = a.firstName.toLowerCase()
          const bFirst = b.firstName.toLowerCase()
          if (aFirst < bFirst) return -1
          if (aFirst > bFirst) return 1
          return 0
        })
        return { label: selfValue, count: attendees.length, attendees }
      }

      return {
        school: buildEntry(selfPerson.normalized_school, 'normalized_school'),
        congregation: buildEntry(selfPerson.normalized_congregation, 'normalized_congregation'),
        city: buildEntry(selfPerson.normalized_city, 'normalized_city'),
        sessionType,
        allGenders: skipGenderFilter,
      }
    },
    enabled,
    ...syncDataOptions,
  })

  return { cohorts, isLoading: enabled ? isLoading : false }
}
