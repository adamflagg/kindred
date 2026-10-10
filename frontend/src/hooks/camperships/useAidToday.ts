import { useQuery } from '@tanstack/react-query'

import { canOpenCamperships } from '../../config/programAccess'
import { Permission } from '../../constants/permissions'
import { useAuth } from '../../contexts/AuthContext'
import { fetchAidToday } from '../../services/camperships/aidApi'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'

/**
 * Today's one read (spec 2026-10-10 §9): view, summary or grantors; the server sends each its own sections.
 * `canOpenCamperships` is view/summary only, so grantors is added here: development reads Today with it alone. Inherits
 * the app's cache defaults: every aid write clears `aidTodayPrefix` (invalidateAidMoneyQueries, invalidateAidRulesQueries,
 * and the funder writers), and a sync completion clears the 'financial-aid' prefix.
 */
export function useAidToday() {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  return useQuery({
    queryKey: queryKeys.aidToday(year),
    queryFn: () => fetchAidToday(fetchWithAuth, year),
    enabled:
      year > 0 &&
      !authLoading &&
      (canOpenCamperships({ hasPermission }) || hasPermission(Permission.FINANCIAL_AID_GRANTORS)),
  })
}
