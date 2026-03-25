/**
 * Hook for fetching camper's historical session and bunk data
 * Aggregates current year and past years' camp history
 */

import { useQuery } from '@tanstack/react-query'
import { pb } from '../../lib/pocketbase'
import { isValidSummerSession } from '../../constants/sessionTypes'
import { filterEnrollmentsByStatus } from '../../utils/enrollmentFilter'
import type { Camper } from '../../types/app-types'
import type {
  BunkAssignmentsResponse,
  CampSessionsResponse,
  BunksResponse,
} from '../../types/pocketbase-types'
import type { HistoricalRecord } from './types'

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

        // Filter current year attendees: show only enrolled, or fallback to best non-enrolled
        const { enrolled, fallback } = filterEnrollmentsByStatus(
          allAttendees ?? [],
          (c) => c.attendee_status
        )

        const currentYearCampers =
          enrolled.length > 0 ? enrolled : fallback ? [fallback] : camper ? [camper] : []

        for (const currentCamper of currentYearCampers) {
          if (currentCamper.expand?.session) {
            const session = currentCamper.expand.session
            const assignedBunk = currentCamper.expand.assigned_bunk
            const isEnrolled = currentCamper.attendee_status === 'enrolled'
            allHistory.push({
              year: currentYear,
              sessionName: session.name || 'Unknown',
              sessionType: session.session_type,
              bunkName: assignedBunk?.name ?? 'Unassigned',
              startDate: session.start_date,
              endDate: session.end_date,
              // Only set attendeeStatus for non-enrolled records
              ...(isEnrolled ? {} : { attendeeStatus: currentCamper.attendee_status }),
            })
          }
        }

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

          if (session && isValidSummerSession(session.session_type)) {
            const year = assignment.year

            // Format session name based on type
            const sessionName = session.name

            // If we haven't seen this year yet, or if this is a main session (preferred), add it
            const existing = yearMap.get(year)
            if (!existing || session.session_type === 'main') {
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
        const { enrolled, fallback } = filterEnrollmentsByStatus(
          allAttendees ?? [],
          (c) => c.attendee_status
        )
        const fallbackCampers =
          enrolled.length > 0 ? enrolled : fallback ? [fallback] : camper ? [camper] : []

        const fallbackHistory: HistoricalRecord[] = []
        for (const currentCamper of fallbackCampers) {
          if (currentCamper.expand?.session) {
            const session = currentCamper.expand.session
            const assignedBunk = currentCamper.expand.assigned_bunk
            const isEnrolled = currentCamper.attendee_status === 'enrolled'
            fallbackHistory.push({
              year: currentYear,
              sessionName: session.name || 'Unknown',
              sessionType: session.session_type,
              bunkName: assignedBunk?.name ?? 'Unassigned',
              startDate: session.start_date,
              endDate: session.end_date,
              ...(isEnrolled ? {} : { attendeeStatus: currentCamper.attendee_status }),
            })
          }
        }
        return fallbackHistory
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
