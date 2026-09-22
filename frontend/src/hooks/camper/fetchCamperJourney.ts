/**
 * Shared prior-year journey source. Lists every prior year a camper was
 * ENROLLED (curated types: summer + teen + family, see #2113), labeling each
 * row with its housing when known: a bunk name for a summer/teen session, or
 * the household's resolved family-camp cabin for a family session (never the
 * CampMinder day group — see the family-housing override below, kindred#2466).
 * Sourcing from attendees (not bunk_assignments) is what surfaces 2022 (a
 * CampMinder export gap), teens, and family camp uniformly.
 *
 * AG is never shown as its own session: a Main+AG same-year pair collapses to the
 * Main row, and an AG-only year is relabeled to its parent main (name resolved via
 * camp_sessions, since AG session names aren't reliably derivable).
 *
 * Adult programs (2026-09, adult camper journey spec §5.2): adult rows are
 * labeled only by the attributed cabin from `/persons/{id}/housing`; an adult
 * viewer also gets the family weekends their household's children attended;
 * every cabin label is the string as recorded that year.
 */
import { pb } from '../../lib/pocketbase'
import { byYearThenChronological } from './journeyOrder'
import { buildCamperJourneySessionTypeFilter } from '../../utils/sessionTypePredicates'
import type {
  AttendeesResponse,
  BunkAssignmentsResponse,
  BunksResponse,
  CampSessionsResponse,
} from '../../types/pocketbase-types'
import type { HouseholdJourneyRow, PersonHousingWeekendRow } from '../../types/lodging'
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

/**
 * Reduce a household's family-camp journey to the one fact this file needs:
 * which cabin, if any, is safely attributable to which specific weekend, per
 * year. Only a year whose `housing_session_cm_id` names exactly one session
 * earns an entry — mirroring `HouseholdJourneyRow.housing_session_cm_id`'s
 * own ambiguity refusal (kindred#2461) rather than reimplementing it. A year
 * with no housing, an unresolved cabin name, or more than one weekend that
 * season produces no entry, and the caller shows nothing rather than guess.
 *
 * The cabin is named AS RECORDED (owner ruling 2026-09-22): the string staff
 * typed that year, `cabin_name_raw`, trimmed — not today's unit name, which
 * the weekend board's household card still shows.
 */
function familyHousingByYear(
  years: HouseholdJourneyRow[]
): Map<number, { sessionCmId: number; cabinName: string }> {
  const map = new Map<number, { sessionCmId: number; cabinName: string }>()
  for (const y of years) {
    const cabinName = (y.cabin_name_raw ?? '').trim()
    if (
      y.year !== undefined &&
      y.housing === 'placed' &&
      y.housing_session_cm_id !== null &&
      y.housing_session_cm_id !== undefined &&
      cabinName.length > 0
    ) {
      map.set(y.year, { sessionCmId: y.housing_session_cm_id, cabinName })
    }
  }
  return map
}

/** The server's attributed adult cabins, keyed `${year}:${sessionCmId}`. */
function adultHousingByWeekend(weekends: PersonHousingWeekendRow[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const w of weekends) {
    const name = (w.cabin_name ?? '').trim()
    if (w.year !== undefined && w.session_cm_id !== undefined && name.length > 0) {
      map.set(`${String(w.year)}:${String(w.session_cm_id)}`, name)
    }
  }
  return map
}

interface ParentFamilyWeekend {
  key: string
  year: number
  record: HistoricalRecord
}

/**
 * Family camp AS A PARENT (spec §5.2): every weekend a child in the household
 * was ENROLLED on (the household journey's `sessions` are built from enrolled
 * children only), except one the adult attended themself. Paper-registration
 * years carry no session and add nothing. Known limit: household membership
 * cannot tell a parent from an older sibling (backlog #19).
 */
function parentFamilyWeekends(
  years: HouseholdJourneyRow[],
  ownFamily: Set<string>,
  currentYear: number
): ParentFamilyWeekend[] {
  const out: ParentFamilyWeekend[] = []
  for (const y of years) {
    if (y.year === undefined || y.year > currentYear) continue
    const cabin = (y.cabin_name_raw ?? '').trim()
    for (const s of y.sessions ?? []) {
      const cmId = s.session_cm_id ?? 0
      if (cmId <= 0) continue
      const key = `${String(y.year)}:${String(cmId)}`
      if (ownFamily.has(key)) continue
      const labelled =
        y.housing === 'placed' && y.housing_session_cm_id === cmId && cabin.length > 0
      out.push({
        key,
        year: y.year,
        record: {
          year: y.year,
          sessionName: s.name ?? 'Unknown',
          sessionType: 'family',
          ...(labelled ? { bunkName: cabin } : {}),
          ...(s.start_date ? { startDate: s.start_date } : {}),
        },
      })
    }
  }
  return out
}

