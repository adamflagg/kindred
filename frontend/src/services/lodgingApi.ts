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
 * Turn a non-ok response into an Error carrying FastAPI's `detail` when it
 * has one, so a 404 for an unknown weekend reads as a sentence rather than
 * a bare status code.
 */
async function toError(response: Response, fallback: string): Promise<Error> {
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
    return new Error(detail)
  }
  return new Error(`${fallback} (HTTP ${String(response.status)})`)
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

/** The per-weekend roster: parties, unit inventory, and honest counts. */
export async function fetchWeekendRoster(
  fetchWithAuth: FetchWithAuth,
  year: number,
  sessionCmId: number
): Promise<WeekendRoster> {
  const response = await fetchWithAuth(
    `${API_BASE}/roster?year=${String(year)}&session_cm_id=${String(sessionCmId)}`
  )
  if (!response.ok) throw await toError(response, 'Failed to load the weekend roster')
  return response.json() as Promise<WeekendRoster>
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
