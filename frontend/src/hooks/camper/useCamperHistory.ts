/**
 * Hook for fetching camper's historical session and bunk data
 * Aggregates current year and past years' camp history
 */

import { useQuery } from '@tanstack/react-query'
import { pb } from '../../lib/pocketbase'
import { isSummerCampSessionType, isMainSession } from '../../utils/sessionTypePredicates'
import { filterEnrollmentsByStatus, toDisplayList } from '../../utils/enrollmentFilter'
import type { Camper } from '../../types/app-types'
import type {
  BunkAssignmentsResponse,
  CampSessionsResponse,
  BunksResponse,
} from '../../types/pocketbase-types'
import type { HistoricalRecord } from './types'

/** Build HistoricalRecord entries from current-year campers */
function buildCurrentYearRecords(campers: Camper[], currentYear: number): HistoricalRecord[] {
  const records: HistoricalRecord[] = []
  for (const c of campers) {
    if (c.expand?.session) {
      const session = c.expand.session
      const assignedBunk = c.expand.assigned_bunk
      const isEnrolled = c.attendee_status === 'enrolled'
      records.push({
        year: currentYear,
        sessionName: session.name || 'Unknown',
        sessionType: session.session_type,
        bunkName: assignedBunk?.name ?? 'Unassigned',
        startDate: session.start_date,
        endDate: session.end_date,
        ...(isEnrolled ? {} : { attendeeStatus: c.attendee_status }),
      })
    }
  }
  return records
}

/** Resolve the best campers to display for the current year */
function resolveCurrentYearCampers(
  allAttendees: Camper[],
  camperFallback: Camper | null
): Camper[] {
  const display = toDisplayList(filterEnrollmentsByStatus(allAttendees, (c) => c.attendee_status))
  return display.length > 0 ? display : camperFallback ? [camperFallback] : []
}

export interface UseCamperHistoryResult {
  camperHistory: HistoricalRecord[]
  isLoading: boolean
  error: Error | null
}

export function useCamperHistory(
  personCmId: number | null,
  currentYear: number,
  camper: Camper | null,
  allAttendees?: Camper[]
): UseCamperHistoryResult {
  const {
    data: camperHistory = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: [
      'camper-history-details',
      personCmId,
      currentYear,
      camper?.expand?.session,
      camper?.expand?.assigned_bunk,
      allAttendees?.length,
    ],
    queryFn: async () => {
      if (!personCmId) return []

      try {
        const allHistory: HistoricalRecord[] = []

        // Add current year records from enrolled (or best fallback) attendees
        const currentYearCampers = resolveCurrentYearCampers(allAttendees ?? [], camper)
        allHistory.push(...buildCurrentYearRecords(currentYearCampers, currentYear))

        // Fetch historical data from bunk_assignments for previous years
        // Query by person.cm_id to get assignments across all year-specific person records
        // (Person records are created per-year to preserve historical school info)
        const historicalFilter = `person.cm_id = ${personCmId} && year < ${currentYear}`
        const historicalAssignments = await pb
          .collection('bunk_assignments')
          .getFullList<
            BunkAssignmentsResponse<{ session?: CampSessionsResponse; bunk?: BunksResponse }>
          >({
            filter: historicalFilter,
            expand: 'session,bunk',
            sort: '-year',
            $autoCancel: false,
          })

        // Group by year and format
        const yearMap = new Map<number, HistoricalRecord>()

        for (const assignment of historicalAssignments) {
          const session = assignment.expand.session
          const bunk = assignment.expand.bunk

          if (session && isSummerCampSessionType(session.session_type)) {
            const year = assignment.year

            // Format session name based on type
            const sessionName = session.name

            // If we haven't seen this year yet, or if this is a main session (preferred), add it
            const existing = yearMap.get(year)
            if (!existing || isMainSession(session)) {
              yearMap.set(year, {
                year,
                sessionName,
                sessionType: session.session_type,
                bunkName: bunk?.name ?? 'Unassigned',
                startDate: session.start_date,
                endDate: session.end_date,
              })
            }
          }
        }

        // Add historical records to array
        allHistory.push(...Array.from(yearMap.values()))

        // Sort by year descending
        allHistory.sort((a, b) => b.year - a.year)

        return allHistory
      } catch (err) {
        console.error('Error fetching camp history:', err)
        // If error, at least return current year data from enrolled campers
        const fallbackCampers = resolveCurrentYearCampers(allAttendees ?? [], camper)
        return buildCurrentYearRecords(fallbackCampers, currentYear)
      }
    },
    enabled: !!personCmId && !!camper,
  })

  return {
    camperHistory,
    isLoading,
    error: error,
  }
}
