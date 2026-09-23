/**
 * Shared prior-year journey source. Lists every prior year a camper was
 * ENROLLED (curated types: summer + teen + family + adult, see #2113), labeling each
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
 * Adult programs (joined 2026-09): adult rows are
 * labeled only by the attributed cabin from `/persons/{id}/housing`; an adult
 * viewer also gets the family weekends their household's children attended.
 *
 * Every cabin label — family and adult — is TODAY's registry name, the same
 * kindred#2332 pattern the weekend board's `HouseholdJourneyCard` already
 * uses (owner ruling 2026-09-22, evening; reverses a same-day morning ruling
 * that showed the as-typed string as the label). The as-typed string still
 * travels, on `bunkNameRecorded`, but ONLY where it disagrees with the
 * label — `CampJourneyTimeline` renders it in a hover tooltip, never inline.
 */
import { pb } from '../../lib/pocketbase'
import { byYearThenChronological } from './journeyOrder'
import {
  buildCamperJourneySessionTypeFilter,
  isQuestSessionType,
  isTeenProgramType,
} from '../../utils/sessionTypePredicates'
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

/** One cabin label, plus the as-typed string when it is worth showing. */
interface CabinLabel {
  cabinName: string
  cabinNameRaw: string
}

/**
 * The as-typed string, but ONLY where it disagrees with the label already
 * shown — the same `showsProvenance` logic `HouseholdJourneyCard` uses.
 * Absent raw or a raw that already IS the label means nothing to offer.
 */
function recordedIfDifferent(label: string, raw: string): string | undefined {
  return raw.length > 0 && raw !== label ? raw : undefined
}

interface FamilySeasonHousing extends CabinLabel {
  /** The pinned weekend, or `null` when the season's cabin is not pinned. */
  sessionCmId: number | null
}

/**
 * Reduce a household's family-camp journey to the one fact this file needs:
 * which cabin labels which weekend, per year. Every PLACED year with a
 * cabin earns an entry. `sessionCmId` is the weekend the year is pinned to
 * (`HouseholdJourneyRow.housing_session_cm_id`, kindred#2461), or `null`
 * when the server declined to pin it — a household that attended 2+
 * weekends that season, since CampMinder's one per-year value cannot say
 * which weekend it describes.
 *
 * `labelsWeekend` reads the entry: a pinned year labels ONLY its weekend; an
 * unpinned year labels EVERY family weekend that season (owner ruling
 * 2026-09-22, late: "just show the same cabin for all… it's not helpful to
 * show nothing; no one will care if historical data is wrong"). A year with
 * no housing or a blank cabin produces no entry, and its rows show nothing.
 *
 * The cabin is named by TODAY's unit name (`cabin_name`, owner ruling
 * 2026-09-22 evening) — the same field the weekend board's household card
 * shows. `cabin_name_raw` travels alongside for the tooltip.
 */
function familyHousingByYear(years: HouseholdJourneyRow[]): Map<number, FamilySeasonHousing> {
  const map = new Map<number, FamilySeasonHousing>()
  for (const y of years) {
    const season = familySeasonHousing(y)
    if (y.year !== undefined && season !== undefined) map.set(y.year, season)
  }
  return map
}

/** One household-year's cabin, or `undefined` when it has none to show. */
function familySeasonHousing(y: HouseholdJourneyRow): FamilySeasonHousing | undefined {
  const cabinName = (y.cabin_name ?? '').trim()
  if (y.housing !== 'placed' || cabinName.length === 0) return undefined
  return {
    sessionCmId: y.housing_session_cm_id ?? null,
    cabinName,
    cabinNameRaw: (y.cabin_name_raw ?? '').trim(),
  }
}

/** Does the season's cabin label this weekend? Pinned: only its own. Unpinned: all. */
function labelsWeekend(housing: FamilySeasonHousing, sessionCmId: number): boolean {
  return housing.sessionCmId === null || housing.sessionCmId === sessionCmId
}

/**
 * Server-named cabins keyed `${year}:${sessionCmId}` — the attributed adult
 * cabins, and the TLI/SCIT cabins the registry resolves (same row shape).
 */
