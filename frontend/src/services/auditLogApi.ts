/**
 * The admin audit log API (FastAPI, admin-only). Every call goes through
 * `fetchWithAuth`: the endpoints are protected, and a bare fetch would 401.
 */
import type { AuditLogActors } from '../types/api-generated'
import type { AuditPage, AuditQuery } from '../types/auditLog'
import { ApiError, toApiError } from './apiError'
import type { FetchWithAuth } from './lodgingApi'

const BASE = '/api/admin/audit-log'

/** An audit log API failure. See `apiError.ts` for why each domain keeps its own subclass. */
export class AuditLogApiError extends ApiError {}

/** The query string for one screen state; defaults are left out. */
export function auditLogSearch(query: AuditQuery): string {
  const params = new URLSearchParams()
  for (const type of query.types) params.append('type', type)
  if (query.actor) params.set('actor', query.actor)
  if (query.q.trim()) params.set('q', query.q.trim())
  if (query.signIns) params.set('sign_ins', 'true')
  params.set('page', String(query.page))
  params.set('per_page', String(query.perPage))
  return params.toString()
}

export async function fetchAuditLog(
  fetchWithAuth: FetchWithAuth,
  query: AuditQuery
): Promise<AuditPage> {
  const response = await fetchWithAuth(`${BASE}?${auditLogSearch(query)}`)
  if (!response.ok)
    throw await toApiError(response, 'Failed to load the audit log', AuditLogApiError)
  return (await response.json()) as AuditPage
}

export async function fetchAuditLogActors(fetchWithAuth: FetchWithAuth): Promise<AuditLogActors> {
  const response = await fetchWithAuth(`${BASE}/actors`)
  if (!response.ok)
    throw await toApiError(response, 'Failed to load the people list', AuditLogApiError)
  return (await response.json()) as AuditLogActors
}
