/**
 * Camperships' reads, the wire only. The server decides every figure (D21); this file builds
 * URLs and turns a non-ok answer into an error that keeps its status. Protected: pass
 * `fetchWithAuth` from `useApiWithAuth()`.
 */
import type {
  ApiAidAcceptedIn,
  ApiAidApplication,
  ApiAidApprovedRules,
  ApiAidAskIn,
  ApiAidCancellationIn,
  ApiAidCorrectionIn,
  ApiAidCorrectionOut,
  ApiAidDefinitions,
  ApiAidDuplicateIn,
  ApiAidGrid,
  ApiAidHeadcountIn,
  ApiAidHoldReleaseIn,
  ApiAidHouseholdPage,
  ApiAidHouseholdShareIn,
  ApiAidJumpIndex,
  ApiAidManualHoldIn,
  ApiAidPreview,
  ApiAidPostedIn,
  ApiAidPreviewIn,
  ApiAidRemaining,
  ApiAidRequestOut,
  ApiAidRound3AmountIn,
  ApiAidRound3ApprovalIn,
  ApiAidSessionIn,
  ApiAidUnpostIn,
  ApiAidUseFormIn,
  ApiAidUseFormOut,
  ApiAidWriteOut,
} from '../../types/api-types'
import { ApiError, readErrorDetail, toApiError } from '../apiError'
import type { FetchWithAuth } from '../lodgingApi'

export class AidApiError extends ApiError {}

const BASE = '/api/financial-aid'

function withQuery(path: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString()
  return query ? `${path}?${query}` : path
}

/** The Remaining line (spec §7.3): one figure per pool, live or as of a past day. */
export async function fetchAidRemaining(
  fetchWithAuth: FetchWithAuth,
  year: number,
  asOfParams: Record<string, string>
): Promise<ApiAidRemaining> {
  const response = await fetchWithAuth(
    withQuery(`${BASE}/decisions/${String(year)}/remaining`, asOfParams)
  )
  if (!response.ok)
    throw await toApiError(response, 'Failed to load the Remaining line', AidApiError)
  return (await response.json()) as ApiAidRemaining
}

/** The jump box's index (§3.5): every household with aid activity this season, loaded once. */
export async function fetchAidJumpIndex(
  fetchWithAuth: FetchWithAuth,
  year: number
): Promise<ApiAidJumpIndex> {
  const response = await fetchWithAuth(`${BASE}/jump-index/${String(year)}`)
  if (!response.ok) throw await toApiError(response, 'Failed to load the jump index', AidApiError)
  return (await response.json()) as ApiAidJumpIndex
}

/** A surface's numbered definition notes (§4.8; D20), from the registry shared with development. */
export async function fetchAidDefinitions(
  fetchWithAuth: FetchWithAuth,
  surface: string
): Promise<ApiAidDefinitions> {
  const response = await fetchWithAuth(withQuery(`${BASE}/definitions`, { surface }))
  if (!response.ok) throw await toApiError(response, 'Failed to load the definitions', AidApiError)
  return (await response.json()) as ApiAidDefinitions
}

/** The Requests grid (§6.1; D21): one row per request, each naming the views it is in; live or as of a past day. */
export async function fetchAidGrid(
  fetchWithAuth: FetchWithAuth,
  year: number,
  asOfParams: Record<string, string>
): Promise<ApiAidGrid> {
  const response = await fetchWithAuth(
    withQuery(`${BASE}/decisions/${String(year)}/grid`, asOfParams)
  )
  if (!response.ok)
    throw await toApiError(response, 'Failed to load the Requests grid', AidApiError)
  return (await response.json()) as ApiAidGrid
}

/** The household page (§6.3; D26): the family's aggregate, its request rows the grid's own. 404: no aid activity. */
export async function fetchAidHouseholdPage(
  fetchWithAuth: FetchWithAuth,
  year: number,
  householdCmId: number
): Promise<ApiAidHouseholdPage> {
  const response = await fetchWithAuth(
    `${BASE}/household-page/${String(year)}/${String(householdCmId)}`
  )
  if (!response.ok)
    throw await toApiError(response, 'Failed to load the household page', AidApiError)
  return (await response.json()) as ApiAidHouseholdPage
}

