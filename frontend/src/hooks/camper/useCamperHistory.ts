/**
 * Hook for fetching camper's historical session and bunk data
 * Aggregates current year and past years' camp history
 */

import { useQuery } from '@tanstack/react-query'
import { pb } from '../../lib/pocketbase'
import { isValidSummerSession } from '../../constants/sessionTypes'
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
  allEnrolledCampers?: Camper[]
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
      allEnrolledCampers?.length,
    ],
    queryFn: async () => {
      if (!personCmId) return []

      try {
        const allHistory: HistoricalRecord[] = []

        // Add current year data for ALL enrollments (multi-session support)
        const enrollments =
          allEnrolledCampers && allEnrolledCampers.length > 0
            ? allEnrolledCampers
            : camper
              ? [camper]
              : []

        for (const enrolled of enrollments) {
          if (enrolled.expand?.session) {
            const session = enrolled.expand.session
            const assignedBunk = enrolled.expand?.assigned_bunk
            allHistory.push({
              year: currentYear,
              sessionName: session.name || 'Unknown',
              sessionType: session.session_type,
              bunkName: assignedBunk?.name || 'Unassigned',
              startDate: session.start_date,
              endDate: session.end_date,
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
          const session = assignment.expand?.session
          const bunk = assignment.expand?.bunk

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
                bunkName: bunk?.name || 'Unassigned',
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
        // If error, at least return current year data for all enrollments
        const fallbackEnrollments =
          allEnrolledCampers && allEnrolledCampers.length > 0
            ? allEnrolledCampers
            : camper
              ? [camper]
              : []

        const fallback: HistoricalRecord[] = []
        for (const enrolled of fallbackEnrollments) {
          if (enrolled.expand?.session) {
            const session = enrolled.expand.session
            const assignedBunk = enrolled.expand?.assigned_bunk
            fallback.push({
              year: currentYear,
              sessionName: session.name || 'Unknown',
              sessionType: session.session_type,
              bunkName: assignedBunk?.name || 'Unassigned',
              startDate: session.start_date,
              endDate: session.end_date,
            })
          }
        }
        return fallback
      }
    },
    enabled: !!personCmId && !!camper,
  })

  return {
    camperHistory,
    isLoading,
    error: error as Error | null,
  }
}