function cabinsByWeekend(weekends: PersonHousingWeekendRow[]): Map<string, CabinLabel> {
  const map = new Map<string, CabinLabel>()
  for (const w of weekends) {
    const cabinName = (w.cabin_name ?? '').trim()
    const cabinNameRaw = (w.cabin_name_raw ?? '').trim()
    if (w.year !== undefined && w.session_cm_id !== undefined && cabinName.length > 0) {
      map.set(`${String(w.year)}:${String(w.session_cm_id)}`, { cabinName, cabinNameRaw })
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
 * Family camp AS A PARENT: every weekend a child in the household
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
    // The same season rule as the viewer's own rows (`labelsWeekend`).
    const housing = familySeasonHousing(y)
    const cabinRecorded = housing && recordedIfDifferent(housing.cabinName, housing.cabinNameRaw)
    for (const s of y.sessions ?? []) {
      const cmId = s.session_cm_id ?? 0
      if (cmId <= 0) continue
      const key = `${String(y.year)}:${String(cmId)}`
      if (ownFamily.has(key)) continue
      const labelled = housing !== undefined && labelsWeekend(housing, cmId)
      out.push({
        key,
        year: y.year,
        record: {
          year: y.year,
          sessionName: s.name ?? 'Unknown',
          sessionType: 'family',
          ...(labelled ? { bunkName: housing.cabinName } : {}),
          ...(labelled && cabinRecorded !== undefined ? { bunkNameRecorded: cabinRecorded } : {}),
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
  /**
   * The person's TLI/SCIT cabins the lodging registry resolves to a real unit
   * (`/persons/{id}/housing` `teen_cabins`, owner ruling 2026-09-22 late, Q9).
   * The ONLY source of a teen row's label — the resolver lives on the server
   * (kindred#2332 forbids a client copy).
   */
  teenCabins?: PersonHousingWeekendRow[]
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
  const {
    familyHousingYears = [],
    adultHousingWeekends = [],
    teenCabins = [],
    viewerIsAdult = false,
  } = options

  const familyHousing = familyHousingByYear(familyHousingYears)
  const adultHousing = cabinsByWeekend(adultHousingWeekends)
  const teenHousing = cabinsByWeekend(teenCabins)

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
    // A TLI/SCIT/Quest "bunk" is a program group or a trip name (Q9). Its own
    // row never reads it (see the overrides below), and it must not reach a
    // summer row through the year-fallback either.
    const assignmentType = a.expand.session?.session_type
    if (isTeenProgramType(assignmentType) || isQuestSessionType(assignmentType)) continue
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
    let bunkNameRecorded: string | undefined

    // kindred#2466: a family-camp row shows the household's ACTUAL HOUSING
    // instead — the day group computed above (if any) is discarded
    // unconditionally, never relabeled or shown alongside it. The season's
    // cabin labels this weekend when the year is pinned to it, or when the
    // year is not pinned at all (2+ weekends that season: every weekend gets
    // it, owner ruling 2026-09-22 late). A year pinned to a DIFFERENT weekend,
    // or with no housing, leaves the row with no label. The label is TODAY's
    // unit name (`cabin_name`); the as-typed string rides along on
    // `bunkNameRecorded` only where it disagrees.
    if (session?.session_type === 'family') {
      const housing = familyHousing.get(year)
      const isThisWeekend = housing !== undefined && labelsWeekend(housing, session.cm_id)
      bunkName = isThisWeekend ? housing.cabinName : undefined
      bunkNameRecorded = isThisWeekend
        ? recordedIfDifferent(housing.cabinName, housing.cabinNameRaw)
        : undefined
    }

    // Adult programs: the label is the cabin the server attributed
    // to THIS weekend, or nothing — never a bunk. Unconditional, like the
    // family override, so the year-fallback above cannot pin a lone summer
    // bunk onto an adult row.
    if (session?.session_type === 'adult') {
      const housing = adultHousing.get(`${String(year)}:${String(session.cm_id)}`)
      bunkName = housing?.cabinName
      bunkNameRecorded = housing && recordedIfDifferent(housing.cabinName, housing.cabinNameRaw)
    }

    // Teen programs (owner ruling 2026-09-22 late, Q9): CampMinder's bunk for
    // TLI/SCIT is usually a program group ("SCIT A", "TLI"), so the label is
    // ONLY the cabin the server's registry resolved for THIS (year, session),
    // or nothing — never the raw bunk. Quest's "bunk" is a trip name: never a
    // cabin. Unconditional, like the family and adult overrides.
    if (isTeenProgramType(session?.session_type)) {
      const housing = teenHousing.get(`${String(year)}:${String(session?.cm_id)}`)
      bunkName = housing?.cabinName
      bunkNameRecorded = housing && recordedIfDifferent(housing.cabinName, housing.cabinNameRaw)
    }
    if (isQuestSessionType(session?.session_type)) {
      bunkName = undefined
      bunkNameRecorded = undefined
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
      ...(bunkNameRecorded !== undefined ? { bunkNameRecorded } : {}),
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