/**
 * The rows a 409 names when a decided amount moved under a Posted tick. It mirrors `ChangedRowOut`
 * (api/schemas/financial_aid_decisions.py), which reaches the browser only inside a 409's detail,
 * so OpenAPI doesn't generate it.
 */
export interface AidChangedRow {
  readonly request_id: string
  readonly round: number
  readonly confirmed: number
  readonly decided_now: number | null
}

/** A refused Camperships write: the server's sentence, its status, and a 409's moved rows. */
export class AidWriteError extends AidApiError {
  rows: readonly AidChangedRow[] = []
}

/** Whether an error carries this HTTP status (narrow on `.status`, never `instanceof`: apiError.ts). */
export function hasStatus(error: unknown, status: number): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === status
}

/**
 * The approved rules, read only (spec §7.5; D76): for everyone with view. With `version` (a receipt's
 * link) that version alone; without it, each section as it prices the season. 404: none approved yet.
 */
export async function fetchAidApprovedRules(
  fetchWithAuth: FetchWithAuth,
  year: number,
  version: number | null
): Promise<ApiAidApprovedRules> {
  const response = await fetchWithAuth(
    withQuery(
      `${BASE}/rules/${String(year)}/approved`,
      version === null ? {} : { version: String(version) }
    )
  )
  if (!response.ok) throw await toApiError(response, 'Failed to load the rules', AidApiError)
  return (await response.json()) as ApiAidApprovedRules
}

/** FastAPI's detail as one sentence: a string, a 409's `{message}`, or a 422's first `msg`. */
export function writeMessage(detail: unknown): string | null {
  const words = wordsOf(detail)
  // No words at all (an empty string, a bare "Value error, "): the caller's own fallback speaks.
  return words === undefined || words === '' ? null : words
}

function wordsOf(detail: unknown): string | undefined {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const first: unknown = detail[0]
    // Pydantic prefixes a validator's message with "Value error, ": not staff's words (M15).
    return typeof first === 'object' &&
      first !== null &&
      'msg' in first &&
      typeof first.msg === 'string'
      ? first.msg.replace(/^Value error, /, '')
      : undefined
  }
  if (
    typeof detail === 'object' &&
    detail !== null &&
    'message' in detail &&
    typeof detail.message === 'string'
  ) {
    return detail.message
  }
  return undefined
}

function changedRows(detail: unknown): AidChangedRow[] {
  if (
    typeof detail === 'object' &&
    detail !== null &&
    'rows' in detail &&
    Array.isArray(detail.rows)
  ) {
    return detail.rows as AidChangedRow[]
  }
  return []
}

async function toWriteError(response: Response, fallback: string): Promise<AidWriteError> {
  const detail = await readErrorDetail(response)
  const error = new AidWriteError(
    writeMessage(detail) ?? `${fallback} (HTTP ${String(response.status)})`,
    response.status
  )
  error.rows = changedRows(detail)
  return error
}

/** One JSON write (or the preview's POST). A refusal becomes an AidWriteError in the server's words. */
async function send<T>(
  fetchWithAuth: FetchWithAuth,
  method: 'POST' | 'PUT',
  url: string,
  body: unknown,
  fallback: string,
  signal?: AbortSignal
): Promise<T> {
  const response = await fetchWithAuth(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  })
  if (!response.ok) throw await toWriteError(response, fallback)
  return (await response.json()) as T
}

/** The editor's line while typing (§4.6; D22): the request priced with the typed amount. Writes nothing. */
export function previewAidEdit(
  fetchWithAuth: FetchWithAuth,
  requestId: string,
  body: ApiAidPreviewIn,
  signal?: AbortSignal
): Promise<ApiAidPreview> {
  return send<ApiAidPreview>(
    fetchWithAuth,
    'POST',
    `${BASE}/requests/${requestId}/preview`,
    body,
    "Couldn't work out the award",
    signal
  )
}

