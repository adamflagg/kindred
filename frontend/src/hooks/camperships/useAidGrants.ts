import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import { Permission } from '../../constants/permissions'
import { useAuth } from '../../contexts/AuthContext'
import { fetchAidGrants } from '../../services/camperships/aidApi'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'

/**
 * Grants' one read (spec §8.2; D21, D57): the Register, Needs attention's groups and Expected, family
 * level, for `view`. Live only. It inherits the app's cache defaults: every Camperships write
 * refreshes it (`invalidateAidMoneyQueries` holds the grants prefix), a ledger sync through the
 * 'financial-aid' prefix.
 */
export function useAidGrants() {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  return useQuery({
    queryKey: queryKeys.aidGrants(year),
    queryFn: () => fetchAidGrants(fetchWithAuth, year, { offsets: true }),
    enabled: year > 0 && !authLoading && hasPermission(Permission.FINANCIAL_AID_VIEW),
  })
}

/**
 * The stored fields past the cache (Decision P-9): what a commitment edit opens on and checks just
 * before it sends, and what a placement checks before it sends. `offsets=false` skips the pricing
 * (router l.1000–1009), and its own key keeps that unpriced answer out of the Register's cache.
 * `staleTime: 0, gcTime: 0`: a read at a click, never a standing query.
 */
export function useFreshAidGrants() {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()
  return useCallback(
    () =>
      queryClient.fetchQuery({
        queryKey: queryKeys.aidGrantsStored(year),
        queryFn: () => fetchAidGrants(fetchWithAuth, year, { offsets: false }),
        staleTime: 0,
        gcTime: 0,
      }),
    [fetchWithAuth, queryClient, year]
  )
}
