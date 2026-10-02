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
  ApiAidBudget,
  ApiAidCancellationIn,
  ApiAidCapacity,
  ApiAidCapacityIn,
  ApiAidCapacityList,
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
  ApiAidHistoryOperationDetail,
  ApiAidHistoryPage,
  ApiAidMakeRulesDraftIn,
  ApiAidPromotionPreview,
  ApiAidRulesDraft,
  ApiAidRound3AmountIn,
  ApiAidRound3ApprovalIn,
  ApiAidScenarioDocumentIn,
  ApiAidScenarioDraft,
  ApiAidScenarioEvaluateIn,
  ApiAidScenarioEvaluation,
  ApiAidScenarioFit,
  ApiAidScenarioCompare,
  ApiAidScenarioKeepIn,
  ApiAidScenarioLoadIn,
  ApiAidScenarioOption,
  ApiAidScenarioSensitivity,
  ApiAidScenarioSnapshot,
  ApiAidScenarioTrailPage,
  ApiAidScenarioViewIn,
  ApiAidScenarioWorkspace,
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
 * A read's retry rule (Decision 30): a refusal in the server's words (`statuses`, e.g. no rules yet
 * 404, nothing to start from 422) and a lapsed sign-in (401) answer at once; anything else keeps the
 * app's three retries.
 */