/** A family's ask for Round 2 (an appeal) or Round 3, dated when it arrived (D91). */
export function keyAidAsk(
  fetchWithAuth: FetchWithAuth,
  requestId: string,
  body: ApiAidAskIn
): Promise<ApiAidWriteOut> {
  return send<ApiAidWriteOut>(
    fetchWithAuth,
    'POST',
    `${BASE}/requests/${requestId}/asks`,
    body,
    "Couldn't save the ask"
  )
}

/** Tick Posted on these rounds, each at the decided amount confirmed (D51, D52). All or nothing: a moved amount is a 409. */
export function tickAidPosted(
  fetchWithAuth: FetchWithAuth,
  year: number,
  body: ApiAidPostedIn
): Promise<ApiAidWriteOut> {
  return send<ApiAidWriteOut>(
    fetchWithAuth,
    'POST',
    `${BASE}/decisions/${String(year)}/posted`,
    body,
    "Couldn't tick Posted"
  )
}

/** Tick (or untick) Accepted on these rounds (D47). All or nothing. */
export function tickAidAccepted(
  fetchWithAuth: FetchWithAuth,
  year: number,
  body: ApiAidAcceptedIn
): Promise<ApiAidWriteOut> {
  return send<ApiAidWriteOut>(
    fetchWithAuth,
    'POST',
    `${BASE}/decisions/${String(year)}/accepted`,
    body,
    "Couldn't tick Accepted"
  )
}

/** Undo a mistaken Posted tick, with its reason. Refused while Accepted is ticked or a later round is posted. */
export function undoAidPosted(
  fetchWithAuth: FetchWithAuth,
  year: number,
  body: ApiAidUnpostIn
): Promise<ApiAidWriteOut> {
  return send<ApiAidWriteOut>(
    fetchWithAuth,
    'POST',
    `${BASE}/decisions/${String(year)}/unposted`,
    body,
    "Couldn't undo the Posted tick"
  )
}

/** A Round 3 amount. The registrar's above the limit waits for finance (D79). */
export function keyAidRound3Amount(
  fetchWithAuth: FetchWithAuth,
  requestId: string,
  body: ApiAidRound3AmountIn
): Promise<ApiAidWriteOut> {
  return send<ApiAidWriteOut>(
    fetchWithAuth,
    'POST',
    `${BASE}/requests/${requestId}/round3-amount`,
    body,
    "Couldn't save the Round 3 amount"
  )
}

/** Finance approves or refuses a Round 3 waiting on it, with a note (D79). */
export function decideAidRound3(
  fetchWithAuth: FetchWithAuth,
  requestId: string,
  body: ApiAidRound3ApprovalIn
): Promise<ApiAidWriteOut> {
  return send<ApiAidWriteOut>(
    fetchWithAuth,
    'POST',
    `${BASE}/requests/${requestId}/round3-approval`,
    body,
    "Couldn't decide the Round 3"
  )
}

/** Release a check's hold with a note, or put it back (main spec §10.5). */
export function setAidHoldRelease(
  fetchWithAuth: FetchWithAuth,
  requestId: string,
  body: ApiAidHoldReleaseIn
): Promise<ApiAidWriteOut> {
  return send<ApiAidWriteOut>(
    fetchWithAuth,
    'POST',
    `${BASE}/requests/${requestId}/hold-release`,
    body,
    "Couldn't change the hold"
  )
}

/** Put the request on hold by hand with a reason, or lift it (§6.3). */
export function setAidManualHold(
  fetchWithAuth: FetchWithAuth,
  requestId: string,
  body: ApiAidManualHoldIn
): Promise<ApiAidWriteOut> {
  return send<ApiAidWriteOut>(
    fetchWithAuth,
    'POST',
    `${BASE}/requests/${requestId}/manual-hold`,
    body,
    "Couldn't change the hold"
  )
}

