/**
 * Hook for fetching camper's historical session and bunk data
 * Aggregates current year and past years' camp history
 */

import { useQuery } from '@tanstack/react-query'
import { isAtCampSessionType } from '../../utils/sessionTypePredicates'
import { filterEnrollmentsByStatus, toDisplayList } from '../../utils/enrollmentFilter'
import { fetchCamperJourney, fetchParentMainSessions } from './fetchCamperJourney'
import { byYearThenChronological } from './journeyOrder'
import type { Camper } from '../../types/app-types'
import type { CampSessionsResponse } from '../../types/pocketbase-types'
import type { HistoricalRecord } from './types'

/**
 * Drop a current-year AG camper when its parent main is also enrolled this year
 * (AG is a sub-track, not a separate attendance → show one Main row). An AG
 * camper without its parent main enrolled keeps its row (to be relabeled).
 */
function collapseAgIntoMain(campers: Camper[]): Camper[] {
  const cmIds = new Set<number>()
  for (const c of campers) {
    const cm = c.expand?.session?.cm_id
    if (cm !== undefined) cmIds.add(cm)
  }
  return campers.filter((c) => {
    const s = c.expand?.session
    if (s?.session_type !== 'ag') return true
    return !cmIds.has(s.parent_id)
  })
}

/**
 * Build HistoricalRecord entries from current-year campers. AG is never shown as
 * its own session — a surviving AG camper is relabeled to its parent main (name
 * from `parentByKey`, type forced to 'main'). "Unassigned" appears only for a
 * current-year *bunkable* (main/embedded/ag) session with no bunk yet.
 */
function buildCurrentYearRecords(
  campers: Camper[],
  currentYear: number,
  parentByKey: Map<string, CampSessionsResponse>
): HistoricalRecord[] {
  const records: HistoricalRecord[] = []
  for (const c of campers) {
    const session = c.expand?.session
    if (!session) continue
    const assignedBunk = c.expand.assigned_bunk
    const isEnrolled = c.attendee_status === 'enrolled'
    const isAg = session.session_type === 'ag'
    const parent = isAg ? parentByKey.get(`${currentYear}:${session.parent_id}`) : undefined
    const sessionName = parent?.name || session.name || 'Unknown'
    const sessionType = isAg ? 'main' : session.session_type
    const bunkName =
      assignedBunk?.name ?? (isAtCampSessionType(sessionType) ? 'Unassigned' : undefined)
    records.push({
      year: currentYear,
      sessionName,
      sessionType,
      ...(bunkName !== undefined ? { bunkName } : {}),
      startDate: session.start_date,
      endDate: session.end_date,
      ...(isEnrolled ? {} : { attendeeStatus: c.attendee_status }),
    })
  }
  return records
}

/** Resolve the best campers to display for the current year */
function resolveCurrentYearCampers(
  allAttendees: Camper[],
  camperFallback: Camper | null
): Camper[] {
  const display = toDisplayList(filterEnrollmentsByStatus(allAttendees, (c) => c.attendee_status))
  if (display.length > 0) return display
  if (camperFallback) return [camperFallback]
  return []
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
        // Current year from live attendees, with AG collapse + relabel.
        const currentCampers = collapseAgIntoMain(
          resolveCurrentYearCampers(allAttendees ?? [], camper)
        )
        const agPairs: Array<{ year: number; cmId: number }> = []
        for (const c of currentCampers) {
          const s = c.expand?.session
          if (s?.session_type === 'ag') agPairs.push({ year: currentYear, cmId: s.parent_id })
        }
        const parentByKey = await fetchParentMainSessions(agPairs)
        allHistory.push(...buildCurrentYearRecords(currentCampers, currentYear, parentByKey))
        // Prior years from the shared enrollment-sourced fetcher.
        allHistory.push(...(await fetchCamperJourney(personCmId, currentYear)))
        // Sort by year descending.
        // The SHARED comparator, not a second year-only one. This merge is
        // where the reported defect actually lived: prior-year records arrive
        // chronological by luck of the fetch order, the current year's do not,
        // and a year-only sort preserves both — so 2025 read correctly while
        // 2026 read "2a, 3a, FC1, FC6".
        allHistory.sort(byYearThenChronological)
        return allHistory
      } catch (err) {
        console.error('Error fetching camp history:', err)
        const fallbackCampers = collapseAgIntoMain(
          resolveCurrentYearCampers(allAttendees ?? [], camper)
        )
        return buildCurrentYearRecords(fallbackCampers, currentYear, new Map())
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
