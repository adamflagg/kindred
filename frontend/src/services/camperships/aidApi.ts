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
  ApiAidCorrectionIn,
  ApiAidCorrectionOut,
  ApiAidDefinitions,
  ApiAidDiscardDraftIn,
  ApiAidDuplicateIn,
  ApiAidGrid,
  ApiAidCostOverrideIn,
  ApiAidHeadcountIn,
  ApiAidHoldReleaseIn,
  ApiAidHouseholdPage,
  ApiAidHouseholdShareIn,
  ApiAidJumpIndex,
  ApiAidLeaveLineIn,
  ApiAidManualHoldIn,
  ApiAidPreview,
  ApiAidPlaceLineIn,
  ApiAidPlaceLinesIn,
  ApiAidPlaceOut,
  ApiAidPlacePreview,
  ApiAidPlacePreviewIn,
  ApiAidPostedIn,
  ApiAidPreviewIn,
  ApiAidReclassifyLineIn,
  ApiAidRemaining,
  ApiAidToPlace,
  ApiAidToPlaceWriteOut,
  ApiAidRequestOut,
  ApiAidSources,
  ApiAidHistoryOperationDetail,
  ApiAidHistoryPage,
  ApiAidMakeRulesDraftIn,
  ApiAidMarchFile,
  ApiAidPromotionPreview,
  ApiAidRulesApproveIn,
  ApiAidRulesDraft,
  ApiAidRulesSection,
  ApiAidRulesVersion,
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
  ApiAidScenarioRenameIn,
  ApiAidScenarioSaveDraftIn,
  ApiAidScenarioSnapshot,
  ApiAidScenarioWorkspace,
  ApiAidSectionSaveIn,
  ApiAidSectionsSaveIn,
  ApiAidSessionIn,
  ApiAidUnpostIn,
  ApiAidUseFormIn,
  ApiAidUseFormOut,
  ApiAidWriteOut,
  ApiAidCommitteeReport,
  ApiAidPrograms,
  ApiAidDevelopment,
  ApiAidZip,
  ApiAidReportRequestIds,
  ApiAidStatistics,
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

/**
 * One write (or the preview's POST). A refusal becomes an AidWriteError in the server's words.
 * `body` undefined sends none (a DELETE whose reason rides in the query, slice 3).
 */
