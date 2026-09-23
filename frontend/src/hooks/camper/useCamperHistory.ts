/**
 * Hook for fetching camper's historical session and bunk data
 * Aggregates current year and past years' camp history
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { isAtCampSessionType } from '../../utils/sessionTypePredicates'
import { filterEnrollmentsByStatus, toDisplayList } from '../../utils/enrollmentFilter'
import { queryKeys } from '../../utils/queryKeys'
import { fetchParentMainSessions } from './fetchCamperJourney'
import { byYearThenChronological } from './journeyOrder'
import { currentYearCabin, type CabinLabel } from './teenCabinLabel'
import { useCamperJourney } from './useCamperJourney'
import type { Camper } from '../../types/app-types'
import type { CampSessionsResponse } from '../../types/pocketbase-types'
import type { HistoricalRecord, JourneyCounts } from './types'

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
 * A current-year record before the Q9 cabin rule is applied — carries the
 * session's `cm_id` (not part of the public `HistoricalRecord` shape) so the
 * REACTIVE resolution step below can key into the registry's teen-cabin map,
 * and `bunkName` here is the raw CampMinder value, unfiltered.
 */
interface RawCurrentYearRecord extends HistoricalRecord {
  sessionCmId: number
}

// M4 (review, kindred#2753): a module-level empty array, not a fresh
// `[]` default on every render while the query has no data — that busted
// both useMemos below it, so camperHistory was a new array every render.
const NO_CURRENT: RawCurrentYearRecord[] = []

/**
 * Build raw HistoricalRecord entries from current-year campers. AG is never
 * shown as its own session — a surviving AG camper is relabeled to its
 * parent main (name from `parentByKey`, type forced to 'main'). The cabin
 * rule (Q9, "Unassigned" included) is applied afterward, in `useCamperHistory`
 * — this function is pure sync data-shaping and carries no dependency on the
 * async teen-cabin registry read.
 */
function buildCurrentYearRecords(
  campers: Camper[],
  currentYear: number,
  parentByKey: Map<string, CampSessionsResponse>
): RawCurrentYearRecord[] {
  const records: RawCurrentYearRecord[] = []
  for (const c of campers) {
    const session = c.expand?.session
    if (!session) continue
    const assignedBunk = c.expand.assigned_bunk
    const isEnrolled = c.attendee_status === 'enrolled'
    const isAg = session.session_type === 'ag'
    const parent = isAg ? parentByKey.get(`${currentYear}:${session.parent_id}`) : undefined
    const sessionName = parent?.name || session.name || 'Unknown'
    const sessionType = isAg ? 'main' : session.session_type
    records.push({
      year: currentYear,
      sessionName,
      sessionType,
      sessionCmId: session.cm_id,
      ...(assignedBunk?.name !== undefined ? { bunkName: assignedBunk.name } : {}),
      startDate: session.start_date,
      endDate: session.end_date,
      ...(isEnrolled ? {} : { attendeeStatus: c.attendee_status }),
    })
  }
  return records
}

/**
 * Q9 for CURRENT-year rows (owner ruling 2026-09-22, late): a TLI/SCIT row's
 * cabin comes ONLY from `teenCabins` (the registry-resolved map
 * `useCamperJourney` already reads for prior years, keyed by year+session) —
 * never the raw CampMinder bunk, which is usually a program group ("SCIT A",
 * "TLI"). Quest never shows a cabin at all; its "bunk" is a trip name.
 * "Unassigned" appears only for a current-year *bunkable* (main/embedded/ag)
 * session still lacking any label. Applied as a separate, reactive step (not
 * inside the attendee-keyed query above) so a teen-cabin registry read that
 * settles AFTER the current-year rows are cached still relabels them, rather
 * than baking a stale (or empty) map into that query's result forever.
 */
function applyCurrentYearCabinRule(
  records: RawCurrentYearRecord[],
  currentYear: number,
  teenCabins: Map<string, CabinLabel>
): HistoricalRecord[] {
  return records.map(({ sessionCmId, bunkName: rawBunkName, ...rest }) => {
    const cabin = currentYearCabin(
      rest.sessionType,
      currentYear,
      sessionCmId,
      rawBunkName,
      teenCabins
    )
    const bunkName =
      cabin.bunkName ?? (isAtCampSessionType(rest.sessionType) ? 'Unassigned' : undefined)
    return {
      ...rest,
      ...(bunkName !== undefined ? { bunkName } : {}),
      ...(cabin.bunkNameRecorded !== undefined ? { bunkNameRecorded: cabin.bunkNameRecorded } : {}),
    }
  })
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
  counts: JourneyCounts
  isLoading: boolean
  error: Error | null
}

export function useCamperHistory(
  personCmId: number | null,
  currentYear: number,
  camper: Camper | null,
  allAttendees?: Camper[]
): UseCamperHistoryResult {
  // Prior years + header counts: the one shared feed every journey surface reads.
  const journey = useCamperJourney(personCmId, currentYear)

  // Current year from live attendees, with AG collapse + relabel (unchanged).
  // The key is built from the SAME resolved list the queryFn uses (CR #4,
  // kindred#2753) — the ids, statuses and bunk ids of every current-year
  // attendee that will actually be rendered, not object identity or
  // `.length`, which can hold steady while a non-primary attendee's
  // session/status/bunk changes underneath it.
  const currentYearCampers = resolveCurrentYearCampers(allAttendees ?? [], camper)
  const {
    data: currentRows = NO_CURRENT,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.currentYearCamperRows(personCmId, currentYear, currentYearCampers),
    queryFn: async () => {
      const currentCampers = collapseAgIntoMain(currentYearCampers)
      const agPairs: Array<{ year: number; cmId: number }> = []
      for (const c of currentCampers) {
        const s = c.expand?.session
        if (s?.session_type === 'ag') agPairs.push({ year: currentYear, cmId: s.parent_id })
      }
      let parentByKey = new Map<string, CampSessionsResponse>()
      try {
        parentByKey = await fetchParentMainSessions(agPairs)
      } catch (err) {
        console.error('Error resolving AG parent sessions:', err)
      }
      return buildCurrentYearRecords(currentCampers, currentYear, parentByKey)
    },
    enabled: !!personCmId && !!camper,
  })

  // Q9 (owner, 2026-09-22 late): reactive to the registry's teen-cabin map,
  // independent of the attendee-keyed query above.
  const resolvedCurrentRows = useMemo(
    () => applyCurrentYearCabinRule(currentRows, currentYear, journey.teenCabinsByWeekend),
    [currentRows, currentYear, journey.teenCabinsByWeekend]
  )

  // The SHARED comparator, not a second year-only one. This merge is where
  // the reported defect actually lived: prior-year records arrive
  // chronological by luck of the fetch order, the current year's do not, and
  // a year-only sort preserves both — so 2025 read correctly while 2026 read
  // "2a, 3a, FC1, FC6".
  const camperHistory = useMemo(
    () => [...resolvedCurrentRows, ...journey.rows].sort(byYearThenChronological),
    [resolvedCurrentRows, journey.rows]
  )

  return {
    camperHistory,
    counts: journey.counts,
    isLoading: isLoading || journey.isLoading,
    error: error ?? journey.error,
  }
}
