/**
 * The Audit Log tab's filters and page live in the URL (spec §6), so a view can
 * be linked and survives a reload. Pure parse/serialize, pinned by
 * auditUrlState.test.ts. Defaults are left out of the URL; an unknown value is
 * dropped rather than trusted.
 */
import {
  AUDIT_DEFAULT_PER_PAGE,
  AUDIT_FILTER_TYPES,
  AUDIT_PER_PAGE_OPTIONS,
  type AuditFilterType,
  type AuditPerPage,
  type AuditQuery,
} from '../../../types/auditLog'

export const DEFAULT_AUDIT_QUERY: AuditQuery = {
  q: '',
  types: [],
  actor: '',
  signIns: false,
  page: 1,
  perPage: AUDIT_DEFAULT_PER_PAGE,
}

const isFilterType = (v: string): v is AuditFilterType =>
  (AUDIT_FILTER_TYPES as readonly string[]).includes(v)

const isPerPage = (v: number): v is AuditPerPage =>
  (AUDIT_PER_PAGE_OPTIONS as readonly number[]).includes(v)

export function parseAuditQuery(params: URLSearchParams): AuditQuery {
  const page = Number.parseInt(params.get('page') ?? '', 10)
  const perPage = Number.parseInt(params.get('per') ?? '', 10)
  const types = params.getAll('type').filter(isFilterType)
  return {
    q: params.get('q') ?? '',
    // Fixed order, no duplicates: two URLs for one view would cache twice.
    types: AUDIT_FILTER_TYPES.filter((type) => types.includes(type)),
    actor: params.get('actor') ?? '',
    signIns: params.get('signins') === '1',
    page: Number.isFinite(page) && page >= 1 ? page : 1,
    perPage: isPerPage(perPage) ? perPage : AUDIT_DEFAULT_PER_PAGE,
  }
}

export function serializeAuditQuery(query: AuditQuery): URLSearchParams {
  const params = new URLSearchParams()
  if (query.q) params.set('q', query.q)
  for (const type of AUDIT_FILTER_TYPES) if (query.types.includes(type)) params.append('type', type)
  if (query.actor) params.set('actor', query.actor)
  if (query.signIns) params.set('signins', '1')
  if (query.page > 1) params.set('page', String(query.page))
  if (query.perPage !== AUDIT_DEFAULT_PER_PAGE) params.set('per', String(query.perPage))
  return params
}

/**
 * Apply a change. Any change that is not itself a page move sends the view back
 * to page 1: a filter change can leave the old page number past the end.
 */
export function updateAuditQuery(query: AuditQuery, change: Partial<AuditQuery>): AuditQuery {
  const next = { ...query, ...change }
  if (!('page' in change)) next.page = 1
  return next
}

/**
 * The type buttons pick ONE type, or All (mockup v8). The URL and the API
 * accept several `type`s, so a hand-built link can still combine them.
 */
export function selectType(type: AuditFilterType | 'all'): AuditFilterType[] {
  return type === 'all' ? [] : [type]
}
