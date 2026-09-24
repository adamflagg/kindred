/**
 * The camper journey's client half: one server read (kindred#2776).
 *
 * The merge that used to live here — enrollments, bunk labels, the AG
 * collapse, family/adult/teen cabins, parent weekends, the counts — runs on
 * the server now, behind `GET /api/campers/{id}/journey?year=`
 * (`api/services/camper_journey_service.py`). Its tests moved with it, one
 * for one. What stays here is the wire: the URL, and the mapping from the
 * server's snake_case row to the `HistoricalRecord` every journey surface
 * already renders.
 *
 * `fetchParentMainSessions` also stays, for the CURRENT-year rows the client
 * still builds from live attendees (`useCamperHistory`, `CamperDetailsPanel`).
 */
import { pb } from '../../lib/pocketbase'
import { ApiError, toApiError } from '../../services/apiError'
import type { FetchWithAuth } from '../../services/lodgingApi'
import type {
  ApiCamperJourneyCounts,
  ApiCamperJourneyResponse,
  ApiCamperJourneyRow,
} from '../../types/api-types'
import type { CampSessionsResponse } from '../../types/pocketbase-types'
import type { PersonHousingWeekendRow } from '../../types/lodging'
import type { HistoricalRecord, JourneyCounts } from './types'

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

/** A failed journey read that still knows its HTTP status (see `apiError.ts`). */
export class CamperJourneyApiError extends ApiError {}

export interface CamperJourney {
  /** Prior years only, newest first, chronological within a year. */
  rows: HistoricalRecord[]
  /**
   * The viewed year's family weekends as a PARENT (21+), chronological — the
   * one current-year row the client's live attendee build cannot make, since
   * a parent has no family-camp attendee row (kindred#2812).
   */
  currentYearParentRows: HistoricalRecord[]
  counts: JourneyCounts
  /** The registry-resolved TLI/SCIT cabins, current year included (Q9). */
  teenCabins: PersonHousingWeekendRow[]
  /** The attributed adult-program cabins, current year included (kindred#2812). */
  adultCabins: PersonHousingWeekendRow[]
  /** The household's cabin per family weekend (owner ruling 2026-09-24, on #2814). */
  familyCabins: PersonHousingWeekendRow[]
}

/**
 * One server row as the `HistoricalRecord` the client merge used to build.
 * A field the server sends as `null` is one the merge left OFF the record,
 * so it stays off; an empty string is a value the merge kept, so it stays.
 */
function toHistoricalRecord(row: ApiCamperJourneyRow): HistoricalRecord {
  return {
    year: row.year ?? 0,
    sessionName: row.session_name ?? '',
    sessionType: row.session_type ?? '',
    ...(row.bunk_name != null ? { bunkName: row.bunk_name } : {}),
    ...(row.bunk_name_recorded != null ? { bunkNameRecorded: row.bunk_name_recorded } : {}),
    ...(row.start_date != null ? { startDate: row.start_date } : {}),
    ...(row.end_date != null ? { endDate: row.end_date } : {}),
  }
}

function toJourneyCounts(counts: ApiCamperJourneyCounts | undefined): JourneyCounts {
  return {
    summers: counts?.summers ?? 0,
    familyWeekends: counts?.family_weekends ?? 0,
    adultWeekends: counts?.adult_weekends ?? 0,
  }
}

/** A person's journey as of `year`. Protected: pass `fetchWithAuth` from `useApiWithAuth()`. */
export async function fetchCamperJourney(
  fetchWithAuth: FetchWithAuth,
  personCmId: number,
  year: number
): Promise<CamperJourney> {
  const response = await fetchWithAuth(
    `/api/campers/${String(personCmId)}/journey?year=${String(year)}`
  )
  if (!response.ok) {
    throw await toApiError(response, 'Failed to load the camper journey', CamperJourneyApiError)
  }
  const body = (await response.json()) as ApiCamperJourneyResponse
  return {
    rows: (body.rows ?? []).map(toHistoricalRecord),
    currentYearParentRows: (body.current_year_parent_rows ?? []).map(toHistoricalRecord),
    counts: toJourneyCounts(body.counts),
    teenCabins: body.teen_cabins ?? [],
    adultCabins: body.adult_cabins ?? [],
    familyCabins: body.family_cabins ?? [],
  }
}
