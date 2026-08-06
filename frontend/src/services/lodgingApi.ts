/**
 * Weekend lodging API client.
 *
 * Every function takes `fetchWithAuth` as its first parameter — obtained by
 * the caller from `useApiWithAuth()`. Services never import it. The
 * PocketBase JWT lives in localStorage, so a raw fetch with
 * `credentials: 'include'` silently 401s (frontend/CLAUDE.md).
 */

import type { PartyGrainBody } from '../components/weekend/dragPlacement'
import type {
  HouseholdMedical,
  LodgingWriteResult,
  WeekendRoster,
  WeekendSessionList,
  WeekendSummary,
} from '../types/lodging'

const API_BASE = '/api/lodging'

/** The wrapper returned by `useApiWithAuth().fetchWithAuth`. */
export type FetchWithAuth = (url: string, options?: RequestInit) => Promise<Response>

/**
 * An API failure that still knows its HTTP status.
 *
 * The seed endpoint's 409 is the reason this exists: "this scenario already
 * holds placements" is a normal thing for staff to bump into, not a fault,
 * and the UI has to say "already seeded" rather than "failed". The status is
 * the only reliable way to tell the two apart — `detail` is prose the server
 * is free to reword.
 */
export class LodgingApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'LodgingApiError'
    this.status = status
  }
}

/**
 * Turn a non-ok response into an Error carrying FastAPI's `detail` when it
 * has one, so a 404 for an unknown weekend reads as a sentence rather than
 * a bare status code.
 */
async function toError(response: Response, fallback: string): Promise<LodgingApiError> {
  let detail: unknown
  try {
    const body: unknown = await response.json()
    if (body && typeof body === 'object' && 'detail' in body) {
      detail = body.detail
    }
  } catch {
    detail = undefined
  }
  if (typeof detail === 'string' && detail.length > 0) {
    return new LodgingApiError(detail, response.status)
  }
  return new LodgingApiError(`${fallback} (HTTP ${String(response.status)})`, response.status)
}

/** List every family-camp and adult-weekend session for a year. */
export async function fetchWeekendSessions(
  fetchWithAuth: FetchWithAuth,
  year: number
): Promise<WeekendSessionList> {
  const response = await fetchWithAuth(`${API_BASE}/sessions?year=${String(year)}`)
  if (!response.ok) throw await toError(response, 'Failed to load weekend sessions')
  return response.json() as Promise<WeekendSessionList>
}

/**
 * Every weekend in a year with its counts, in ONE request.
 *
 * The lander used to call the roster once per weekend. That endpoint's cost is
 * dominated by year-scoped work identical across weekends, so twelve weekends
 * repeated it twelve times — a weekend with zero parties still took ~3s.
 */
export async function fetchWeekendSummary(
  fetchWithAuth: FetchWithAuth,
  year: number
): Promise<WeekendSummary> {
  const response = await fetchWithAuth(`${API_BASE}/summary?year=${String(year)}`)
  if (!response.ok) throw await toError(response, 'Failed to load the weekend summary')
  return response.json() as Promise<WeekendSummary>
}

/**
 * The per-weekend roster: parties, unit inventory, and honest counts.
 *
 * `scenario` is required and empty means the CampMinder mirror. It is not
 * optional because the server's is — `scenario: str = Query("")` — so a
 * request that omits it returns 200 with the mirror rather than an error, and
 * staff would be looking at synced rows believing them to be their draft.
 */
export async function fetchWeekendRoster(
  fetchWithAuth: FetchWithAuth,
  year: number,
  sessionCmId: number,
  scenario: string
): Promise<WeekendRoster> {
  const scenarioParam = scenario ? `&scenario=${encodeURIComponent(scenario)}` : ''
  const response = await fetchWithAuth(
    `${API_BASE}/roster?year=${String(year)}&session_cm_id=${String(sessionCmId)}${scenarioParam}`
  )
  if (!response.ok) throw await toError(response, 'Failed to load the weekend roster')
  return response.json() as Promise<WeekendRoster>
}

/** What the seed wrote: rows created, and mirror rows it could not resolve. */
export interface LodgingCopyResult {
  copied: number
  skipped: number
}

/**
 * Seed a scenario from the CampMinder mirror, for one weekend.
 *
 * A scenario REPLACES the mirror rather than overlaying it (kindred#1974), so
 * a freshly created one renders an empty board — every family gone. This is
 * the call that fills it.
 *
 * **409 is not a failure.** It means the scenario already holds placements for
 * this weekend, and the server refuses because a second copy would overwrite
 * what staff placed and re-place everything they unplaced. Callers branch on
 * `LodgingApiError.status`.
 */
