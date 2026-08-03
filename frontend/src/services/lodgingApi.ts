/**
 * Weekend lodging API client.
 *
 * Every function takes `fetchWithAuth` as its first parameter — obtained by
 * the caller from `useApiWithAuth()`. Services never import it. The
 * PocketBase JWT lives in localStorage, so a raw fetch with
 * `credentials: 'include'` silently 401s (frontend/CLAUDE.md).
 */

import type {
  HouseholdMedical,
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
