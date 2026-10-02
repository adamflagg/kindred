import { useQuery } from '@tanstack/react-query'

import { Permission } from '../../constants/permissions'
import { useAuth } from '../../contexts/AuthContext'
import { fetchAidToday } from '../../services/camperships/aidApi'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'

/**
 * Today's read (§6.4; D21: the counts and the lists come from the same server query). Live only
 * (#2924), app cache defaults; every write refreshes it. The Requests grid reads it too, for a
 * listed line's rows (Decision 10), so `enabled` can turn it off there.
 */
export function useAidToday({ enabled = true }: { readonly enabled?: boolean } = {}) {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  return useQuery({
    queryKey: queryKeys.aidToday(year),
    queryFn: () => fetchAidToday(fetchWithAuth, year),
    enabled: enabled && year > 0 && !authLoading && hasPermission(Permission.FINANCIAL_AID_VIEW),
  })
}
