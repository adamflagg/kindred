/**
 * The admin audit log's reads (Manage > Audit Log).
 *
 * `userDataOptions` (30 s stale, refetch on focus), deliberately: every access,
 * role and settings write anywhere in the app adds a row -- by any admin, in any
 * tab, or behind the app in the PocketBase admin -- and none of those writers
 * can know this screen's keys to invalidate them. A log read half an hour stale
 * would hide exactly what an admin opened it to check.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { fetchAuditLog, fetchAuditLogActors } from '../services/auditLogApi'
import type { AuditQuery } from '../types/auditLog'
import { queryKeys, userDataOptions } from '../utils/queryKeys'
import { useApiWithAuth } from './useApiWithAuth'

export function useAuditLog(query: AuditQuery) {
  const { fetchWithAuth, isAuthLoading } = useApiWithAuth()
  return useQuery({
    queryKey: queryKeys.auditLog(query),
    enabled: !isAuthLoading,
    queryFn: () => fetchAuditLog(fetchWithAuth, query),
    // Paging keeps the old rows up until the next page arrives.
    placeholderData: keepPreviousData,
    ...userDataOptions,
  })
}

export function useAuditLogActors() {
  const { fetchWithAuth, isAuthLoading } = useApiWithAuth()
  return useQuery({
    queryKey: queryKeys.auditLogActors(),
    enabled: !isAuthLoading,
    queryFn: () => fetchAuditLogActors(fetchWithAuth),
    ...userDataOptions,
  })
}
