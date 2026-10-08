import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import { Permission } from '../../constants/permissions'
import { useAuth } from '../../contexts/AuthContext'
import { fetchAidGrantors } from '../../services/camperships/aidApi'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { usePermissions } from '../usePermissions'

/**
 * The grantor directory's read (spec §8.2; D160): `view` or `grantors` (owner ruling 2026-10-01).
 * Pickers read the grantors in use; the directory and any name shown from history read them all
 * (`includeRetired`). `year` adds each grantor's grants and $ that season (Grants › Grantors).
 * Inherits the app's cache defaults: every grantor or mapping write refreshes it
 * (`invalidateAidMoneyQueries`'s `registry`), and a ledger sync through the 'financial-aid' prefix.
 */
export function useAidGrantors({
  includeRetired = false,
  year = null,
  enabled = true,
}: {
  readonly includeRetired?: boolean
  readonly year?: number | null
  readonly enabled?: boolean
} = {}) {
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  const allowed =
    hasPermission(Permission.FINANCIAL_AID_VIEW) || hasPermission(Permission.FINANCIAL_AID_GRANTORS)
  return useQuery({
    queryKey: queryKeys.aidGrantors(includeRetired, year),
    queryFn: () => fetchAidGrantors(fetchWithAuth, { includeRetired, year }),
    enabled: enabled && !authLoading && allowed,
  })
}

/**
 * A fresh read of the whole directory (retired included, no season), past the cache (staleTime 0),
 * for an editor to open on and to check just before it sends (Decision P-9).
 */
export function useFreshAidGrantors() {
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()
  return useCallback(
    () =>
      queryClient.fetchQuery({
        queryKey: queryKeys.aidGrantors(true, null),
        queryFn: () => fetchAidGrantors(fetchWithAuth, { includeRetired: true, year: null }),
        staleTime: 0,
      }),
    [fetchWithAuth, queryClient]
  )
}