export async function copyPlacementsFromMirror(
  fetchWithAuth: FetchWithAuth,
  { year, sessionCmId, scenario }: { year: number; sessionCmId: number; scenario: string }
): Promise<LodgingCopyResult> {
  const response = await fetchWithAuth(`${API_BASE}/placements/copy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ year, session_cm_id: sessionCmId, scenario }),
  })
  if (!response.ok) throw await toError(response, 'Failed to seed the scenario')
  return response.json() as Promise<LodgingCopyResult>
}

/** One weekend, in one scenario — the shape every placement write shares. */
export interface PlacementWriteBase {
  year: number
  sessionCmId: number
  /** REQUIRED and non-empty. A blank scenario is a 422, never a write to the live plan. */
  scenario: string
  grain: PartyGrainBody
}

function placementBody({ year, sessionCmId, scenario, grain }: PlacementWriteBase) {
  return { year, session_cm_id: sessionCmId, scenario, ...grain }
}

/**
 * Place a party into one or more units, inside a scenario.
 *
 * `unitIds` must name at least one unit. An empty list is NOT a second
 * spelling of "unplaced" — it was the tombstone until kindred#1974 retired it,
 * and the schema now pins `min_length=1`, so an empty set is a 422. Unplacing
 * is `unplaceParty` below. HANDOFF said otherwise until #1974 and has since
 * been corrected (§2, §6) — the note survives because the old shape is the
 * intuitive one to reach for.
 *
 * Idempotent from the caller's side: the server upserts, so re-placing a party
 * into the room it already occupies succeeds. The board still refuses to send
 * that write — see `dragPlacement.resolveDrop` — because every write flips the
 * one-way `staff_touched` flag.
 */
export async function placeParty(
  fetchWithAuth: FetchWithAuth,
  { unitIds, ...base }: PlacementWriteBase & { unitIds: string[] }
): Promise<void> {
  if (unitIds.length === 0) {
    throw new LodgingApiError('A placement must name at least one unit', 0)
  }
  const response = await fetchWithAuth(`${API_BASE}/placements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...placementBody(base), unit_ids: unitIds }),
  })
  if (!response.ok) throw await toError(response, 'Failed to place the party')
}

/**
 * Remove a party's placement in this scenario — the unplaced queue.
 *
 * Deleting the row IS unplacing (kindred#1974): a scenario replaces the mirror
 * rather than overlaying it, so there is no synced row left underneath for the
 * delete to fall through to. This is the same operation summer performs on a
 * `bunk_assignments_draft` row.
 */
export async function unplaceParty(
  fetchWithAuth: FetchWithAuth,
  base: PlacementWriteBase
): Promise<void> {
  const response = await fetchWithAuth(`${API_BASE}/placements`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(placementBody(base)),
  })
  if (!response.ok) throw await toError(response, 'Failed to unplace the party')
}

/** Holding one unit back for a weekend, or releasing one to families. */
export interface AvailabilityWrite {
  year: number
  sessionCmId: number
  /** The unit's PocketBase id, which is what `lodging_availability.unit` relates to. */
  unitId: string
  /**
   * THREE values, not two. `false` closes the unit for this weekend, `true`
   * opens it, and `null` DELETES the row so the unit's own role decides again.
   * Nothing here may be read for truthiness: `!familyAvailable` folds a hold
   * into a clear.
   */
  familyAvailable: boolean | null
  /** Display only — the rule never branches on it. `''` when clearing. */
  reason: string
}

/**
 * Reserve or release one unit for one weekend.
 *
 * Takes NO scenario, unlike every other write on this client. Availability is
 * a fact about the WEEKEND rather than about the plan — a burst pipe closes a
 * cabin in every scenario for that weekend — so 1500000135 deleted the
 * dimension and `AvailabilityWriteRequest` stopped extending
 * `ScenarioWriteRequest`. Requiring one is what left this endpoint with no
 * caller and the table with no rows.
 */
export async function setUnitAvailability(
  fetchWithAuth: FetchWithAuth,
  { year, sessionCmId, unitId, familyAvailable, reason }: AvailabilityWrite
): Promise<LodgingWriteResult> {
  const response = await fetchWithAuth(`${API_BASE}/availability`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      year,
      session_cm_id: sessionCmId,
      unit_id: unitId,
      family_available: familyAvailable,
      reason,
    }),
  })
  if (!response.ok) throw await toError(response, 'Failed to update availability')
  return response.json() as Promise<LodgingWriteResult>
}

/** What the board asks the server to write when a house is merged or split. */
export interface SlotMergeWrite {
  year: number
  session_cm_id: number
  scenario: string
  /** The CONTAINER's PocketBase id — `lodging_slot_merges.unit` relates to it. */
  unit_id: string
  combined: boolean
}

/**
 * Set or clear one container's draw level — merge a house's rooms into one
 * card, or split it back into its rooms.
 *
 * `scenario: ''` is a legitimate write, not a refusal: a draw level is never
 * CampMinder-sourced, so unlike a placement, the mirror has no truth for this
 * write to overwrite. A blank `scenario` becomes the WEEKEND-LEVEL row —
 * seen on the mirror, and inherited by every scenario that has not
 * overridden it locally. See the `SlotMergeRequest` doc in `types.gen.ts`
 * for the full resolution order.
 */
export async function setSlotMerge(
  fetchWithAuth: FetchWithAuth,
  write: SlotMergeWrite
): Promise<LodgingWriteResult> {
  const response = await fetchWithAuth(`${API_BASE}/merge`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(write),
  })
  if (!response.ok) throw await toError(response, 'Failed to update the merge')
  return (await response.json()) as LodgingWriteResult
}

/**
 * PHI. Requires the `lodging.phi` permission server-side; a caller without
 * it gets a 403, which this surfaces verbatim so the UI can explain why.
 */
export async function fetchHouseholdMedical(
  fetchWithAuth: FetchWithAuth,
  year: number,
  householdCmId: number
): Promise<HouseholdMedical> {
  const response = await fetchWithAuth(
    `${API_BASE}/households/${String(householdCmId)}/medical?year=${String(year)}`
  )
  if (!response.ok) throw await toError(response, 'Failed to load medical details')
  return response.json() as Promise<HouseholdMedical>
}
