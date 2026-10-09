import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import { Permission } from '../../constants/permissions'
import { useAuth } from '../../contexts/AuthContext'
import { fetchAidFundingSources } from '../../services/camperships/aidApi'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'

/**
 * Funding sources (D88, D100): each outside source's reporting group under the season's pools,
 * labelled by the rules, and the pools a group may be. Money › Funders joins it on `source_id` for
 * its Reporting group column and "Set a Group…" (Decision P-14). `view` or `summary`, as the route.
 * Under the sources prefix: "Set a Group…", a classification and a grantor mapping refresh it
 * (`registry`), and a ledger sync through the 'financial-aid' prefix.
 */
export function useAidFundingSources({ enabled = true }: { readonly enabled?: boolean } = {}) {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  const allowed =
    hasPermission(Permission.FINANCIAL_AID_VIEW) || hasPermission(Permission.FINANCIAL_AID_SUMMARY)
  return useQuery({
    queryKey: queryKeys.aidFundingSources(year),
    queryFn: () => fetchAidFundingSources(fetchWithAuth, year),
    enabled: enabled && year > 0 && !authLoading && allowed,
  })
}

/** A fresh read of Funding sources past the cache, for "Set a Group…" to open on and check before it sends (P-9). */
export function useFreshAidFundingSources() {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()
  return useCallback(
    () =>
      queryClient.fetchQuery({
        queryKey: queryKeys.aidFundingSources(year),
        queryFn: () => fetchAidFundingSources(fetchWithAuth, year),
        staleTime: 0,
      }),
    [fetchWithAuth, queryClient, year]
  )
}
