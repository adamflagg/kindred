import { useQuery } from '@tanstack/react-query'

import { Permission } from '../../constants/permissions'
import { useAuth } from '../../contexts/AuthContext'
import { fetchAidToPlace } from '../../services/camperships/aidApi'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'

/**
 * Money › To place's one read (spec §8.1; D21): the season's open lines by reason, the lines left at
 * family level and those reclassified, with the dashboard's suggestions and what confirming each would
 * tick. Live only (the route has no as-of). `householdCmId` scopes it to one household's D26 scope.
 * Inherits the app's cache defaults: every Camperships write refreshes it through
 * `invalidateAidMoneyQueries`, and a ledger sync through the 'financial-aid' prefix.
 */
export function useAidToPlace(householdCmId: number | null = null) {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  return useQuery({
    queryKey: queryKeys.aidToPlace(year, householdCmId),
    queryFn: () => fetchAidToPlace(fetchWithAuth, year, householdCmId),
    enabled: year > 0 && !authLoading && hasPermission(Permission.FINANCIAL_AID_VIEW),
  })
}
