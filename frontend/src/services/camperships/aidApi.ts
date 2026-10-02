/**
 * Camperships' reads, the wire only. The server decides every figure (D21); this file builds
 * URLs and turns a non-ok answer into an error that keeps its status. Protected: pass
 * `fetchWithAuth` from `useApiWithAuth()`.
 */
import type {
  ApiAidApprovedRules,
  ApiAidDefinitions,
  ApiAidGrid,
  ApiAidJumpIndex,
  ApiAidRemaining,
} from '../../types/api-types'
import { ApiError, toApiError } from '../apiError'
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