async function send<T>(
  fetchWithAuth: FetchWithAuth,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  body: unknown,
  fallback: string,
  signal?: AbortSignal
): Promise<T> {
  const response = await fetchWithAuth(url, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
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

/** Set the cost to price the request at with a reason and a note, or clear it (D22). */
export function setAidCostOverride(
  fetchWithAuth: FetchWithAuth,
  requestId: string,
  body: ApiAidCostOverrideIn
): Promise<ApiAidWriteOut> {
  return send<ApiAidWriteOut>(
    fetchWithAuth,
    'POST',
    `${BASE}/requests/${requestId}/cost-override`,
    body,
    "Couldn't change the cost"
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
  body: ApiAidScenarioSaveDraftIn
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

/** Which requests a compare counts (D138): every frozen one, those by the Round 1 deadline, or by a date. */
export type AidRequestSet =
  | { readonly kind: 'all' }
  | { readonly kind: 'deadline' }
  | { readonly kind: 'date'; readonly date: string }

/** Which requests a read counts (D138), as the evaluate and fit bodies say it. */
export function requestSetBody(set: AidRequestSet): {
  through_round1_deadline?: boolean
  received_through?: string
} {
  if (set.kind === 'deadline') return { through_round1_deadline: true }
  if (set.kind === 'date') return { received_through: set.date }
  return {}
}

export const setKey = (set: AidRequestSet) => (set.kind === 'date' ? `date:${set.date}` : set.kind)

/** What Compare asks for (§S11.2): kept codes, the built-in columns, the draft and last season, on a request set. */
export interface CompareQuery {
  readonly codes: readonly string[]
  readonly requestSet: AidRequestSet
  readonly lastSeason: boolean
  readonly rules: boolean
  readonly lastRules: boolean
  readonly draft: boolean
}

export const compareKey = (query: CompareQuery) =>
  [
    query.codes.join(','),
    setKey(query.requestSet),
    query.lastSeason,
    query.rules,
    query.lastRules,
    query.draft,
  ].join('|')

/** Rename a kept option (§S11.1): everyone with `rules` sees it. */
export function renameAidScenarioOption(
  fetchWithAuth: FetchWithAuth,
  year: number,
  code: string,
  body: ApiAidScenarioRenameIn
): Promise<ApiAidScenarioOption> {
  return send<ApiAidScenarioOption>(
    fetchWithAuth,
    'PATCH',
    `${scenarios(year)}/options/${encodeURIComponent(code)}`,
    body,
    "Couldn't rename it"
  )
}

/**
 * Your draft first, beside up to four kept options, on the current snapshot (spec §7.4; D38), on a
 * request set when asked (D138); with last season's posted money beside them on `lastSeason` (RPT-17), and the
 * built-in columns (the rules in effect, last season's rules) when asked (§S11.2).
 */
export async function fetchAidScenarioCompare(
  fetchWithAuth: FetchWithAuth,
  year: number,
  compare: CompareQuery
): Promise<ApiAidScenarioCompare> {
  const query = new URLSearchParams()
  for (const code of compare.codes) query.append('codes', code)
  if (compare.requestSet.kind === 'deadline') query.set('through_round1_deadline', 'true')
  if (compare.requestSet.kind === 'date') query.set('received_through', compare.requestSet.date)
  if (compare.lastSeason) query.set('last_season', 'true')
  if (compare.rules) query.set('rules', 'true')
  if (compare.lastRules) query.set('last_rules', 'true')
  if (!compare.draft) query.set('draft', 'false')
  const search = query.toString()
  const response = await fetchWithAuth(`${scenarios(year)}/compare${search ? `?${search}` : ''}`)
  if (!response.ok) throw await toApiError(response, 'Failed to compare', AidApiError)
  return (await response.json()) as ApiAidScenarioCompare
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

/** A rules write's body, carrying a done season's unlock reason (spec §11.3) only when there is one. */
function withReason<B extends object>(body: B, pastSeasonReason: string | null): B {
  return pastSeasonReason === null ? body : { ...body, past_season_reason: pastSeasonReason }
}

/**
 * One section editor's save into the rules draft (spec §7.5; D39). It lands in a new version when it
 * would change approved rules in use (`branched_from`). 409 (G6) when the section changed since the
 * editor opened (`expected_fingerprint`), or the version is no longer the latest: nothing is written.
 */
export function saveAidRulesSection(
  fetchWithAuth: FetchWithAuth,
  year: number,
  section: ApiAidRulesSection,
  body: ApiAidSectionSaveIn,
  pastSeasonReason: string | null = null
): Promise<ApiAidRulesDraft> {
  return send<ApiAidRulesDraft>(
    fetchWithAuth,
    'PUT',
    `${BASE}/rules/${String(year)}/sections/${section}`,
    withReason(body, pastSeasonReason),
    "Couldn't save the section"
  )
}

/** Programs and costs' one Save (spec §15.6): several sections as one logged operation. 409 when a named section moved. */
export function saveAidRulesSections(
  fetchWithAuth: FetchWithAuth,
  year: number,
  body: ApiAidSectionsSaveIn,
  pastSeasonReason: string | null = null
): Promise<ApiAidRulesDraft> {
  return send<ApiAidRulesDraft>(
    fetchWithAuth,
    'PUT',
    `${BASE}/rules/${String(year)}/sections`,
    withReason(body, pastSeasonReason),
    "Couldn't save the card"
  )
}

/**
 * Approve sections of `version` as one logged operation, the note naming the approving body (D39).
 * 409 (G6) when `version` is no longer the rules draft, or a section changed under the approval.
 */
export function approveAidRules(
  fetchWithAuth: FetchWithAuth,
  year: number,
  version: number,
  body: ApiAidRulesApproveIn,
  pastSeasonReason: string | null = null
): Promise<ApiAidRulesVersion> {
  return send<ApiAidRulesVersion>(
    fetchWithAuth,
    'POST',
    `${BASE}/rules/${String(year)}/versions/${String(version)}/approve`,
    withReason(body, pastSeasonReason),
    "Couldn't approve the sections"
  )
}

/**
 * Throw the rules draft away (owner 2026-10-08): every version newer than the one in effect is marked discarded, and
 * the answer is the draft read, back on the version in effect. 409 when the draft moved on since `base_version`, holds
 * an approval made since it started, or there is nothing to go back to.
 */
export function discardAidRulesDraft(
  fetchWithAuth: FetchWithAuth,
  year: number,
  body: ApiAidDiscardDraftIn,
  pastSeasonReason: string | null = null
): Promise<ApiAidRulesDraft> {
  return send<ApiAidRulesDraft>(
    fetchWithAuth,
    'POST',
    `${BASE}/rules/${String(year)}/draft/discard`,
    withReason(body, pastSeasonReason),
    "Couldn't discard the rules draft"
  )
}

/** Version 1 of an empty season, copied from last season's rules, every section a draft (§7.5). 409 when the season already has rules. */
export function startAidRulesFromLastYear(
  fetchWithAuth: FetchWithAuth,
  year: number,
  pastSeasonReason: string | null = null
): Promise<ApiAidRulesVersion> {
  return send<ApiAidRulesVersion>(
    fetchWithAuth,
    'POST',
    `${BASE}/rules/${String(year)}/start-from-last-year`,
    withReason({}, pastSeasonReason),
    "Couldn't start the season's rules"
  )
}

/** Money › To place (spec §8.1; D12, D58): the camp-aid lines no single request takes, by reason; one household page's part of it (D26). */
export async function fetchAidToPlace(
  fetchWithAuth: FetchWithAuth,
  year: number,
  householdCmId: number | null
): Promise<ApiAidToPlace> {
  const params: Record<string, string> =
    householdCmId === null ? {} : { household_cm_id: String(householdCmId) }
  const response = await fetchWithAuth(withQuery(`${BASE}/money/${String(year)}/to-place`, params))
  if (!response.ok) throw await toApiError(response, 'Failed to load To place', AidApiError)
  return (await response.json()) as ApiAidToPlace
}

const toPlaceLine = (year: number, transactionCmId: number) =>
  `${BASE}/money/${String(year)}/to-place/${String(transactionCmId)}`

/** Confirm (one part) or Split (several) one line, with the Posted ticks it makes, as one operation (D12, D81). */
export function placeAidLine(
  fetchWithAuth: FetchWithAuth,
  year: number,
  transactionCmId: number,
  body: ApiAidPlaceLineIn
): Promise<ApiAidPlaceOut> {
  return send<ApiAidPlaceOut>(
    fetchWithAuth,
    'POST',
    `${toPlaceLine(year, transactionCmId)}/place`,
    body,
    "Couldn't place the line"
  )
}

/** Confirm several lines at once (D16), all or nothing, as one operation. At most 200 lines. */
export function placeAidLines(
  fetchWithAuth: FetchWithAuth,
  year: number,
  body: ApiAidPlaceLinesIn
): Promise<ApiAidPlaceOut> {
  return send<ApiAidPlaceOut>(
    fetchWithAuth,
    'POST',
    `${BASE}/money/${String(year)}/to-place/place`,
    body,
    "Couldn't place the lines"
  )
}

/** Leave a line at family level, with a note (D58). */
export function leaveAidLine(
  fetchWithAuth: FetchWithAuth,
  year: number,
  transactionCmId: number,
  body: ApiAidLeaveLineIn
): Promise<ApiAidToPlaceWriteOut> {
  return send<ApiAidToPlaceWriteOut>(
    fetchWithAuth,
    'POST',
    `${toPlaceLine(year, transactionCmId)}/leave`,
    body,
    "Couldn't leave the line at family level"
  )
}

/** Reopen a line left at family level; the reason rides in the query (the route's DELETE). */
export function reopenAidLine(
  fetchWithAuth: FetchWithAuth,
  year: number,
  transactionCmId: number,
  reason: string
): Promise<ApiAidToPlaceWriteOut> {
  return send<ApiAidToPlaceWriteOut>(
    fetchWithAuth,
    'DELETE',
    withQuery(`${toPlaceLine(year, transactionCmId)}/leave`, { reason }),
    undefined,
    "Couldn't reopen the line"
  )
}

/** Reclassify a line as another aid source, with a reason (D104; `rules`). The next ledger sync applies it. */
export function reclassifyAidLine(
  fetchWithAuth: FetchWithAuth,
  year: number,
  transactionCmId: number,
  body: ApiAidReclassifyLineIn
): Promise<ApiAidToPlaceWriteOut> {
  return send<ApiAidToPlaceWriteOut>(
    fetchWithAuth,
    'POST',
    `${toPlaceLine(year, transactionCmId)}/reclassify`,
    body,
    "Couldn't reclassify the line"
  )
}

/**
 * What placing these parts on one line would mark posted, lock and withhold (slice 3 ask 8, #2975),
 * worked out by the plan the write runs. Writes nothing; refuses (4xx, the server's sentence) as the
 * write would. `casework`.
 */
export function previewAidPlacement(
  fetchWithAuth: FetchWithAuth,
  year: number,
  transactionCmId: number,
  body: ApiAidPlacePreviewIn
): Promise<ApiAidPlacePreview> {
  return send<ApiAidPlacePreview>(
    fetchWithAuth,
    'POST',
    `${toPlaceLine(year, transactionCmId)}/preview`,
    body,
    "Couldn't work out what placing this would do"
  )
}

/**
 * The CampMinder description registry (spec §8.1; D58, D100): every description, classified or not,
 * with this season's lines and $ (`?year=`). `view` or `grantors` (router `_VIEW_OR_GRANTORS`).
 */
export async function fetchAidSources(
  fetchWithAuth: FetchWithAuth,
  year: number
): Promise<ApiAidSources> {
  const response = await fetchWithAuth(withQuery(`${BASE}/sources`, { year: String(year) }))
  if (!response.ok) throw await toApiError(response, 'Failed to load the sources', AidApiError)
  return (await response.json()) as ApiAidSources
}

/**
 * The March file's rows (spec §8.3; D73; S3-7; `casework`): one per payer share of each Round 1 offer,
 * and the count of $0 Round 1 offers left out (ruling E). Reads only; changes nothing.
 */
export async function fetchAidMarchFile(
  fetchWithAuth: FetchWithAuth,
  year: number
): Promise<ApiAidMarchFile> {
  const response = await fetchWithAuth(`${BASE}/decisions/${String(year)}/march-file`)
  if (!response.ok) throw await toApiError(response, "Couldn't make the March file", AidApiError)
  return (await response.json()) as ApiAidMarchFile
}

// --- Reports (slice 4; spec §9) -----------------------------------------------------------------

/**
 * One Reports read (spec §9; D21): a GET with its query. A refusal keeps its status and the server's
 * sentence (a 422 names a control the season can't take), so the page can show it beside the control.
 */
async function fetchAidReport<T>(
  fetchWithAuth: FetchWithAuth,
  path: string,
  params: Readonly<Record<string, string>>,
  fallback: string
): Promise<T> {
  const response = await fetchWithAuth(withQuery(`${BASE}/reports/${path}`, { ...params }))
  if (!response.ok) throw await toApiError(response, fallback, AidApiError)
  return (await response.json()) as T
}

/** Reports › Statistics (§9.2): one award table × round, the reporting controls and the as-of in `params`. `view`. */
export function fetchAidStatistics(
  fetchWithAuth: FetchWithAuth,
  year: number,
  params: Readonly<Record<string, string>>
): Promise<ApiAidStatistics> {
  return fetchAidReport<ApiAidStatistics>(
    fetchWithAuth,
    `${String(year)}/statistics`,
    params,
    'Failed to load Statistics'
  )
}

/** Reports › Programs (§9.3, RPT-11): sessions by pool, the request set and the as-of in `params`. `view`. */
export function fetchAidPrograms(
  fetchWithAuth: FetchWithAuth,
  year: number,
  params: Readonly<Record<string, string>>
): Promise<ApiAidPrograms> {
  return fetchAidReport<ApiAidPrograms>(
    fetchWithAuth,
    `${String(year)}/programs`,
    params,
    'Failed to load Programs'
  )
}

/** The committee's year-over-year tables (§9.7), seasons 2022 → `year`; live only. `view`. */
export function fetchAidCommitteeReport(
  fetchWithAuth: FetchWithAuth,
  year: number,
  params: Readonly<Record<string, string>>
): Promise<ApiAidCommitteeReport> {
  return fetchAidReport<ApiAidCommitteeReport>(
    fetchWithAuth,
    `${String(year)}/committee`,
    params,
    "Failed to load the committee's tables"
  )
}

/**
 * The requests behind one Statistics or Programs count (D20; #2974): `GET /reports/{year}/{report}/requests`
 * with the count's address (the same chips, basis and reporting control as its read) and the grid's as-of.
 * `view` only: development's summary never sees a request (D65).
 */
export function fetchAidReportRequests(
  fetchWithAuth: FetchWithAuth,
  year: number,
  report: 'statistics' | 'programs',
  params: Readonly<Record<string, string>>
): Promise<ApiAidReportRequestIds> {
  return fetchAidReport<ApiAidReportRequestIds>(
    fetchWithAuth,
    `${String(year)}/${report}/requests`,
    params,
    "Couldn't read the requests behind that count"
  )
}

/**
 * Reports › Development (§9.4): every line by group, seasons from 2022 as columns. `view` or `summary` (D65).
 * `column` asks for one on-demand dated column, `<season>:<YYYY-MM-DD>`, returned among `columns`;
 * the server saves nothing.
 */
export function fetchAidDevelopment(
  fetchWithAuth: FetchWithAuth,
  year: number,
  column?: string
): Promise<ApiAidDevelopment> {
  return fetchAidReport<ApiAidDevelopment>(
    fetchWithAuth,
    `${String(year)}/development`,
    column === undefined ? {} : { column },
    'Failed to load the Development report'
  )
}

/**
 * ZIP codes (§9.4, D90; owner ruling C): `group` is a pool key of the season's rules or `all`;
 * omitted, the server serves the summer group. An unknown group is a 422. `view` or `summary`.
 */
export function fetchAidZip(
  fetchWithAuth: FetchWithAuth,
  year: number,
  params: Readonly<Record<string, string>>
): Promise<ApiAidZip> {
  return fetchAidReport<ApiAidZip>(
    fetchWithAuth,
    `${String(year)}/development/zip`,
    params,
    'Failed to load the ZIP codes'
  )
}
