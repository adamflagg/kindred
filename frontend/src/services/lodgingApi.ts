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
  HouseholdJourney,
  HouseholdMedical,
  LodgingWriteResult,
  ScenarioCompare,
  WeekendRoster,
  WeekendSessionList,
  WeekendSummary,
} from '../types/lodging'
import { ApiError, toApiError } from './apiError'

const API_BASE = '/api/lodging'

/** The wrapper returned by `useApiWithAuth().fetchWithAuth`. */
export type FetchWithAuth = (url: string, options?: RequestInit) => Promise<Response>

/**
 * An API failure that still knows its HTTP status. See `apiError.ts` for
 * why this stays its own subclass rather than a shared `ApiError`.
 *
 * The seed endpoint's 409 is the reason this exists: "this scenario already
 * holds placements" is a normal thing for staff to bump into, not a fault,
 * and the UI has to say "already seeded" rather than "failed". The status is
 * the only reliable way to tell the two apart — `detail` is prose the server
 * is free to reword.
 */
export class LodgingApiError extends ApiError {
  /**
   * The parsed `detail` field verbatim, when it was a JSON object rather
   * than a plain string.
   *
   * `toApiError`'s generic reading only keeps `detail` when it's a STRING —
   * `.message` already carries that case. The push/unpush 409s (below)
   * disagree on purpose: FastAPI sends `{reason: "stale", report:
   * PushPreview}`, `{reason: "already_unpushed"}` or `{reason: "drift",
   * buildings: string[]}`, objects the UI branches on (kindred#2477 Task 10).
   * This is where those survive the trip through `toPushError` instead of
   * being discarded in favour of a bare "HTTP 409".
   */
  readonly detail: PushErrorDetail | undefined

  constructor(message: string, status: number, detail: PushErrorDetail | undefined = undefined) {
    super(message, status)
    this.name = 'LodgingApiError'
    this.detail = detail
  }
}

/**
 * Turn a non-ok response into an Error carrying FastAPI's `detail` when it
 * has one, so a 404 for an unknown weekend reads as a sentence rather than
 * a bare status code.
 */
async function toError(response: Response, fallback: string): Promise<LodgingApiError> {
  return toApiError(response, fallback, LodgingApiError)
}

/**
 * A `detail` body the push/unpush endpoints can send on a 409 — never prose,
 * always a reason the UI branches on (kindred#2477 Task 10).
 */
export type PushErrorDetail =
  | { reason: 'stale'; report: PushPreview }
  | { reason: 'already_unpushed' }
  | { reason: 'drift'; buildings: string[] }

/**
 * Like `toError`, but keeps an OBJECT-shaped `detail` rather than discarding
 * it.
 *
 * `toApiError` (shared with every other domain client) only surfaces
 * `detail` when it's a string, because that's the only shape FastAPI's
 * `HTTPException` sends elsewhere in this file. The push endpoints' 409s are
 * the exception to that: `execute_push` and `unpush` raise structured
 * `detail` objects on purpose, and a caller (Task 10) needs the parsed
 * `report`/`buildings` back, not just a status code.
 */