export interface CamperJourneyOptions {
  /**
   * The household's family-camp journey years (kindred#2073/#2461), already
   * fetched by the caller via `useHouseholdJourney` — this file makes no
   * fetch of its own for it. Defaults to empty for a camper with no
   * household on file, in which case every family row shows no housing at
   * all (never the day group).
   */
  familyHousingYears?: HouseholdJourneyRow[]
  /** The person's attributed adult-weekend cabins (`/persons/{id}/housing`). */
  adultHousingWeekends?: PersonHousingWeekendRow[]
  /** An adult viewer also sees the family weekends their household's children attended. */
  viewerIsAdult?: boolean
}

export interface CamperJourneyFeed {
  /** Prior years only, newest first. */
  rows: HistoricalRecord[]
  /** Distinct (year, session) family weekends, current year included. */
  familyWeekends: number
  /** Distinct (year, session) adult weekends, current year included. */
  adultWeekends: number
}

export async function fetchCamperJourney(
  personCmId: number,
  currentYear: number,
  options: CamperJourneyOptions = {}
): Promise<CamperJourneyFeed> {
  if (!personCmId || Number.isNaN(personCmId)) {
    return { rows: [], familyWeekends: 0, adultWeekends: 0 }
  }
  const { familyHousingYears = [], adultHousingWeekends = [], viewerIsAdult = false } = options

  const familyHousing = familyHousingByYear(familyHousingYears)
  const adultHousing = adultHousingByWeekend(adultHousingWeekends)

  const typeFilter = buildCamperJourneySessionTypeFilter()

  // 1. Enrollments — the journey's source of truth. The read runs THROUGH the
  // current year so the header counts include this year the way CampMinder's
  // years_at_camp does; the rows themselves stay prior-year.
  const allAttendees = await pb
    .collection<AttendeesResponse<SessionExpand>>('attendees')
    .getFullList({
      filter: `person_id = ${personCmId} && year <= ${currentYear} && status = "enrolled" && (${typeFilter})`,
      expand: 'session',
    })

  // (year, session) pairs — CampMinder reuses session ids across years, so a
  // bare session id would count three Keshet weekends as one.
  const weekendKeys = (type: string): Set<string> =>
    new Set(
      allAttendees
        .filter((a) => a.expand.session?.session_type === type && a.expand.session.cm_id > 0)
        .map((a) => `${String(a.year)}:${String(a.expand.session?.cm_id)}`)
    )
  const ownFamily = weekendKeys('family')
  const adultWeekends = weekendKeys('adult').size
  const parentFamily = viewerIsAdult
    ? parentFamilyWeekends(familyHousingYears, ownFamily, currentYear)
    : []
  const familyWeekends = new Set([...ownFamily, ...parentFamily.map((p) => p.key)]).size
  const parentRows = parentFamily.filter((p) => p.year < currentYear).map((p) => p.record)

  const attendees = allAttendees.filter((a) => a.year < currentYear)
  if (attendees.length === 0) {
    return { rows: parentRows.sort(byYearThenChronological), familyWeekends, adultWeekends }
  }

  // Collapse AG sub-tracks into their parent main: when both a main session and
  // its AG child are enrolled the same year, AG isn't a separate attendance —
  // show one Main row. AG enrolled without its parent main keeps its own row.
  // This is the ONLY same-year row collapse (family/quest/teen alongside summer
  // stay distinct).
  //
  // Guards against the `cm_id`/`parent_id` sentinel: both default to 0 when
  // absent (mirrors the same guard in agCollapse.ts for current-year
  // enrollments), so a non-positive parent_id never identifies a real parent.
  // Without the `> 0` checks, a cm_id-less session would seed 0 into
  // enrolledByYear and silently collapse an unrelated parentless AG row.
  const enrolledByYear = new Map<number, Set<number>>()
  for (const att of attendees) {
    const cmId = att.expand.session?.cm_id
    if (cmId === undefined || cmId <= 0) continue
    const set = enrolledByYear.get(att.year) ?? new Set<number>()
    set.add(cmId)
    enrolledByYear.set(att.year, set)
  }
  const deduped = attendees.filter((att) => {
    const session = att.expand.session
    if (session?.session_type !== 'ag' || session.parent_id <= 0) return true
    // AG row drops only when its parent main is also enrolled that year;
    // an unmatched parent_id is never present in enrolledByYear → kept.
    return !enrolledByYear.get(att.year)?.has(session.parent_id)
  })

  // 2. Prior-year bunk assignments — used ONLY to label a row, never to gate it.
  // Restricted to journey session types (as of #2113, that now includes family) so
  // the year-fallback's family/non-family guard below still has a family-typed
  // candidate to compare against and reject (the leak fb1a88d2 closed for
  // current-year views in useCamperEnrollment). A family session's OWN match here
  // is never shown, though (kindred#2466): that "bunk" is the CampMinder day
  // group, and the family-housing override further down discards it
  // unconditionally in favor of the household's actual housing.
  const assignments = await pb
    .collection<BunkAssignmentsResponse<AssignmentExpand>>('bunk_assignments')
    .getFullList({
      filter: `person.cm_id = ${personCmId} && year < ${currentYear} && (${typeFilter})`,
      expand: 'session,bunk',
    })

  const assignmentsByYear = new Map<number, Array<BunkAssignmentsResponse<AssignmentExpand>>>()
  for (const a of assignments) {
    const list = assignmentsByYear.get(a.year) ?? []
    list.push(a)
    assignmentsByYear.set(a.year, list)
  }

  // Resolve parent-main sessions for any surviving AG rows (AG is relabeled to its
  // parent main; AG names aren't derivable). One query, fires only when AG present.
  const agPairs: Array<{ year: number; cmId: number }> = []
  for (const att of deduped) {
    const s = att.expand.session
    if (s?.session_type === 'ag') agPairs.push({ year: att.year, cmId: s.parent_id })
  }
  const parentByKey = await fetchParentMainSessions(agPairs)

  const records = deduped.map((att): HistoricalRecord => {
    const session = att.expand.session
    const year = att.year
    const yearAssignments = assignmentsByYear.get(year) ?? []

    // Bunk-label join precedence (spec §7):
    // 1. exact (year, session) match
    let match = yearAssignments.find((a) => a.expand.session?.cm_id === session?.cm_id)
    // 2. else year-fallback ONLY when the year has exactly one assignment, AND that
    // assignment's session type is on the same side of the family/non-family split
    // as the row it would label. Without this guard, a lone family-camp assignment
    // (now reachable here since #2113 widened typeFilter to include family) could
    // attach to an unrelated summer/teen row via the fallback — the exact leak
    // fb1a88d2 closed for current-year views in useCamperEnrollment.
    if (!match && yearAssignments.length === 1) {
      const candidate = yearAssignments[0]
      const candidateIsFamily = candidate?.expand.session?.session_type === 'family'
      const rowIsFamily = session?.session_type === 'family'
      if (candidateIsFamily === rowIsFamily) match = candidate
    }
    // 3. else (>=2 assignments, no match, or zero) → no label
    let bunkName = match?.expand.bunk?.name

    // kindred#2466: a family-camp row shows the household's ACTUAL HOUSING
    // instead — the day group computed above (if any) is discarded
    // unconditionally, never relabeled or shown alongside it. Resolved via
    // `familyHousing`, which only carries a year whose cabin is unambiguously
    // THIS weekend; any other case (no housing, unresolved cabin, or a
    // different/ambiguous weekend that year) leaves the row with no label,
    // same as any other unlabeled row. The cabin is the name AS RECORDED that
    // year (`familyHousingByYear` reads `cabin_name_raw`).
    if (session?.session_type === 'family') {
      const housing = familyHousing.get(year)
      bunkName =
        housing !== undefined && housing.sessionCmId === session.cm_id
          ? housing.cabinName
          : undefined
    }

    // Adult programs (spec §5.2): the label is the cabin the server attributed
    // to THIS weekend, or nothing — never a bunk. Unconditional, like the
    // family override, so the year-fallback above cannot pin a lone summer
    // bunk onto an adult row.
    if (session?.session_type === 'adult') {
      bunkName = adultHousing.get(`${String(year)}:${String(session.cm_id)}`)
    }

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

  return {
    rows: [...records, ...parentRows].sort(byYearThenChronological),
    familyWeekends,
    adultWeekends,
  }
}