export function retryUnlessRefused(statuses: readonly number[]) {
  return (failureCount: number, error: Error): boolean =>
    ![...statuses, 401].some((status) => hasStatus(error, status)) && failureCount < 3
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

/** Rounds & budget (spec §7.2): pools × rounds, the strip, below the line and forward demand; live or a past day. */
export async function fetchAidBudget(
  fetchWithAuth: FetchWithAuth,
  year: number,
  asOfParams: Record<string, string>
): Promise<ApiAidBudget> {
  const response = await fetchWithAuth(
    withQuery(`${BASE}/decisions/${String(year)}/budget`, asOfParams)
  )
  if (!response.ok) throw await toApiError(response, 'Failed to load Rounds & budget', AidApiError)
  return (await response.json()) as ApiAidBudget
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

/** The rules draft, section by section with its changes (spec §7.5; D39): `rules` only. 404: no rules yet. */
export async function fetchAidRulesDraft(
  fetchWithAuth: FetchWithAuth,
  year: number
): Promise<ApiAidRulesDraft> {
  const response = await fetchWithAuth(`${BASE}/rules/${String(year)}/draft`)
  if (!response.ok) throw await toApiError(response, 'Failed to load the rules draft', AidApiError)
  return (await response.json()) as ApiAidRulesDraft
}

/**
 * Season › History (spec §7.6; D49): one page of the season's log, one line per operation, newest
 * first. `query` is the page's filters in the router's names (historyModel's `historyQuery`).
 */
export async function fetchAidHistory(
  fetchWithAuth: FetchWithAuth,
  year: number,
  query: Readonly<Record<string, string>>
): Promise<ApiAidHistoryPage> {
  const response = await fetchWithAuth(withQuery(`${BASE}/history/${String(year)}`, { ...query }))
  if (!response.ok) throw await toApiError(response, 'Failed to load the history', AidApiError)
  return (await response.json()) as ApiAidHistoryPage
}

/** One operation's rows with their field-level diffs, as recorded. 404: not in this season's log, or a rules one without `rules`. */
export async function fetchAidHistoryOperation(
  fetchWithAuth: FetchWithAuth,
  year: number,
  operationId: string
): Promise<ApiAidHistoryOperationDetail> {
  const response = await fetchWithAuth(
    `${BASE}/history/${String(year)}/operations/${encodeURIComponent(operationId)}`
  )
  if (!response.ok) throw await toApiError(response, 'Failed to load the operation', AidApiError)
  return (await response.json()) as ApiAidHistoryOperationDetail
}

const scenarios = (year: number) => `${BASE}/scenarios/${String(year)}`

/** Your scenario draft, every kept option, and the frozen snapshot they run on (spec §7.4; D38): `rules`. */
export async function fetchAidScenarios(
  fetchWithAuth: FetchWithAuth,
  year: number
): Promise<ApiAidScenarioWorkspace> {
  const response = await fetchWithAuth(scenarios(year))
  if (!response.ok) throw await toApiError(response, 'Failed to load the scenarios', AidApiError)
  return (await response.json()) as ApiAidScenarioWorkspace
}

/** Freeze the season's applications for scenarios; nothing is written when they haven't moved (§7.4). */
export function freezeAidScenarioSeason(
  fetchWithAuth: FetchWithAuth,
  year: number
): Promise<ApiAidScenarioSnapshot> {
  return send<ApiAidScenarioSnapshot>(
    fetchWithAuth,
    'POST',
    `${scenarios(year)}/snapshot`,
    {},
    "Couldn't freeze the applications"
  )
}

/**
 * A starting point loaded into your draft: from the rules draft, or from last season's approved
 * criteria (RPT-18). 422 when last season has no approved rules, or its criteria don't fit.
 */
export function startAidScenarios(
  fetchWithAuth: FetchWithAuth,
  year: number,
  from: 'rules' | 'last_season'
): Promise<ApiAidScenarioWorkspace> {
  return send<ApiAidScenarioWorkspace>(
    fetchWithAuth,
    'POST',
    `${scenarios(year)}/starting-points${from === 'last_season' ? '/last-season' : ''}`,
    {},
    "Couldn't start a scenario"
  )
}

/** A document priced on the frozen season with the sliders applied; records nothing (the live figures). */
export function evaluateAidScenario(
  fetchWithAuth: FetchWithAuth,
  year: number,
  body: ApiAidScenarioEvaluateIn,
  signal?: AbortSignal
): Promise<ApiAidScenarioEvaluation> {
  return send<ApiAidScenarioEvaluation>(
    fetchWithAuth,
    'POST',
    `${scenarios(year)}/evaluate`,
    body,
    "Couldn't work out the scenario",
    signal
  )
}

/** A released setting: your draft becomes this document, recorded in the trail (D38). */
export function saveAidScenarioDraft(
  fetchWithAuth: FetchWithAuth,
  year: number,
  body: ApiAidScenarioDocumentIn
): Promise<ApiAidScenarioDraft> {
  return send<ApiAidScenarioDraft>(
    fetchWithAuth,
    'PUT',
    `${scenarios(year)}/draft`,
    body,
    "Couldn't record the setting"
  )
}

/** A kept option or a trail row into your draft; recorded, so nothing is lost (D38). */
export function loadAidScenarioDraft(
  fetchWithAuth: FetchWithAuth,
  year: number,
  body: ApiAidScenarioLoadIn
): Promise<ApiAidScenarioDraft> {
  return send<ApiAidScenarioDraft>(
    fetchWithAuth,
    'POST',
    `${scenarios(year)}/draft/load`,
    body,
    "Couldn't load it"
  )
}

/** Keep your draft: a variant under its starting point, or a new starting point (two levels, D38). */
export function keepAidScenario(
  fetchWithAuth: FetchWithAuth,
  year: number,
  body: ApiAidScenarioKeepIn
): Promise<ApiAidScenarioOption> {
  return send<ApiAidScenarioOption>(
    fetchWithAuth,
    'POST',
    `${scenarios(year)}/keep`,
    body,
    "Couldn't keep the draft"
  )
}

/**
 * What one step of each sizing setting moves Round 1 by (§7.4), the dollar-for-dollar switch included
 * (D137). The body is the draft's document alone (Decision 22).
 */
export function fetchAidScenarioSensitivity(
  fetchWithAuth: FetchWithAuth,
  year: number,
  body: Pick<ApiAidScenarioViewIn, 'document'>
): Promise<ApiAidScenarioSensitivity> {
  return send<ApiAidScenarioSensitivity>(
    fetchWithAuth,
    'POST',
    `${scenarios(year)}/sensitivity`,
    body,
    "Couldn't work out each setting's step"
  )
}

/** Which requests a compare counts (D138): every frozen one, those by the Round 1 deadline, or by a date. */
export type AidRequestSet =
  | { readonly kind: 'all' }
  | { readonly kind: 'deadline' }
  | { readonly kind: 'date'; readonly date: string }

/**
 * Your draft first, beside up to four kept options, on the current snapshot (spec §7.4; D38), on a
 * request set when asked (D138); with last season's posted money beside them on `lastSeason` (RPT-17).
 */
export async function fetchAidScenarioCompare(
  fetchWithAuth: FetchWithAuth,
  year: number,
  codes: readonly string[],
  requestSet: AidRequestSet,
  lastSeason: boolean
): Promise<ApiAidScenarioCompare> {
  const query = new URLSearchParams()
  for (const code of codes) query.append('codes', code)
  if (requestSet.kind === 'deadline') query.set('through_round1_deadline', 'true')
  if (requestSet.kind === 'date') query.set('received_through', requestSet.date)
  if (lastSeason) query.set('last_season', 'true')
  const search = query.toString()
  const response = await fetchWithAuth(`${scenarios(year)}/compare${search ? `?${search}` : ''}`)
  if (!response.ok) throw await toApiError(response, 'Failed to compare', AidApiError)
  return (await response.json()) as ApiAidScenarioCompare
}

/** Every released setting, everyone's, newest first (D38), a page at a time. */
export async function fetchAidScenarioTrail(
  fetchWithAuth: FetchWithAuth,
  year: number,
  page: number
): Promise<ApiAidScenarioTrailPage> {
  const response = await fetchWithAuth(
    withQuery(`${scenarios(year)}/trail`, { page: String(page), per_page: '50' })
  )
  if (!response.ok) throw await toApiError(response, 'Failed to load the trail', AidApiError)
  return (await response.json()) as ApiAidScenarioTrailPage
}

/**
 * The tier shift that uses Round 1's allocation: the total row's Round 1 Remaining (it also counts
 * money on programs with no pool; §7.4; D119; fit.py), naming the tightest pool as information. Records nothing: "Use it" records the document.
 */
export function fitAidScenario(
  fetchWithAuth: FetchWithAuth,
  year: number,
  body: ApiAidScenarioDocumentIn
): Promise<ApiAidScenarioFit> {
  return send<ApiAidScenarioFit>(
    fetchWithAuth,
    'POST',
    `${scenarios(year)}/fit-to-budget`,
    body,
    "Couldn't fit to budget"
  )
}

/** "Make A1 the rules draft": each section it changes, old → new, and whose edit it would replace (D39). */
export async function fetchAidPromotionPreview(
  fetchWithAuth: FetchWithAuth,
  year: number,
  code: string
): Promise<ApiAidPromotionPreview> {
  const response = await fetchWithAuth(`${scenarios(year)}/options/${code}/rules-draft`)
  if (!response.ok) throw await toApiError(response, "Couldn't look at the changes", AidApiError)
  return (await response.json()) as ApiAidPromotionPreview
}

/**
 * Copy a kept option's changed sections into the rules draft (D39); each then goes through approval.
 * 409 when the rules draft moved on since the preview, or a replaced edit wasn't confirmed by its token.
 */
export function makeAidRulesDraft(
  fetchWithAuth: FetchWithAuth,
  year: number,
  code: string,
  body: ApiAidMakeRulesDraftIn
): Promise<ApiAidRulesDraft> {
  return send<ApiAidRulesDraft>(
    fetchWithAuth,
    'POST',
    `${scenarios(year)}/options/${code}/rules-draft`,
    body,
    "Couldn't make it the rules draft"
  )
}

/** The session capacities stored for the season (view-level; the Season reads' gate). */
export async function fetchAidSessionCapacities(
  fetchWithAuth: FetchWithAuth,
  year: number
): Promise<ApiAidCapacityList> {
  const response = await fetchWithAuth(`${BASE}/capacity/${String(year)}`)
  if (!response.ok) throw await toApiError(response, 'Failed to load the capacities', AidApiError)
  return (await response.json()) as ApiAidCapacityList
}

/**
 * A session's capacity for the season, for Round 3's context only (spec §6.3, §10.4; `rules`). It
 * replaces the figure stored for the session, if any; re-entering the same figure writes nothing.
 */
export function setAidSessionCapacity(
  fetchWithAuth: FetchWithAuth,
  year: number,
  sessionCmId: number,
  body: ApiAidCapacityIn
): Promise<ApiAidCapacity> {
  return send<ApiAidCapacity>(
    fetchWithAuth,
    'PUT',
    `${BASE}/capacity/${String(year)}/${String(sessionCmId)}`,
    body,
    "Couldn't save the capacity"
  )
}
