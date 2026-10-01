/**
 * Camperships' reads, the wire only. The server decides every figure (D21); this file builds
 * URLs and turns a non-ok answer into an error that keeps its status. Protected: pass
 * `fetchWithAuth` from `useApiWithAuth()`.
 */
import type { ApiAidRemaining } from '../../types/api-types'
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
