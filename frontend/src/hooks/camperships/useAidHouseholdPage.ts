import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { Permission } from '../../constants/permissions'
import { useAuth } from '../../contexts/AuthContext'
import { fetchAidHouseholdPage, hasStatus } from '../../services/camperships/aidApi'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'

/**
 * The household page's one read (§6.3; D21, D26): live only (Decision 36), inheriting the app's
 * cache defaults; every write refreshes the whole household-page prefix. Household 0 reads nothing.
 */
export function useAidHouseholdPage(householdCmId: number) {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  return useQuery({
    queryKey: queryKeys.aidHouseholdPage(year, householdCmId),
    queryFn: () => fetchAidHouseholdPage(fetchWithAuth, year, householdCmId),
    enabled:
      year > 0 && householdCmId > 0 && !authLoading && hasPermission(Permission.FINANCIAL_AID_VIEW),
    // A household with no aid activity is a 404 (#2924): say so at once rather than retry it. A
    // 401 isn't retried either, as the app's default rule has it.
    retry: (failures, error) => !hasStatus(error, 404) && !hasStatus(error, 401) && failures < 3,
  })
}

/**
 * Loads the queue walk's next family in the background (§3.5, §10: Next under 200 ms; #2924
 * Decision 1). The app's cache defaults apply, so a family already loaded isn't read again.
 */
export function usePrefetchHousehold(householdCmId: number | null): void {
  const year = useYear()
  const queryClient = useQueryClient()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  const allowed = !authLoading && hasPermission(Permission.FINANCIAL_AID_VIEW)
  useEffect(() => {
    if (householdCmId === null || year <= 0 || !allowed) return
    void queryClient.prefetchQuery({
      queryKey: queryKeys.aidHouseholdPage(year, householdCmId),
      queryFn: () => fetchAidHouseholdPage(fetchWithAuth, year, householdCmId),
    })
  }, [householdCmId, year, allowed, queryClient, fetchWithAuth])
}
