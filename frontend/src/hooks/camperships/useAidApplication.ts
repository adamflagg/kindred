import { useQuery } from '@tanstack/react-query'

import { Permission } from '../../constants/permissions'
import { useAuth } from '../../contexts/AuthContext'
import { fetchAidApplication, hasStatus } from '../../services/camperships/aidApi'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'

/**
 * A household's application, with its intake requests: the intake-named duplicate holder (Keep the other
 * request…) and the headcount (Headcount…) the casework forms need (§6.3). Session candidates come
 * from the grid row, not from here. Read only while a form that needs it is open, or (`enabled`)
 * while a page holds a pending duplicate whose pair the cards link (item 11); household 0 reads
 * nothing. App cache defaults; every write refreshes the application prefix.
 */
export function useAidApplication(
  householdCmId: number,
  { enabled = true }: { readonly enabled?: boolean } = {}
) {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  return useQuery({
    queryKey: queryKeys.aidApplication(year, householdCmId),
    queryFn: () => fetchAidApplication(fetchWithAuth, year, householdCmId),
    enabled:
      enabled &&
      year > 0 &&
      householdCmId > 0 &&
      !authLoading &&
      hasPermission(Permission.FINANCIAL_AID_VIEW),
    // No application is a 404: take it at its word. A 401 isn't retried either.
    retry: (failures, error) => !hasStatus(error, 404) && !hasStatus(error, 401) && failures < 3,
  })
}
