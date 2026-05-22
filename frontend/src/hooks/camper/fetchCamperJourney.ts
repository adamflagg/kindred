/**
 * Shared prior-year journey source. Lists every prior year a camper was
 * ENROLLED (curated types: summer + teen + family), labeling each row with its
 * bunk/day-group when an assignment exists. Sourcing from attendees (not
 * bunk_assignments) is what surfaces 2022 (a CampMinder export gap), teens, and
 * family camp uniformly.
 *
 * AG is never shown as its own session: a Main+AG same-year pair collapses to the
 * Main row, and an AG-only year is relabeled to its parent main (name resolved via
 * camp_sessions, since AG session names aren't reliably derivable).
 */
import { pb } from '../../lib/pocketbase'
import { buildCamperJourneySessionTypeFilter } from '../../utils/sessionTypePredicates'
import type {
  AttendeesResponse,
  BunkAssignmentsResponse,
  BunksResponse,
  CampSessionsResponse,
} from '../../types/pocketbase-types'
import type { HistoricalRecord } from './types'

interface SessionExpand {
  session?: CampSessionsResponse
}
interface AssignmentExpand {
  session?: CampSessionsResponse
  bunk?: BunksResponse
}

/**
 * Fetch parent-main `camp_sessions` for a set of (year, cm_id) pairs, keyed
 * `${year}:${cmId}`. Returns an empty map for no pairs (no query). Used to relabel
 * AG rows to their parent main — AG session names aren't reliably derivable.
 */
export async function fetchParentMainSessions(
  pairs: Array<{ year: number; cmId: number }>
): Promise<Map<string, CampSessionsResponse>> {
  const out = new Map<string, CampSessionsResponse>()
  const unique = new Map<string, { year: number; cmId: number }>()
  for (const p of pairs) unique.set(`${p.year}:${p.cmId}`, p)
  if (unique.size === 0) return out
  const orClause = [...unique.values()]
    .map((p) => `(year = ${p.year} && cm_id = ${p.cmId})`)
    .join(' || ')
  const sessions = await pb
    .collection<CampSessionsResponse>('camp_sessions')
    .getFullList({ filter: orClause })
  for (const s of sessions) out.set(`${s.year}:${s.cm_id}`, s)
  return out
}

export async function fetchCamperJourney(
  personCmId: number,
  currentYear: number
): Promise<HistoricalRecord[]> {
  if (!personCmId || Number.isNaN(personCmId)) return []

  const typeFilter = buildCamperJourneySessionTypeFilter()

  // 1. Prior-year enrollments — the journey's source of truth.
  const attendees = await pb.collection<AttendeesResponse<SessionExpand>>('attendees').getFullList({
    filter: `person_id = ${personCmId} && year < ${currentYear} && status = "enrolled" && (${typeFilter})`,
    expand: 'session',
  })

  if (attendees.length === 0) return []

  // Collapse AG sub-tracks into their parent main: when both a main session and
  // its AG child are enrolled the same year, AG isn't a separate attendance —
  // show one Main row. AG enrolled without its parent main keeps its own row.
  // This is the ONLY same-year row collapse (family/quest/teen alongside summer
  // stay distinct).
  const enrolledByYear = new Map<number, Set<number>>()
  for (const att of attendees) {
    const cmId = att.expand?.session?.cm_id
    if (cmId === undefined) continue
    const set = enrolledByYear.get(att.year) ?? new Set<number>()
    set.add(cmId)
    enrolledByYear.set(att.year, set)
  }
  const deduped = attendees.filter((att) => {
    const session = att.expand?.session
    if (session?.session_type !== 'ag') return true
    // AG row drops only when its parent main is also enrolled that year;
    // an unmatched parent_id (e.g. 0) is never present in enrolledByYear → kept.
    return !enrolledByYear.get(att.year)?.has(session.parent_id)
  })

  // 2. Prior-year bunk assignments — used ONLY to label a row, never to gate it.
  const assignments = await pb
    .collection<BunkAssignmentsResponse<AssignmentExpand>>('bunk_assignments')
    .getFullList({
      filter: `person.cm_id = ${personCmId} && year < ${currentYear}`,
      expand: 'session,bunk',
    })

  const assignmentsByYear = new Map<number, BunkAssignmentsResponse<AssignmentExpand>[]>()
  for (const a of assignments) {
    const list = assignmentsByYear.get(a.year) ?? []
    list.push(a)
    assignmentsByYear.set(a.year, list)
  }

  // Resolve parent-main sessions for any surviving AG rows (AG is relabeled to its
  // parent main; AG names aren't derivable). One query, fires only when AG present.
  const agPairs: Array<{ year: number; cmId: number }> = []
  for (const att of deduped) {
    const s = att.expand?.session
    if (s?.session_type === 'ag') agPairs.push({ year: att.year, cmId: s.parent_id })
  }
  const parentByKey = await fetchParentMainSessions(agPairs)

  const records = deduped.map((att): HistoricalRecord => {
    const session = att.expand?.session
    const year = att.year
    const yearAssignments = assignmentsByYear.get(year) ?? []

    // Bunk-label join precedence (spec §7):
    // 1. exact (year, session) match
    let match = yearAssignments.find((a) => a.expand?.session?.cm_id === session?.cm_id)
    // 2. else year-fallback ONLY when the year has exactly one assignment
    if (!match && yearAssignments.length === 1) match = yearAssignments[0]
    // 3. else (>=2 assignments, no match, or zero) → no label
    const bunkName = match?.expand?.bunk?.name

    // AG is never shown as its own session (spec §3). For a surviving AG-only row,
    // relabel to its parent main: name from the camp_sessions lookup (AG names
    // aren't derivable from the AG session name), session_type forced to 'main'.
    // The AG bunk above already comes from the exact (year, AG-session) match —
    // in the data AG bunks are filed under the AG session itself.
    const parent =
      session?.session_type === 'ag' ? parentByKey.get(`${year}:${session.parent_id}`) : undefined
    const displaySession = parent ?? session
    const sessionType = session?.session_type === 'ag' ? 'main' : (session?.session_type ?? '')

    return {
      year,
      sessionName: displaySession?.name ?? 'Unknown',
      sessionType,
      ...(bunkName !== undefined ? { bunkName } : {}),
      ...(displaySession?.start_date !== undefined ? { startDate: displaySession.start_date } : {}),
      ...(displaySession?.end_date !== undefined ? { endDate: displaySession.end_date } : {}),
    }
  })

  return records.sort((a, b) => b.year - a.year)
}