async function toPushError(response: Response, fallback: string): Promise<LodgingApiError> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }
  const rawDetail = body && typeof body === 'object' && 'detail' in body ? body.detail : undefined
  if (typeof rawDetail === 'string' && rawDetail.length > 0) {
    return new LodgingApiError(rawDetail, response.status)
  }
  if (rawDetail && typeof rawDetail === 'object') {
    return new LodgingApiError(
      `${fallback} (HTTP ${String(response.status)})`,
      response.status,
      rawDetail as PushErrorDetail
    )
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

/** Writing somebody into one unit for a weekend, or releasing one to families. */
export interface AvailabilityWrite {
  year: number
  sessionCmId: number
  /**
   * The unit's PocketBase id, which is what the `unit` relation on whichever
   * table receives this write points at — `lodging_write_ins` for a write-in,
   * `lodging_availability` for a release (kindred#2382).
   */
  unitId: string
  /**
   * WHICH BOARD the occupancy lands on — `''` is the live board, a scenario id
   * is that scenario's own draft (kindred#2382 PR 4).
   *
   * Blank is a real scope and not a missing value, which is why it is sent
   * rather than omitted. The ROLE half ignores it: staff↔family role is a fact
   * about the weekend, so a release written from inside a scenario still
   * writes `lodging_availability`.
   */
  scenario: string
  /**
   * THREE values, not two. `false` closes the unit for this weekend, `true`
   * opens it, and `null` DELETES the row so the unit's own role decides again.
   * Nothing here may be read for truthiness: `!familyAvailable` folds a
   * write-in into a clear.
   */
  familyAvailable: boolean | null
  /**
   * WHO is in the room (kindred#2078). Required through the control on a
   * write-in; `''` on a release and on a clear.
   *
   * Sent under the SAME name the column carries, unlike `reason` below —
   * `reason`/`note` carry two names only because 1500000135 reused a column
   * that already existed.
   */
  occupantName: string
  /** Display only — the rule never branches on it. `''` when clearing. */
  reason: string
  /**
   * How many people the write-in is for (kindred#2503). `null` is a REAL
   * value — nobody recorded a count — never a missing one, and it is the
   * PERMANENT common case: most write-ins are non-rostered staff and staff
   * will type nothing. Sent explicitly for the same reason `familyAvailable`
   * is: a key dropped on the way out is indistinguishable from a key nobody
   * set, and the endpoint's `party_size` upsert would then wipe a recorded
   * count on any write that omitted it.
   */
  partySize: number | null
}

/**
 * Write somebody into one unit for one weekend, or release one to families.
 *
 * ONE ENDPOINT, TWO TABLES behind it since kindred#2382, and the request shape
 * says which: `false` is an OCCUPANCY and is stored in `lodging_write_ins` or
 * its scenario-scoped draft twin, `true` is a staff↔family ROLE override for
 * the weekend and stays in `lodging_availability`, and `null` clears both. The
 * server decides which table; this decides which BOARD.
 *
 * `scenario` is OPTIONAL at the endpoint and blank-defaulted, the shape
 * `setSlotMerge` already uses — required is what left this endpoint with no
 * caller and the table with no rows, and would now leave the live board with
 * no write path. It steers the occupancy half alone: the role half is a fact
 * about the WEEKEND rather than about a plan, so 1500000135's deleted
 * dimension stays deleted for it.
 */
export async function setUnitAvailability(
  fetchWithAuth: FetchWithAuth,
  {
    year,
    sessionCmId,
    scenario,
    unitId,
    familyAvailable,
    occupantName,
    reason,
    partySize,
  }: AvailabilityWrite
): Promise<LodgingWriteResult> {
  const response = await fetchWithAuth(`${API_BASE}/availability`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      year,
      session_cm_id: sessionCmId,
      scenario,
      unit_id: unitId,
      family_available: familyAvailable,
      occupant_name: occupantName,
      reason,
      party_size: partySize,
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
 * A household's year-over-year family-camp record (kindred#2073).
 *
 * TAKES NO YEAR, unlike every other read here. The journey's window is
 * discovered from the household's own traces, not chosen by the caller —
 * see the endpoint's docstring. That is also why the query key below is
 * keyed on the household alone.
 */
export async function fetchHouseholdJourney(
  fetchWithAuth: FetchWithAuth,
  householdCmId: number
): Promise<HouseholdJourney> {
  const response = await fetchWithAuth(`${API_BASE}/households/${String(householdCmId)}/journey`)
  if (!response.ok) throw await toError(response, 'Failed to load household history')
  return response.json() as Promise<HouseholdJourney>
}

/**
 * The medical narrative. Requires `bunking.manage` server-side (kindred#2312
 * retargeted the gate from the now-removed `lodging.phi`); a caller without
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

/**
 * One classified write-in row, as `preview_push` reports it (kindred#2477).
 *
 * Declared here rather than aliased from `types.gen.ts`'s `PushRowPayload`:
 * every field on the generated type carries a Pydantic default and so comes
 * through as optional (`note?: string`, `party_size?: number | null`,
 * `sleeps?: number | null` — see the GOTCHA note atop `types/lodging.ts`),
 * but the server always populates all four, and Tasks 8/10 build report
 * tiles straight off `buildings[].live`/`.draft` rows without re-deriving
 * that guarantee at every read site. This mirrors how `PlacementWriteBase`
 * and `AvailabilityWrite` above are hand-declared rather than pulled from
 * the generated request types.
 */
export interface PushRowPayload {
  unit_id: string
  unit_code: string
  unit_name: string
  occupant_name: string
  note: string
  /**
   * How many people this write-in occupies wholesale. `null` is a REAL
   * value — nobody recorded a count — never a missing one, the same
   * semantics `AvailabilityWrite.partySize` carries above (kindred#2503,
   * #2540). The server's `PushRow.tuple_key()` treats a live `null` against
   * a draft row that recorded a count as a genuine difference, not noise to
   * coerce away — so this stays `number | null` rather than defaulting to 0
   * on either side of the wire.
   */
  party_size: number | null
  /**
   * The unit's capacity, carried for display only. `tuple_key()` (the
   * server's match key) does not include it, so two rows differing only in
   * `sleeps` still count as the same row.
   */
  sleeps: number | null
}

/**
 * One building's live-vs-draft write-ins, and the RULED verdict for it
 * (kindred#2477).
 *
 * `cls` is `classify_push`'s own word, computed server-side and PUBLISHED
 * rather than re-derived — inside a scenario the client never reads
 * `lodging_write_ins` at all, so it has nothing to diff against and no TS
 * mirror of the classifier exists on purpose.
 */
export interface PushBuildingReport {
  key: string
  label: string
  cls: 'add' | 'match' | 'conflict' | 'remove'
  live: PushRowPayload[]
  draft: PushRowPayload[]
}

/**
 * The report half of kindred#2477's write-in push queue.
 *
 * `digest` fingerprints `buildings` and is not a fact about the request — it
 * is a fact about what this preview SAW. `executeWriteInPush` echoes it back
 * unchanged; a mismatch means the live board or the scenario moved between
 * the preview and the push, and the server refuses with a fresh report
 * rather than applying decisions made against one that is no longer true.
 */
export interface PushPreview {
  year: number
  session_cm_id: number
  scenario: string
  digest: string
  buildings: PushBuildingReport[]
}

/**
 * What `executeWriteInPush` actually did.
 *
 * `push_id` is the `lodging_write_in_pushes` row's id — the ledger entry
 * `unpushWriteIns` will replay — and is `""` on a no-op, when nothing needed
 * to move and no ledger row was written at all.
 */
export interface PushResult {
  push_id: string
  added: number
  removed: number
  replaced: number
  kept: number
  matched: number
  no_op: boolean
}

/**
 * Compare a scenario's write-ins against the live board (kindred#2477).
 *
 * Read-only: reviewing what a push would do is part of the same staff
 * workflow the push itself is, and writes nothing on its own.
 */
export async function fetchPushPreview(
  fetchWithAuth: FetchWithAuth,
  { year, sessionCmId, scenario }: { year: number; sessionCmId: number; scenario: string }
): Promise<PushPreview> {
  const response = await fetchWithAuth(
    `${API_BASE}/push/preview?year=${String(year)}&session_cm_id=${String(sessionCmId)}&scenario=${encodeURIComponent(scenario)}`
  )
  if (!response.ok) throw await toPushError(response, 'Failed to load the push preview')
  return response.json() as Promise<PushPreview>
}

/**
 * Apply a scenario's write-ins onto the live board (kindred#2477).
 *
 * `digest` must be the exact value `fetchPushPreview` returned — the server
 * re-classifies before touching anything and refuses with a fresh report if
 * it disagrees. `decisions` names a verdict only for buildings that need
 * one (`conflict` or `remove`); a missing decision on a building that needs
 * one refuses the whole push rather than defaulting to `keep`.
 */
export async function executeWriteInPush(
  fetchWithAuth: FetchWithAuth,
  {
    year,
    sessionCmId,
    scenario,
    digest,
    decisions,
  }: {
    year: number
    sessionCmId: number
    scenario: string
    digest: string
    decisions: Record<string, 'live' | 'scenario' | 'keep' | 'remove'>
  }
): Promise<PushResult> {
  const response = await fetchWithAuth(`${API_BASE}/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      year,
      session_cm_id: sessionCmId,
      scenario,
      digest,
      decisions,
    }),
  })
  if (!response.ok) throw await toPushError(response, 'Failed to push write-ins')
  return response.json() as Promise<PushResult>
}

/**
 * Revert one push as a unit (kindred#2477 Task 5) — deleting what the push
 * added and recreating what it removed.
 *
 * A drift check refuses the whole unpush (409, `reason: 'drift'`) unless
 * the live board still matches the push's own after-state; a push already
 * reverted refuses with `reason: 'already_unpushed'`.
 */
export async function unpushWriteIns(
  fetchWithAuth: FetchWithAuth,
  { pushId, year, sessionCmId }: { pushId: string; year: number; sessionCmId: number }
): Promise<{ push_id: string; restored: number; deleted: number }> {
  const response = await fetchWithAuth(
    `${API_BASE}/push/${pushId}/unpush?year=${String(year)}&session_cm_id=${String(sessionCmId)}`,
    { method: 'POST' }
  )
  if (!response.ok) throw await toPushError(response, 'Failed to unpush the write-ins')
  return response.json() as Promise<{ push_id: string; restored: number; deleted: number }>
}

/**
 * Compare a scenario's placements against the CampMinder mirror
 * (kindred#2478 §5), for one family-camp weekend.
 *
 * READ-ONLY, and there is deliberately no companion write call: the modal
 * this feeds reports and nothing else (owner ruling §5.6). Acting on
 * `remove` would mean writing toward `lodging_assignments`, which the write
 * service forbids outright, and acting is gated on the promote/publish
 * decision rather than on this screen.
 *
 * A weekend that is not family camp answers 400 — the feature is scoped to
 * family camp, and an empty report would read as agreement.
 */
export async function fetchScenarioCompare(
  fetchWithAuth: FetchWithAuth,
  { year, sessionCmId, scenario }: { year: number; sessionCmId: number; scenario: string }
): Promise<ScenarioCompare> {
  const response = await fetchWithAuth(
    `${API_BASE}/compare?year=${String(year)}&session_cm_id=${String(sessionCmId)}&scenario=${encodeURIComponent(scenario)}`
  )
  if (!response.ok) throw await toError(response, 'Failed to load the comparison')
  return response.json() as Promise<ScenarioCompare>
}