/** Cancel with one of D141's reasons, give CampMinder's cancellation its reason, or reopen (D101). */
export function setAidCancellation(
  fetchWithAuth: FetchWithAuth,
  requestId: string,
  body: ApiAidCancellationIn
): Promise<ApiAidWriteOut> {
  return send<ApiAidWriteOut>(
    fetchWithAuth,
    'POST',
    `${BASE}/requests/${requestId}/cancellation`,
    body,
    "Couldn't save the cancellation"
  )
}

/** A household's application, with its intake requests (§6.3 casework forms). 404: no application. */
export async function fetchAidApplication(
  fetchWithAuth: FetchWithAuth,
  year: number,
  householdCmId: number
): Promise<ApiAidApplication> {
  const response = await fetchWithAuth(
    `${BASE}/applications/${String(year)}/${String(householdCmId)}`
  )
  if (!response.ok) throw await toApiError(response, 'Failed to load the application', AidApiError)
  return (await response.json()) as ApiAidApplication
}

/** Correct an answer (main spec §9.3). `new_value: null` (or left out) goes back to the form's figure; an empty string is refused (422). */
export function addAidCorrection(
  fetchWithAuth: FetchWithAuth,
  year: number,
  householdCmId: number,
  body: ApiAidCorrectionIn
): Promise<ApiAidCorrectionOut> {
  return send<ApiAidCorrectionOut>(
    fetchWithAuth,
    'POST',
    `${BASE}/applications/${String(year)}/${String(householdCmId)}/corrections`,
    body,
    "Couldn't save the correction"
  )
}

/**
 * Use X's Form (#3021): one camper's form answers every question the household's forms disagree on,
 * as one operation of ordinary corrections. A 422 says why in words safe to show.
 */
export function applyAidForm(
  fetchWithAuth: FetchWithAuth,
  year: number,
  householdCmId: number,
  body: ApiAidUseFormIn
): Promise<ApiAidUseFormOut> {
  return send<ApiAidUseFormOut>(
    fetchWithAuth,
    'POST',
    `${BASE}/applications/${String(year)}/${String(householdCmId)}/use-form`,
    body,
    "Couldn't use the form"
  )
}

/** One household's share, as a percentage (the form sends no dollar amount; the server fills the other of two shares; main spec §9.2). */
export function setAidHouseholdShare(
  fetchWithAuth: FetchWithAuth,
  requestId: string,
  householdCmId: number,
  body: ApiAidHouseholdShareIn
): Promise<ApiAidRequestOut> {
  return send<ApiAidRequestOut>(
    fetchWithAuth,
    'PUT',
    `${BASE}/requests/${requestId}/payer-shares/${String(householdCmId)}`,
    body,
    "Couldn't set the share"
  )
}

/** Settle a request's session (main spec §9.1). */
export function resolveAidSession(
  fetchWithAuth: FetchWithAuth,
  requestId: string,
  body: ApiAidSessionIn
): Promise<ApiAidRequestOut> {
  return send<ApiAidRequestOut>(
    fetchWithAuth,
    'POST',
    `${BASE}/requests/${requestId}/session`,
    body,
    "Couldn't settle the session"
  )
}

/** Mark a request the duplicate of the one kept (main spec §9.2). */
export function markAidDuplicate(
  fetchWithAuth: FetchWithAuth,
  requestId: string,
  body: ApiAidDuplicateIn
): Promise<ApiAidRequestOut> {
  return send<ApiAidRequestOut>(
    fetchWithAuth,
    'POST',
    `${BASE}/requests/${requestId}/duplicate`,
    body,
    "Couldn't mark the duplicate"
  )
}

/** A Family Camp headcount (main spec §8). */
export function setAidHeadcount(
  fetchWithAuth: FetchWithAuth,
  requestId: string,
  body: ApiAidHeadcountIn
): Promise<ApiAidRequestOut> {
  return send<ApiAidRequestOut>(
    fetchWithAuth,
    'PUT',
    `${BASE}/requests/${requestId}/headcount`,
    body,
    "Couldn't set the headcount"
  )
}
